# ============================================================
# Runtime image — no model builds. All inference (LLM, Whisper ASR, Kokoro
# TTS) is served by the host's Lemonade daemon; ffmpeg stays for audio
# chunking/merging, GLiNER/MiniLM ONNX stay in-process (encoder-only).
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

# Heap sized for the 48 GB container ceiling on the Beelink (PDF/image spikes,
# in-process GLiNER/MiniLM/Kokoro ONNX). LLM inference is the separate ollama
# service — see docker-compose.yml.
ENV NODE_OPTIONS="--max-old-space-size=8192"
# LLM runtime. On the deploy platform (single container, no compose sidecar)
# the Beelink host runs AMD Lemonade on Ollama's old port, serving BOTH wire
# protocols; we speak Ollama-native to it via the docker bridge gateway.
# Qwen3-8B-GGUF = the iGPU/Vulkan build (~16 tok/s, CPU ~idle); qwen3-8b-FLM
# is the NPU build (~4 tok/s, lowest power). docker-compose overrides this to
# its ollama sidecar; a real env var overrides both.
ENV OLLAMA_URL="http://172.17.0.1:11434"
ENV OLLAMA_MODEL="Qwen3-8B-GGUF"
# onnxruntime-node delivers inference results via libuv's worker pool; the default
# size (4) can be starved by the app's other native work (compression, sharp),
# stalling embedding. Give it generous headroom.
ENV UV_THREADPOOL_SIZE=16
EXPOSE 3000 3001

CMD ["pnpm", "start"]
