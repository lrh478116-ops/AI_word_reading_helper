# Supabase 邮箱验证码发布配置

AI Tip 已实现以下正式认证链：

```text
邮箱密码注册 → Supabase 发送注册邮件 → 输入六位码 → /verify 建立会话
忘记密码 → Supabase 发送恢复邮件 → 输入六位码 → /verify → /user 更新密码
```

## 当前生产项目的阻断

项目 `AI_reading_helper` 当前位于 Supabase Free 计划，创建于 2026-08-16，并使用 Supabase 默认 SMTP。Supabase 从 2026-06-03 起不允许新 Free 项目在默认 SMTP 下自定义认证邮件模板。因此：

- App 的验证码输入、验证和密码更新主链已经存在并通过协议测试；
- 默认注册/恢复邮件目前仍以链接为主，不会展示 App 所需的六位 `{{ .Token }}`；
- 在配置自有 SMTP 前，真实邮件验证码能力属于 `KNOWN_FRAMEWORK_GAP`，不得作为已发布能力验收。

## 发布前配置

1. 在 Supabase Dashboard 的 Authentication → SMTP Settings 中配置一个只存在于 Supabase 服务端的 SMTP 账号。生产发布建议使用独立发信域名；不要使用个人邮箱长期承担公开 App 的认证邮件。
2. 不得把 SMTP 密码、授权码、service-role key 或邮件服务 API key写入本仓库、`.env.example`、Electron 包或前端代码。
3. 在 Authentication → Email Templates 中修改 **Confirm signup**，保留六位码变量：

```html
<h2>AI Tip 邮箱验证</h2>
<p>你的注册验证码是：</p>
<p style="font-size: 28px; font-weight: 700; letter-spacing: 6px;">{{ .Token }}</p>
<p>如果不是你本人操作，请忽略此邮件。</p>
```

4. 修改 **Reset Password**：

```html
<h2>AI Tip 密码恢复</h2>
<p>你的密码恢复验证码是：</p>
<p style="font-size: 28px; font-weight: 700; letter-spacing: 6px;">{{ .Token }}</p>
<p>如果不是你本人操作，请忽略此邮件。</p>
```

5. 模板若继续包含 `{{ .ConfirmationURL }}`，Supabase 会发送链接式邮件；要以 App 内六位码作为主流程，应确保模板实际显示 `{{ .Token }}`。
6. 在 Authentication → Providers → Email 中检查 OTP 有效期与发送频率。验证码有效期不应超过一天，生产环境应设置合理的尝试和发送速率限制。

## 发布验收

必须使用一个全新的真实邮箱执行：

1. 注册后收到含六位码的邮件；
2. 错码无法建立会话；
3. 正确码建立 Supabase 会话并进入文档库；
4. 重复注册显示“该用户已注册”和“忘记密码”；
5. 恢复邮件含六位码；
6. 错误恢复码不能改密码；
7. 正确恢复码更新密码，新密码可登录，旧密码不可登录；
8. Windows 与 macOS 各执行一次，不依赖浏览器回调或 localhost 固定端口；
9. 安装包中扫描不到 SMTP 密钥、service-role key、模型 API key 或 Tavily key。

只有以上真实任务全部通过，邮件 OTP 才能从 `NOT_CAUSALLY_VERIFIED` 升级为生产环境的 `LEVEL_5_PREDICTION_BEARING`。
