# 审核测试账户私密填写模板

本文件只能作为字段模板。不要把真实审核密码、邮箱验证码、service-role key 或 SMTP 密钥提交到 Git。

在 App Store Connect 的私密审核信息中填写：

```text
Cloud test account email: [REVIEW_EMAIL]
Cloud test account password: [REVIEW_PASSWORD]
One-time code behavior: [说明审核期邮箱如何接收真实验证码]
Account deletion path: Settings → Account & privacy → Delete account
Local-only path: Click “仅本地使用 / Local only” on the first screen
Special test document: [仅在无隐私风险时说明内置或公开样例]
Support contact: 2280810215@qq.com
```

## 建立账户后的真实验收

- 从未登录过的新安装完成密码登录。
- 注册邮件实际收到 6 位码；错误、过期和重复码均被拒绝。
- 忘记密码邮件实际收到 6 位码；成功后旧密码失效。
- 云账户能显式上传一个小于 5 MB 的压缩文档副本。
- 删除失败时账户仍可重试，应用不显示成功。
- 删除成功后 Auth、Storage、文档、Tip 和本机记住登录均消失。
- 使用旧 access token 调用正式 API 返回 401。

在取得自定义 SMTP 账号并完成以上真实验收之前，邮件能力必须标记为 `NOT_CAUSALLY_VERIFIED`，不能只用 mock 测试授权发布。
