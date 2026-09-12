# syntax=docker/dockerfile:1

# --- frontend ---
FROM node:24.21.0-bookworm-slim AS web
WORKDIR /src
RUN corepack enable && corepack prepare pnpm@12.4.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @web-grep/shared build \
 && pnpm --filter @web-grep/web build

# --- backend ---
FROM golang:1.23-bookworm AS go
WORKDIR /src
COPY apps/server/ ./
ARG TARGETARCH
RUN CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH:-amd64} \
    go build -trimpath -ldflags="-s -w" -o /out/web-grep ./cmd/web-grep

# --- runtime ---
FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates ripgrep \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=go /out/web-grep /app/web-grep
COPY --from=web /src/apps/web/dist /app/web
ENV WEB_GREP_HOST=0.0.0.0 \
    WEB_GREP_PORT=8787 \
    WEB_GREP_ROOT=/data \
    WEB_GREP_RG=/usr/bin/rg \
    WEB_GREP_WEB_DIST=/app/web
EXPOSE 8787
USER nobody
ENTRYPOINT ["/app/web-grep"]
