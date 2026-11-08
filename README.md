# Nyarugram Adapter WebUI

面向 Nyarugram 适配器的多协议 Web 管理界面。前端保留原 NapCat WebUI 的组件体系，同时支持：

- 多实例登记与切换，显式配置管理、业务 HTTP、事件入口。
- 业务协议：OneBot V11、Milky。
- 管理模式：Nyarugram `/admin/v1`、仅协议调试（无管理接口）。
- Milky 标准 HTTP 动作、消息段请求、SSE/WebSocket 事件、Nyarugram ACK/resume 扩展。
- Nyarugram 管理会话、机器人账号登录、脱敏配置与版本冲突、日志流、运行指标。
- OneBot HTTP/WebSocket 标准协议调试，包括按标准协议提供服务的 NapCat 实例。
- 通话控制面（发起、接听、挂断、查询）；真实媒体能力按适配器声明展示。

NapCat 专属管理兼容已移除：不再提供 NapCat WebUI Token 登录、QQ 扫码/快捷登录、OB11Config/网络配置、NapCat 管理日志、系统状态、QQ/安装包版本查询或 `localhost:6099` 等管理地址推断。

本项目源自 [NextNapCatWebUI](https://github.com/bietiaop/NextNapCatWebUI)（MIT），保留原许可证与版权声明。

## 当前状态

| 能力 | 状态 |
|---|---|
| 前端多实例、协议与管理模式分流 | 已实现，已做类型检查、单元测试和浏览器验证 |
| 旧 NapCat 实例迁移 | 已实现，自动化测试与浏览器验证通过 |
| Milky 业务 HTTP/事件与 ACK/resume | 已实现；本轮自动化回归通过，浏览器使用明确标识的替身服务验证 |
| Nyarugram `/admin/v1`（Milky / OneBot 组合） | 已实现会话、账号、配置、日志、指标、健康；浏览器使用替身管理服务验证 |
| OneBot 标准 HTTP/WebSocket 调试 | 已保留；浏览器使用替身 OneBot 服务验证 |
| 真实 NapCat 服务互操作 | 未验证（本轮没有 NapCat 服务；其标准 OneBot 接口按普通 OneBot 实例使用） |
| Nyarugram.OnebotV11 | 同级仓库仍为空，未联调 |
| 真实双向语音媒体 | 未实现；`calls.voice=false` 时不宣称语音可用 |

详细实现、测试证据和限制见 [Docs/DELIVERY-REPORT.md](Docs/DELIVERY-REPORT.md)、[Docs/MILKY-INTEGRATION.md](Docs/MILKY-INTEGRATION.md) 和 [Docs/MANAGEMENT-API.md](Docs/MANAGEMENT-API.md)。

## 旧实例迁移

浏览器中保存的 `managementKind=napcat` 实例会在首次读取时迁移为 `onebot11 + none`：

- 保留稳定实例 ID、名称、协议和用户已显式填写的业务/事件入口。
- 清空 NapCat 管理地址；不会根据旧管理端口生成业务地址。
- 删除旧全局 NapCat 令牌、旧 `storeURL`、实例级 NapCat 令牌和旧全局管理登录标记。
- 不把 NapCat 管理凭据复制为 OneBot 业务凭据；缺少业务地址时在实例页面提示补充。
- 迁移可重复执行，不影响其他实例、业务令牌和事件游标。

## 开发

要求 Node.js 20+ 与 npm。依赖安装在 `D:\BotgramBuild\Nyarugram.Adapter.WebUI`，仓库内 `node_modules` 为指向该目录的联接。

```bash
npm ci
npm run webui:dev
```

其他命令：

```bash
npm run webui:typecheck
npm run webui:test
npm run webui:lint
npm run webui:build
```

`webui:lint` 未带 `--fix`。Windows 工作区若因 `core.autocrlf` 产生 CRLF，Prettier 会报告行尾错误；CI 在 Linux 检出 LF 后执行。

## 构建与部署

```bash
npm run webui:build
```

产物在 `dist/`。部署时：

1. 配置 SPA fallback，把未知的非资源路径交给 `index.html`。
2. 子路径部署使用 `VITE_BASE_PATH=/adapter/` 构建，前端路由会使用同一 basename。
3. 同源部署时，把 `/admin/v1`、`/api`、`/event`、`/health`、`/nyarugram` 反向代理到适配器。
4. `/event` 必须支持 WebSocket upgrade；SSE 日志流必须关闭代理缓冲。
5. 反向代理应保留原始 `Host`/`Origin`，否则管理写请求的 Origin 校验会拒绝。

Nginx 示例（同源、子路径按需调整）：

```nginx
server {
    listen 443 ssl;
    server_name adapter.example;

    root /srv/nyarugram-webui/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~ ^/(admin/v1|api|health|nyarugram)(/|$) {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /event {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_buffering off;
    }
}
```

管理接口要求 `admin.secret` 显式配置。管理会话使用 HttpOnly Cookie 与 `X-CSRF-Token`，不把管理凭据写入前端持久状态。业务访问令牌只保存在当前标签页的 `sessionStorage`。

## 容器镜像与 CI/CD

推送到 `main`、推送 `v*` 版本标签或在 `main` 手动运行 GitHub Actions，会先执行冻结依赖安装、全仓 lint、类型检查、测试和静态构建，再构建 `linux/amd64` 镜像。容器的健康入口、SPA 深链接和静态资源通过检查后，使用仓库自带的 `GITHUB_TOKEN` 推送到 GHCR。

当前仓库的镜像名为 `ghcr.io/nyarugram-program/nyarugram.adapter.webui`。名称自动取当前仓库并转为小写，所需权限由工作流声明为 `packages: write`。

- `main` 发布 `latest` 和 `sha-<完整提交 SHA>`。
- `v*` 标签发布同名镜像标签和提交 SHA 标签。
- Pull Request 执行前端检查与构建。
- 原静态构建产物继续上传。版本标签或消息包含 `release` 的主分支提交还会生成 GitHub Release ZIP。

```bash
docker run -d --name nyarugram-adapter-webui \
  -p 127.0.0.1:8088:8080 \
  ghcr.io/nyarugram-program/nyarugram.adapter.webui:latest
```

浏览器打开 `http://127.0.0.1:8088`。镜像使用非 root Nginx，监听 8080，`/healthz` 检查静态服务。业务协议、事件和 `/admin/v1` 由适配器提供，继续按下方同源反向代理示例部署。容器内这些接口路径返回 404，部署者显式登记实际服务入口。

本地可从仓库独立构建镜像，Dockerfile 使用 Node 22、`npm ci` 和多阶段构建，运行镜像包含静态资源。

```bash
docker build -t nyarugram-adapter-webui .
docker run --rm -p 127.0.0.1:8088:8080 nyarugram-adapter-webui
```

## 安全与隐私

- 默认不加载音乐、一言、QQ 公网头像等自动联网入口。
- 不根据端口或常见路径猜测业务地址；实例入口必须显式登记。
- 管理配置按 `If-Match` 版本保存，冲突返回 412，不覆盖其他管理员的修改。
- 秘密字段采用保持/替换/清除三种显式操作；读取接口不返回秘密值。
- 浏览器媒体未接入；`calls.voice=false` 时只展示控制面和明确原因。
- 已移除的 NapCat 管理页 `/qq_login` 会显示明确的入口移除说明，不发起旧管理请求。

## License

[MIT](LICENSE)

## Related Projects

- [NextNapCatWebUI](https://github.com/bietiaop/NextNapCatWebUI)
- [Milky](https://milky.ntqqrev.org/)
