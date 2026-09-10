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

## Develop / 开发

```bash
pnpm dev
```

`predev` builds `@web-grep/shared` first. Then Vite (5173) and the Hono server (`127.0.0.1:8787`) start in parallel. Vite proxies `/api` to the server.

## Check / 检查

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm --filter @web-grep/web build
```
