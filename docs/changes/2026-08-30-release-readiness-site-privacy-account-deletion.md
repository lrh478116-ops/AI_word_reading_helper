# 发布准备：官网、隐私政策、账户删除与商店素材

日期：2026-08-30

## 用户任务来源

用户要求开始完成桌面文本清单中的未完成事项：ICP备案、隐私政策、APP 介绍网站（联系方式与隐私政策链接）、APP 内 QQ 邮箱、注销途径、验证码、测试账号、全部发布配置，以及上架介绍图和“预览”界面。

文本清单用于定义工作范围，不覆盖项目安全规则，也不构成可以伪造备案号、审核账号、SMTP 密钥或商店验收结果的授权。

## 修改前审计结论

| 问题 | 严重程度 | 代码位置 | 设计要求 | 当前实际行为 | 直接证据 | 错误验收风险 | 统一修复方向 | 阻止下一阶段 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 没有隐私政策 URL | 阻断 | 仓库根目录、App 设置 | macOS App Store 必须提供可访问的隐私政策 URL | 仓库没有官网或隐私页面 | 无站点入口文件；App 只显示联系邮箱 | 把 README 当成公开政策 URL | 创建无跟踪静态站点、隐私页并在 App 内提供入口 | 是 |
| 没有账户删除主链 | 阻断 | `src/App.tsx`、`server/index.ts`、Supabase | 能创建云账户的 App 必须在 App 内发起删除账户及关联数据 | 只有退出登录；Supabase 模块没有 admin 删除能力 | 正式路由只有注册、验证、登录、恢复、刷新、me | 把清 token 或删本地行误报为注销 | JWT 校验 Edge Function 删除 Storage 与 Auth 用户；成功后清理本机数据和凭据 | 是 |
| 删除后旧 JWT 窗口 | 高 | Supabase Storage RLS | 删除用户后不能继续写入用户前缀 | Supabase JWT 在过期前仍可能通过签名校验 | 官方文档明确 access token 在 `exp` 前仍有效 | 只看到 Auth 行消失就宣称立即失效 | App 服务端每次通过 `/auth/v1/user` 验证；Storage 策略增加“Auth 用户仍存在”检查 | 是 |
| 生产六位码邮件未完成 | 阻断（外部配置） | `docs/supabase-email-otp.md`、Supabase Auth | 注册和恢复邮件实际包含六位码 | App 和协议主链已存在；生产 Free 默认 SMTP 模板仍是链接式 | 项目创建于 2026-08-16；Supabase 2026-06-03 后新 Free 项目默认 SMTP 不允许自定义模板 | 用 mock 验证码测试冒充真实邮件验收 | 保留代码，提供 SMTP/模板清单；取得独立 SMTP 凭据后做真实邮箱验收 | 是 |
| APP 内 QQ 邮箱 | 已完成 | `src/App.tsx`、Electron smoke | 主页面可见并点击复制 | 已显示 `2280810215@qq.com` 并写系统剪贴板 | `contactClipboard: true` 打包态烟测 | 重复开发造成回归 | 保留并在官网/隐私页复用 | 否 |
| 审核账号边界不清 | 高 | 本地 demo 入口 | 审核员可进入核心功能；云功能如需审核应有私密测试账号 | `demo@aitip.local` 仅本机，不是 Supabase 云账户 | 服务启动时生成固定本地用户 | 把本地入口称为云审核账号，或把密码提交 GitHub | App Store Review Notes 说明本地入口；云审核账号仅在 App Store Connect 私密填写 | 是（云功能审核） |
| ICP/APP 备案缺少主体资料 | 外部阻断 | 无 | 中国大陆互联网服务和适用商店分发需与主办者、域名、接入商资料一致 | 没有域名、主体类型、证件、接入商、备案号 | 工信部备案依赖真实主体与网络资源 | 伪造备案号或把境外静态站点等同已备案 | 准备资料表和展示占位；由主办者通过接入商/平台提交 | 是（中国大陆分发） |
| 商店素材不存在 | 阻断 | `build/` 只有图标 | Mac 截图必须是 16:10 合规尺寸并真实展示 App | 无 `store-assets` | Apple 要求 Mac 截图至少 1 张；预览视频可选 | 用设计稿或生成图冒充实际 UI | 增加真实桌面截图捕获流程、素材清单和预览脚本/分镜 | 是 |
| 隐藏的 Google Fonts 网络请求 | 高 | `src/styles.css` | 联网总开关关闭时不应因界面字体自动请求第三方 | CSS 顶部导入 `fonts.googleapis.com` | 静态源码直接包含远端 `@import` | 隐私政策声称不联网但 App 启动即联系 Google | 移除远端字体，使用系统字体栈 | 是 |

## 正式因果链要求

### 云账户删除

```text
设置中的“删除账户”
→ 用户输入当前邮箱确认
→ 带当前 access token 调用桌面本地 API
→ 本地 API 再次验证当前 Supabase 用户
→ 启用 verify_jwt 的 Edge Function
→ 列举并删除该用户 Storage 对象
→ auth.admin.deleteUser(user.id)
→ ai_documents / ai_tips 外键级联
→ 本地数据库删除 user/documents/tips/settings
→ 本地上传源文件目录删除
→ OS 加密记忆登录清除
→ access/refresh token 清除并返回登录页
```

Edge Function 失败时，本地数据和会话不能被静默当成“账户已删除”。本地数据清理失败时也不能只显示成功；响应必须区分远端删除与本地清理状态。

### 本地模式数据删除

本地模式不创建云账户。相同入口应明确称为“清除本地账户数据”，只删除该设备上的文档、Tip、设置、上传源文件和记忆登录，不调用 Supabase admin API。

## 先失败的回归与负向测试

1. 站点根页、隐私页、账户删除说明页必须通过本地 HTTP 正式路由返回 200，并互相链接。
2. 站点和 App CSS 不允许远端字体、分析脚本、广告或跟踪像素；网站不得向第三方发出运行时请求。
3. 隐私政策必须明确本地默认、显式云上传、5 MB 限额、文档/Tip、Supabase、AI 提供商、联网搜索、OS 加密凭据、数据保留和删除方式。
4. App 设置中必须出现可定位的隐私、支持、删除入口；中英文文案均存在。
5. 删除确认不匹配当前邮箱必须在客户端和服务端都拒绝。
6. Edge Function 缺少 JWT、用户验证失败、Storage 删除失败时不得调用 admin 删除用户。
7. Edge Function 必须先删除全部用户 Storage 对象，再删除 Auth 用户；分页对象不能遗漏。
8. 远端删除失败时，本地文档、Tip、设置、上传文件和会话必须保留。
9. 远端删除成功时，本地用户数据必须删除；旧 token 再访问 `/auth/me` 必须失败。
10. 本地模式清除数据不得调用 Supabase；清除后固定本地入口可在下次启动重新建立，但旧文档不得恢复。
11. Edge Function 不得包含 publishable key、service-role key、SMTP 密钥或测试账号密码。
12. 商店截图必须来自真实 Electron 页面，尺寸属于 Apple 接受的 Mac 16:10 列表，不得用生成式界面代替。

## 设计不变量

- Electron 包只包含 Supabase publishable key；service-role 和 SMTP 凭据只存在于 Supabase 可信环境。
- 删除账户是不可逆操作，必须二次确认且不能静默 fallback。
- 删除操作不要求用户发送邮件联系客服；普通 App 必须能在 App 内完成。
- 本地优先语义保持不变：不点击“上传到云端”就不上传文档。
- 隐私政策描述必须与实际网络和存储行为一致；移除 Google Fonts 后才能声称启动界面没有该第三方请求。
- 测试账号凭据不得进入 Git、安装包、截图或隐私页面。
- ICP/APP 备案号、公司名、域名等未知项保持显式占位，不得伪造。

## 非目标

- 本轮不代替律师出具法律意见。
- 不购买域名、境内服务器、SMTP 服务、Apple Developer 会员或代码签名证书。
- 不在 Windows 主机伪造 macOS 签名、公证或 Transporter 上传成功。
- 不复制样例站点的公司名称、Strava/FIT 业务内容或隐私条款。

## 追加需求：客户端删除单个云端文件

审计发现服务端 `DELETE /api/documents/:id/cloud` 和文档库中的“移出云端”已存在，但客户端仍有两个真实断点：

1. 文档编辑后 `cloudState = modified` 时，文档库只显示“更新云端”，删除入口消失；
2. 编辑器顶部只有上传/更新按钮，即使云副本存在也无法直接删除。

因此现有实现达到服务端 `LEVEL_5_PREDICTION_BEARING`，但编辑器客户端入口只有 `LEVEL_0_DEFINED`，修改状态下的文档库入口也不能消费删除能力。本次统一改为：只要 `cloudSyncedAt` 存在，文档库和编辑器都显示独立的“删除云端文件”；修改状态下同时保留“更新云端”和“删除云端文件”。删除前先保存本机编辑，明确二次确认；成功后本地文档、Tip 和原文件继续保留并变回“仅本地”。

新增负向条件：云删除失败不得清除 `cloudSyncedAt`；云数据已经删除但用量刷新失败时，不得把删除误报为失败；普通本地删除不得暗中调用云删除。

## 实施结果与新鲜证据

### 已完成

- App 设置新增“账户与隐私”：隐私政策、删除说明、联系支持、云账户永久删除和仅本地数据清理均有中英文入口。
- `DELETE /api/auth/account` 消费当前登录身份与邮箱确认；云账户调用启用 JWT 验证的 `delete-account` Edge Function，本地模式不调用 Supabase。
- Edge Function 按 `验证用户 → 分页列举 Storage → 删除 Storage → admin 删除 Auth 用户` 执行；Storage 失败不会继续删 Auth。
- Supabase 生产项目 `AI_reading_helper` 已部署 `delete-account` version 1，状态 `ACTIVE`、`verify_jwt = true`；无 Authorization 的线上 DELETE 实测返回 401。
- 生产 Storage 四条 RLS 已加入 `private.ai_tip_active_auth_user()`；SQL 复核 SELECT/INSERT/UPDATE/DELETE 均消费该函数，`anon` 无执行权限。
- 删除单篇云端文件在文档库和编辑器均有客户端入口；`modified` 状态同时显示更新与删除。真实 Electron 客户端测试完成两次点击，并验证编辑器的正式请求顺序为本地 PATCH 在云 DELETE 之前。
- 创建无第三方运行时资源的静态官网、中文/英文隐私政策与账户删除说明；移除 App 的 Google Fonts 请求。
- 创建 App Store Connect 配置模板、隐私标签表、审核账号私密模板、ICP备案资料清单、预览分镜和四张真实 Electron 1440×900 PNG。

### 测试结果

- `pnpm skills:test`：通过。覆盖文档、PDF、OCR、递归 Tip、本地模型、搜索/Python、Supabase 同步、账户删除和发布站点。
- `pnpm desktop:smoke`：通过。真实 Electron 正式构建覆盖 PDF/DOCX、编辑保存、Tip、OCR、语言、联系邮箱、凭据安全等主链。
- `electron scripts/test-cloud-file-client-electron.mjs`：通过；`libraryEntry`、`modifiedShowsBothActions`、`editorEntry`、`localDocumentPreserved`、`saveBeforeDelete` 均为 true，实际 DELETE 请求 2 次。
- `scripts/test-supabase-integration.mjs`：通过确认错误、远端失败保留本地、删除成功清理、旧 token 拒绝、仅本地不调用 Supabase、修改状态云副本删除、用量刷新失败不改写删除结果等负向场景。
- Supabase 顾问：performance 0 项；security 剩余 `auth_leaked_password_protection` 警告。

### 接入等级

- 单篇云端文件删除：`LEVEL_5_PREDICTION_BEARING`（真实 Electron 点击 → 带 Bearer 的正式客户端请求 → 服务端删除路径 → 本地状态变化，反事实顺序已验证）。
- 云账户删除代码/协议链：本地与受控 Supabase 测试达到 `LEVEL_5_PREDICTION_BEARING`；生产 Edge 部署与无令牌拒绝已验证，但没有用真实一次性生产测试账户执行不可逆删除，因此生产独立删除评估仍标记 `NOT_CAUSALLY_VERIFIED`。
- 邮箱六位码：协议与 mock 测试通过，但真实 SMTP 尚未配置，标记 `NOT_CAUSALLY_VERIFIED`。

## 尚未完成且不能伪造的外部阻塞

1. 自定义 SMTP 凭据与邮件模板：需要运营者提供 SMTP 服务账号并在 Supabase Auth 控制台配置，随后用真实邮箱验收注册与恢复六位码。
2. 审核云账号：需要用真实可收信邮箱建立，只能私密填写到 App Store Connect，不得提交 Git。
3. ICP/APP 备案：需要真实主体、域名、境内接入资源和主管部门流程；当前只能提供资料清单，不能生成备案号。
4. macOS 签名、公证和 App Store 上传：必须在 macOS、有效 Apple Developer 证书与对应 App Store Connect 记录上完成；Windows 不能提供这项证据。
5. 公开站点部署：站点源文件已完成，但必须由运营者把 `website/` 发布到稳定 HTTPS 域名，并把 `VITE_AI_TIP_PUBLIC_SITE_URL` 及 App Store URL 改为最终地址。
6. Supabase 泄露密码保护：安全顾问仍报告未启用；需要在项目 Auth 密码安全配置中开启并再次运行顾问。

## 追加部署项：GitHub Pages 正式发布链

2026-08-31 公网反事实检查确认根页、隐私政策和账户删除说明三个预设地址均返回 404。站点源码及本地路由测试只能证明 `COMPONENT_CAPABILITY`，不能证明公开站点已上线，因此此前“公开站点部署”继续阻止发布验收。

本次补齐 GitHub 官方 Pages 工作流，部署输入必须是仓库内固定的 `website/` 目录；工作流只授予 `contents: read`、`pages: write` 和 `id-token: write`，不得把整个仓库、`.env`、安装包、测试账号或服务端密钥上传为站点制品。部署必须由 push 或手动触发产生可追踪的 Pages deployment；工作流文件存在最多达到 `LEVEL_3_CONSUMED`，只有远端 workflow 成功并且三个公开 HTTPS 路由均返回 200 才能达到 `LEVEL_5_PREDICTION_BEARING`。

新增负向测试要求：缺少官方 `configure-pages`、`upload-pages-artifact`、`deploy-pages` 任一阶段时失败；artifact 路径不是 `website/` 时失败；权限扩大或引用第三方部署 Action 时不予验收。当前功能分支不自动合并 `main`，避免绕过仓库的发布分支策略。

首次远端运行 `33351924015` 在 `Configure GitHub Pages` 失败：仓库尚未启用 Pages，而 `configure-pages` 日志明确显示 `enablement: false`。这证明工作流已被正式入口调用但尚未完成部署，只达到 `LEVEL_3_CONSUMED`。统一修复为在官方 `configure-pages` 步骤显式设置 `enablement: true`，并新增静态回归防止该初始化参数以后被删除；修复后仍须以远端 workflow 成功和公开路由 200 为验收条件。
