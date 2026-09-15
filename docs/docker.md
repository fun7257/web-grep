# Docker 部署

前后端打进**同一个镜像、同一个容器**：Go 提供页面和 `/api`，镜像内带 ripgrep（Alpine）。配置主文件是容器里的 `/app/config.yaml`（由 `config.docker.yaml` 打进去：`root: /data`）。`WEB_GREP_*` 只做临时覆盖。

## 准备

- 宿主机已装 Docker / Compose
- 在目标架构上构建（本机 Apple Silicon 导出的是 `linux/arm64`，x86 测试机要在那台机器上 `docker build`，或 `--platform linux/amd64`）
- 登录密码：Compose 用环境变量 `WEB_GREP_TOKEN`；也可以写进自己的 yaml 后用 `docker run` 挂载

## Compose

```bash
WEB_GREP_DATA=/要搜索的宿主机目录 \
WEB_GREP_TOKEN=登录密码 \
WEB_GREP_PUBLIC_HOST=测试机IP或域名,127.0.0.1 \
docker compose up --build -d
```

打开 `http://<WEB_GREP_PUBLIC_HOST>:8787`，用 `WEB_GREP_TOKEN` 登录。

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

## `docker run`（config.yaml）

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
docker run -d --name web-grep --restart unless-stopped \
  -p 8787:8787 \
  -v "$PWD/config.deploy.yaml:/app/config.yaml" \
  -v /要搜索的宿主机目录:/data:ro \
  web-grep:v0.1.6
```

```bash
docker logs -f web-grep
docker rm -f web-grep
```

改端口：`-p 9000:8787`。不要加 `--init`。不要加 `-e WEB_GREP_TOKEN`，否则会盖掉 yaml。

导出镜像：`docker save web-grep:v0.1.6 | gzip > web-grep-v0.1.6.tar.gz`，对端 `gunzip -c web-grep-v0.1.6.tar.gz | docker load`。

## 注意

- `public_host` / `WEB_GREP_PUBLIC_HOST` 必须是浏览器地址栏里的名字/IP，不要填 `0.0.0.0`。
- 健康检查请求 `http://127.0.0.1:8787/api/health`（Host 为本机，始终允许）。
- 登录勾选「记住密码」后令牌在浏览器 `localStorage`，关页还在；服务端会话在内存里，**重启容器要重新登录**。
- 时间范围、搜索历史在浏览器里。搜索次数由服务端记在配置文件同目录的 `search-count`（单文件挂载 config 时写在容器 `/app/search-count`，换容器会清零，需要持久化请把该文件或整个 `/app` 配置目录一起挂出来）。
- 多条件 AND 在页面上加框，空框不搜；空格算进单条条件。
- 树是空的或权限错误：确认 `WEB_GREP_DATA` 存在且该 uid 可读。
- 本仓库当前推荐镜像标签 `web-grep:v0.1.6`（需从本提交重新 `docker build`）。Compose 本地构建仍用 `web-grep:test`。
