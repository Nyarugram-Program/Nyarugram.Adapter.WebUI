# Nyarugram Adapter WebUI

面向 Nyarugram 适配器的多协议 Web 管理界面。前端保留原 NapCat WebUI 的组件体系，同时支持：

- 多实例登记与切换，显式配置管理、业务 HTTP、事件入口。
- 业务协议：OneBot V11、Milky。
- 管理模式：NapCat 管理、Nyarugram `/admin/v1`、仅协议调试。
- Milky 标准 HTTP 动作、消息段请求、SSE/WebSocket 事件、Nyarugram ACK/resume 扩展。
- Nyarugram 管理会话、机器人账号登录、脱敏配置与版本冲突、日志流、运行指标。
- OneBot HTTP/WebSocket 调试、事件分类及原 NapCat 管理模式回归。
- 通话控制面（发起、接听、挂断、查询）；真实媒体能力按适配器声明展示。

本项目源自 [NextNapCatWebUI](https://github.com/bietiaop/NextNapCatWebUI)（MIT），保留原许可证与版权声明。NapCat 管理客户端仍用于 `managementKind=napcat` 的兼容路径。

## 当前状态

| 能力 | 状态 |
|---|---|
| 前端多实例、协议与管理模式分流 | 已实现，已做类型检查、单元测试和浏览器验证 |
| Milky 业务 HTTP/事件与 ACK/resume | 已实现，已对 PostgreSQL + 真实适配器宿主 + 替身后端联调 |
| Nyarugram `/admin/v1`（Milky） | 已实现会话、账号、配置、日志、指标、健康 |
| OneBot 原有 HTTP/WebSocket 调试 | 已保留，已做静态/浏览器页面验证 |
| 真实 NapCat 服务互操作 | 未验证（本次环境没有 NapCat 服务） |
| Nyarugram.OnebotV11 | 同级仓库仍为空，未联调 |
| 真实双向语音媒体 | 未实现；`calls.voice=false` 时不宣称语音可用 |

详细实现、测试证据和限制见 [Docs/DELIVERY-REPORT.md](Docs/DELIVERY-REPORT.md)、[Docs/MILKY-INTEGRATION.md](Docs/MILKY-INTEGRATION.md) 和 [Docs/MANAGEMENT-API.md](Docs/MANAGEMENT-API.md)。

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

## 安全与隐私

- 默认不加载音乐、一言、QQ 公网头像等自动联网入口。
- 不根据端口或常见路径猜测业务地址；实例入口必须显式登记。
- 管理配置按 `If-Match` 版本保存，冲突返回 412，不覆盖其他管理员的修改。
- 秘密字段采用保持/替换/清除三种显式操作；读取接口不返回秘密值。
- 浏览器媒体未接入；`calls.voice=false` 时只展示控制面和明确原因。

## License

[MIT](LICENSE)

## Related Projects

- [NapCat](https://github.com/NapNeko/NapCatQQ/)
- [NextNapCatWebUI](https://github.com/bietiaop/NextNapCatWebUI)
- [Milky](https://milky.ntqqrev.org/)
