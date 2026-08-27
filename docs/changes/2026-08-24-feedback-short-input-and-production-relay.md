# 建议箱短文本提交与生产邮件链审计

## 结论

截图中的“发送建议”按钮并非视觉失效，而是被前端未公开的 `trim().length < 10` 条件禁用。服务端还重复拒绝少于 10 个字符的建议。界面只显示当前长度和 4000 上限，没有展示最小长度，因此用户输入“你好怎么回事”等正常短建议时无法知道为什么不能发送。

同时，Windows 1.12.2 发布包没有生产 `AI_TIP_FEEDBACK_RELAY_URL`。当前 Supabase 项目 `AI_reading_helper` 的 `/functions/v1/feedback` 经只读 GET 检查返回 404，说明真实生产中继不存在。此前模拟中继测试只能证明应用组件能力，不能证明目标邮箱真实收到邮件。

## 证据类型

- `COMPONENT_CAPABILITY`：前端状态、`POST /api/feedback`、隐藏收件人请求和模拟中继均已存在。
- `FORMAL_PATH_INTEGRATION`：短建议当前在前端按钮条件和服务端长度检查两处被阻断，未到达中继。
- `INDEPENDENT_EVALUATION`：真实 Supabase Edge Function 不存在；真实目标邮箱送达为 `NOT_CAUSALLY_VERIFIED`。

## 统一修复

1. 前端只在内容去除首尾空白后为空或正在提交时禁用按钮；不再设置隐藏的 10 字门槛。
2. 服务端接受 1～4000 个 UTF-16 表单字符，空白内容仍返回 400；保留类别白名单、登录鉴权、每用户 60 秒频率限制和 12 秒中继超时。
3. 短中文建议必须真实经过正式 API 到达受控中继；前端烟测必须用截图同长度的短建议证明按钮可点击。
4. 发送失败时继续保留原文；成功后才清空。
5. 收件地址和邮件服务凭据只能位于生产 HTTPS 中继或 Supabase Edge Function secrets，不能进入 React、Express 默认值、Electron、安装包或日志。

## 非目标与部署缺口

- 不把目标邮箱、QQ SMTP 授权码、Resend API Key 或 Supabase secret key写入桌面包。
- 不用 `mailto:` 冒充自动发送；它会暴露收件地址且要求用户手动操作。
- 没有可部署的邮件提供方凭据时，不伪造“发送成功”。应用侧修复可以完成，但生产邮箱到达仍标记为 `KNOWN_FRAMEWORK_GAP / NOT_CAUSALLY_VERIFIED`，直到在 Supabase secrets 中配置邮件提供方密钥、部署 Edge Function并执行真实送达测试。

## 验收条件

1. “你好怎么回事”输入后按钮启用。
2. 同一短文本通过 `POST /api/feedback` 到达受控中继，且 payload 不包含 `to`、`recipient`、邮箱、文档、Tip、模型 Key 或 Prompt。
3. 纯空白内容仍被前端阻止并被服务端返回 400。
4. 4001 字符仍被拒绝；成功提交后的第二次立即提交仍返回 429。
5. 中继未配置或返回错误时输入框不清空，并显示明确错误。
6. 完整回归和 Windows 打包态烟测通过。

## 实施与验证结果

- 前端和服务端的隐藏 10 字门槛已删除；当前只拒绝去除首尾空白后为空的内容。
- 修改实现前，受控正式 API 对“你好怎么回事”返回 `400 建议至少需要 10 个字符`，失败回归按预期捕获了截图中的真实阻断。
- 修复后，同一 6 字建议经鉴权 `POST /api/feedback` 到达受控中继；中继 payload 中没有 `to`、`recipient`、邮箱、文档、Tip、API Key 或 Prompt。
- 空白和 4001 字符输入均在调用中继前返回 400；成功提交后立即重复提交仍返回 429。
- Electron 桌面烟测使用同一短建议验证按钮已启用；未配置中继时输入保留并显示错误。
- `pnpm skills:test` 与 `pnpm desktop:smoke` 通过。
- 真实 Supabase `feedback` Edge Function 仍为 404，且当前没有可安全部署的 SMTP/Resend secret。因此生产邮件到达仍为 `KNOWN_FRAMEWORK_GAP / NOT_CAUSALLY_VERIFIED`；该结论不会被受控中继测试覆盖。

## 当前接入等级

- 短建议 UI → 本机 API → 受控 HTTPS 中继：`LEVEL_5_PREDICTION_BEARING`。
- 生产中继 → 目标 QQ 邮箱：`NOT_CAUSALLY_VERIFIED`。完成需要在 Supabase secrets 中配置邮件提供方凭据并部署安全的生产 Edge Function，随后执行真实邮箱送达测试。

## 1.12.3 发布态

- Windows x64 安装包：`release/AI Tip Setup 1.12.3.exe`。
- 新打包应用以独立进程通过完整桌面 smoke；短建议按钮启用、失败保留和隐藏收件人均在打包态执行。
- SHA-256：`EEF849A85E2DFFCCE1460354A055456DB2D020755389D1443602BF79E3879CC6`。
- 旧 1.12.2 发布产物已可恢复地移动到 `.release-archive/1.12.2`；打包测试记录保存在 `.release-archive/test-results/1.12.3`。
- 安装器没有 Authenticode 发布证书，状态仍为 `NotSigned`。
