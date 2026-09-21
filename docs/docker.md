# Docker 部署

前后端打进**同一个镜像、同一个容器**：Go 提供页面和 `/api`，镜像内带 ripgrep（Alpine）。配置主文件是容器里的 `/app/config.yaml`（由 `config.docker.yaml` 打进去：`root: /data`）。`WEB_GREP_*` 只做临时覆盖。

镜像有两条路：本机 `docker compose up --build` 现场构建，或拉取 GitHub Container Registry（GHCR）上已发布的镜像。

## 准备

- 宿主机已装 Docker / Compose
- 在目标架构上构建（本机 Apple Silicon 导出的是 `linux/arm64`，x86 测试机要在那台机器上 `docker build`，或 `--platform linux/amd64`）。GHCR 上由 Actions 推送的镜像是 `linux/amd64`
- 登录密码：Compose 用环境变量 `WEB_GREP_TOKEN`；也可以写进自己的 yaml 后用 `docker run` 挂载

## GHCR 镜像 / Published images

合入 `main` 或推送 `v*` git tag 后，[`.github/workflows/docker.yml`](../.github/workflows/docker.yml) 用仓库根目录的 `Dockerfile` 构建并推到 GHCR。镜像名是 `ghcr.io/<owner>/<repo>`（小写），本仓库为：

`ghcr.io/fun7257/web-grep`

| 触发 / Trigger | 标签 / Tag | 说明 |
| --- | --- | --- |
| push 到 `main`（合并后） | `:dev` | **可变 tag**：每次合并都会重建并覆盖上一份 `dev` |
| push git tag `v*`（如 `v0.2.0`） | `:v0.2.0` 以及 `:latest` | 精确版本 tag 不会被后续构建改写；`:latest` 只随新的 `v*` tag 移动 |

发布版本：在已合入的 `main` 上打 tag，再推送（不要 force-push 已有 tag）：

```bash
git checkout main && git pull
git tag v0.2.0
git push origin v0.2.0
```

Workflow 看到 `v*` tag 就会构建该提交，并打上同名镜像 tag（以及 `latest`）。

拉取：

```bash
docker pull ghcr.io/fun7257/web-grep:dev      # 跟 main 走，会被下次合并覆盖
docker pull ghcr.io/fun7257/web-grep:v0.2.0   # 钉死某个版本
docker pull ghcr.io/fun7257/web-grep:latest   # 最近一次 v* 发布
```

公开包可以直接 `docker pull`。若 Packages 页里该包是 private，先：

```bash
echo "$GITHUB_TOKEN" | docker login ghcr.io -u USERNAME --password-stdin
```

`GITHUB_TOKEN` / PAT 需要 `read:packages`。仓库管理员可在 GitHub Packages 把包改成 Public，匿名才能拉。镜像带 `org.opencontainers.image.source`，会链回本仓库。

## Compose（本地构建）

现有本地路径不变：现场构建，镜像名统一为 `web-grep:local`。

```bash
WEB_GREP_DATA=/要搜索的宿主机目录 \
WEB_GREP_TOKEN=登录密码 \
WEB_GREP_PUBLIC_HOST=测试机IP或域名,127.0.0.1 \
docker compose up --build -d
```

打开 `http://<WEB_GREP_PUBLIC_HOST>:8787`，用 `WEB_GREP_TOKEN` 登录。

## Compose / `docker run`（GHCR）

挂卷规则与上面相同：`root` 必须是容器内 `/data`，不要把本机开发用的 `config.yaml` 挂进去。

仓库根目录的 [`compose.ghcr.yaml`](../compose.ghcr.yaml) 与本地 `docker-compose.yml` 同一套环境变量和 `/data` 挂载，只是拉 GHCR、不构建。默认镜像是 `:dev`；钉版本时加 `WEB_GREP_IMAGE`（不要 `--build`）：

```bash
WEB_GREP_DATA=/要搜索的宿主机目录 \
WEB_GREP_TOKEN=登录密码 \
WEB_GREP_PUBLIC_HOST=测试机IP或域名,127.0.0.1 \
docker compose -f compose.ghcr.yaml up -d
```

```bash
# 钉死版本 tag（不要 force-push 已有 git tag）
WEB_GREP_IMAGE=ghcr.io/fun7257/web-grep:v0.2.0 \
WEB_GREP_DATA=/要搜索的宿主机目录 \
WEB_GREP_TOKEN=登录密码 \
WEB_GREP_PUBLIC_HOST=测试机IP或域名,127.0.0.1 \
docker compose -f compose.ghcr.yaml up -d
```

或直接 `docker run`：

```bash
docker run -d --name web-grep --restart unless-stopped \
  -p 8787:8787 \
  -e WEB_GREP_TOKEN=登录密码 \
  -e WEB_GREP_PUBLIC_HOST=测试机IP或域名,127.0.0.1 \
  -v /要搜索的宿主机目录:/data:ro \
  ghcr.io/fun7257/web-grep:dev
```

挂自己的 yaml 时不要再传 `-e WEB_GREP_TOKEN`（会盖掉文件里的 token），也不要用 `:ro` 挂配置（明文 token 启动后要写成 `sha256:<hex>`）：

```bash
cp config.docker.yaml config.deploy.yaml
# 编辑 token、public_host；保持 root: /data

docker run -d --name web-grep --restart unless-stopped \
  -p 8787:8787 \
  -v "$PWD/config.deploy.yaml:/app/config.yaml" \
  -v /要搜索的宿主机目录:/data:ro \
  ghcr.io/fun7257/web-grep:v0.2.0
```

## Nginx 路径前缀

若必须挂在 `https://example.com/web-grep/` 而不是子域名，配置：

```yaml
public_host:
  - example.com
public_path: /web-grep
```

或 `WEB_GREP_PUBLIC_PATH=/web-grep`。生产包使用相对静态资源，**不必为前缀重打前端镜像**；改配置后重启进程即可。

```nginx
location /web-grep/ {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_buffering off;
    proxy_read_timeout 3600s;
}

location = /web-grep {
    return 301 /web-grep/;
}
```

不要用 `rewrite` 把前缀剥掉再转给后端：Go 会自己剥 `public_path`，并把此前缀写进 HTML，让 `fetch('/web-grep/api/...')` 对上。`Host` 必须是浏览器里的主机名，且列入 `public_host`。健康检查仍可用 `http://127.0.0.1:8787/api/health`（无前缀）。

```bash
docker compose logs -f
docker compose ps      # 应 healthy
docker compose down
```

| 变量 | 作用 | 是否进容器进程 |
| --- | --- | --- |
| `WEB_GREP_DATA` | 宿主机目录，只读挂到 `/data` | 否（只给 Compose 挂卷） |
| `WEB_GREP_TOKEN` | 登录密码（覆盖镜像 yaml） | 是 |
| `WEB_GREP_PUBLIC_HOST` | 地址栏主机名/IP，逗号分隔 | 是（空则用镜像里的 localhost、127.0.0.1） |
| `WEB_GREP_PORT` | 宿主机映射端口，默认 8787 | 否（容器内仍听 8787） |
| `WEB_GREP_UID` / `WEB_GREP_GID` | 容器用户，默认 `0:0` 方便读日志 | 否 |

不要把本机开发用的 `config.yaml`（`root` 是 Mac 路径）挂进容器。

## `docker run`（本地构建 + config.yaml）

不要用本机开发那份 `config.yaml`（里面的 `root` 是宿主机路径）。从镜像模板复制一份：

```bash
cp config.docker.yaml config.deploy.yaml
```

编辑 `config.deploy.yaml`：

```yaml
root: /data
host: 0.0.0.0
port: 8787
public_host:
  - 127.0.0.1
  - 测试机IP或域名
token: 登录密码
rg: /usr/bin/rg
web_dist: /app/web
```

`root` 必须是 `/data`。密码用明文即可，启动后进程会把这一行改成 `sha256:<hex>`。可以挂单个文件；不要用 `:ro`，否则改不了 token。

```bash
docker build -t web-grep:local .
docker run -d --name web-grep --restart unless-stopped \
  -p 8787:8787 \
  -v "$PWD/config.deploy.yaml:/app/config.yaml" \
  -v /要搜索的宿主机目录:/data:ro \
  web-grep:local
```

```bash
docker logs -f web-grep
docker rm -f web-grep
```

改端口：`-p 9000:8787`。不要加 `--init`。不要加 `-e WEB_GREP_TOKEN`，否则会盖掉 yaml。

离线拷贝：`docker save ghcr.io/fun7257/web-grep:v0.2.0 | gzip > web-grep-v0.2.0.tar.gz`，对端 `gunzip -c web-grep-v0.2.0.tar.gz | docker load`。本地构建的同理，把镜像名换成 `web-grep:local`。

## 注意

- `public_host` / `WEB_GREP_PUBLIC_HOST` 必须是浏览器地址栏里的名字/IP，不要填 `0.0.0.0`。
- 路径前缀用 `public_path` / `WEB_GREP_PUBLIC_PATH`（如 `/web-grep`），Nginx `proxy_pass` 不要剥前缀。
- 健康检查请求 `http://127.0.0.1:8787/api/health`（Host 为本机，始终允许）。
- 登录勾选「记住密码」后令牌在浏览器 `localStorage`，关页还在；服务端会话在内存里，**重启容器要重新登录**。
- 时间范围、搜索历史在浏览器里。搜索次数由服务端记在配置文件同目录的 `search-count`（单文件挂载 config 时写在容器 `/app/search-count`，换容器会清零，需要持久化请把该文件或整个 `/app` 配置目录一起挂出来）。
- 多条件 AND 在页面上加框，空框不搜；空格算进单条条件。
- 树是空的或权限错误：确认 `WEB_GREP_DATA` 存在且该 uid 可读。
- 跟 main 用 `ghcr.io/fun7257/web-grep:dev`（每次合并覆盖）。钉版本用 `:vX.Y.Z`。本地构建统一用 `web-grep:local`（`docker compose up --build` 与 `docker build -t web-grep:local`）。
