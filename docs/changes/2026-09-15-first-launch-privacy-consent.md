# 首次启动隐私政策确认（1.12.16）

## 只读审计与统一方案

- 高：electron/main.mjs 启动时直接 bootServer、恢复模型、安装业务 IPC，再加载登录页；没有隐私同意门禁。登录页弹窗无法阻止这些上游动作。阻止本需求验收。
- 高：src/App.tsx 的 AppContent 可恢复会话或进入本地模式；不能把“已登录”视为同意隐私政策。阻止本需求验收。
- 中：website/privacy/index.html 已有中英文政策，但未打包到桌面应用；仅在线链接不能保证离线可读。阻止本需求验收。

统一修复：在 Electron 正式启动入口最前方读取打包政策，展示独立、离线、受限 IPC 窗口。仅明确勾选并点击同意，且本地记录成功落盘后，才能启动业务服务、登录和本地模式。拒绝或关闭退出应用。缓存政策 SHA-256 与同意时间；缺失、损坏、版本过期时重新确认。

## 设计不变量

1. 未同意不启动业务 HTTP 服务、不恢复用户会话/本地模型、不注册业务 IPC。
2. 本地模式、已保存登录、诊断参数、macOS activate 均不能绕过首次确认。
3. 使用仓库现有政策全文（中英文），随安装包离线提供；不改变政策实质内容。
4. 同意不默认勾选；写入失败留在确认页并显示原因，不静默放行。
5. 明确拒绝和关闭窗口都退出，不保存同意记录；用户再次打开仍需确认。
6. 正常重启只接受匹配当前政策内容哈希的记录；新政策重新确认。记录仅在设备保存，不上传。
7. 测试使用独立临时配置，不读取或覆盖用户真实同意记录。烟测必须实际点击同意 UI，不添加跳过门禁参数。

## 非目标和边界

不改写法律条款，不宣称满足所有地区/商店法律要求；不实现网站开发服务器的强制弹窗。用户自行修改源码/本机文件不属于防篡改安全边界。未做 macOS 实机验收前不得声称已通过。

## 验收计划与证据等级

先添加并运行失败回归，再实现：首次无记录、旧登录不绕过、损坏/过期记录、不同意、窗口关闭、未勾选、伪造 IPC、写入失败、政策缺失、正常同意及重启复用、政策变化后重现。真实 Electron 窗口检查语言、滚动、窄窗口布局；正式打包入口烟测必须先通过同意 UI 再执行业务路径。

单元、人工构造数据、Electron 专项测试记为 COMPONENT_CAPABILITY；正式入口打包烟测按真实执行链报告，不用其 mock 模型结果声称独立用户评估。未执行项明确标记 NOT_CAUSALLY_VERIFIED。

## 本轮结果

2026-09-15，本轮执行结果：

- 实现前 `node scripts/test-privacy-consent.mjs` 明确失败（缺少 privacy-consent-store.mjs），随后实现并转绿。
- `pnpm privacy:test` 退出码 0：无记录、旧登录、损坏记录、过期政策、未勾选、错误政策哈希、伪造 sender/frame、拒绝、关闭、写入失败、正常同意、重启复用均检查。真实 Electron UI 检查中英文与 520×560 / 900×820 / 1440×1000 窗口布局。以上为 COMPONENT_CAPABILITY。
- `pnpm skills:test` 完整通过；其中模拟云端故障日志是负向用例，整体退出码 0，不是本轮真实云服务故障。
- `pnpm stream-rag:test`、`pnpm ux:test` 均退出码 0。
- `pnpm exec electron-builder --win nsis --x64` 成功生成 `release/AI Tip Setup 1.12.16.exe`，204415439 字节。没有覆盖 1.12.15 安装包。
- 打包后的 `release/win-unpacked/AI Tip.exe --smoke-test` 退出码 0。正式启动入口先检查业务服务/模型/凭据存储未启动、确认页没有业务 bridge、政策已离线显示且未默认勾选；随后实际点击勾选框及同意按钮，成功进入本地模式，完成导入、编辑保存、PDF/OCR、递归 Tip、Python 与安全存储烟测。记录位于 `release/packaged-smoke-1.12.16.json` 与同名前缀 stdout/stderr 日志。
- 对 app.asar 内 main、6 个隐私相关文件、政策原文逐字节与工作区比对一致，包内版本 1.12.16。隐私原文文件 SHA-256：`1da44605221a64b562315f50aa07dea191d08827bc0a5a23c435ebe09c602e9a`。
- UI 截图：`release/privacy-consent-1.12.16.png`，已检查政策正文滚动和底部操作区域。

## 因果链和边界

正式入口 `app.whenReady` → `loadPrivacyPolicy` 计算政策哈希 → 当前哈希收据验证或独立确认窗口 → 同意复选框及受限 IPC → 当前政策哈希验证与本机原子写入 → ensurePrivacyConsent 返回值赋给 privacyAccepted → 拒绝时 app.quit、同意时注册业务 IPC/bootServer → 正常登录及文档/Tip。bootServer 和 installDesktopIpc 自身再次校验 privacyAccepted，避免未来调用顺序变化绕过门禁。

专项负向测试的“业务调用次数”是测试端计数，不等同正式应用执行证据；正式打包入口的正向集成由实际 EXE 烟测证明。模型回答使用受控服务，不能据此宣称真实用户独立评估通过。INDEPENDENT_EVALUATION 及 macOS 实机验证仍为 NOT_CAUSALLY_VERIFIED。Windows 安装包仍未 Authenticode 签名，本任务不涉及商店审核或签名配置。
