# Web Grep

Self-hosted React SPA + **Go** server that greps a configured filesystem root via **ripgrep**.

自托管的 React 单页应用 + Go 服务：在配置的文件系统根目录上运行 ripgrep，并在浏览器中展示结果。

## Requirements / 环境要求

- **Go** ≥ 1.24
- **Node.js** ≥ 24.0.0 (frontend only; `.nvmrc` = `24.21.0`)
- **pnpm** 12.4.0
- **ripgrep** (`rg`) on `PATH`, or the copy shipped under `node_modules` via `@vscode/ripgrep` after `pnpm install`（Docker 镜像已自带 `rg`）

## Install / 安装

```bash
nvm install && nvm use
corepack enable
corepack prepare pnpm@12.4.0 --activate
pnpm install
```

If `rg` is not on `PATH`, either `brew install ripgrep` / `apt install ripgrep`, set `rg:` in `config.yaml` (or `WEB_GREP_RG`) to an absolute binary, or rely on the optional `@vscode/ripgrep-*` platform package after `pnpm install`.

## Develop / 开发

```bash
cp config.example.yaml config.yaml   # set root:
pnpm dev
```

`pnpm dev` builds `@web-grep/shared`, starts Vite on `:5173`, and `go run`s the server on `127.0.0.1:8787`. Vite proxies `/api` to the Go process. The server loads `config.yaml` (`root` is required; `~` is expanded). `WEB_GREP_*` env vars override yaml keys for one shot (`WEB_GREP_DEV=1` is set by `pnpm dev`).

Open http://127.0.0.1:5173

前后端接口标准见 [`docs/API.md`](docs/API.md)。类型与默认值以 `packages/shared` 为准，两边按这份契约并行开发。

## Use / 使用

- 搜索框是**一条条件**。空格算进查询本身（`err msg` 是一整段）。
- 多条件 AND：点 **+** / 下拉，或 **Shift+Enter** 再开一框。空框不会参与匹配。同一行必须都命中（顺序不限）。
- `Aa` 大小写、`\b` 全词、`.*` 正则。默认字面量、忽略大小写。
- 左侧 **时间** 按**文件修改时间**限制目录树和可搜范围（不是日志行时间）。
- 树勾选后，搜索只覆盖选中路径。
- 登录勾选 **记住密码**：令牌进 `localStorage`，关网页还在，直到退出或清站点数据。不勾则关标签即掉。会话在服务端内存里，**重启进程要重新登录**。
- 搜索次数在左侧栏底部；历史在搜索框左边的时钟按钮。

## Test / production (Docker) / 测试与生产

前后端打进**同一个镜像**。见 [`docs/docker.md`](docs/docker.md)：`docker compose up --build -d` 或 `docker run`。

Without Docker:

```bash
pnpm build && pnpm start
```

`pnpm build` typechecks, builds the SPA, then compiles `dist/web-grep`。`pnpm start` 在仓库根目录跑该二进制（会向上找到 `config.yaml`），`GET /*` 在全部 `/api/*` 之后提供 SPA。

## Operator runbook / 运维手册

Primary config is `config.yaml` (see `config.example.yaml`). Path: `-config`, else `WEB_GREP_CONFIG`, else `./config.yaml` walking up from cwd, else next to the binary. `WEB_GREP_*` env vars override yaml keys.

| yaml | env override | Default | Notes |
| --- | --- | --- | --- |
| `root` | `WEB_GREP_ROOT` | **required** | Directory to search. Realpath’d at boot. `~` is expanded. |
| `host` | `WEB_GREP_HOST` | `127.0.0.1` | Bind address only. Never a HTTP Host name. |
| `port` | `WEB_GREP_PORT` | `8787` | Listen port. |
| `public_host` | `WEB_GREP_PUBLIC_HOST` | unset | List or comma-separated names/IPs in the address bar. Required when bind is non-loopback. Never `0.0.0.0`. |
| `token` | `WEB_GREP_TOKEN` | unset | Login password. Yaml plaintext is hashed at boot to `sha256:<hex>`. Required when bind is non-loopback. Env override is in-memory only. |
| `rg` | `WEB_GREP_RG` | unset | Absolute `rg` binary. |
| `web_dist` | `WEB_GREP_WEB_DIST` | next to binary | Built SPA directory. Docker image uses `/app/web`. |
| `dev` | `WEB_GREP_DEV` | `false` | Skip serving the SPA (`pnpm dev` sets `1`). |
| `log_level` | `WEB_GREP_LOG_LEVEL` | `info` | `debug \| info \| warn \| error` |

其余搜索参数（`max_results`、`timeout_ms`、`no_ignore` 等）见 `config.example.yaml`。

- Loopback bind can start without `token`.
- Binding `0.0.0.0` without `token` **or** `public_host` fails at boot.
- After login the SPA stores a **session** token with no expiry. Checking **Remember password** writes it to `localStorage` until logout or the user clears site data; otherwise `sessionStorage` (cleared when the tab closes). Requests send `Authorization: Bearer` / `X-Web-Grep-Token`. The password is never sent on search. Sessions live in process memory, so restarting the server still requires a new login.
- Time range is **file mtime** (`mtimeAfter` from the browser), not a yaml key. Search history is in `localStorage`. Search count is a file next to `config.yaml` named `search-count`.
- `SIGHUP` 会按同一条 `config.yaml` 路径重新加载配置。

## Architecture

React talks to Go over the same JSON/SSE contract as before (`POST /api/search` streams `rg --json`). The Go process sandboxes paths to `root`, then `os/exec`s ripgrep with `cwd` set to that root.

## License

[MIT](LICENSE)
