# Web Grep

Self-hosted React SPA + **Go** server that greps a configured filesystem root via **ripgrep**.

自托管的 React 单页应用 + Go 服务：在配置的文件系统根目录上运行 ripgrep，并在浏览器中展示结果。

## Requirements / 环境要求

- **Go** ≥ 1.23
- **Node.js** ≥ 24.0.0 (frontend only; `.nvmrc` = `24.21.0`)
- **pnpm** 12.4.0
- **ripgrep** (`rg`) on `PATH`, or the copy shipped under `node_modules` via `@vscode/ripgrep` after `pnpm install`

## Install / 安装

```bash
nvm install && nvm use
corepack enable
corepack prepare pnpm@12.4.0 --activate
pnpm install
```

If `rg` is not on `PATH`, either `brew install ripgrep` / `apt install ripgrep`, set `WEB_GREP_RG` to an absolute binary, or rely on the optional `@vscode/ripgrep-*` platform package after `pnpm install`.

## Develop / 开发

```bash
cp .env.example .env   # set WEB_GREP_ROOT
pnpm dev
```

`pnpm dev` builds `@web-grep/shared`, starts Vite on `:5173`, and `go run`s the server on `127.0.0.1:8787`. Vite proxies `/api` to the Go process. The server loads the repo-root `.env` (`WEB_GREP_ROOT` is required; `~` is expanded).

Open http://127.0.0.1:5173

前后端接口标准见 [`docs/API.md`](docs/API.md)。类型与默认值以 `packages/shared` 为准，两边按这份契约并行开发。

## Production / 生产

```bash
pnpm build && pnpm start
```

`pnpm build` typechecks, builds the SPA, then compiles `dist/web-grep`. `pnpm start` runs that binary, which serves `apps/web/dist` on `GET /*` **after** all `/api/*` routes.

## Operator runbook / 运维手册

### Search root / 搜索根目录

| Variable | Default | Notes |
| --- | --- | --- |
| `WEB_GREP_ROOT` | **required** | Directory to search. Realpath’d at boot. `~` is expanded. |

### Bind, Host, token / 绑定、Host、令牌

| Variable | Default | Notes |
| --- | --- | --- |
| `WEB_GREP_HOST` | `127.0.0.1` | Bind address only. Never used as a HTTP Host name. |
| `WEB_GREP_PORT` | `8787` | Listen port. |
| `WEB_GREP_PUBLIC_HOST` | unset | Comma-separated DNS names / IPs in the address bar. **Required** when bind is non-loopback. Never `0.0.0.0`. |
| `WEB_GREP_TOKEN` | unset | `Authorization: Bearer` or `X-Web-Grep-Token`. **Required** when bind is non-loopback. |
| `WEB_GREP_RG` | unset | Absolute override of the `rg` binary. |
| `WEB_GREP_DEV` | unset | `1` to skip serving the SPA (used by `pnpm dev`). |

- Loopback bind does not require a token. `localhost` / `127.0.0.1` / `::1` are always allowed Hosts (including Vite `:5173`).
- Binding `0.0.0.0` without `WEB_GREP_TOKEN` **or** `WEB_GREP_PUBLIC_HOST` fails at boot.

## Architecture

React talks to Go over the same JSON/SSE contract as before (`POST /api/search` streams `rg --json`). The Go process sandboxes paths to `WEB_GREP_ROOT`, then `os/exec`s ripgrep with `cwd` set to that root.
