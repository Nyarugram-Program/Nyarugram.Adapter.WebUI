# 交付报告：Milky / OneBot 多协议 WebUI（2026-11-08）

## 1. 结论

本轮完成并验证了以下交付：

- 修复 Milky 事件恢复的确定性缺陷（SSE 具名事件、地址规范化、游标丢失、重复事件 ACK、epoch 清理与持久化）。
- 认证与管理会话按实例隔离；NapCat 令牌、业务令牌、管理标记不再共用全局键。
- 接通 Nyarugram `/admin/v1` 的管理概览、机器人账号、配置、日志和指标页面。
- 完成 OneBot V11 与 Milky、NapCat 管理 / Nyarugram 管理 / 仅协议调试的页面分流。
- 在同级 Nyarugram.Milky 中实现真实 `/admin/v1` v1 子集，使用现有 `SessionManager`、PostgreSQL 和调用服务，不使用静态替身。
- 类型检查、前端单元测试、后端宿主测试和生产构建通过；用真实适配器宿主、PostgreSQL、替身 Protobuf 后端和浏览器完成联调。

未完成或未验证的内容在第 7 节逐项列出，不能据此宣称真实 NapCat、真实 Nyarugram 后端或真实双向语音已经验收。

## 1.1 本轮追加修复（三项竞态缺陷）

### A. 管理 CSRF 跨实例共用

- `NyarugramAdminManager` 的静态 `csrfToken` 已移除。会话缓存按稳定实例 ID 保存，条目同时记录规范化管理入口和会话代际。
- 每次写请求捕获自己的 `AdminTarget`（实例、入口、代际、CSRF）；请求地址和 CSRF 来自同一目标，401/403/退出回调只在目标仍是当前代际时失效缓存。
- 登录、退出、实例切换、管理入口修改、删除实例都会递增代际并中止在途 `GET /session`。
- 同一实例并发 `GET /session` 合并为一个请求；迟到响应只在代际和入口都匹配时提交。
- `csrf_rejected` 只重试一次，并在重试前重新获取会话；第二次仍拒绝时直接上报，避免重复执行可能已生效的写操作。
- 回归：`src/controllers/nyarugram_admin_manager.test.ts`，10 项，使用可延迟/乱序的 axios 请求替身，覆盖 A/B 交替、A 会话迟到、重新登录、旧 401/退出、入口变化、并发合流和 CSRF 重试。

### B. 事件游标未隔离服务与账号

- 新增 `src/utils/milky-event-scope.ts`：消费作用域由 `instanceId + protocol + 规范化服务入口（management/business/event）+ 稳定账号身份 + consumer + transport` 组成。
- 管理模式的账号身份来自 `/admin/v1/account` 的稳定 `account_id`；仅协议调试模式通过业务 `get_login_info` 的 `uin` 确认，身份未确认时不建立连接、不读取旧游标。
- 游标存储改为 v3，值中带 `version` 和完整 `scope`；v1/v2 游标没有服务和账号归属，明确丢弃而不猜测迁移。
- WS 的 ACK/epoch/去重状态抽到 `src/components/milky/ws-event-state.ts`；组件卸载或作用域变化时 `close()`，迟到帧不再写游标或发送 ACK。
- 账号登录/退出调用实例 `invalidate()`，触发事件作用域、连接和请求的代际切换；业务令牌变化在仅协议模式下必须重新确认身份，确认前不使用未确认令牌连接。
- 回归：`milky-event-scope.test.ts`（8）、`milky-events.test.ts`（13）、`ws-event-state.test.ts`（9），覆盖账号/入口/consumer/transport 隔离、旧 epoch、重复 ACK、关闭后迟到帧、resume 拒绝重试和 int64 uin。

### C. 历史日志覆盖实时日志

- 新增 `src/components/admin/log-merge.ts`：历史页和 SSE 统一进入同一个 `AdminLogStream`，按 `stream_id + id` 去重，按时间倒序、同时间按数值 id 倒序稳定排序，合并后统一截断到 1000 条并重建去重集合。
- 历史响应不再 `setEntries` 覆盖；SSE 先到或历史先到结果一致。被容量淘汰的 id 不再永久占用去重集合。
- 旧实例/旧作用域的控制器在切换时 `close()`，旧历史响应和旧 SSE 回调只能命中已关闭控制器。
- 适配器日志增加进程级 `stream_id` 与 `stream_started_at`；历史响应、每条 SSE 日志和页面都暴露该身份。服务重启后 id 从 1 重置时，前端按新流身份重置列表，不把新日志当成旧日志。
- 回归：`log-merge.test.ts`（12），包含延迟历史 Promise、SSE 先到/后到、重复 ID、容量、流身份切换、旧进程历史迟到和关闭后迟到回调；后端 `AdminApiTests` 校验历史与两次查询的 `stream_id` 一致。

## 1.2 最新复核追加修复（三项遗漏）

### A. 禁止旧代际写操作迁移到新会话重试

- 管理契约新增 `session_id`（`POST/GET /admin/v1/session` 响应体）和 `X-Nyarugram-Admin-Session` 响应头；它是不可用于认证的不透明会话标识。
- 客户端在操作入口捕获实例、规范化入口、会话代际、会话 ID 和 CSRF；CSRF 获取、等待和重试都受该上下文约束。
- 登录、退出、实例切换、入口变化、删除和会话失效会递增代际并中止等待中的 `GET /session`；旧操作返回 `AdminOperationInvalidatedError`，不再借新会话重试。
- 同一会话的 `csrf_rejected` 可以清空 CSRF 后刷新并重试一次；如果刷新得到不同 `session_id`，按“会话已切换”失效，不重试。
- 已发送请求的失效错误带 `sent=true` 并明确提示服务端结果可能已生效；未发送的写操作带 `sent=false`。
- 旧成功响应、旧 401/403、旧退出完成不会更新或清除新会话缓存；`useAuth` 对失效的退出不清除新会话标记。
- 回归：`nyarugram_admin_manager.test.ts`（17）覆盖旧 PUT/DELETE 延迟 403、等待 GET 时登录/入口变化、当前会话刷新重试、第二次 403、旧成功响应、会话头不匹配和旧 401/退出。

### B. 事件自动重连前重新确认账号归属

- `/event` 新增可选 `nyarugram_expected_identity` 握手：管理模式传 `admin:<account_uuid>`，仅协议模式传 `business:<uin>`；不匹配在建立 SSE/WS 前返回 409，不创建消费者位点。
- 前端不再让 `react-use-websocket` 或 EventSource 静默重连。连接关闭/失败后先重新查询 `/account` 或 `get_login_info`，确认身份后才建立下一条连接；账号变化会切换到新作用域，同账号保留恢复位置。
- 服务端事件订阅按 `SessionContext` 隔离，账号切换会取消旧 scope 并中止旧 socket；旧控制帧、旧查询迟到结果和旧重连定时器不能写入新作用域。
- 管理模式和 `managementKind=none` 均覆盖；身份查询失败或未登录时不建立连接、不读取/写入旧游标。
- 回归：后端 `EventTransportIdentityTests`（5）覆盖 SSE 零事件恢复、多消费者、错误/正确 admin/business 身份、SSE 账号切换和 WS 账号切换后旧身份拒绝；前端 `ws-event-state`/scope 测试覆盖 epoch、ACK 和关闭后迟到帧。
- 说明：CLI 是独立进程，当前不会通知正在运行的 `serve` 进程切换运行时账号；浏览器可发现的账号切换来自运行中适配器的管理 API/其他标签页。该边界在未验证项中列出。

### C. SSE 稳定消费者身份

- SSE 与 WS 都通过 `nyarugram_consumer` 传递稳定消费者：前端由 `consumer.ws` / `consumer.sse` 派生，长度截断到 128，不含凭据；SSE 和 WS 各自拥有独立服务端位点。
- URL 构造保留显式路径和原有合法查询参数，并传递 `nyarugram_expected_identity`；WS 保留 `access_token` 和 `nyarugram_ws_ack`，SSE 继续用 Authorization 头，不把令牌放进 URL。
- 首次连接由适配器 `EnsureConsumerAsync` 保存初始位置；零事件断线后重连可从该位置补发。已有 v3 本地游标通过 `nyarugram_cursor` 作为连接起始提示迁移到新的 transport-scoped 消费者。
- 回归：后端 SSE 零事件恢复和多消费者测试；前端 URL 构造测试覆盖消费者、expected identity、cursor、自定义路径/查询和 128 字符限制；浏览器实测 SSE 页面请求携带 `nyarugram_consumer=nyarugram-webui.sse`，零事件后切走再切回补发了 seq=32 事件。

## 1.3 最新复核追加修复（SSE 重连与身份退避）

### A. SSE 不再每收到事件就重建连接

- `MilkySseEvents` 的连接 effect 不再依赖渲染时计算的 `sourceUrl`/`initialCursor`。起始游标在 effect 内部一次性捕获，事件更新只写 `cursorRef`、列表和 `sessionStorage`，不改变连接依赖。
- 显式重连和失败恢复只调用父级 `onReconnect`；父级先重新确认身份并 remount 面板，新面板从持久化的最新游标构造 `Last-Event-ID` 和 `nyarugram_cursor`。健康连接不会因普通渲染关闭。
- 组件级测试 `event_debug.test.tsx`（4）：连续两条事件始终一个连接且未关闭；显式重连关闭旧连接并建立一条带最新游标的新连接；失败恢复同样只建立一条新连接；旧作用域迟到事件不更新新面板。
- 浏览器实测：SSE 单连接接收 30 条注入事件期间，服务端 `nyarugram_consumer=nyarugram-webui.sse` 请求计数保持 1，页面 cursor 推进到 68。

### B. 身份确认暂时失败后自动恢复

- 新增 `use-event-identity.ts`：身份确认与事件连接分离。第一次连接和每次自动重连都先解析 `/account` 或 `get_login_info`；未确认期间不建立事件连接、不读写游标。
- 错误分类：
  - 网络中断、超时、408、429、5xx：指数退避 1s→2s→4s→8s→16s→30s，遵循 `Retry-After`（至少 1s）。
  - 401/403、账号未登录：每 30 秒做一次仅身份的重试，不建立事件连接；凭据或账号恢复后自动连接。
  - 400/404/契约错误：停止自动重试，保留手动入口。
- `retryNow` 与自动定时器共用同一 effect/AbortController：手动触发会取消定时器并中止旧查询；实例/入口/凭据/卸载会取消查询和定时器。旧查询和旧定时器不能恢复旧账号连接。
- `AdminRequestError` 和 `MilkyRequestError` 增加 `network`、`timeout`、`status`、`retcode`、`retryAfterMs`，用于可靠分类。
- Hook 级测试 `use-event-identity.test.ts`（8）：500 后恢复、Retry-After、未登录慢重试、手动取消定时器、旧实例迟到查询、卸载清理、仅协议 503 恢复、A 重试期间切 B。SSE/WS 共用该 hook；管理模式和 `none` 均覆盖。
- 浏览器断网验证：停止前端同源代理后，SSE 断开，页面显示 `Network Error 自动重试中（已尝试 2 次）` 且无事件连接；恢复代理后无需操作自动重新确认身份并连接，服务端记录 `nyarugram_cursor=68`，事件消费者从 seq 68 恢复，下一条事件 seq 69 正常到达。

## 1.4 Milky HTTP 错误元数据修复

- 内部请求结果保留 Milky 业务外壳、实际 HTTP 状态和解析后的 `Retry-After`。`getLoginInfo` 构造 `MilkyRequestError` 时同时传递 `status`、`retcode` 和 `retryAfterMs`，仅协议模式的身份 Hook 因此能够遵循服务端退避要求。
- 非 JSON、非法业务外壳及空 JSON 响应的错误同样保留 HTTP 状态与退避时间。公开 `MilkyManager.call` 继续返回原 Milky 业务外壳，既有调试和通话调用保持兼容。
- 新增 `src/controllers/milky_manager.test.ts` 的 11 项回归，覆盖 429/503/业务失败、非 JSON/非法外壳/空响应、秒数与 HTTP-date 形式的 `Retry-After`、无效头、原返回结构和 int64 身份精度。
- 回归通过实际 `MilkyManager.getLoginInfo` 和 `useEventIdentity`，仅替换 axios 传输。HTTP 429 + `Retry-After: 60` 时，59,999 毫秒内只有一次请求，满 60,000 毫秒后才发起第二次请求并恢复身份。
- 本轮类型检查通过，11 个测试文件的 94 项测试全部通过，两个改动源码文件的 ESLint（含 Prettier）通过，生产构建成功。构建仍有 chunk 体积警告。
- 发布 ZIP 从 `D:\BotgramBuild\AdapterWebUI-retry-after-fix-dist` 重新生成，225 个归档文件逐项 SHA-256 与构建目录一致，最终大小和哈希见第 2 节。
- 本轮未修改后端，也未复跑后端测试、浏览器联调或真实服务验证。下方后端与浏览器证据保留为此前轮次记录。

## 2. 环境与可复现构建

| 项 | 值 |
|---|---|
| 工作区 | `W:\Work\Nyarugram.Adapter.WebUI` |
| 系统 | Windows 10.0.26100 x64 |
| Node / npm | v24.15.0 / 11.12.1 |
| 前端依赖 | `D:\BotgramBuild\Nyarugram.Adapter.WebUI\node_modules`（仓库内为联接） |
| npm 缓存 | `D:\BotgramBuild\npm-cache` |
| 后端 | .NET SDK 8.0.204 / 9.0.320，目标 net8.0 |
| 数据库 | PostgreSQL `127.0.0.1:56411`，测试库 `nyarugram_milky_test`、浏览器联调库 `nyarugram_milky_browser` |
| 锁文件 | `package-lock.json`，SHA-256 `51800b0e33a9b482bae2f334bc00a95089b53cac0f199c1d69138d9a4acd7f3f` |

构建产物：

- 目录：`D:\BotgramBuild\AdapterWebUI-retry-after-fix-dist`（225 个文件）
- 归档：`D:\BotgramBuild\NyarugramAdapterWebUI-dist-2026-11-08.zip`
- 归档 SHA-256：`47188ecb4e4c526fecdf2880ab928d219f59983cc8f059743c072bbc66b7edb3`
- 归档大小：8,404,376 字节

复现命令：

```bash
cd W:/Work/Nyarugram.Adapter.WebUI
npm ci
npm run webui:typecheck
npm run webui:test
npm run webui:build

cd W:/Work/Nyarugram.Milky
dotnet test Nyarugram.Milky.sln
```

## 3. 前端实现

### 3.1 事件恢复

修改：`src/components/milky/event_debug.tsx`、新增 `src/utils/milky-events.ts`。

- 事件入口接受 `http(s)://` 或 `ws(s)://`，按传输只做协议头规范化，保留 host、端口、路径和查询；不根据端口猜测地址。
- SSE 使用具名事件 `milky_event` 监听，修复只绑定 `onmessage` 导致收不到事件的问题。
- SSE 游标按实例、消费者、传输分别写入 `sessionStorage`；“重连并恢复”只重建连接，不再改组件 key，内存和历史事件保留。
- SSE 重连使用最新 `Last-Event-ID`，重复/更旧 `seq` 不重复显示。
- WebSocket 重复投递仍发送 ACK；ACK 按 `epoch:seq` 去重，但不会因为“已显示”而跳过确认。
- 收到新 epoch 或 `nyarugram_resumed` 时清理旧代际去重集合，并立即持久化新 epoch/cursor。
- 旧 epoch 事件丢弃且不 ACK；ACK/resume 拒绝会显示原因并允许一次带新 epoch 的重试。
- 后端在 `nyarugram_events_gap`、`nyarugram_ack_rejected`、`nyarugram_resume_rejected` 帧中补充当前 epoch，便于客户端恢复。

### 3.2 实例与认证隔离

修改：`src/contexts/instance.tsx`、`src/hooks/auth.ts`、`src/utils/instance-secrets.ts`、`src/utils/admin-session.ts`、`src/utils/auth-store.ts`、`src/utils/request.ts`、`src/utils/url.ts`、`src/controllers/webui_manager.ts`、`src/pages/web_login.tsx`、`src/components/sidebar/index.tsx`。

- NapCat 令牌、业务令牌均按实例写入 `sessionStorage`；旧全局 `localStorage.token` 只迁移一次后删除。
- 管理会话标记按实例保存，并绑定管理入口 origin；旧全局标记直接丢弃，避免跨实例误判已登录。
- `useAuth` 使用 `useSyncExternalStore` 订阅登录状态，不再读取全局 `useLocalStorage`。
- 实例切换、地址/协议/管理方式变化、登录/退出都会递增连接代际并取消在途请求。
- `getFullServerUrl` 不再回退 `http://localhost:6099`，没有显式 NapCat 实例时直接报错。
- 删除实例前尽力调用服务端 `DELETE /session`，并清除本实例秘密。
- 实例表单增加令牌“保持 / 替换 / 清除”三种显式操作。

### 3.3 管理页面

新增：`src/components/admin/overview.tsx`、`config.tsx`、`logs.tsx`、`shared.tsx`；修改 `src/controllers/nyarugram_admin_manager.ts`、`src/types/admin.ts`。

- 概览：`/info`、`/session`、`/health`、`/account`、`/metrics`，分别展示实例、能力、管理会话、账号状态和运行指标。
- 账号登录/退出：密码和验证器只用于本次请求，请求结束后清空；与 Web 管理会话分开显示。
- 配置：加载 schema、脱敏配置、版本和状态；按字段类型渲染；秘密字段保持/替换/清除；保存使用 `If-Match`，冲突提示并刷新。
- 日志：历史分页 + SSE 流，按级别和文本过滤，有界 1000 条，暂停/清空/刷新，重复 ID 去重。
- 401 显示管理登录入口，不伪造数据；配置保存后按后端返回显示 `requires_restart`。

### 3.4 页面分流

修改：`src/pages/index.tsx`、`src/config/site.tsx`、`src/components/onebot/overview.tsx`、`src/App.tsx`。

- `nyarugram-admin-v1`：管理概览、配置、日志，OneBot/Milky 各自的协议调试与通话入口。
- `milky + none`：业务健康、能力、通话和 Milky 调试；配置/日志显示明确不可用原因。
- `onebot11 + none`：新增纯协议概览，`/network`、`/config`、`/logs` 不再进入 NapCat 仪表盘。
- `onebot11 + napcat`：保留原 NapCat 仪表盘、网络、配置、日志和 QQ 登录。
- 修复未登录时 `/web_login` 被重定向到自身的空页面循环。
- 实例保存后自动跳转到当前实例首页。

## 4. 适配器管理接口实现

修改/新增于 `W:\Work\Nyarugram.Milky`：

- `src/Nyarugram.Milky.Host/AdminEndpoints.cs`：`/admin/v1` 路由与 DTO、错误外壳、CSRF/Origin 校验、账号、配置、健康、指标、日志和 SSE。
- `src/Nyarugram.Milky.Storage/AdminConfigStore.cs`：`admin_config` 单行版本记录、秘密加密、`If-Match` 冲突。
- `src/Nyarugram.Milky.Host/Configuration.cs`：启动时把管理配置覆盖应用到 `MilkyOptions`，记录已应用版本。
- `src/Nyarugram.Milky.Host/Program.cs`：启动前从 PostgreSQL 读取管理配置；注册有界日志缓冲；映射管理路由。
- `src/Nyarugram.Milky.Host/Composition.cs`：注册 `AdminAuthService`、`AdminConfigStore`。
- `src/Nyarugram.Milky.Host/AdminLogging.cs`：新增 `ReadLatest`。
- `src/Nyarugram.Milky.Host/MilkyEndpoints.cs`：补全 WS 控制帧的 epoch。
- `tests/Nyarugram.Milky.Tests/AdminApiTests.cs`：管理接口契约测试；`IntegrationTests.cs` 增加测试管理凭据。

实现边界：

- 配置字段为 `runtime.sync_interval_seconds`、`outbox_retention_hours`、`profile_cache_ttl_minutes`、`auto_answer`；秘密为 `milky.access_token`。
- 配置在进程启动时读取，保存后状态为 `requires_restart`，不做热应用。
- 管理会话保存在进程内存；Cookie 为 HttpOnly、SameSite=Strict；写请求校验 Origin 和 `X-CSRF-Token`。
- 当前未启用跨源 CORS；部署要求同源反向代理并保留 Host/Origin。

## 5. 自动化测试

### 前端

- `npm run webui:typecheck`：通过。
- `npm run webui:test`：11 个文件、94 个测试通过。
  - `milky_manager.test.ts`（11）：真实请求处理链保留 HTTP/Retry-After，身份 Hook 满 60 秒后才重试，兼容性与 int64 回归。
  - `json.test.ts`（3）：int64 精度与 BigInt 往返。
  - `milky-events.test.ts`（13）：传输地址规范化、v3 作用域游标、旧游标丢弃、损坏存储处理、transport-scoped consumer/expected identity/cursor URL。
  - `milky-event-scope.test.ts`（8）：服务/账号/consumer/transport 作用域、admin UUID、business uin 和 URL 规范化。
  - `ws-event-state.test.ts`（9）：ACK/epoch/去重状态机、关闭后迟到帧、resume 拒绝、跨账号不共享 epoch。
  - `nyarugram_admin_manager.test.ts`（17）：CSRF 目标隔离、迟到会话、旧 PUT/DELETE 403 不重试、等待 GET 时登录/入口变化、同会话刷新、第二次 403、旧成功响应和会话头不匹配。
  - `log-merge.test.ts`（12）：历史/SSE 乱序合并、重复 ID、容量、流身份重置、旧历史迟到和关闭后回调。
  - `admin-session.test.ts`（4）、`instance-secrets.test.ts`（5）：实例级管理标记和秘密隔离。
  - `event_debug.test.tsx`（4）：真实组件 + EventSource 替身，单连接、显式重连、失败恢复、旧作用域迟到事件。
  - `use-event-identity.test.ts`（8）：500/429/未登录/仅协议退避、Retry-After、手动与自动合并、实例切换和卸载清理。
- `npm run webui:build`：通过；存在 Monaco/页面 chunk 体积警告，不影响产物。
- ESLint（关闭 `prettier/prettier` 行尾规则）：0 错误。对本轮变更文件单独执行 ESLint（含 Prettier 规则）通过；Windows `core.autocrlf` 会把其余已跟踪文件检出为 CRLF，导致全仓 `webui:lint` 的 Prettier 规则报 18887 个行尾错误；CI 在 Linux 检出 LF。未执行全仓 `--fix`，避免无关格式化。

### 后端

- `dotnet test Nyarugram.Milky.sln`：105 通过、0 失败、1 跳过。
- 跳过项：`TgcallsEngineTests.Two_agents_establish_a_real_p2p_call_with_full_duplex_audio`，需要原生媒体 agent。
- 新增管理接口测试覆盖：公开 info、错误/正确管理凭据、会话 Cookie/`session_id` 头、账号绑定、CSRF、`If-Match`、配置校验、版本递增与 412、秘密保持/替换/清除且不回显、日志/指标、跨源写拒绝、日志 `stream_id` 历史一致性。
- 新增 `EventTransportIdentityTests`（5）：SSE 零事件恢复、多消费者、错误/正确 admin/business 身份、SSE 账号切换、WS 账号切换后旧身份拒绝。

## 6. 浏览器联调

测试拓扑（全部为本机、隔离数据）：

- 前端静态产物 + 同源代理：`http://127.0.0.1:4173`。
- Nyarugram.Milky 宿主：`http://127.0.0.1:58081`，PostgreSQL 库 `nyarugram_milky_browser_r2`。
- 替身 Protobuf 后端：`http://127.0.0.1:59999`，测试事件注入端口 `59998`；替身支持 `bot`/`bot2` 两个账号和按 bearer 返回各自 `AccountMe`。
- 测试实例：Milky + `nyarugram-admin-v1`、Milky + `none`、OneBot V11 + `none`。
- 管理凭据和业务令牌均为本地测试值，不写入仓库。
- 浏览器操作说明：实例登记、管理登录、账号 A/B 首次登录和事件页操作走 UI；外部账号切换使用同页 `fetch` 调用同源管理 API（页面保持打开），入口变更使用实例记录，以避免自动化环境对原生 `confirm` 对话框和坐标点击的限制。所有账号切换都经过真实适配器 `SessionManager`。

已验证场景：

| 场景 | 结果 |
|---|---|
| 未登录访问 `/` | 正确进入管理登录页，不再空页面循环 |
| 登记 Milky 实例（HTTP 业务、WS 事件、管理入口） | 保存成功并切换 |
| 管理凭据登录 | 200，建立 HttpOnly 会话，页面加载实例/能力/账号/指标 |
| 机器人账号登录 | 通过管理 API 调用真实 `SessionManager`，显示 `Bot` / `100001` |
| 配置保存 | 同步间隔 2→9，版本 0→1，状态 `requires_restart` |
| 管理日志 | 历史条目 + SSE 实时流均显示；页面显示进程级日志流 ID |
| Milky HTTP 业务 | `send_private_message` 返回 `status=ok`、`message_seq=1000` |
| Milky WS 事件 | 收到 `message_receive`，ACK 游标正常推进 |
| 显式 resume | `nyarugram_resumed` 返回新 epoch，旧代际去重清空，新事件按新 epoch ACK |
| SSE 事件 | 收到事件和游标；“重连并恢复”后无重复 |
| 通话控制 | 发起返回 outgoing 呼叫 ID；挂断返回 ended/hangup/media closed；界面明确 `voice=false` |
| OneBot 纯调试分流 | 概览、`/network` 不可用原因、HTTP 调试目录均正确，未请求 NapCat 管理接口 |
| 非 JSON 业务响应 | 页面显示“非 JSON 响应”警告，不伪装成成功 |
| 管理实例 A/B/A 账号切换 | A（`admin:1d89…`）与 B（`admin:127f…`）作用域键不同；B 首次连接无 A 游标；B 重登恢复自己的 cursor=3；A 重登由服务端持久游标恢复 cursor=4，新事件 seq=5 ACK |
| 仅协议模式账号 A/B/A | `get_login_info` 确认 `business:100001` / `business:100005`；作用域键不同；B 不继承 A 的 cursor=6；A 切回后恢复自己的 cursor=8 |
| 同一实例更换业务入口 | 业务入口加 `/business-v2` 后作用域键变化且无可复用游标；恢复入口后 A 原作用域和 cursor=4 重新出现 |
| 双实例切换 | Milky 管理实例、Milky 仅协议实例、OneBot 实例之间切换，管理标记/业务令牌/事件作用域均按实例隔离 |
| CSRF 跨实例 | 自动化测试覆盖 A/B 不同 CSRF、迟到会话、旧 PUT/DELETE 403 不重试、旧 401/成功/退出和入口变化；浏览器实例切换未出现串用 |
| 页面保持打开、外部 A→B | 通过同源管理 API 在页面不刷新的情况下退出 A、登录 B；旧 WS 自动关闭，页面重新查询 `/account` 后显示 `Bot Two` 和 `admin:127f…` 作用域，B 的事件 seq=19/34 正常 ACK |
| 页面保持打开、外部 B→A | 自动切回 `Bot` / `admin:1d89…` 作用域，恢复 A 自己的 cursor=30，不沿用 B 的显示 |
| 仅协议模式外部 A→B | 页面保持打开，`get_login_info` 重新确认 `business:100005`，作用域键变化并显示 B 的事件 seq=34 |
| 外部退出全部账号 | 事件页显示 `not logged in`，不建立新连接，不读取或写入旧账号游标 |
| SSE 实际请求 | 服务端日志显示 `nyarugram_consumer=nyarugram-webui.sse` 和 `nyarugram_expected_identity=admin:1d89…`；SSE 使用 Authorization 头，URL 无 access_token |
| SSE 页面零事件重连 | SSE 连接后无事件，切到 WS 产生事件，再切回 SSE；同一 `nyarugram-webui.sse` 消费者补发 seq=32 事件 |
| SSE 事件不重建连接 | 单条 SSE 连接期间注入 30 条事件，服务端该消费者请求计数保持 1，页面 cursor 推进到 68，未关闭健康连接 |
| 断网后身份自动恢复 | 停止同源代理后页面显示 `Network Error 自动重试中（已尝试 2 次）` 且无事件连接；恢复代理后无需操作自动连接，服务端记录 `nyarugram_cursor=68`，消费者从 seq 68 恢复，下一条 seq=69 正常到达 |
| SSE 原始 EventSource 零事件恢复 | 首次连接后立即关闭，注入事件，再用同一消费者重连，收到 `sse-zero-browser-recovery`；证明服务端保存初始位点 |
| WS 账号切换 | 后端测试连接 A 后登录 B，旧 socket 关闭；expected A 连接被 409 拒绝，expected B 可建立 |

兼容迁移：

- 事件游标 v1/v2 键没有服务或账号归属，前端首次进入实例时直接删除，不猜测归属；新键为 `nyarugram.events.v3.*`，值内含完整作用域。旧位置不可恢复，需要重新建立消费位置。
- 日志 `stream_id`/`stream_started_at` 为新增字段；旧适配器缺失时前端按 `legacy` 流处理，无法区分旧进程 id 重置，需升级适配器才能获得严格重启隔离。
- 管理会话新增 `session_id` 和 `X-Nyarugram-Admin-Session`；旧适配器不返回时客户端退化为按实例/入口/本地代际判断。CSRF 缓存只在内存中，刷新后重新 `GET /session`。
- v3 本地事件游标仍可读取；连接时通过 `nyarugram_cursor` 作为新 transport-scoped 服务端消费者的起始提示。SSE/WS 使用不同的服务端消费者（`.sse`/`.ws`），不共享或互相推进位点。
- `nyarugram_expected_identity` 为可选参数，旧客户端不传时保持原有行为；新前端总是携带已确认身份。
- 旧的全局 NapCat 令牌/管理标记迁移策略保持之前实现：令牌迁移到实例 sessionStorage，旧全局管理标记丢弃。

## 7. 未完成或未验证

| 项 | 状态 |
|---|---|
| 真实 NapCat / OneBot 服务互操作 | 未验证；本次没有 NapCat 服务，仅验证页面分流和调试页 |
| Nyarugram.OnebotV11 | 同级仓库仍为空，未联调；管理契约已可复用 |
| 真实 Nyarugram 后端账号 | 未验证；浏览器账号登录使用替身 Protobuf 后端 |
| 真实双向语音/媒体设备 | 未实现；仅验证控制面和 `calls.voice=false` 展示 |
| 配置热应用 | 未实现；保存后需要重启适配器 |
| 管理会话持久化 | 未实现；进程重启后需重新登录 |
| CLI 独立进程切换账号 | CLI 不通知正在运行的 `serve` 进程；页面只能发现运行中适配器管理 API/其他标签页产生的账号变化。CLI 改库后需重启或重新登录 serve 进程才能生效 |
| 旧适配器事件契约 | 不返回/不校验 `nyarugram_expected_identity` 的旧适配器仍可连接，但无法提供连接级账号归属保证；SSE 消费者参数旧适配器支持，`nyarugram_cursor` 也已有服务端支持 |
| 断网验证范围 | 浏览器验证停止的是浏览器到适配器之间的同源代理，不是真实公网断网，也没有重启适配器；适配器重启会清空内存管理会话，需要重新登录 |
| 身份重试期间的事件列表 | 身份重新确认会 remount 事件面板，页面内存中的已显示列表清空；恢复位置由持久化游标和服务端消费者保证，已消费但未在列表中的事件不会补显示 |
| 身份自动重试频率 | 网络/5xx/429 使用 1s→30s 退避；401/403/未登录每 30 秒做一次仅身份查询。页面保持打开时会持续重试，直到身份恢复或组件卸载 |
| SSE/WS 位点独立 | 这是本实现的声明语义：两种传输使用不同服务端消费者，不共享恢复位置；需要共享位点时应使用同一 consumer 的单一传输 |
| 账号退出的媒体释放 | 管理 API 复用现有 `SessionManager.LogoutAsync`；真实通话中的媒体强制释放仍依赖 `CallService` 维护路径，未做媒体设备验证 |
| 跨源部署/CORS | 未启用；要求同源反向代理 |
| 旧版事件游标 | v1/v2 无服务和账号归属，按策略直接丢弃，不能恢复旧位置；升级后首次进入实例需要重新建立消费位置 |
| 旧版适配器日志 | 缺少 `stream_id`/`stream_started_at` 时前端按 `legacy` 流处理；服务重启且 id 重置时无法严格区分新旧流，需升级适配器 |
| 管理 CSRF 缓存 | 只在内存中，页面刷新或标签页重建后重新 `GET /session`；不持久化 CSRF，避免秘密进入存储 |
| 替身后端账号 | 浏览器验证使用支持 `bot`/`bot2` 和按 bearer 返回 `AccountMe` 的替身 Protobuf 后端；真实 Nyarugram 后端未验证 |
| WS 自动 resume | 正常重连依赖服务端持久消费位置；显式“按当前游标恢复”按钮仍使用本地游标。若服务端起点与本地游标相同，显式回退可能被服务端拒绝并显示原因 |
| Windows 全量 lint | 受 CRLF 影响；CI Linux 预期通过，未在本机执行全仓 `--fix` |
| 真实公网/NAT 部署 | 未验证；文档只给私网与同源示例 |

## 8. 状态口径

- 源码实现：前端与 Milky 管理接口均已落地；CSRF、事件作用域和日志合并竞态已修复。
- 自动化测试：前端 94 项通过。本轮未复跑后端，后端 105 项通过与 1 项原生媒体测试跳过为此前记录。
- 浏览器测试：已完成上表场景，使用真实宿主和 PostgreSQL，后端账号认证使用支持双账号的替身 Protobuf 服务；双实例和 A/B/A 账号切换已验证。
- 真实服务测试：NapCat/OneBot 和真实 Nyarugram 后端未完成。
- 媒体设备测试：未完成，不能宣称语音可用。

正式部署、发布和数据迁移需另行授权。

## 9. 本轮修改文件

前端：

- `src/controllers/nyarugram_admin_manager.ts`、`src/controllers/nyarugram_admin_manager.test.ts`（重试元数据）
- `src/controllers/milky_manager.ts`（结构化 MilkyRequestError）
- `src/utils/milky-events.ts`、`src/utils/milky-events.test.ts`
- `src/utils/milky-event-scope.ts`、`src/utils/milky-event-scope.test.ts`
- `src/components/milky/event_debug.tsx`、`src/components/milky/event_debug.test.tsx`
- `src/components/milky/use-event-identity.ts`、`src/components/milky/use-event-identity.test.ts`
- `src/components/milky/ws-event-state.ts`、`src/components/milky/ws-event-state.test.ts`
- `src/components/admin/logs.tsx`
- `src/components/admin/log-merge.ts`、`src/components/admin/log-merge.test.ts`
- `src/components/admin/overview.tsx`
- `src/contexts/instance.tsx`
- `src/hooks/auth.ts`
- `src/types/admin.ts`
- `vitest.config.ts`
- `package.json`、`package-lock.json`（`@testing-library/react`/`dom` 测试依赖）

同级 Nyarugram.Milky：

- `src/Nyarugram.Milky.Host/AdminLogging.cs`
- `src/Nyarugram.Milky.Host/AdminEndpoints.cs`（`session_id`/响应头）
- `src/Nyarugram.Milky.Host/MilkyEndpoints.cs`（`nyarugram_expected_identity` 连接握手）
- `tests/Nyarugram.Milky.Tests/AdminApiTests.cs`
- `tests/Nyarugram.Milky.Tests/FakeBackend.cs`（测试替身支持双账号和按 bearer 返回对应 AccountMe）
- `tests/Nyarugram.Milky.Tests/EventTransportIdentityTests.cs`（SSE/WS 身份与稳定消费者测试）

文档：

- `Docs/DELIVERY-REPORT.md`
- `Docs/MANAGEMENT-API.md`
