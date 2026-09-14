#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

free_listen_port() {
  local port="$1"
  local pids
  pids="$(lsof -t -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -z "$pids" ]; then
    return 0
  fi
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true
  sleep 0.25
  pids="$(lsof -t -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null || true
  fi
}

cleanup() {
  if [ -n "${web_pid:-}" ]; then
    kill "$web_pid" 2>/dev/null || true
  fi
  if [ -n "${srv_pid:-}" ]; then
    kill "$srv_pid" 2>/dev/null || true
  fi
  free_listen_port 5173
  free_listen_port 8787
}

trap cleanup EXIT INT TERM HUP

free_listen_port 5173
free_listen_port 8787

pnpm --filter @web-grep/shared build
export WEB_GREP_DEV=1
pnpm --filter @web-grep/shared --filter @web-grep/web --parallel run dev &
web_pid=$!
go run -C "$ROOT/apps/server" ./cmd/web-grep -config "$ROOT/config.yaml" &
srv_pid=$!

for _ in $(seq 1 100); do
  if lsof -t -nP -iTCP:8787 -sTCP:LISTEN >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$srv_pid" 2>/dev/null; then
    wait "$srv_pid" || true
    echo "web-grep server failed to listen on :8787" >&2
    exit 1
  fi
  sleep 0.1
done
if ! lsof -t -nP -iTCP:8787 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "web-grep server did not listen on :8787 within 10s" >&2
  exit 1
fi

wait
