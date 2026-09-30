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
- 多个过滤：点 **+** / 下拉，或 **Shift+Enter** 再开一框。空框不会参与匹配。同一行必须都命中（顺序不限）。
- `Aa` 大小写、`\b` 全词、`.*` 正则。默认字面量、忽略大小写。
- 左侧 **时间** 按**文件修改时间**限制目录树和可搜范围（不是日志行时间）。
- 树勾选后，搜索只覆盖选中路径。
- 文件树：点文件夹名展开/收起，点文件名开预览；**勾选只用行右侧的勾选框**（悬停出现；一旦有选中项，所有框常显）。键盘：↑↓ 移动，→ 展开，← 收起，空格勾选。
- 「已选 N」点开可看具体选了什么并单个移除；右侧滑块图标折叠/展开「排除」和「时间」（折叠状态会记住，有范围条件生效时图标带数字）。改范围条件不会收起已展开的文件夹。
- 选中一条搜索结果时，树会自动展开到该文件并滚动到可见。
- 超过 200 项的文件夹分批显示，滚到底部自动加载更多；单层最多列 2000 项，超出会提示已截断。
- 登录勾选 **记住密码**：令牌进 `localStorage`，关网页还在，直到退出或清站点数据。不勾则关标签即掉。会话在服务端内存里，**重启进程要重新登录**。
- 搜索次数在左侧栏底部；历史在搜索框左边的时钟按钮。

## Test / production (Docker) / 测试与生产

前后端打进**同一个镜像**。见 [`docs/docker.md`](docs/docker.md)：本地 `docker compose up --build -d`（镜像 `web-grep:local`），或 `docker compose -f compose.ghcr.yaml up -d` 拉取 GHCR `:dev` / `:vX.Y.Z`。

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
| `public_path` | `WEB_GREP_PUBLIC_PATH` | unset (`/`) | URL prefix when reverse-proxied (e.g. `/web-grep`). Assets and `/api` use this prefix. Do not use `/api`. |
| `token` | `WEB_GREP_TOKEN` | unset | Login password. Yaml plaintext is hashed at boot to `sha256:<hex>`. Required when bind is non-loopback. Env override is in-memory only. |
| `rg` | `WEB_GREP_RG` | unset | Absolute `rg` binary. |
| `web_dist` | `WEB_GREP_WEB_DIST` | next to binary | Built SPA directory. Docker image uses `/app/web`. |
| `dev` | `WEB_GREP_DEV` | `false` | Skip serving the SPA (`pnpm dev` sets `1`). |
| `log_level` | `WEB_GREP_LOG_LEVEL` | `info` | `debug \| info \| warn \| error`。默认 `info` 且未设 `WEB_GREP_DEV` 时，启动行与热加载行只含 `rootLabel`，不含搜索根绝对路径。令牌与密码不进日志。见下方说明 |
| `search_zip` | `WEB_GREP_SEARCH_ZIP` | `true` | 交给 rg `--search-zip`。只支持 gzip、bzip2、xz、lz4、lzma、brotli、zstd，且 `PATH` 里要有对应解压程序。不支持 `.zip` 归档。缺解压程序时没有解压后的正文（常见是 0 命中；压缩字节里残留原文时也可能是一条脏行） |

其余搜索参数（`max_results`、`timeout_ms`、`no_ignore` 等）见 `config.example.yaml`。`GET /api/tree` / `/api/file` 另有读接口限额：`read_max_concurrent`（默认 32）、`read_rate_limit`（默认 120 / `read_rate_window_ms` 默认 10s）。超限返回 HTTP 429 `BUSY`。搜索仍只用 `max_concurrent`。

- Loopback bind can start without `token`.
- Binding `0.0.0.0` without `token` **or** `public_host` fails at boot.
- After login the SPA stores a **session** token with no expiry. Checking **Remember password** writes it to `localStorage` until logout or the user clears site data; otherwise `sessionStorage` (cleared when the tab closes). Requests send `Authorization: Bearer` / `X-Web-Grep-Token`. The password is never sent on search. Sessions live in process memory, so restarting the server still requires a new login.
- Time range is **file mtime** (`mtimeAfter` from the browser), not a yaml key. Search history is in `localStorage`. Search count is a file next to `config.yaml` named `search-count`. The in-memory counter increments on every search; the file is flushed about every 2s and on SIGINT/SIGTERM. A crash before the next flush can lose recent increments.
- 日志：默认 `log_level=info` 且未设 `WEB_GREP_DEV` 时，启动行 `listening` 与热加载行 `reloaded config` 只含 `rootLabel`，不含搜索根绝对路径；成功搜索的 info 行也不含查询全文。登录密码和会话令牌不进日志。`WEB_GREP_DEV` 为 `1`、`true` 或 `TRUE`（`pnpm dev` 设的是 `1`），或 `WEB_GREP_LOG_LEVEL=debug` 时，每次搜索有一条 `level=info` 的 `rg` 日志，含搜索根绝对路径和完整命令（含查询全文）。`rg` 报错（如非法正则）时，stderr 会原样进 `warn` / `error`，可能回显查询片段。`log_level=debug` 还可以含 `root path`、`search start` 等更多细节。
- `SIGHUP` 会按同一条 `config.yaml` 路径重新加载配置，并以原子快照替换（并发请求不会读到半更新的字段）。进行中的搜索会被中止，仍保持连接的客户端会收到 `done.cancelled=true`（`matchCount` / `fileCount` 是已经发出的部分结果，不能当作完整结果）。客户端自己先断开的那条连接收不到 `done`。监听地址/端口不会在热加载时重绑。

## Architecture

React talks to Go over the same JSON/SSE contract as before (`POST /api/search` streams `rg --json`). The Go process sandboxes paths to `root`, then `os/exec`s ripgrep with `cwd` set to that root.

## License

[MIT](LICENSE)
