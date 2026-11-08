# Milky 接入与多协议改造方案

本文基于 2026-11-08 对本仓库及同级 Nyarugram.Milky、Nyarugram.OnebotV11 的源码检查。前端多实例、协议分流、Milky 业务调试、事件恢复和统一管理页面已实现；Nyarugram.Milky 已实现 `/admin/v1` v1 子集并通过宿主测试。真实 NapCat 服务、Nyarugram.OnebotV11 和真实双向语音仍未验证，具体证据与限制见 `Docs/DELIVERY-REPORT.md`。

## 交付目标

一个 WebUI 可以选择多个适配器实例，支持 OneBot V11 与 Milky 的基础状态、API 调试和事件查看。具备统一管理接口的 Nyarugram 实例进一步支持账号登录、配置、日志及运行指标。现有 NapCat 模式通过独立管理客户端继续使用。

首期必须完成 Milky 普通消息收发调试、联系人与群查询、事件查看及断线恢复。通话页面按能力提供控制操作，真实音频在适配器具备媒体能力后验收。

## 当前耦合位置

| 位置 | 当前行为 | 改造要求 |
|---|---|---|
| src/controllers/qq_manager.ts | 调用 QQLogin 和 OB11Config | 将 NapCat 管理封装限定在旧模式，新增 Nyarugram 管理客户端 |
| src/controllers/webui_manager.ts | NapCat 登录、日志、QQ 版本与系统状态 | 对接独立管理契约，统一页面所需视图模型 |
| src/utils/request.ts | 全局 storeURL、token 及 code/data/message 外壳 | 请求上下文显式绑定实例，按管理模式及业务协议解析响应 |
| src/store/modules/config.ts | 全局 OneBotConfig | 公共实例元数据与协议专属配置分离 |
| src/components/onebot/api/debug.tsx | 静态 OneBot API 目录，端口 6099 替换成 3000 | 业务入口显式配置，保留 OneBot 目录并增加 Milky 目录 |
| src/hooks/use-websocket-debug.ts | 只解析 OneBot 事件和响应 | 公共连接生命周期配合独立协议解析器 |
| src/pages/qq_login.tsx | QQ 扫码与快捷登录 | 根据管理模式切换登录视图，Nyarugram 使用账号密码和验证器 |
| src/components/qq_info_card.tsx | QQ 公网头像回退 | 使用适配器提供的授权资源或本地默认头像 |
| src/utils/music.ts、src/components/hitokoto.tsx | 自动访问公网服务 | 默认关闭，提供本地或部署者配置的替代入口 |
| .gitignore | 忽略 npm/yarn/pnpm 全部锁文件 | 选定包管理器，提交相应锁文件 |

保留布局、主题、表单、Monaco、xterm 和弹窗等成熟组件。协议与管理抽象保持最小范围，优先移动现有逻辑到明确客户端，避免创建无调用者的框架。

## 两个独立的选择维度

业务 protocol 首期支持 onebot11 和 milky。管理 managementKind 支持 napcat、nyarugram-admin-v1 和 none。

示例组合包括以下情况。

- onebot11 + napcat 继续使用原 NapCat 管理和业务接口。
- onebot11 + nyarugram-admin-v1 为后续 Nyarugram.OnebotV11 提供统一管理能力。
- milky + nyarugram-admin-v1 在 Milky 实例实现管理契约后启用完整面板。
- milky + none 直接使用现有业务 API 和事件连接，账号由适配器 CLI 预先登录。

实例资料包含稳定 ID、展示名称、protocol、managementKind、显式入口及凭据引用。地址不得根据协议或常见端口静默猜测。浏览器保存的非秘密显示偏好与服务端业务持久化分开处理。

## 请求与状态模型

公共 UI 使用实例状态视图，表达管理连接、账号绑定、后端连接、数据库、事件及媒体状态。未知值保持 unknown，未实现能力提供 reason。

业务请求和管理请求使用不同客户端。OneBot 保留 action/params/echo 和 post_type 等语义，Milky 保留 API 动作、message_scene/peer_id/message_seq 及 event_type 等语义。JSON 编辑器可共享，参数定义、默认值、响应外壳和消息段编辑器按协议选择。

为当前实例生成请求上下文，捕获实例 ID 和本地连接代际。账号变化、实例切换、页面卸载后取消请求、重连定时器、SSE、WebSocket 和媒体任务。响应写入状态前再次验证上下文。

## Milky 基础业务范围

以适配器锁定 schema 和实际能力为准，首期包含以下动作。

- get_login_info、get_impl_info、get_user_profile。
- get_friend_list、get_friend_info。
- get_group_list、get_group_info、get_group_member_list、get_group_member_info。
- send_private_message、send_group_message。
- get_message、get_history_messages、mark_message_as_read。
- nyarugram_get_capabilities 及适配器声明的呼叫扩展。

固定协议定义或生成可校验的前端类型，记录来源、版本和哈希。业务 API 目录需要区分协议标准定义与当前实例支持集合。未支持动作可展示为不可用，不能发送后伪造成功。

发送调试使用 Milky 消息段，不复用 OneBot CQ 码。提供 text、实例支持的 mention 和 reply 输入。结果显示原始响应与可读视图，保留 HTTP 状态及业务 retcode。

入站事件至少处理 message_receive 和声明的 Nyarugram 呼叫事件。未知事件保留原始 JSON，保持列表容量上限、过滤及清空行为，不强行归类为 OneBot 通知。

## 事件恢复

普通 Milky SSE/WebSocket 按标准载荷处理。需要 Nyarugram 确认扩展时，显式选择支持该能力的实例。

- 事件帧提供 extension_version、epoch、seq、event_id 和 event。
- 成功处理事件后发送匹配 epoch 的 ACK。记录确认位置，允许重复投递并按稳定身份去重。
- resume 携带当前 epoch 和恢复位置，收到 nyarugram_resumed 后采用新 epoch。
- 旧代际异步任务不能继续 ACK，连接结束后取消待发送任务。
- nyarugram_events_gap 需显式展示缺口及支持的恢复操作，不能静默跳到末尾。
- 管理日志 SSE 与业务事件连接分别管理，避免将日志行作为聊天事件。

精确帧字段在实施前核对 Nyarugram.Milky 的最新源码与运行手册，并执行真实 WebSocket 测试。

## 管理与部署模式

当前 Nyarugram.Milky 只有业务 API、/event、媒体入口和 /health，账号管理依赖 CLI。统一 /admin/v1 是拟新增管理面。

没有管理 API 时，先实现纯协议调试模式，页面明确显示账号登录、配置保存及管理日志不可用。已有 Milky 业务路径仍可使用。具备统一管理 API 后再启用完整面板。

建议同源部署，前端静态资源由适配器或部署者反向代理托管。支持根路径和配置的子路径，静态资源、管理 API、业务 API、SPA fallback 不相互覆盖。

独立集中面板可登记多个实例。采用服务端代理时，目标必须来自受控实例登记，凭据绑定目标和协议，不能变成任意 URL 转发器。

## 通话范围

面板可显示方向、对端、信令状态、媒体状态及结束原因，并按实际能力提供发起、接听、拒接和挂断。

当前真实媒体尚未完成，calls.voice=false。配置页面不能将该值切换为 true。适配器提供真实能力后，再接入已实现的 PCM 媒体接口，验证浏览器授权、重采样、音频时钟、有界缓冲和挂断清理。

音乐播放和语音消息录制组件可用于 UI 参考。真实电话媒体需通过现有通话契约单独实现和验收。

## 实施阶段与验收

| 阶段 | 结果 | 必须验收 |
|---|---|---|
| 基线 | 固定依赖及可复现构建，保留许可证 | 冻结安装、类型检查、构建 |
| 多协议结构 | 实例模型、协议客户端、管理客户端分离 | OneBot 旧路径继续工作，切换实例无串号 |
| Milky 数据模式 | 真实业务 API、消息段、事件及恢复 | 对当前 Milky 服务查询、收发和重连 |
| 统一管理面 | 适配器新增管理 API，前端接入登录、配置和日志 | 真实账号登录、失效处理、配置持久化与重启生效 |
| 呼叫面板 | 能力控制下的通话操作 | 控制面与媒体证据分别记录 |
| 交付 | 独立静态产物、部署说明、支持矩阵和报告 | 干净目录启动、两协议回归、无默认公网请求 |

## 完成标准

Milky 已能在浏览器真实收发消息并恢复事件，OneBot 现有模式通过回归，管理能力按真实后端声明启用。未实现能力有明确状态，配置保存、账号在线和电话媒体均有可追溯证据。

依赖来源可参考 Milky 官方规范及本地固定副本，升级时复核版本。[Milky 官方文档](https://milky.ntqqrev.org/)

## 2026-11-08 事件连接身份补充

- `/event` 接受可选 `nyarugram_expected_identity`：管理模式为 `admin:<account_uuid>`，仅协议模式为 `business:<uin>`。适配器在升级 WebSocket/建立 SSE 前校验当前 `SessionContext`，不匹配返回 409，不创建消费者位点。
- 前端在每次首次连接和自动重连前重新查询 `/account` 或 `get_login_info`；连接关闭/失败后不直接重连旧作用域。身份变化会切换到新作用域，身份失败/未登录则不建立连接。
- SSE 和 WS 都传递 `nyarugram_consumer`。前端从用户消费者派生 `consumer.sse` 或 `consumer.ws`（长度不超过 128，不含令牌）；两种传输各自拥有服务端恢复位点。
- 首次连接由 `EnsureConsumerAsync` 保存初始位点；无事件断线后可恢复断线期间事件。已有本地 v3 游标通过 `nyarugram_cursor` 作为连接起始提示。
- SSE 使用 Authorization 头，URL 只保留消费者、expected identity 和可选的 `nyarugram_cursor`；WS 因浏览器 API 限制保留 `access_token` 与 `nyarugram_ws_ack`。

## 2026-11-08 SSE 连接与身份退避补充

- SSE 连接的起始游标在建立连接时一次性读取；事件处理只更新内存游标、列表和持久化位置，不重建健康连接。
- 显式重连和连接失败恢复都先经过身份确认；新面板从持久化游标构造 `Last-Event-ID` 和 `nyarugram_cursor`。服务端命名消费者继续保存初始/恢复位置。
- 身份查询的网络错误、超时、408、429、5xx 使用 1s→2s→4s→8s→16s→30s 退避并遵循 `Retry-After`；401/403、账号未登录使用 30 秒慢重试，期间不建立事件连接。
- 手动“重新确认身份”与自动重试共用同一 AbortController 和定时器；实例、入口、凭据变化或卸载会取消旧查询、定时器、旧连接和迟到回调。
