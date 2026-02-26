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
FROM node:25-slim

RUN apt-get update && apt-get install -y \
    git \
    graphicsmagick \
    ghostscript \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && git config --global safe.directory '*'

# Copy whisper-cli binary and shared libraries from builder
COPY --from=builder /whisper/build/bin/whisper-cli /usr/local/bin/whisper-cli
COPY --from=builder /whisper/build/src/libwhisper.so* /usr/local/lib/
COPY --from=builder /whisper/build/ggml/src/libggml*.so* /usr/local/lib/

# Copy GPU runtime libraries (empty dir for CPU builds)
COPY --from=builder /gpu-libs/ /usr/local/lib/
RUN ldconfig

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm install pnpm -g

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

ENV NODE_OPTIONS="--max-old-space-size=4096"
EXPOSE 3000 3001

CMD ["pnpm", "start"]
