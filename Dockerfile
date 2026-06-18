# ============================================================
# Stage 1: Build whisper.cpp from source
#
# GPU_BACKEND options: "cpu" (default), "cuda", "rocm"
#
# For GPU builds, set the appropriate base image:
#   CPU:  docker build --build-arg GPU_BACKEND=cpu .
#   CUDA: docker build --build-arg GPU_BACKEND=cuda --build-arg BUILDER_IMAGE=nvidia/cuda:12.4.1-devel-ubuntu22.04 .
#   ROCm: docker build --build-arg GPU_BACKEND=rocm --build-arg BUILDER_IMAGE=rocm/dev-ubuntu-22.04:6.3 .
# ============================================================
ARG BUILDER_IMAGE=debian:bookworm
FROM ${BUILDER_IMAGE} AS builder

ARG GPU_BACKEND=cpu

RUN apt-get update && apt-get install -y \
    cmake \
    git \
    build-essential \
    unzip \
    tar \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /whisper

RUN git clone --depth 1 --branch v1.7.5 \
    https://github.com/ggml-org/whisper.cpp.git .

RUN if [ "$GPU_BACKEND" = "cuda" ]; then \
      cmake -B build -DGGML_CUDA=ON ; \
    elif [ "$GPU_BACKEND" = "rocm" ]; then \
      cmake -B build -DGGML_HIP=ON \
        -DCMAKE_C_COMPILER=/opt/rocm/bin/amdclang \
        -DCMAKE_CXX_COMPILER=/opt/rocm/bin/amdclang++ \
        -DCMAKE_PREFIX_PATH=/opt/rocm ; \
    else \
      cmake -B build ; \
    fi

RUN cmake --build build --config Release -j$(nproc)

# Collect GPU shared libraries needed at runtime
RUN mkdir -p /gpu-libs && \
    if [ "$GPU_BACKEND" = "cuda" ]; then \
      cp /usr/local/cuda/lib64/libcublas*.so* /gpu-libs/ 2>/dev/null || true ; \
      cp /usr/local/cuda/lib64/libcudart*.so* /gpu-libs/ 2>/dev/null || true ; \
      cp /usr/local/cuda/lib64/libcublasLt*.so* /gpu-libs/ 2>/dev/null || true ; \
    elif [ "$GPU_BACKEND" = "rocm" ]; then \
      for lib in libamdhip64 librocblas libhipblas; do \
        cp /opt/rocm/lib/${lib}*.so* /gpu-libs/ 2>/dev/null || true ; \
      done ; \
    fi

# ============================================================
# Stage 2: Runtime image
# ============================================================
# Node 22 LTS — pinned to match .nvmrc / package.json `engines` (locally,
# Homebrew node@22) so the native better-sqlite3 binding's ABI is identical
# across local, CI, and prod.
FROM node:22-slim

RUN apt-get update && apt-get install -y \
    git \
    graphicsmagick \
    ghostscript \
    ffmpeg \
    curl \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && git config --global safe.directory '*'

# Copy whisper-cli binary and shared libraries from builder
COPY --from=builder /whisper/build/bin/whisper-cli /usr/local/bin/whisper-cli
COPY --from=builder /whisper/build/src/libwhisper.so* /usr/local/lib/
COPY --from=builder /whisper/build/ggml/src/libggml*.so* /usr/local/lib/

# Copy GPU runtime libraries (empty dir for CPU builds)
COPY --from=builder /gpu-libs/ /usr/local/lib/
RUN ldconfig

# corepack reads package.json's `packageManager` field at run time, so the
# container's pnpm always matches whatever generated pnpm-lock.yaml — never
# hardcode a version here (it has broken `--frozen-lockfile` twice).
RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
# pnpm-workspace.yaml declares `docs` as an importer; frozen install needs its
# manifest present or the workspace shape (and overrides hash) won't match.
COPY docs/package.json ./docs/package.json
# puppeteer is a dev-only tool; its postinstall downloads Chrome and needs
# `unzip`, which node:22-slim lacks — skip the browser entirely in the image.
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN pnpm install --frozen-lockfile

COPY . .

# Heap kept generous to protect PDF/image processing under the 8 GB container
# ceiling. Entity extraction is GLiNER/ONNX in-process — no separate model server.
ENV NODE_OPTIONS="--max-old-space-size=3072"
# onnxruntime-node delivers inference results via libuv's worker pool; the default
# size (4) can be starved by the app's other native work (compression, sharp),
# stalling embedding. Give it generous headroom.
ENV UV_THREADPOOL_SIZE=16
EXPOSE 3000 3001

CMD ["pnpm", "start"]
