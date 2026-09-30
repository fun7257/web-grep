# Web Grep API 契约（v1）

前后端分离开发的**唯一接口标准**。字段名、错误码、SSE 事件以 `packages/shared` 的 Zod schema 为准；Go 服务必须与之逐字段对齐。

- 契约包：`@web-grep/shared`
- 当前版本：`1`。请求头 `X-Api-Version` **尚未实现**（Go 不读该头，带不带行为相同）；缺省即 v1。
- 传输：HTTP/1.1，JSON UTF-8；搜索为 SSE
- 基址：开发时 Vite `http://127.0.0.1:5173` 把 `/api` 代理到 Go `http://127.0.0.1:8787`

改接口的顺序：**先改 shared + 本文档 → 再并行改 Go 与 React**。禁止一端先发明字段。

---

## 1. 协作规则

| 规则 | 说明 |
| --- | --- |
| 单一真相 | 类型、默认值、上限只写在 `packages/shared/src`。前端 `safeParse` 响应；后端按同名字段吐 JSON。 |
| 兼容 | v1 内只允许**新增可选字段**。删除、改名、改语义必须升到 v2。**唯一例外**：2026-09-30 经产品确认，在 v1 内把请求字段 `andTerms` 改名为 `filterTerms`、`globAnd` 改名为 `globIntersect`。服务端**不再接受旧名**，旧名会被静默忽略（不报错）。此后不再有例外。 |
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
| `INVALID_QUERY` | 400 | 缺查询、超长、JSON 非法，或 `POST /api/search` 的 `Content-Type` 不是 `application/json` |
| `INVALID_PATH` | 400/404 | 路径越界、不存在 |
| `INVALID_GLOB` | 400 | glob 含 `!`、`--`、绝对路径、`..` |
| `DENIED` | 403 | 命中密钥/黑名单（如 `.env`） |
| `BUSY` | 429 | 超过上限。搜索：并发默认 8 路（`max_concurrent` / `WEB_GREP_MAX_CONCURRENT`）。`GET /api/tree`、`GET /api/file`：全局同时进行默认 32 路（`read_max_concurrent` / `WEB_GREP_READ_MAX_CONCURRENT`），并且每个客户端（有效会话令牌，否则 TCP 对端 IP）在窗口内默认 120 次（`read_rate_limit` / `WEB_GREP_READ_RATE_LIMIT`，窗口 `read_rate_window_ms` 默认 10000）。JSON `{ "code": "BUSY", "message": "…" }`，在读文件 / 列目录之前返回。登录没有这项限制。 |
| `ENGINE` | 503（开流前）或 SSE `error` | 开流前的 503：没有可用的 `rg`。搜索途中 `rg` 失败（如非法正则）：以 SSE `error` 事件终止，message 是 `rg` 的错误原文。**只有开流前的 `ENGINE`（或 `GET /api/meta` 的 `engine:"none"`）表示引擎不存在**；流里的 `ENGINE` 只是这一次搜索失败 |
| `UNAUTHORIZED` | 401 | 未登录或会话无效 |
| `INVALID_AUTH` | 400/401 | 密码不合法或错误。已启用登录时，请求体不是 JSON，或 `Content-Type` 不是 `application/json`，也是 400 `INVALID_AUTH`。未启用登录时不走到这个码：任何 `POST /api/auth/login` 都在检查 `Content-Type` 之前返回 `401 UNAUTHORIZED`（`auth is not enabled`） |
| `FORBIDDEN_HOST` | 403 | Host/Origin 不在允许名单 |
| `NOT_FOUND` | 404 | 未知的 `/api/*` 路径。路径越界或不存在仍是 `INVALID_PATH`，不是这个码 |
| `INTERNAL` | 500 | 未分类失败 |

`ENGINE_UNSUPPORTED` **不是**当前契约码（Go 不导出）。若客户端仍收到该码，按 `ENGINE` 处理。

`TIMEOUT` **不是**错误码。搜索超时走 SSE `done.timedOut=true`。

未知的 `/api/*` 路径（且已通过鉴权，或没设密码）返回 `404 { "code": "NOT_FOUND", "message": "not found" }`。鉴权在路由之前，所以没登录时未知路径也是 `401 UNAUTHORIZED`。

---

## 3. 接口一览

### `GET /api/health`（公开）

响应 `HealthResponseSchema`：

```json
{ "ok": true, "engine": "rg" }
```

`engine`：`rg` | `none`。与搜索 SSE `meta.engine`、`GET /api/meta` 的 `engine` 同一套枚举（没有 `literal`）。

### `GET /api/auth/status`（公开）

```json
{ "authRequired": true }
```

`authRequired` 为 true 且没有会话时显示登录。密码在 `config.yaml` 的 `token`（可用 `WEB_GREP_TOKEN` 临时覆盖）：写在 yaml 里的明文启动时会 SHA-256 后写回 `sha256:<hex>`。

### `POST /api/auth/login`（公开）

Body `{ "password" }` → `{ "token" }`。密码错误 `401 INVALID_AUTH`。

未设置登录密码时，本接口在检查 `Content-Type` 和请求体之前就返回 `401 UNAUTHORIZED`（message 为 `auth is not enabled`），不签发令牌。下面的 `Content-Type` 规则只在已启用登录时生效。

已启用登录时，`Content-Type` 必须是 `application/json`。可以附带参数（例如 `charset=utf-8`），判定只看媒体类型。缺失该头，或媒体类型不是 `application/json`（如 `text/plain`、`application/x-www-form-urlencoded`），与非 JSON 请求体相同：`400 INVALID_AUTH`（message 为 `invalid request`），不签发令牌。

### `POST /api/auth/logout`（公开）

撤销请求所带的会话令牌，响应 `{ "ok": true }`。**请求必须带着要撤销的令牌**（`Authorization: Bearer` 或 `X-Web-Grep-Token`）：不带令牌也返回 200 `{ "ok": true }`，但什么都不会撤销，令牌仍然有效。前端要先发退出请求，再清本地令牌。

### `GET /api/meta`（设置了密码时需会话）

`MetaResponseSchema`。

| 字段 | 说明 |
| --- | --- |
| `engine` | `rg` \| `none`。`none` 表示没找到 `rg`，搜索会 503 `ENGINE` |
| `rgVersion` | `rg --version` 的第一行；探测不到时为 `null` |
| `rootLabel` | 根目录的 basename，给界面显示用 |
| `root` | 根目录的**绝对路径**（已解析符号链接）。前端用它拼分享弹窗里可复现的 `rg` 命令。要注意：任何能调用 meta 的人都能看到服务器上的部署目录 |
| `followSymlinks` | 是否跟随符号链接（`follow_symlinks`，默认 `true`）。跟随时，解析后落在根外的命中会被丢弃，见搜索一节 |
| `limits` | 见下表 |
| `defaultLocale` | 固定 `"zh-CN"` |
| `authRequired` | 是否设置了登录密码 |
| `searchCount` | 本实例累计执行的搜索次数，落在配置文件旁的 `search-count`；内存先加，约每 2 秒以及进程退出时刷盘 |

`limits`：

| 字段 | 说明 |
| --- | --- |
| `maxResults` | 单次搜索的结果条数上限（`max_results`，默认 20000，`0` 不限）。`POST /api/search` 省略 `maxResults` 时用它 |
| `maxResultsHard` | 请求里 `maxResults` 的硬上限（`max_results_hard`）；`0` 表示没有硬上限 |
| `timeoutMs` | 单次搜索超时（`timeout_ms`），`0` 不超时 |
| `previewBytes` | `0` 表示不限制文件体积 |
| `queryMaxChars` | 单个查询串的最大长度 8192；服务端按字节计，见搜索一节的上限说明 |
| `previewChunk` / `previewChunkMax` | `GET /api/file` 省略 `count` 时的默认行数与上限（配置 `preview_chunk` / `preview_chunk_max`，默认 160 / 400） |
| `previewLines` | **已弃用**：仍会返回（配置 `preview_lines` / `WEB_GREP_PREVIEW_LINES`，默认 201），**不**改变文件预览行数 |

### `POST /api/search`（设置了密码时需会话）

**Request** `SearchRequestSchema`（JSON body）。`Content-Type` 必须是 `application/json`（可以附带 `charset`）；否则见下方请求上限后面的说明。

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `query` | 必填 | 1–8192 字节（口径见下方上限说明）。第一框。空条件丢弃。单框里的空格是查询内容，不是分隔符。 |
| `filterTerms` | `[]` | 额外过滤条件（filter），最多 **16** 项。每项是非空字符串，或 `{ query, regex?, caseSensitive?, wordMatch? }`（`query` 1–8192 字节）。与 `query` 同时命中（顺序不限）。**不会**折成一条 `a.*b\|b.*a` 正则；服务端对每一项再跑一轮 rg 过滤。字符串项按字面量、不区分大小写、非整词。对象项未写的修饰符为 false，不从顶层字段继承。当前 UI 把其余框发成对象。 |
| `path` | `""` | 相对目录；空=整个根 |
| `globInclude` | `[]` | 用户 glob 或树勾选转成的路径 glob（多项之间 OR） |
| `globIntersect` | `[]` | 与 `globInclude` 求交。当前 UI 发空数组；不要为了「用上字段」去改搜索范围 |
| `globExclude` | `[]` | |
| `regex` | `false` | `false` → rg `-F`（只作用于 `query`，不自动套到 `filterTerms`） |
| `caseSensitive` | `false` | 只作用于 `query` |
| `wordMatch` | `false` | 只作用于 `query` |
| `hidden` | `true` | `true` → rg `--hidden` |
| `maxResults` | 服务端配置 | 正整数；省略则用服务端 `max_results` |
| `mtimeAfter` | 省略=不限 | unix 毫秒。服务端先按文件 mtime 列出文件，再只对这些路径跑 rg |

请求上限（超出一律 `400 INVALID_QUERY`，不开流）：

| 项 | 上限 |
| --- | --- |
| `query`、`filterTerms[*].query` | 各 8192 **字节** |
| `filterTerms` | 16 项 |
| `path` | 4096 字节 |
| `globInclude` / `globIntersect` / `globExclude` | 每项 256 字节，每个数组 4096 项 |
| 请求体 | 约 1 MiB |
| `maxResults` | 正整数；配置了 `max_results_hard`（非 0）时不能超过它 |

`Content-Type` 同样在开流之前检查，不占用搜索槽：必须是 `application/json`。可以附带参数（例如 `charset=utf-8`），判定只看媒体类型。缺失该头，或媒体类型不是 `application/json`（如 `text/plain`、`application/x-www-form-urlencoded`），返回 `400 INVALID_QUERY`，响应不是 `text/event-stream`。

**注意口径不一致**：服务端按 UTF-8 **字节数**判断长度（Go `len`），而 `packages/shared` 的 Zod schema 的 `.max(8192)` 按 UTF-16 **码元数**判断。纯英文时两者相同；含中文时服务端更早拒绝，例如 2731 个汉字（8193 字节）能通过前端校验，却会被服务端以 `400 INVALID_QUERY` 拒掉。这是已知的不一致，尚未统一。

**Preflight（非 SSE）**：校验失败直接 HTTP JSON。空查询、非法路径、BUSY、ENGINE 都在开流之前返回。

**成功：SSE** `Content-Type: text/event-stream`，服务端每 5 秒发一条 `: ping` 心跳。

| event | data | 次数 |
| --- | --- | --- |
| `meta` | `{ searchId, engine, searchCount? }`（`engine`：`rg` \| `none`；`searchCount` 是本实例累计搜索次数，可选） | 恰好 1，最先 |
| `progress` | `{ files, matches }` | 0–N，搜索过程中，最多每 200ms 一条。搜得很快时可能一条都没有 |
| `hit` | `{ path, line, text, matches[{start,end}] }`。`text` 最长 65,536 **字节**（按 UTF-8 边界截断，不会切开一个字符；名字里带 `Chars` 的 `lineTextMaxChars` 常量实际按字节算），更长的行被截断，`matches` 也随之夹到截断后的范围内 | 0–N |
| `done` | `{ elapsedMs, matchCount, fileCount, truncated, timedOut, cancelled }` | 与 `error` 互斥。连接还在时恰好一个终态；客户端自己断开则这条连接上看不到终态，见下方边界表 |
| `error` | `{ code, message }` | 引擎失败（message 可含 rg stderr）；与 `done` 互斥 |

注释行 `: ping` 为心跳，客户端必须忽略。`matches.start/end` 是 **UTF-16 码元**（给 JS `string` 切片），不是字节。

搜索时的边界情况：

| 情况 | 行为 |
| --- | --- |
| 有路径读不了（没权限、符号链接环等） | rg 此时退出码为 2，但其余文件都已搜完。只要 rg 的 stderr 里全是这类「某个路径读不了」的错误，就照常以 `done` 收尾，服务端记一条 warn。不会再因为一个读不了的文件让整次搜索变成 `error`。正则错误、参数错误等其它 rg 失败仍以 `error`（`ENGINE`）收尾 |
| 符号链接 | `follow_symlinks` 开着（默认）时，rg 会跟进符号链接。服务端对每条命中解析真实路径。落在根外的命中**丢弃**，不计入 `matchCount`、`fileCount` 和 `maxResults`，与 `GET /api/file` 对同一路径返回 `INVALID_PATH` 保持一致。目标仍在根内的可以搜到；经根内符号链接到达的命中若与原路径是同一真实文件的同一行，只保留先到达的一条（按真实文件 + 行号去重）。文件链接和目录链接都这样。`matchCount` / `fileCount` 只计实际发出的命中 |
| 客户端自己断开 | 服务端中止这次搜索，日志为 `search abort`。连接已经断了，终态 `done` 不会再写出，所以这条连接上看不到 `done` |
| 服务端取消仍连着的搜索（既不是超时，也不是结果被截断） | 典型是收到 `SIGHUP` 热加载配置。终态仍是 `done`，且 `cancelled=true`（`timedOut` 与 `truncated` 为 false）。`matchCount` / `fileCount` 是已经发出的命中数，属于部分结果，客户端不能当作完整结果。超时仍是 `timedOut=true`，截断仍是 `truncated=true` |
| `search_zip`（配置，默认 `true`） | 传给 rg `--search-zip`。只搜 ripgrep 能解压的压缩流：gzip（`.gz`）、bzip2（`.bz2`）、xz（`.xz`）、lz4（`.lz4`）、lzma（`.lzma`）、brotli（`.br`）、zstd（`.zst`）。**不支持 `.zip` 归档**（搜 `.zip` 里的内容没有命中是预期）。解压程序要在进程的 `PATH` 里（rg 会去调 `gzip`、`brotli`、`lz4` 等）。找不到时 rg 按原字节读：文件里有 NUL 时当成二进制，API 是 0 命中；原文残留在压缩字节里、又没被当成二进制时，可能扫到一条脏行，那不是解压后的正文。这不是请求字段，见 `config.example.yaml` |
| `filterTerms` 某项 `regex:true` 但正则非法 | 以 `error`（`ENGINE`，message 含 rg 的 `regex parse error`）终止，不会挂起 |

仍保持连接、由服务端中止的搜索（`SIGHUP`）：`done.cancelled=true`，不是 `error`。客户端自己断开时，该连接收不到这条 `done`。超时：`done.timedOut=true`，不是 `error`。截断：`done.truncated=true`。

### `GET /api/tree`（设置了密码时需会话）

查询串 `TreeQuerySchema`：

| 参数 | 说明 |
| --- | --- |
| `path` | 相对目录；省略或空=根 |
| `mtimeAfter` | 可选，unix 毫秒。只列出该时间之后改过的文件，以及下面仍有这类文件的目录 |
| `include` | 可选，可重复。用户 glob；只保留匹配的文件（以及下面仍有匹配文件的目录）。当前 UI 不发 |
| `exclude` | 可选，可重复。用户 glob；去掉匹配的文件。当前 UI 排除框发这个参数 |

`include` / `exclude` 用与搜索相同的用户 glob 清洗（含 `!`、`--`、绝对路径、`..` 的项会被丢掉，目录树接口不因此 400）。可与 `mtimeAfter` 同时用。同一个参数值里的逗号、分号、空白会拆成多项。

分号在 URL 里必须写成 `%3B`。Go 标准库解析查询串时，把裸的 `;` 当成非法分隔符，丢掉**含有它的那一项**（同一条查询串里的其它参数还在）。因此 `?exclude=README.md;*.log` 等于没有 `exclude`，而 `?exclude=README.md%3B*.log` 会拆成两项并都生效。逗号和空白不受这条限制（`?exclude=*.log,README.md`、`?exclude=*.log%20README.md` 都会拆开）。前端用 `URLSearchParams` 组查询串，会把 `;` 编成 `%3B`。

没有通配符、也不含 `/` 的项是相对根的精确路径，不会自动变成 `目录/**`。`exclude=docs` 去不掉 `docs/` 下面的文件，目录项也还在；`exclude=README.md%3Bdocs` 只会去掉 `README.md`。要按文件名排除，用 `*.log` 这种带通配符的写法。

响应 `TreeListingSchema`：

```json
{
  "path": "",
  "truncated": false,
  "entries": [{ "name": "src", "path": "src", "dir": true }]
}
```

一次性只列一层。`.git` / `node_modules` / `.vite` / 密钥不出现。`truncated=true` 表示该层超过 2000 条被截断。超过读接口上限时 HTTP 429 `BUSY`（与 file 共用同一套限额）。

### `GET /api/file`（设置了密码时需会话）

查询串（`FileSliceQuerySchema`）：

| 参数 | 说明 |
| --- | --- |
| `path` | 必填，相对路径 |
| `from` | 起始行（1-based）。省略且未开 `tail` 时用 `line` 居中 |
| `count` | 行数。省略时用服务端 `preview_chunk`（默认 160）；超过 `preview_chunk_max`（默认 400）会被夹住。**不是** `preview_lines` |
| `line` | 可选，居中锚点 |
| `tail` | 可选。`1` / `true` 时从文件末尾取 `count` 行，不要求 `from` / `line`。当前 UI 弹窗跳行失败时会再请求 `tail=1` |

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
- 前端虚拟列表：可视区靠近已加载边界时再请求相邻切片。向上或向下补窗口时，每次只发一个请求，并保持视口锚点；**禁止**把 `scrollTop` 重置到第一行。见 §4 第 5 点。
- 超过读接口上限时 HTTP 429 `BUSY`（与 tree 共用同一套限额）。`preview_chunk` / 切片语义不变。

### 反向代理前缀（`public_path`）

设置 `public_path`（如 `/web-grep`）后，页面、静态资源和 API 都可以挂在前缀下：`/web-grep/`、`/web-grep/assets/*`、`/web-grep/api/*`。服务端会剥掉可选的前缀，所以**不带前缀的 `/api/*` 同样可用**，方便前面的代理自己剥前缀后再转发。`public_path` 不能以 `/api` 开头。Host/Origin 校验对两种写法一视同仁。

---

## 4. 前端必须遵守

1. 发请求前用 schema `parse`/`safeParse`。
2. 收响应再 `safeParse`；失败当 `INTERNAL`。
3. SSE 用缓冲拆帧（TCP 可把 `data:` 切断）；忽略 `:` 注释。
4. 换查询要 abort 上一轮搜索和预览。
5. 读文件窗口向上或向下补窗口时，每次靠近边界只发一个 `GET /api/file`，并且必须保持视口锚点：同一行仍留在视野里（行号前后相差不超过 1），不要用 `scrollTop` 重置到顶或第一行。只在「换文件 / 换命中行」时 `scrollTo` 一次。
6. 退出登录：先带着令牌调用 `POST /api/auth/logout`，再清本地令牌。先清再发，服务端会话不会被撤销。
7. 只有开流前的 `ENGINE`（或 `meta.engine` 为 `none`）才禁用搜索。流里途中的 `ENGINE`（如非法正则）只是这一次搜索失败，下一次仍要允许。

---

## 5. 后端必须遵守

1. JSON 字段名与 schema 完全一致（camelCase）。
2. 搜索 `cwd = root`（`config.yaml`），命中路径转相对路径后再发出。`mtimeAfter` 时不要把整个 root 交给 rg，只搜筛过的文件列表。
3. 先 preflight 再 SSE；SSE 开始后不要再发普通 JSON 错误体。
4. 文件接口按行扫描切片，不要 `ReadAll` 整文件。
5. 日志里的路径、查询和秘密：
   - 默认 `log_level=info`。启动行 `listening` 和热加载行 `reloaded config` 只带 `rootLabel`，不带搜索根的绝对路径。成功搜索的 info 行（`search done`）也不写查询全文。
   - yaml 与环境变量 `WEB_GREP_LOG_LEVEL` 都没有设置 `log_level` 时：普通启动仍是 `info`；开发模式改为 `debug`。开发模式指 `WEB_GREP_DEV` 为 `1`、`true` 或 `TRUE`（`pnpm dev` 设的是 `1`），或 yaml 里 `dev: true`。显式设置了 `log_level`（包括 `info`）则以显式值为准。
   - 登录密码和会话令牌不进任何级别的日志。
   - `rg` 命令只在 `debug` 级别打印，日志行的 `level` 是 `debug`。`cwd` 是搜索根绝对路径，`cmd` 是完整命令，里面有查询全文。默认 `info` 时，即使 `WEB_GREP_DEV=1`，也不会打这条。
   - `rg` 失败（例如非法正则）时，`warn`（`rg stderr`）和 `error`（`search failed`）只记录 stderr 的第一行（最多 200 个字符）和总行数（`lines`）。回显 pattern 的后续行不进 info 及以上。完整 stderr 只在 `debug` 级别记录。给客户端的 SSE `error` 事件的 `message` 仍是完整的 rg 报错（可含 `regex parse error` 和查询）。
   - `log_level=debug` 还可以有更多细节，例如启动时的 `root path`、搜索开始时的 `search start`（含查询）。

---

## 6. 版本策略

- 契约版本是 `1`。请求头 `X-Api-Version` **尚未实现**（Go 忽略），不要靠它分流。
- v1 冻结：上表路径与必填字段。
- 新增可选 JSON / 查询字段：改 shared，文档加一行，旧前端忽略即可。
- 破坏性变更：新路径 `/api/v2/...` 或新版本号，旧 v1 保留到明确下线。

---

## 7. 前端无 Go 时怎么开发

1. 改 Vite proxy 到本地 mock，或在 `apps/web/src/api/*` 用 fixture 短路。
2. Mock 必须能通过对应 `*Schema.safeParse`。
3. 搜索 mock 至少覆盖：`meta` → 若干 `hit` → `done`；以及 HTTP 400/401。
4. 文件 mock 按 `from/count` 切数组（`tail=1` 则取末尾），并正确设 `eof`。
5. 联调前跑 `pnpm --filter @web-grep/shared test` 与 `go test ./...`。
