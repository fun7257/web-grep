# syntax=docker/dockerfile:1
# Single runtime image. Node/Go stages are build-only; you run one container.
# Multi-arch (linux/amd64 + linux/arm64): Node/Go compile on $BUILDPLATFORM;
# Go cross-compiles with TARGETOS/TARGETARCH (no ARG defaults — a default
# would shadow BuildKit and put the wrong binary in the other arch).

# --- build SPA (not shipped; JS output is arch-independent) ---
FROM --platform=$BUILDPLATFORM node:24.21.0-bookworm-slim AS web
WORKDIR /src
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@12.4.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=web-grep-pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
 && pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @web-grep/shared build \
 && pnpm --filter @web-grep/web build

# --- build API binary (not shipped) ---
FROM --platform=$BUILDPLATFORM golang:1.24-bookworm AS go
WORKDIR /src
COPY apps/server/ ./
# BuildKit injects these per --platform target (or host for a plain docker build).
ARG TARGETOS
ARG TARGETARCH
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags="-s -w" -o /out/web-grep ./cmd/web-grep

# --- run: static Go binary + SPA + musl rg ---
FROM alpine:3.21
RUN apk add --no-cache ripgrep
WORKDIR /app
COPY --from=go /out/web-grep /app/web-grep
COPY --from=web /src/apps/web/dist /app/web
COPY config.docker.yaml /app/config.yaml
EXPOSE 8787
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=8 \
    CMD wget -qO- http://127.0.0.1:8787/api/health >/dev/null || exit 1
ENTRYPOINT ["/app/web-grep"]
