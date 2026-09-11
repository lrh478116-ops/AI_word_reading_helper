# 2026-09-10 云注册 fetch failed 根因审计与修复

## 只读审计结论

| 问题 | 严重程度/位置 | 直接证据与实际影响 | 修复方向/阻断 |
| --- | --- | --- | --- |
| 生产项目暂停 | 阻断；Supabase 项目 kaqonqxygajosgddhmaq | 2026-09-10 Management API 两次返回 INACTIVE；直连 Auth TLS 失败。项目停止与是否开启 VPN 无关；暂停原因尚无事件证据，不能断言一定为自动暂停 | 恢复同一项目并验证 Auth 健康；不得重建或删除数据 |
| 认证绕过桌面网络注入 | 高；server/supabase.ts request，server/index.ts configureExternalNetworkFetch | 搜索读取已注入 Chromium，但全部 Auth/Data/Storage 调用仍使用全局 Node fetch；现有桌面 smoke 禁用云端，不能验收生产认证 | 配置函数必须把网络能力传给 Supabase；桌面缺少绑定明确失败 |
| Chromium 丢失请求体 | 高；electron/chromium-net-fetch.mjs | init.body 从未被读取；request.end() 无参数。直接接入注册会发送空邮箱/密码；POST 搜索也受影响 | 完整传输 JSON/字节/标准 Request body；处理无 body 的 204/HEAD、取消和手动跳转 |
| 原始错误直接展示 | 中；Auth 路由与 src/App.tsx | TypeError fetch failed 直接进入 error 文案；上游 429 被登录路径错误转换成密码错误 | 稳定错误码、中英文说明；区分 DNS/TLS/超时/服务不可用/限流；不可将 DNS 失败武断归因为 VPN 或项目暂停 |
| POST 敏感数据跳转边界 | 高；Supabase request | Node 默认自动 follow，TUS Location 未验证目标来源 | 只允许当前 API/Storage origin，重定向明确失败，禁止跨域凭据转发 |

以上是同一云请求链的运行状态、绑定、字节传输和错误传播断点。先恢复服务，再修复共享传输与绑定，再验证正式认证入口与真实服务。任何一层未完成均不宣称生产注册验收。

## 不变量与非目标

- 本地模式保持零云调用；不开启用户的搜索开关，不上传文档，不触发真实注册邮件。
- 网络错误不自动重试注册、验证码、密码重置等写操作，避免重复发信/一次性 token 重放。
- 只使用原项目 publishable key；无管理密钥进入 App；TLS 验证始终启用；不硬编码 IP、不绕过用户代理。
- 恢复免费项目不更改套餐。免费项目未来仍可能因低活动暂停；客户端无法保证服务永不暂停。
- mock/协议服务器仅为 COMPONENT_CAPABILITY；正式桌面主入口消费的证据单独记录；真实健康与无副作用负向认证探针不能冒充真实邮件完整注册。

## 先失败的回归与验收

1. Chromium POST JSON 在接收端逐字节匹配；二进制 PATCH 匹配；HEAD/204 不崩溃；取消和重定向不泄漏。
2. 正式 /api/auth/register 读取注入网络；毒化 Node fetch 后仍通过；切断绑定时桌面云注册明确失败而本地登录正常。
3. 注入 DNS/TLS/超时/服务 503/429，验证 HTTP 状态、错误码、无伪会话、无重复请求；注册成功才进入验证码页。
4. 真实 Electron 主入口，使用隔离本地目录，经系统网络调用恢复后的真实 Auth 健康与无副作用无效认证请求。
5. focused tests、全量回归和 Windows 新包实际测试；按新提交生成包版本/哈希。生产邮件仍需实际邮箱证据。

## 当轮证据（持续更新）

- Management API 恢复同一项目成功；状态依次 INACTIVE → COMING_UP → ACTIVE_HEALTHY，未改变套餐或删除数据。
- Chromium 请求体回归在修复前失败，接收端 JSON 是空字符串；修复后 JSON/二进制/HEAD/204/取消/重定向及正式注册路由的毒化 Node 反事实全部通过。
- 整套现有 Supabase 协议测试改为显式绑定传输，并额外在 Electron Chromium 中执行通过，包含注册、验证码、密码更新、云文件 gzip 上传/下载、移除云端和账户删除失败隔离。此为协议测试 COMPONENT_CAPABILITY，非真实邮件验收。
- Electron 原生 Fetch 的 manual 模式实测直接抛出 Redirect was cancelled，无法返回 Location，因此保留 ClientRequest 并由 redirect 事件截获、终止转发。接收端检查重定向目的地请求数为 0；不调用 followRedirect。
- 实际桌面 bootServer → probeCloudConnection 已消费新绑定，但生产域名直连仍失败：Chromium wrapper/native 均 ERR_CONNECTION_CLOSED，Node 为 ECONNRESET；系统代理 DIRECT，项目域名 DNS 为 198.18.0.148，Meta Tunnel 网卡仍 Up。该地址属于虚拟网络解析，不能以“代理开关关闭”推断系统无 TUN 接管。
- 未修改系统代理、网卡、DNS、hosts 或 TLS 验证。等待网络环境切换后的生产复测；在取得真实成功证据前标记 NOT_CAUSALLY_VERIFIED，不将协议测试当作生产注册通过。
- Supabase 官方 free-project-pausing 文档确认 Free 低活动可能自动暂停，付费项目不因闲置暂停。此次暂停的具体触发者没有事件日志，不武断归因。免费版未来不暂停无法靠本次代码修复保证。
- `pnpm skills:test` 全量通过；最终新增的连接中断分类回归也通过。新版本 1.12.12。测试日志中模拟的 503 是负向案例，不能当作真实项目故障。

## 2026-09-11 最终产物与真实连接复测

这一节是上述“等待复测”之后的新证据，不删除之前失败的记录。

- 生产项目仍为 ACTIVE_HEALTHY；恢复后真实只读 SQL 已确认 ai_documents 与 ai_tips 表存在。
- 当前系统代理仍 DIRECT，Chromium 包装、Chromium 原生 Fetch、Node Fetch 对真实 `/auth/v1/health` 都返回 HTTP 200，服务为 GoTrue v2.196.0。未改动本机代理、网卡或 DNS；因此此前 Meta Tunnel 的存在只能作为网络环境事实，不能判定为已证实的充分根因。此前连接关闭的精确归因未获得证据。
- Windows 1.12.12 由代码提交 `a6458be857d93ea830403284c1b4c31ca746a804` 构建。发布清单记录构建时源码干净。此节为后续文档验证提交，不把文档提交冒称为二进制构建源码。
- 安装包 `AI Tip Setup 1.12.12.exe`：204394459 bytes，SHA-256 `2ec556d86136a5714c91985c7d2db3a2f7b77ea6c1f99f12ad902a801eb19cd6`；Windows 签名仍为 NotSigned。
- 打包 EXE `--smoke-test` 退出码 0，PDF/OCR、递归 Tip、文档编辑保存、联网开关、凭据安全存储、Python Decimal 均通过。
- 同一打包 EXE `--cloud-connection-test` 退出码 0：正式 bootServer 注入 Chromium → 真实 Auth health 成功 → 本机正式 `/api/auth/verify-registration` → 真实 Supabase 拒绝无效验证码 → 本机 HTTP 401，无 token、无注册、无发信。证明云连接和负向认证在正式打包路径达到 FORMAL_PATH_INTEGRATION；不证明实际邮箱收信或真实用户注册成功。
- 对应本机原始证据：`release/release-manifest.json`、`release/packaged-smoke-1.12.12.json`、`release/cloud-connection-1.12.12.json`。
- 真实邮箱验证码接收、正确码建立会话仍为 NOT_CAUSALLY_VERIFIED；免费套餐不因闲置暂停的保证仍然不存在。SMTP 已知配置边界见 `docs/supabase-email-otp.md`。
