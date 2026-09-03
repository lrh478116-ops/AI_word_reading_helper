# 2026-09-02 发布前门禁与安全加固

## 结论

本轮审计确认当前源码的核心阅读、Tip、本地模型、本地优先云同步和账户删除能力已经存在，但发布链仍有可复现缺口。发布验收不得只依据组件存在、测试字段非空或旧安装包可启动；候选构建必须由当前源码生成，并通过正式入口、负向路径和产物级检查。

## 已确认问题

| 问题 | 严重程度 | 代码或产物位置 | 当前直接证据 | 潜在影响 | 是否阻止下一阶段 |
| --- | --- | --- | --- | --- | --- |
| Electron 页面导航按字符串前缀放行 | 阻断 | `electron/main.mjs` | `url.startsWith(allowedOrigin)` 会把带用户信息的伪造 URL 误判为同源 | 页面可离开本地受信任来源 | 是 |
| 应用默认支持/隐私/删除 URL 不可访问 | 阻断 | `src/App.tsx`、私有 GitHub 仓库 Pages 工作流 | 正式 URL 返回 404；GitHub API 表明私有仓库当前套餐不支持 Pages | App Store 隐私政策和账户删除说明不可核验 | 是 |
| Windows 安装包落后于源码且未签名 | 阻断 | `release/AI Tip Setup 1.12.10.exe` | 产物时间早于最新提交；Authenticode 状态为 `NotSigned` | 用户拿到旧功能；SmartScreen/企业策略可能阻止运行 | 是，签名由运营者完成 |
| 渲染入口没有 CSP | 高 | `index.html` | 没有 `Content-Security-Policy` | 内容加载边界缺少纵深防御 | 是 |
| 构建依赖包含高危告警 | 高 | `pnpm-lock.yaml` | `pnpm audit` 报告 `nanoid 3.3.17` / GHSA-2v37-7h3g-55p8 | 构建链未达到零高危门禁 | 是 |
| 第三方许可未形成候选包可见清单 | 高 | `package.json`、`runtime/llama.cpp/win-x64` | 没有根级 notices；Windows llama.cpp 目录缺主 MIT LICENSE | 分发义务不可审计 | 是 |
| Supabase 泄露密码保护不可用且应用只要求 6 位密码 | 中 | Supabase Auth 免费项目、`server/index.ts`、`src/App.tsx` | Security Advisor 报警；官方文档说明该功能仅 Pro 及以上 | 弱密码风险高于发布建议 | 应用侧修复；Pro 功能保留明确边界 |
| 商店运营和签名证据尚未产生 | 外部阻断 | App Store Connect、签名证书、SMTP、ICP/APP 备案 | 当前仓库只有模板或 mock/组件测试 | 可能形成虚假“已上架就绪”结论 | 是 |
| 发布清单固定调用 Windows PowerShell | 高 | `scripts/create-release-manifest.mjs` | 从 PowerShell 7 启动时，子进程继承不兼容的 `PSModulePath`，`Microsoft.PowerShell.Security` 加载失败 | 已生成的候选包无法形成签名与哈希清单，发布证据链中断 | 是 |

## 设计不变量

1. 正式渲染页面只能在当前本地服务器的精确 `origin` 内导航；字符串相似、用户信息伪装、不同端口和非 HTTP(S) URL 必须拒绝。
2. 外部链接只能交给系统浏览器处理，不能替换应用主页面。
3. CSP 必须禁止插件对象、外部 frame、任意 base URL 和非必要脚本；同时保留应用自身、Blob Worker、Data/Blob 图片和用户选择 HTTPS API 的必要能力。
4. 专用支持站点只能发布 `website/` 中的静态支持材料；主源码仓库改为 MIT 开源后，两个仓库都不得包含密钥、测试账号、发布证书或用户文档。
5. 应用内默认 URL、发布配置和在线探针必须指向同一公开站点，并验证首页、隐私页和账户删除页均返回 2xx。
6. 候选包必须由当前提交重新生成；版本、文件哈希、签名状态和测试结果必须写入当轮清单。
7. 所有 API Key、Supabase secret/service-role key、审核账号密码和 SMTP 密钥都不得进入客户端包或 Git。
8. Supabase 免费套餐不具备的保护不得被报告为已启用；应用自身注册和重置密码至少要求 8 个字符。
9. Windows 签名检查必须优先使用可用的 PowerShell 7，并在只存在 Windows PowerShell 时隔离不兼容的 PowerShell Core 模块路径；命令缺失或模块加载失败必须显式报错，不得把“未检查”伪装成“未签名”。

## 非目标

- 不伪造 Windows 或 Apple 代码签名，不创建虚假运营主体、电话号码、备案号或审核账户。
- 不重写或伪造源码历史；开源发布使用根目录 MIT `LICENSE`，第三方组件继续遵循各自许可证。
- 不把 mock 邮件、fixture PDF、Windows 截图或单元测试称为 macOS 候选包的独立商店验收。
- 不升级会改变最低系统版本的 Electron 主版本，也不在本轮修改模型或 checkpoint。

## 回归与反事实测试

在实现修复前，测试必须能捕获下列失败：

1. `http://allowed-origin@evil.example/`、不同端口和无效 URL 被旧前缀判断错误放行。
2. 公开站点 URL 返回 404 时，本地文件存在仍不得报告发布网站通过。
3. CSP 缺失、允许任意脚本、对象或 frame 时门禁失败。
4. 锁文件仍解析到已知脆弱的 `nanoid < 3.3.18` 时门禁失败。
5. 第三方 notices、llama.cpp 主许可或候选包内 notices 缺失时门禁失败。
6. 7 位注册或重置密码必须失败；已有登录密码不因新策略被静默改写。
7. 安装包版本与 `package.json` 不一致、产物时间早于 HEAD、产物未通过烟雾测试或未记录签名状态时不得标记为正式候选。
8. 关闭联网搜索、未点击云上传、删除账户失败、旧 token 复用等既有负向测试必须继续通过。
9. 发布清单的签名检查必须在当前 Windows 环境真实执行；传入普通未签名文件应明确返回 `NotSigned`，不能因继承的模块路径而崩溃，也不能硬编码为通过。

## 验收等级和证据边界

- 导航策略、CSP、密码策略和许可生成器通过独立负向测试后，可证明 `COMPONENT_CAPABILITY`。
- Electron 桌面烟雾测试从主进程加载页面、导入文档并运行 Tip，可证明对应功能达到 `FORMAL_PATH_INTEGRATION`；必须确认安全策略由主窗口正式消费。
- 新 Windows 安装包启动并产生当轮 smoke 记录、哈希与版本映射后，相关 Windows 功能才能达到 `LEVEL_5_PREDICTION_BEARING`。
- macOS 签名、沙箱、截图、SMTP、审核账号和真实账户删除仍需真实环境证据；在此之前统一标记 `NOT_CAUSALLY_VERIFIED`，不得用于正式上架授权。

## 完成条件

- [x] 精确 origin 导航策略及反事实测试通过。
- [x] CSP 门禁通过且正式构建/桌面 smoke 无回归。
- [x] 完整依赖审计不含 high/critical，生产依赖审计为零。
- [x] 第三方 notices 与 llama.cpp 许可证进入安装目录。
- [x] 公开站点三个正式路径在线返回 2xx，应用默认 URL 已更新。
- [x] 注册和重置密码的 7 位负向测试及 8 位正向测试通过。
- [ ] 版本升级、全量回归、Windows 重打包和候选包哈希完成（提交后生成最终候选 manifest）。
- [x] 所有只能由运营者完成的项目在最终报告中保持未完成状态，不被静默放行。

## 2026-09-03 开源发布补充

用户明确授权把主 GitHub 仓库改为公开开源库。本轮在改变可见性前对全部 Git patch 历史执行了私钥、GitHub token、OpenAI/Tavily、AWS、Google API 与 Supabase service-role 字面量扫描，未发现命中；当前跟踪文件名中只有实现和测试用的 `login-credentials` 文件，没有真实凭据文件。根目录新增 MIT 许可证，并把应用许可证与第三方 notices 一并写入桌面安装资源。
