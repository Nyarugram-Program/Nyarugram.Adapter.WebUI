# Nyarugram.Adapter.WebUI 开发指引

本文件适用于本仓库及子目录。用户在当前任务中的明确要求优先。开始修改前阅读 Docs/MILKY-INTEGRATION.md 和 Docs/MANAGEMENT-API.md。

## 目标与当前状态

将原 NapCat WebUI 源码改造为面向 Nyarugram 适配器的多协议管理界面。业务协议支持 OneBot V11 与 Milky；管理模式只保留 Nyarugram `/admin/v1` 与无管理接口的纯协议调试。NapCat 专属管理客户端（WebUI Token 登录、QQ 扫码/快捷登录、OB11Config、管理日志/系统状态/版本查询）已移除。

截至 2026-11-08，前端已完成多实例、协议/管理模式分流、Milky 业务调试与事件恢复、统一管理页面，以及旧 NapCat 实例迁移。同级 Nyarugram.Milky 已实现 `/admin/v1` v1 子集。以源码、构建、自动化测试和浏览器联调证据为准，未验证项在 Docs/DELIVERY-REPORT.md 中逐项列出。

- 同级 Nyarugram.Milky 已实现管理会话、账号登录/退出、脱敏配置与版本、日志、指标和健康；管理配置在重启后生效。
- 同级 Nyarugram.OnebotV11 仍为空仓库，不得宣称已与其联调；统一管理契约可复用于后续实现。
- 当前前端采用 React 19、TypeScript、Vite、NextUI、Redux Toolkit、Monaco。xterm、NapCat 管理客户端及其专属组件已随功能移除。
- 上游 NextNapCatWebUI/NapCat WebUI 为 MIT 许可。保留 LICENSE、版权声明、README/Docs 中的来源说明；上游管理实现不再作为运行依赖。
- 当前构建与测试入口：`npm run webui:typecheck`、`npm run webui:test`、`npm run webui:build`。后端测试在 `Nyarugram.Milky/tests`。

## 协议与管理边界

- 业务协议和管理协议分别建模。支持 OneBot V11 与 Milky，不将 Milky 请求、消息或事件转换成伪造的 OneBot 对象，反之亦然。
- 管理模式只支持 `nyarugram-admin-v1` 与 `none`。不得重新引入 NapCat 管理入口、管理令牌、端口推断或专属响应模型。
- `onebot11 + none` 必须能只依赖显式业务 HTTP/事件地址和业务凭据完成标准协议调试，不依赖任何管理接口；按标准协议提供服务的 NapCat 实例同样走该路径。
- `onebot11 + nyarugram-admin-v1` 与 `milky + nyarugram-admin-v1` 按服务端实际能力启用管理功能；缺失端点或能力时展示真实原因。
- Milky HTTP 使用 POST /api/{action}，事件使用 GET /event 的 SSE 或正向 WebSocket。OneBot 按实例声明的实际传输方式调用。
- Nyarugram 管理接口统一在 /admin/v1；当前 Milky 实现见同级仓库 `src/Nyarugram.Milky.Host/AdminEndpoints.cs`，路径和 DTO 变更需前后端协同。
- 适配器访问 Nyarugram 后端坚持 Protobuf-only，业务持久化坚持 PostgreSQL-only。前端管理 JSON 和 Milky/OneBot 标准 JSON 按各自契约使用。
- 前端不直接访问数据库，不调用 Nyarugram 已弃用的 JSON-TL 或 REST 业务接口。
- 依赖实际能力声明展示配置与操作。区分已支持、未实现、未配置和无法查询，不伪造保存成功或在线状态。
- 调试目录区分协议标准动作与实现扩展；Nyarugram 呼叫等扩展需明确标识，不得伪装成标准 OneBot/Milky 动作。

## 实例与迁移

- 每个实例显式保存 protocol、managementKind、管理入口、业务入口和事件入口。禁止通过端口字符串替换推断业务地址。
- 实例配置使用稳定实例 ID。页面状态、缓存、草稿、调试历史及凭据按实例隔离。
- 旧版 `managementKind=napcat` 实例读取时迁移为 `onebot11 + none`：保留稳定 ID、名称、协议和用户已显式填写的业务/事件入口，清空管理地址，清除 NapCat 管理令牌与全局登录标记。不得把旧管理端口或凭据迁移为业务入口或业务凭据。
- 迁移可重复执行；第二次读取不得再次更改 `updatedAt`、其他实例、业务令牌或事件游标。缺少业务地址时在实例页面提示用户补充。
- 不再根据旧 `storeURL` 自动创建实例，也不再请求已废弃管理入口。
- 切换实例、退出、重新登录或卸载页面时取消旧请求和事件连接。迟到回调不得覆盖新实例。
- 处理 JSON 整数精度。自定义管理 ID 使用十进制字符串，标准协议字段遵守固定 schema，不通过 Number 强制转换完整 int64。

## 认证与配置

- Web 管理会话、机器人业务 access_token、Nyarugram 账号会话分别管理。账号 Bearer 令牌由适配器保管。
- 账号密码及验证器输入仅用于当前登录请求，避免写入持久前端状态、URL、日志或调试历史。
- Nyarugram 管理模式优先同源部署，管理登录使用服务端安全会话 Cookie，并实现相应 CSRF 防护。
- 配置读取脱敏，秘密更新显式区分保持、替换及清除。保存要校验版本，展示实际生效状态和需要重启的项目。
- 没有管理接口时允许配置业务地址及业务凭据使用协议调试，管理页面显示功能不可用及原因。

## Milky 事件及通话

- 支持标准 Milky 事件。Nyarugram 的确认扩展单独处理，启用时解析 epoch、seq、event_id 和内层 event。
- ACK/resume 回传服务端提供的当前 epoch。收到 nyarugram_resumed 后采用新 epoch，丢弃旧连接及旧代际待确认任务。
- 持久消费位点在应用处理成功后确认。显式恢复、缺口通知、重复事件和重连分别按实际契约实现。
- 呼叫控制与真实媒体能力分别展示。当前 Nyarugram.Milky 未接入真实媒体引擎，calls.voice=false，前端不能通过配置宣称语音可用。
- 增加浏览器媒体功能时，按已实现的媒体契约处理麦克风授权、PCM 格式、缓冲、停止及短期凭据失效。

## 自部署与构建

- 服务入口由部署者显式配置，不默认连接公共服务。
- 音乐、一言、QQ 公网头像、外部图片等自动联网入口改为本地资源或显式配置，默认关闭。技术资料和开源依赖链接可以保留。
- 新下载的 Node、依赖、包管理器及缓存放 D 盘，默认 D:\BotgramBuild。先检查已有环境。
- 选择一种包管理器，固定版本并提交锁文件。修正现有忽略全部锁文件的规则，使用冻结依赖安装。
- 保留原有格式与组件体系，避免与任务无关的依赖升级和格式化。检查 lint 命令是否带 --fix，避免无关自动改写。
- 前端发布包可由适配器托管或同源反向代理提供。构建产物不依赖同级源码目录，正确处理 SPA 路由及部署子路径。

## 验证和交付

- 覆盖 OneBot 与 Milky 请求、事件、错误和能力分支，以及实例切换和迟到结果隔离。
- 覆盖旧 NapCat 实例迁移、迁移幂等、其他实例/凭据/游标不被破坏，以及新实例只有两种管理模式。
- 检查浏览器实际页面，至少验证登录、接口调试、事件显示和重连。管理接口使用真实服务或明确标识的替身分别验证。
- 浏览器验证 OneBot HTTP/WebSocket 标准调试时，确认页面不发送 NapCat 专属管理请求，也不根据旧管理端口推断业务地址。
- 仅前端构建成功不代表已与适配器互通，模拟管理 API 也不能作为真实账号登录证据。
- 文档记录设计、前端实现、适配器实现、自动化测试、真实联调及媒体设备验证各自状态。
- README.md 和 AGENTS.md 放根目录，设计及报告放 Docs/，任务 Prompt 放 Prompt/。遵循本次用户明确指定的目录。
- 普通开发任务按实际范围执行，正式发布、部署及数据迁移遵循已有明确授权。

## 实施入口

- Docs/MILKY-INTEGRATION.md 定义架构、范围及阶段验收。
- Docs/MANAGEMENT-API.md 定义需要前后端协同实现的管理契约草案。
- Prompt/implement-milky-multiprotocol-webui.md 可直接交给实施 agent。
- Prompt/review-milky-multiprotocol-webui.md 用于独立复核交付。
