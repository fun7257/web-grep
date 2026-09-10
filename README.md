# Web Grep

Self-hosted React SPA + Node server that greps a configured filesystem root via ripgrep.

自托管的 React 单页应用 + Node 服务：在配置的文件系统根目录上运行 ripgrep，并在浏览器中展示结果。

## Requirements / 环境要求

- **Node.js** ≥ 24.0.0 (`.nvmrc` = `24.21.0`)
- **pnpm** 12.4.0 (`packageManager` field)

## Install / 安装

```bash
# Node 24.21.0 via nvm (or n, fnm, etc.)
nvm install
nvm use

# pnpm 12.4.0 via Corepack
corepack enable
corepack prepare pnpm@12.4.0 --activate

pnpm install
```

`@vscode/ripgrep@1.18.0` ships platform binaries as **optionalDependencies** (no postinstall network fetch). Air-gapped installs work when the optional package for the host arch is present in the lockfile/store. Exotic arch falls through to `WEB_GREP_RG` or the literal JS walker.

`@vscode/ripgrep@1.18.0` 通过 **optionalDependencies** 附带平台二进制（**没有** postinstall 联网下载）。离线安装只要 lockfile/store 里有当前架构的可选包即可。冷门架构则使用 `WEB_GREP_RG` 或字面量搜索。

## Develop / 开发

```bash
pnpm dev
```

`predev` builds `@web-grep/shared` first. Then Vite (5173) and the Hono server (`127.0.0.1:8787`) start in parallel. Vite proxies `/api` to the server.

## Production / 生产

```bash
cp .env.example .env
# set WEB_GREP_ROOT (required) and other keys
pnpm build && pnpm start
```

`pnpm build` runs `tsc -b` then Vite. `pnpm start` runs the compiled server, which serves `apps/web/dist` on `GET /*` **after** all `/api/*` routes.

`pnpm build` 先 `tsc -b` 再 Vite。`pnpm start` 启动编译后的服务：在全部 `/api/*` 之后用 `GET /*` 托管 `apps/web/dist`。

Load env with Node 24:

```bash
WEB_GREP_ROOT=/path/to/tree node --env-file=.env apps/server/dist/index.js
```

Or export variables, then `pnpm start`.

## Operator runbook / 运维手册

### Search root / 搜索根目录

| Variable | Default | Notes |
| --- | --- | --- |
| `WEB_GREP_ROOT` | **required** | Absolute directory. Realpath’d at boot. Missing / unreadable → process exits. |

`WEB_GREP_ROOT` **必填**，必须是可读目录。启动时 `realpath` 一次。

### Bind, Host, token / 绑定、Host、令牌

| Variable | Default | Notes |
| --- | --- | --- |
| `WEB_GREP_HOST` | `127.0.0.1` | **Bind address only** (`127.0.0.1`, `::1`, `0.0.0.0`, `::`). Never used as a Host name. |
| `WEB_GREP_PORT` | `8787` | Listen port. |
| `WEB_GREP_PUBLIC_HOST` | unset | Comma-separated DNS names / IPs in the address bar (e.g. `192.168.1.10,grep.lab`). **Required** when bind is non-loopback. Never `0.0.0.0`. |
| `WEB_GREP_TOKEN` | unset | If set, required as `Authorization: Bearer` or `X-Web-Grep-Token`. **Required** when bind is non-loopback. |

- Loopback bind (`127.0.0.1` / `::1`) does not require a token. The SPA still talks to `/api` on that host.
- Binding `0.0.0.0` or `::` **without** `WEB_GREP_TOKEN` **or** without `WEB_GREP_PUBLIC_HOST` fails at boot.
- `0.0.0.0` is a bind address, not a Host. Set `WEB_GREP_PUBLIC_HOST` to the name/IP you type in the browser (LAN IP, DNS name).
- The SPA prompts for the token (sessionStorage). Do not put the token in the URL.

回环绑定默认不需要令牌。非回环监听必须同时设置 `WEB_GREP_TOKEN` 和 `WEB_GREP_PUBLIC_HOST`。`0.0.0.0` 只是绑定地址，不能当 Host；把浏览器地址栏里的名字/IP 写进 `WEB_GREP_PUBLIC_HOST`。SPA 用 sessionStorage 提示输入令牌，不要把令牌放进 URL。

Example LAN bind / 局域网示例:

```bash
WEB_GREP_ROOT=/srv/code \
WEB_GREP_HOST=0.0.0.0 \
WEB_GREP_PORT=8787 \
WEB_GREP_PUBLIC_HOST=192.168.1.10 \
WEB_GREP_TOKEN=long-random-token \
pnpm start
```

Open `http://192.168.1.10:8787/` and enter the token when prompted.

### Ripgrep detection / 检测 rg

Order / 顺序:

1. `WEB_GREP_RG` — absolute path to an executable `rg`
2. Walk `PATH` for `rg` / `rg.exe` (no `which`)
3. `@vscode/ripgrep` `rgPath` if the optional native package resolved for this platform
4. Literal JS walker (`engine: "literal"`) — last resort, **not equivalent** to rg

Installing a system ripgrep (optional if the bundled binary resolved):

```bash
# macOS
brew install ripgrep

# Debian/Ubuntu
sudo apt install ripgrep
```

Air-gap / 离线:

- Prefer the lockfile + pnpm store so `@vscode/ripgrep`’s optional platform package is already present.
- Or set `WEB_GREP_RG=/absolute/path/to/rg` to a binary you copied onto the machine.
- If neither is available, the server still boots and uses **literal** search: no `.gitignore` / `.ignore` / `.rgignore`, no regex (`ENGINE_UNSUPPORTED`), depth 32. The UI banner states this gap.

离线优先用已有 lockfile/store 中的平台包；否则把 `rg` 拷到机器上并设置 `WEB_GREP_RG`。都没有时启动仍成功，降级为字面量搜索（不读 gitignore、不支持正则、深度 32）。界面横幅会说明差异。

### Other keys / 其他变量

See `.env.example` for `WEB_GREP_MAX_RESULTS`, timeout, preview caps, `WEB_GREP_FOLLOW_SYMLINKS`, `WEB_GREP_NO_IGNORE`, `WEB_GREP_ALLOW_SECRETS`, log level.

## Check / 检查

```bash
pnpm --filter @web-grep/shared build
pnpm typecheck
pnpm test
pnpm lint
```
