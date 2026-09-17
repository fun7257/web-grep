# Web Grep API 契约（v1）

前后端分离开发的**唯一接口标准**。字段名、错误码、SSE 事件以 `packages/shared` 的 Zod schema 为准；Go 服务必须与之逐字段对齐。

- 契约包：`@web-grep/shared`
- 当前版本：`1`（请求可带 `X-Api-Version: 1`，缺省视为 1）
- 传输：HTTP/1.1，JSON UTF-8；搜索为 SSE
- 基址：开发时 Vite `http://127.0.0.1:5173` 把 `/api` 代理到 Go `http://127.0.0.1:8787`

改接口的顺序：**先改 shared + 本文档 → 再并行改 Go 与 React**。禁止一端先发明字段。

---

## 1. 协作规则

| 规则 | 说明 |
| --- | --- |
| 单一真相 | 类型、默认值、上限只写在 `packages/shared/src`。前端 `safeParse` 响应；后端按同名字段吐 JSON。 |
| 兼容 | v1 内只允许**新增可选字段**。删除、改名、改语义必须升到 v2。 |
| 默认值 | 请求里省略的字段按 Zod `.default()`。前端若行为与默认不同，必须显式传（当前 UI：`regex: false`、`caseSensitive: false`、`hidden: true`）。 |
| 路径 | 客户端只出现 POSIX **相对路径**（`src/a.ts`）。禁止绝对路径、`..`、NUL。 |
| 错误 | 机器可读 `code` + 给人看的 `message`。不要把 Zod issue 数组或 Go error 原文直接给浏览器。 |
| 鉴权 | 单密码。`GET /api/health`、`GET /api/auth/status`、`POST /api/auth/login`、`POST /api/auth/logout` 以及非 `/api` 的 SPA 静态资源免会话，但仍校验 Host/Origin。其余 `/api/*` 在设置了 `token` 时需要登录后的 `Authorization: Bearer` 或 `X-Web-Grep-Token`（会话令牌，不是密码）。会话不过期，直到退出或服务重启。勾选「记住密码」把令牌放 `localStorage`，否则 `sessionStorage`（关标签即丢）。 |
| 401 vs 403 | `401 UNAUTHORIZED`：弹登录。`INVALID_AUTH`：密码错误。`403 FORBIDDEN_HOST`：不是登录问题。 |

并行开发建议：

1. 在 shared 里改/加 schema，补 `packages/shared/test/schemas.test.ts`。
2. 前端可以先 `safeParse` + mock JSON/SSE（见第 7 节）。
3. Go 按字段实现；用 `httptest` 对同一份 JSON 形状做断言。
4. 双方都绿再联调 `pnpm dev`。

---

## 2. 通用错误

HTTP JSON（SSE 尚未开始时）：

```json
{ "code": "INVALID_QUERY", "message": "invalid query" }
```

`code` 枚举（`ErrorCodeSchema`）：

| code | HTTP | 含义 |
| --- | --- | --- |
| `INVALID_QUERY` | 400 | 缺查询、超长、JSON 非法 |
| `INVALID_PATH` | 400/404 | 路径越界、不存在 |
| `INVALID_GLOB` | 400 | glob 含 `!`、`--`、绝对路径、`..` |
| `DENIED` | 403 | 命中密钥/黑名单（如 `.env`） |
| `BUSY` | 429 | 超过并发上限。默认 8 路（`max_concurrent` / `WEB_GREP_MAX_CONCURRENT`，`MaxConcurrentDefault=8`） |
| `ENGINE` | 503 | 没有可用的 `rg` |
| `UNAUTHORIZED` | 401 | 未登录或会话无效 |
| `INVALID_AUTH` | 400/401 | 密码不合法或错误 |
| `FORBIDDEN_HOST` | 403 | Host/Origin 不在允许名单 |
| `INTERNAL` | 500 | 未分类失败 |

`ENGINE_UNSUPPORTED` **不是**当前契约码（Go 不导出）。若客户端仍收到该码，按 `ENGINE` 处理。

`TIMEOUT` **不是**错误码。搜索超时走 SSE `done.timedOut=true`。

---

## 3. 接口一览

### `GET /api/health`（公开）

```json
{ "ok": true, "engine": "rg" }
```

`engine`：`rg` | `none`。

### `GET /api/auth/status`（公开）

```json
{ "authRequired": true }
```

`authRequired` 为 true 且没有会话时显示登录。密码在 `config.yaml` 的 `token`（可用 `WEB_GREP_TOKEN` 临时覆盖）：写在 yaml 里的明文启动时会 SHA-256 后写回 `sha256:<hex>`。

### `POST /api/auth/login`（公开）

Body `{ "password" }` → `{ "token" }`。密码错误 `401 INVALID_AUTH`。

### `POST /api/auth/logout`（公开）

撤销当前会话令牌。`{ "ok": true }`。

### `GET /api/meta`（设置了密码时需会话）

见 `MetaResponseSchema`。`rgVersion` 可为 `null`。`rootLabel` 是根目录 basename，不是绝对路径。`previewBytes=0` 表示不限制文件体积。含 `authRequired`、`searchCount`（本实例累计执行的搜索次数，落在配置文件旁的 `search-count`）。

### `POST /api/search`（设置了密码时需会话）

**Request** `SearchRequestSchema`（JSON body）：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `query` | 必填 | 1–8192 字符。UI 多条件 AND 时，前端编成同一行的 `a.*b\|b.*a`（字面量会先转义）；空条件丢弃。单框里的空格是查询内容，不是分隔符。 |
| `path` | `""` | 相对目录；空=整个根 |
| `globInclude` | `[]` | 用户 glob 或树勾选转成的路径 glob（多项之间 OR） |
| `globAnd` | `[]` | 与 `globInclude` 求交；树勾选后再套高级选项的包含 glob |
| `globExclude` | `[]` | |
| `regex` | `false` | `false` → rg `-F` |
| `caseSensitive` | `false` | |
| `wordMatch` | `false` | |
| `hidden` | `true` | `true` → rg `--hidden` |
| `maxResults` | 服务端配置 | 正整数；省略则用服务端 `max_results` |
| `mtimeAfter` | 省略=不限 | unix 毫秒。服务端先按文件 mtime 列出文件，再只对这些路径跑 rg |

**Preflight（非 SSE）**：校验失败直接 HTTP JSON。空查询、非法路径、BUSY、ENGINE 都在开流之前返回。

**成功：SSE** `Content-Type: text/event-stream`

| event | data | 次数 |
| --- | --- | --- |
| `meta` | `{ searchId, engine }`（`engine`：`rg` \| `none`） | 恰好 1，最先 |
| `progress` | `{ files, matches }` | 0–N，搜索过程中 |
| `hit` | `{ path, line, text, matches[{start,end}] }` | 0–N |
| `done` | `{ elapsedMs, matchCount, fileCount, truncated, timedOut, cancelled }` | 与 `error` 互斥，恰好一个终态 |
| `error` | `{ code, message }` | 引擎失败（message 可含 rg stderr）；与 `done` 互斥 |

注释行 `: ping` 为心跳，客户端必须忽略。`matches.start/end` 是 **UTF-16 码元**（给 JS `string` 切片），不是字节。

取消：关掉 fetch（AbortController）。超时：`done.timedOut=true`，不是 `error`。

### `GET /api/count?path=`（设置了密码时需会话）

`{ "count": 12 }`。统计该路径下的文件数，可选 `mtimeAfter`（unix 毫秒），规则与目录树过滤相同。

### `GET /api/tree?path=`（设置了密码时需会话）

`path` 省略或空=根。响应 `TreeListingSchema`：

```json
{
  "path": "",
  "truncated": false,
  "entries": [{ "name": "src", "path": "src", "dir": true }]
}
```

一次性只列一层。`.git` / `node_modules` / `.vite` / 密钥不出现。`truncated=true` 表示该层超过 2000 条被截断。可选 `mtimeAfter`（unix 毫秒）：只列出该时间之后改过的文件，以及下面仍有这类文件的目录。

### `GET /api/file`（设置了密码时需会话）

查询串（`FileSliceQuerySchema`）：

| 参数 | 说明 |
| --- | --- |
| `path` | 必填，相对路径 |
| `from` | 起始行（1-based）。省略则用 `line` 居中 |
| `count` | 行数，默认 160，最大 400 |
| `line` | 可选，居中锚点 |

响应 `FileWindowResponseSchema`：一段行窗口，**不是整文件**。

```json
{
  "path": "src/a.ts",
  "startLine": 80,
  "lineCount": 160,
  "truncated": false,
  "binary": false,
  "eof": false,
  "lines": [{ "n": 80, "text": "..." }]
}
```

- `eof=true`：这是文件末尾，不要再请求 `from=hi+1`。
- `binary=true`：`lines` 为空，不要当文本渲染。
- 前端虚拟列表：可视区靠近已加载边界时再请求相邻切片；**禁止**因新切片把 scrollTop 重置到第一行。

---

## 4. 前端必须遵守

1. 发请求前用 schema `parse`/`safeParse`。
2. 收响应再 `safeParse`；失败当 `INTERNAL`。
3. SSE 用缓冲拆帧（TCP 可把 `data:` 切断）；忽略 `:` 注释。
4. 换查询要 abort 上一轮搜索和预览。
5. 预览切片合并后保持用户当前滚动位置；只在「换文件 / 换命中行」时 `scrollTo` 一次。

---

## 5. 后端必须遵守

1. JSON 字段名与 schema 完全一致（camelCase）。
2. 搜索 `cwd = root`（`config.yaml`），命中路径转相对路径后再发出。`mtimeAfter` 时不要把整个 root 交给 rg，只搜筛过的文件列表。
3. 先 preflight 再 SSE；SSE 开始后不要再发普通 JSON 错误体。
4. 文件接口按行扫描切片，不要 `ReadAll` 整文件。
5. 不把绝对路径、token、查询全文（非 debug）打进 info 日志。

---

## 6. 版本策略

- 请求头 `X-Api-Version: 1` 可选。
- v1 冻结：上表路径与必填字段。
- 新增可选 JSON 字段：改 shared，文档加一行，旧前端忽略即可。
- 破坏性变更：新路径 `/api/v2/...` 或新版本号，旧 v1 保留到明确下线。

---

## 7. 前端无 Go 时怎么开发

1. 改 Vite proxy 到本地 mock，或在 `apps/web/src/api/*` 用 fixture 短路。
2. Mock 必须能通过对应 `*Schema.safeParse`。
3. 搜索 mock 至少覆盖：`meta` → 若干 `hit` → `done`；以及 HTTP 400/401。
4. 文件 mock 按 `from/count` 切数组，并正确设 `eof`。
5. 联调前跑 `pnpm --filter @web-grep/shared test` 与 `go test ./...`。
