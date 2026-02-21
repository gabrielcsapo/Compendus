FROM node:25-slim

RUN apt-get update && apt-get install -y \
    git \
    graphicsmagick \
    ghostscript \
    && rm -rf /var/lib/apt/lists/* \
    && git config --global safe.directory '*'

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