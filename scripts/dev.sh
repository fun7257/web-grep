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
go run -C "$ROOT/apps/server" ./cmd/web-grep &
srv_pid=$!
wait
