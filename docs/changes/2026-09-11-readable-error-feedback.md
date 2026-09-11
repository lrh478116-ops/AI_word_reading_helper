# 2026-09-11 可理解的错误反馈

## 审计与统一方案

- 中：src/cloud-errors.ts 只有短说明，DNS、TLS、TUN 等术语缺少解释，无法指导普通用户操作。统一为现象、原因说明、处理方法；未证实根因使用“可能”。
- 中：src/api.ts 刷新会话把稳定 code 丢失，云文件和账户删除出口也只保留原始文字。保留分类并在统一 ApiError 边界按界面语言生成可读说明。
- 中：server/supabase.ts 丢弃官方 Auth code。邮箱未确认、发信限制、验证码失效可能被当作错误密码。保留官方 code、使用明确映射；不根据英文关键词猜业务原因。
- 中：Auth 错误区域没有语义 alert，长说明没有分段布局。按三行显示，保持输入内容和原有操作按钮可用。

## 不变量、非目标、验收

先运行失败回归，再改实现。仅改错误分类的保留与展示，不改变认证结果、请求次数、存储、搜索开关或服务器套餐；不伪造“已暂停”的确定诊断，不显示原始 HTML/堆栈/密钥。对已知错误必须显示现象、原因和可执行建议；未知 Auth 错误明确原因未确认。中英文、注册/验证码/刷新/云文件都消费同一映射。组件测试不冒称真实生产邮件验收。

## 本轮验证（1.12.13）

用户补充：所有本轮错误说明中建议“联系开发者”的位置必须直接显示公开联系邮箱 2280810215@qq.com，英文同样显示；不需要用户去其他页面寻找。先增加失败断言，再统一格式化联系方式；不改邮件发送或账户流程。

邮箱补充验证：修改前断言 `Contact support must display the public email` 失败；修改后 `pnpm errors:test` 通过，并在实际 React 错误区域断言完整邮箱显示。重新构建与类型检查通过。

- 修复前 `node scripts/test-readable-errors.mjs` 失败于 `Missing understandable cause/action: CLOUD_DNS_FAILED`，修复后通过。证据类型：COMPONENT_CAPABILITY。
- `pnpm cloud:network:test` 通过。真实构建的 React 登录表单 → 本地 API → 受控上游错误 → 保留 Auth code → ApiError 本地化 → 可见 alert。把上游 503 改为邮箱未确认后，可见原因随之改变；中文/英文、原因/处理方法、输入保留与换行样式均断言通过。受控正式路径达到 LEVEL_5_PREDICTION_BEARING；属于 FORMAL_PATH_INTEGRATION，不属于真实生产邮件投递的 INDEPENDENT_EVALUATION。
- 注册、登录、验证码确认、密码找回的官方错误码保留断言通过；缺少网络绑定、错误重定向、连接失败不得创建账户或自动重放请求的负向检查通过。
- `pnpm skills:test` 完整回归通过，包含导入、PDF/递归 Tip、模型下载、云文件与账户操作等既有回归。上述测试使用受控服务的部分不能证明真实邮箱收到验证码。
- Windows 安装包版本升至 1.12.13；不覆盖 1.12.12，不升级 Supabase 套餐，不修改生产 SMTP。
