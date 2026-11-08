# 统一管理接口契约

本文定义 Nyarugram.Milky 与未来 Nyarugram.OnebotV11 共同实现的 Web 管理能力。Nyarugram.Milky 已实现下表 v1 子集（`src/Nyarugram.Milky.Host/AdminEndpoints.cs`），前端在 `managementKind=nyarugram-admin-v1` 时使用；Nyarugram.OnebotV11 尚未实现，前端必须识别缺失管理面并允许纯业务调试模式。宿主测试与浏览器联调证据见 `Docs/DELIVERY-REPORT.md`。

## 边界

浏览器通过管理接口操作适配器账号生命周期、配置、日志和指标。适配器通过自身服务访问 Nyarugram 后端的 Protobuf 接口。现有 /api/{action}、OneBot 业务入口、/event 及媒体路径保留各自语义。

管理请求和响应使用版本化 JSON。运行时账号、会话、配置版本和其他业务状态由适配器存入 PostgreSQL，服务端保护密钥等受限部署资料按适配器开发要求管理。

## 公共约定

- 前缀为 /admin/v1。自定义 ID、配置版本和长整数标识使用十进制字符串或不透明字符串。
- 成功响应提供 data。失败响应提供 error.code、error.message、request_id 和可选字段错误，使用实际 HTTP 400/401/403/409/412/429/503 等状态。
- 未知管理接口返回 404。未实现功能提供能力声明，前端依据状态展示。
- 信息响应提供 api_version、instance_id、adapter_kind、adapter_version、protocol_version 和 capabilities。
- 能力至少分为 account、config、logs、metrics、business_debug、events 和 calls，每项包含 supported 及必要限制。
- 入口描述包含管理、业务 HTTP、业务事件及媒体路径。优先提供同源相对路径，外部入口必须由部署者配置。
- 字段错误与日志不返回密码、令牌、连接串、私钥或完整内部异常。

## 管理会话

| 方法和路径 | 用途 | 约束 |
|---|---|---|
| POST /session | 使用部署者配置的管理凭据建立会话 | 凭据只在请求体提交，限制重试，不出现在 URL |
| GET /session | 返回当前管理认证状态和权限 | 不返回认证秘密 |
| DELETE /session | 退出 Web 管理会话 | 与机器人账号退出分别执行 |
| GET /info | 查询实例、协议、能力及入口 | 认证要求由部署模式明确，未认证仅提供必要信息 |

同源模式使用 HttpOnly、适当 SameSite 的会话 Cookie，TLS 部署启用 Secure，写操作校验 Origin/CSRF。跨源模式需要显式允许来源及凭据策略。管理令牌、业务 access_token 和后端账号 Bearer 互不复用。

## Nyarugram 账号

| 方法和路径 | 用途 | 结果 |
|---|---|---|
| GET /account | 当前绑定账号和会话状态 | 展示身份、会话代际、状态及失效原因 |
| POST /account/login | 用户名、密码及可选验证器登录 | 成功账号资料或明确的补充验证/失败结果 |
| POST /account/logout | 退出机器人账号 | 清除当前绑定、取消旧请求和连接，关闭媒体并处理后台清理 |

登录应复用适配器真实 SessionManager 和认证客户端。处理并发登录、旧结果、已退出后的迟到响应及服务重启。密码和验证器输入不落前端持久状态，后端会话令牌不返回浏览器。

账号 DTO 可提供 account_id、display_name、username、gram_id、numeric_user_id、generation 和 avatar。缺少头像时返回明确缺省状态。禁止使用数字身份构造 QQ 公网头像 URL。

浏览器管理登录成功与机器人账号登录成功在页面中分别展示。

## 配置

| 方法和路径 | 用途 | 约束 |
|---|---|---|
| GET /config/schema | 配置定义及可编辑范围 | 按协议和实际实现生成字段 |
| GET /config | 脱敏配置及版本 | 包含 ETag 或等价版本标识 |
| POST /config/validate | 校验候选配置 | 返回字段错误及预计生效方式 |
| PUT /config | 保存配置 | If-Match 或等价并发校验，冲突不覆盖其他管理员修改 |
| GET /config/status | 查询保存与生效状态 | 区分已保存、已应用、需要重启、应用失败 |

配置由公共实例部分及 protocol_config 组成。OneBot 的正向/反向 HTTP、WebSocket 字段与 Milky 的业务监听、事件和恢复字段分别维护。只有适配器真正实现的传输方式才能启用。

秘密字段返回 is_set 等状态，更新采用显式保持、替换或清除操作。不能把脱敏字符串保存成真实秘密，也不能将空输入静默解释为清除。

保存及应用配置应保持一致性，失败时返回真实状态和可恢复版本。后端业务地址、TLS 及凭据变化需要使旧连接失效。数据库连接和保护密钥等高权限部署配置可标为只读并说明生效方式。

## 日志与运行指标

| 方法和路径 | 用途 | 要求 |
|---|---|---|
| GET /health | 管理面就绪状态 | 描述管理与业务状态，避免替代实际业务健康判断 |
| GET /metrics | 账号、后端、存储、同步、Outbox、连接及媒体摘要 | 不可用字段返回 unknown 或明确原因 |
| GET /logs | 查询受限日志条目或可访问日志列表 | 分页、有界读取、脱敏 |
| GET /logs/stream | SSE 日志流 | 鉴权、级别过滤、断线清理、有界队列 |

日志条目使用稳定 ID、时间、级别、来源及文本。历史文件读取验证允许范围，禁止根据任意浏览器路径读取文件。xterm 用于显示日志，不提供隐式系统命令执行入口。

## 业务调试和呼叫

管理信息返回实际 business HTTP 和 event 入口，前端通过协议客户端调用。若实现同源调试代理，仅允许登记实例和已声明的动作，严格隔离每个目标的凭据。

Milky 实例的 nyarugram_get_capabilities 可作为业务能力来源，管理面补充管理能力。不能通过前端假设 OneBot V11 实例已经实现同名扩展。

呼叫控制复用适配器已有业务扩展，权限由服务端验证。媒体凭据短期且绑定呼叫和账号，通话结束或账号变化后失效。当前未具备真实媒体时返回对应 capability 和 reason。

## 前端降级规则

- managementKind=none 时，可用显式配置的业务地址和业务凭据进入协议调试。
- /admin/v1 不存在时显示管理能力未实现，保留协议调试入口。
- 业务在线但管理断线、管理在线但账号未登录等情况分别展示。
- NapCat 管理模式使用原有管理客户端，其响应外壳及配置结构不扩散到统一管理契约。

## 协同交付

实施时固定管理契约版本和类型定义，补充精确 DTO、错误码及请求样例。前端替身与适配器契约测试采用同一版本，并至少完成一次真实服务验收。

本文件尚未执行接口部署，也不代表适配器已经支持上述管理功能。

## Nyarugram.Milky 实现状态（2026-11-08）

已实现并测试的端点：

- `GET /admin/v1/info`：协议版本、适配器版本、能力及入口；无需管理会话。
- `POST /admin/v1/session`：提交 `username`/`password` 或 `secret`；当前部署只校验 `admin.secret`，返回会话有效期和 `csrf_token`。
- `GET /admin/v1/session`、`DELETE /admin/v1/session`：查询/退出管理会话。
- `GET /admin/v1/account`、`POST /admin/v1/account/login`、`POST /admin/v1/account/logout`：复用 `SessionManager` 和真实后端认证。
- `GET /admin/v1/config/schema`、`GET /admin/v1/config`、`POST /admin/v1/config/validate`、`PUT /admin/v1/config`、`GET /admin/v1/config/status`。
- `GET /admin/v1/health`、`GET /admin/v1/metrics`。
- `GET /admin/v1/logs`、`GET /admin/v1/logs/stream`（SSE）。

实现约定：

- 配置可编辑字段为 `values.runtime.sync_interval_seconds`、`outbox_retention_hours`、`profile_cache_ttl_minutes`、`auto_answer`。
- 唯一可覆盖秘密为 `milky.access_token`，通过 `secrets["milky.access_token"] = {state: keep|replace|clear, value?}` 更新；读取只返回 `is_set`。
- 配置保存到 PostgreSQL `nyarugram_milky.admin_config`，版本从 0 递增；`If-Match` 必须匹配，冲突返回 412。
- 配置值在进程启动时读取并应用，因此保存后 `state=requires_restart`，不会伪造运行中已生效。
- 管理会话保存在进程内存；重启后需要重新登录。Cookie 为 HttpOnly、SameSite=Strict，写请求校验 `Origin` 和 `X-CSRF-Token`。
- 当前未启用跨源 CORS，部署应同源反向代理，并保留原始 `Host`/`Origin`。

## 2026-11-08 追加契约说明

- `GET /admin/v1/logs` 与 `GET /admin/v1/logs/stream` 的每条日志增加 `stream_id` 和 `stream_started_at`；历史响应还包含同名页级字段。`id` 只在同一 `stream_id` 内唯一，进程重启后可以重置，客户端去重键必须使用 `stream_id + id`。
- 管理客户端 CSRF 缓存按稳定实例 ID、规范化管理入口和会话代际隔离；这是前端实现约束，不改变 `/admin/v1` 的 JSON 外壳。
- 事件消费作用域不是管理 API 字段；前端使用实例入口、`/account` 的稳定 `account_id` 或业务 `get_login_info` 的 `uin`、consumer 和 transport 组合持久化游标。旧版无归属游标不迁移。

## 2026-11-08 会话代际补充

- `POST /admin/v1/session` 和 `GET /admin/v1/session` 的成功响应新增 `session_id`；所有已认证管理响应同时返回 `X-Nyarugram-Admin-Session`。该值是不透明会话标识，不是 Cookie 或 CSRF 凭据。
- 客户端把每个写操作绑定到实例、规范化管理入口、本地会话代际、`session_id` 和 CSRF。操作等待 `GET /session` 或刷新 CSRF 期间如果代际/入口变化，停止发送并返回操作失效。
- 同一 `session_id` 的 `csrf_rejected` 允许清空 CSRF、重新 `GET /session` 并重试一次；新 `session_id` 表示新登录会话，旧操作不得重试，旧成功/401/403/退出也不得更新或清除新缓存。
- 已发送请求在失效时明确标记服务端结果可能未知；浏览器取消只保证本地停止等待，不保证服务端未执行。
