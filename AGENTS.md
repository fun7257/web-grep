# AGENTS.md

给后续 agent 改本仓库用的开发规范。动手前先对齐，改完开 PR 先不合。

## 动手前

- 先跟人对齐方案再改代码
- 大改走 PR；先不合，等 Test 过、PM 放行再合
- 说人话同步进度：改了啥、为啥、要谁定什么

## 冻结约定

- 搜索多条件语义冻结。不要改 and 条件契约（`andTerms`）、SSE 事件名（`meta` / `progress` / `hit` / `done` / `error`）或相关产品行为，除非产品明确放开。

## Backend

- 栈：Go 服务在 `apps/server`（入口 `apps/server/cmd/web-grep`）。契约在 `packages/shared`，说明在 `docs/API.md`。
- 路径和错误码先稳住，不要改现有 `/api` 路由和 `code`。当前路由：`GET /api/health`、`GET /api/auth/status`、`POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/meta`、`POST /api/search`、`GET /api/tree`、`GET /api/file`。`GET /api/count` 已删，不要加回去。
- 拉文件行数只认配置 `preview_chunk` / `preview_chunk_max`（环境变量 `WEB_GREP_PREVIEW_CHUNK` / `WEB_GREP_PREVIEW_CHUNK_MAX`）。废弃的 `preview_lines` 只还会出现在 meta 的 `previewLines`，**不能**改变 `GET /api/file`。
- 并发：搜索走 `max_concurrent`（默认 8，超限 HTTP 429 `BUSY`）。树和文件走 `read_max_concurrent` / `read_rate_limit` / `read_rate_window_ms`（默认 32 路、每客户端 10 秒 120 次）。取消必须释放槽位。
- 测试：动过的包跑 `go test`。钉死测试要绿：登录会话、取消释放搜索槽、满并发 `BUSY`、`preview_chunk` 针、有 rg 时的真实边沿（`httpapi` 里 `TestPin*`）。
- 没验证过的行为不要写进结论。别顺手大重构。别自己合 main。

## Front

- 改页面、状态、样式前先跟人对齐；开 PR 先不合，等 Test 过、PM 放行再合。
- 类型与契约：以 `packages/shared` 为准，字段名跟接口一致。预览每次拉多少行：有 meta.`previewChunk` 就用它（可按 `previewChunkMax` 截），没有再用共享默认；不要把废弃的 `previewLines` 当每次块大小。
- 搜索多条件语义冻结，别改。发请求走统一客户端（`apps/web/src/api`：拼前缀、带令牌、解析错误、可取消）；换条件/关弹窗要 abort，别让旧请求改界面。
- 本地：`pnpm typecheck` / `pnpm lint` / `pnpm test`（vitest）。冒烟：登录 → 搜一下 → 树点文件名出预览弹窗。
- 别顺手大重构、别合 main、别编造未验证结果。

## 禁止

- 未经放行合进 main
- 编造未验证的测试/行为结果
- 无关大重构、复制粘贴式改半截契约
