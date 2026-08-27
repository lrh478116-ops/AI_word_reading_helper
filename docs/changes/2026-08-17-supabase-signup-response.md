# Supabase 邮箱确认注册响应修复

## 问题

Supabase Auth 的 `POST /auth/v1/signup` 有两种成功响应：

- 关闭邮箱确认时返回包含 `access_token`、`refresh_token` 和嵌套 `user` 的完整会话；
- 开启邮箱确认时返回顶层 User 对象，不会立即返回会话。

应用此前把两者都强制转换为完整会话，并立即读取 `cloudSession.user.user_metadata`。真实注册已经创建账号并发送确认邮件后，正式入口仍会抛出 `Cannot read properties of undefined (reading 'user_metadata')`。

## 设计不变量

1. 只有同时具备有效 `access_token`、`refresh_token` 和 User 的响应才可建立云会话、写入本地云用户并开始同步。
2. User-only 注册响应只能产生 `confirmationRequired: true`，不得伪造会话，不得提前写入本地云用户。
3. 重复注册可能返回模糊化 User 以防止邮箱枚举；应用不得通过响应差异泄漏账号是否存在，也不得持久化该未验证对象。
4. 缺少 User 的 token 响应、缺少 token 的非 User 响应以及不合法 User 必须显式报告上游响应错误，不能抛出原生 TypeError，也不能静默回退到本地账户。
5. 登录和刷新仍必须要求完整会话；注册兼容 User-only 响应不能削弱登录、刷新和云同步的身份校验。

## 非目标

- 不关闭 Supabase 的邮箱确认。
- 不使用 service-role key 查询账号是否存在。
- 不自动把云注册失败降级为本地账号。
- 不改变“仅本地使用”的零 Supabase 请求语义。

## 追加范围：已注册提示与验证码恢复

1. 当 Supabase 明确返回 `identities: []` 的模糊化重复注册 User 时，按产品要求返回稳定错误码 `ACCOUNT_EXISTS`，界面显示“该用户已注册”并提供“忘记密码”。这会降低 Supabase 默认的邮箱防枚举保护，属于经产品要求接受的安全权衡。
2. 新注册的 User-only 响应进入注册验证码页面；验证码必须由 Supabase `/verify` 正式换取完整 Session，不能仅凭前端输入非空就放行。
3. 忘记密码必须依次经过 `/recover` 发送恢复邮件、`/verify` 验证恢复验证码、带恢复会话调用 `/user` 更新密码；缺少任一步都不能产生登录结果。
4. 注册、恢复验证码固定为六位数字；错误验证码必须由 Supabase 拒绝，不能在应用端伪造成功。
5. 当前生产项目是 2026 年新建的 Free 项目并使用 Supabase 默认 SMTP。该组合不能自定义邮件模板，因此默认邮件暂时只有确认/恢复链接，不会显示 `{{ .Token }}`。代码能力可以完成，但真实六位码邮件在配置自有 SMTP 和包含 `{{ .Token }}` 的模板前标记为 `KNOWN_FRAMEWORK_GAP`，不得声称生产 OTP 已验收。

## 验收条件

1. 顶层 User 注册响应通过正式 `/api/auth/register` 返回 HTTP 202 和 `confirmationRequired: true`，且不包含 token。
2. 上述路径不写入本地云用户，也不触发 Data API 或 Storage。
3. 完整会话注册仍返回 token、用户并进入既有云同步主链。
4. 带 token 但缺 User 的畸形响应返回明确 502，错误中不出现 JavaScript TypeError。
5. 登录、刷新、伪造 token 拒绝、仅本地隔离及完整 Supabase 集成回归全部通过。
6. `identities: []` 的重复注册响应产生 `ACCOUNT_EXISTS`，界面可进入忘记密码流程。
7. 注册与恢复验证码分别通过 Supabase `/verify` 产生会话；恢复流程随后真实调用 `/user` 更新密码。

## 证据边界

- 协议服务器回归测试属于 `FORMAL_PATH_INTEGRATION`，可证明正式 HTTP 入口消费两类响应并产生不同可观察结果。
- 真实 Auth 日志已证明注册请求返回 200、确认邮件发送和邮箱确认成功，属于真实服务证据。
- 修复后的新安装包仍需执行一次真实 UI 注册/登录复验后，才能把生产桌面交互标记为 `INDEPENDENT_EVALUATION`；在此之前保持 `NOT_CAUSALLY_VERIFIED`。

## 本轮新鲜证据

- 修复前正式测试稳定复现 HTTP 503：`Cannot read properties of undefined (reading 'user_metadata')`。
- 修复后完整 `pnpm skills:test` 通过，协议服务器确认 User-only、完整 Session、重复注册模糊 User、畸形 token 响应、注册 OTP、恢复 OTP 和密码更新均由正式入口消费。
- 真实 Supabase Auth 日志显示原始 `/signup` 返回 200、确认邮件已发送，用户随后完成邮箱确认；这证明截图对应的注册在云端实际成功。
- 以隔离的临时本地数据目录调用正式 App 注册入口，对已确认邮箱执行重复注册反事实，真实返回 HTTP 409、`ACCOUNT_EXISTS`、“该用户已注册”，且没有 token 或 User 输出。
- 真实六位码邮件尚未验证；由于 Free + 默认 SMTP 的模板限制，继续标记 `KNOWN_FRAMEWORK_GAP` / `NOT_CAUSALLY_VERIFIED`。
