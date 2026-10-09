# 补齐两版 Windows 安装包

## 追加：发布到 GitHub

用户于 2026-10-09 明确要求把本轮修改推送到 GitHub。发布 scope 包含当前源码、分版本构建与验证脚本，以及两份 Windows 1.12.17 安装包；安装包作为 GitHub Release 附件发布，不提交进 Git 历史。仓库远端在本地工作期间新增了 `36afc492`（关闭最后窗口后退出），必须先保留该提交记录并审查它与本地 Window 菜单恢复实现的冲突。

设计不变量：Mac App Store 版本仍不显示 API 版站外链接；Windows/站外本地模型版指向同一仓库中真实存在的 API 版 Release 资产；本地版不能因链接存在而获得云模型或 Tavily 能力；API 版保持现有能力；两份安装包使用默认英文文件名；不得把密钥、用户数据、构建缓存或整个 `release/` 目录加入 Git。

验收条件：远端 `main` 包含本轮源码提交且本地与远端 commit 一致；`v1.12.17` Release 的两个资产可由匿名 HTTPS 请求获得，大小与 SHA-256 匹配本轮已验证文件；本地安装包内的下载链接精确指向该 API 资产；无 URL、错误 scheme、凭据 URL、API+MAS 和本地版云配置继续明确失败；发布前重新运行 focused、正式构建/启动验证、仓库安全检查及最终差异检查。Windows 证据不能冒充 macOS 签名、沙箱或 App Store 审核通过证据。

最终 gate 首次运行时发现商店导出文本在 Windows 工作树中使用 CRLF，而 JSON 元数据中的文本使用 LF；原校验做原始换行逐字节比较，因平台换行差异误报 `Stale exported field`。修复范围仅是比较前把 CRLF/CR 规范化为 LF，其他文字仍严格相等；增加反事实检查，真实文字变化仍必须被拒绝。该修复不改商店文案内容和安装包业务行为。

## 追加：默认英文命名

用户随后要求默认用英文命名。scope 为安装包/发布产物的默认文件名，不改变用户已选择的界面语言，也不更改两版能力。当前中文名称来自 verify-edition-installers 的 label，而底层打包产物已是英文。

方案：交付名称改为 `AI Tip Local Setup <version>.exe` 和 `AI Tip API Setup <version>.exe`，同步生成器、最新文件清单与当前文件。改名先核对现有文件与已验证源安装器 SHA-256，目标若存在且不同则拒绝，避免覆盖用户文件。验收当前文件名、最新清单、字节内容及脚本默认输出；不重建或改变安装器内容。保留历史版本。

独立 closure：当前两份安装包已改名、生成器默认标签为 Local/API、最新清单已更新；界面语言未变。命名回归在旧中文文件名上明确失败，修复后 exit0；重新运行两份真实 EXE 及包内容验证 exit0，run ID `2e12038e-d3ea-4562-9fec-2fd720b1f72a`。改名后的摘要仍与原安装器相同，`git diff --check` exit0。该命名范围为 VERIFIED_LOCAL，未公开发布。

## 只读审计、scope 与方案

用户指出没有更新 EXE。本轮目标是生成当前代码的两版 Windows 安装包，不公开发布、不替用户安装、不覆盖用户数据、不删除旧安装包。仓库没有 AGENTS.md，遵循用户工程规则；保留之前未提交的分版改动。

确认：release 根目录的 1.12.16 安装包仍是 9 月隐私版本；API 候选在 api-direct 子目录，版本仍 1.12.16；local-direct 没有 EXE。此前把本地包生成与 API 公开 URL 绑定，导致缺少公开地址时无法交付本地使用的安装包。这是交付断点，不是编译或本地模型功能必须依赖公开下载。

统一方案：版本提升至 1.12.17；无公开地址时仍生成本地版，不提供虚假链接，而在邮箱上方明确显示 API 下载待发布。配置真实 URL 后仍按原要求显示超链接，MAS 始终无该导流。生成 API 与本地安装包，根目录提供带版本和版别的明确文件名及最新文件清单，保留历史文件。两套 staging/packaging 必须顺序运行，防止构建时覆盖正在打包的输入。

## 不变量、non-goals、验收与负向

- 本地模型/基础搜索/Skill 和 API 版功能边界不变，不解除任何模型或搜索硬门控。
- 不把待发布 API 链接当作可用下载，不修改商店导流决策。
- 包内 version=1.12.17、edition 与目标一致；本地 appId 独立，API 原身份不变。
- 正式 EXE 冷启动、隐私门禁、主窗口恢复与正确设置项可用；包内业务和客户端/PDF/隐私资源与 staging 一致，package 保护字段一致。
- 负向：旧版本不能冒称当前包；本地未配置下载 URL 必须能构建，且不能出现假下载链接；MAS 仍无导流；包字段/资源不匹配必须失败。检查文件摘要及当前源码，不以旧日志替代。
- 保留历史安装包，不生成自签名冒充可信签名；Windows 包验证不等于 Mac 签名/沙箱/审核。

## 状态

## 独立 closure 与对抗性复审

重新读取用户“为什么不更新 EXE”及前序拆版要求：本轮必须交付两份当前 Windows 安装包，而不是只更新源码、只验证开发服务器、只给 staging 或等待用户批准公开发布。公开下载/商店重新提交与本地安装包生成是不同事项。

- 版本：先失败回归观察旧 package 仍1.12.16，再升为1.12.17；安装器 Windows FileVersion/ProductVersion 两项均实际为1.12.17。
- 本地包：无 API 下载 URL 时实际打包成功；本地客户端显示待发布状态且无虚假 href，MAS 配置没有该导流。模型、搜索、Skill 权限未放开。
- 两份文件：正式 builder 分别生成 API/local EXE；根目录给清晰中文版别/版本文件名，SHA-256 与各自原安装器相同，保留旧文件。
- 真实链路：当前源码 → 三种分发配置 → builder 安装器 → 从实际 NSIS EXE 提取的 app.asar/主程序 → 与 win-unpacked 对照 → win-unpacked 主程序实际冷启动 → 本地登录、隐私同意、2或9个provider、主窗口菜单恢复。不能仅凭 MZ 文件头或文件名验收。
- 每份包223个业务/客户端/PDF资源/隐私文件逐字节与 staging 相同；元数据身份/版本/依赖/策略保护字段相同。
- 未使用真实用户目录、不代安装、不公开上传；生成的是未签名候选。Windows 回归不证明 Mac/App Store 或真实模型语义正确性。

## 本轮新鲜证据

- `node scripts/test-installer-delivery.mjs` 先失败，修复后 exit0。
- `pnpm skills:test` 完整通过，Skill 验证 run ID `3591caf1-b169-48d5-90a8-eac5cff6d275`。
- `pnpm editions:test` 在最后的源码/验证脚本修改后重新执行，随后顺序 `desktop:dist:api:win`、`desktop:dist:local:win`，均 exit0。
- `pnpm stream-rag:test`、`pnpm privacy:test`、`node scripts/test-store-metadata.mjs`、`pnpm typecheck`、`git diff --check` 均exit0。
- `node scripts/verify-edition-installers.mjs` exit0，run ID `2755ce89-2119-4ed6-bd49-b9c365b77b59`；报告 `release/latest-installers.json` 的当前源码摘要重新核对无过期项，两份安装包当前摘要与报告一致。
- 使用构建工具现有7za直接读取实际 NSIS安装器，不执行安装。提取的主程序/app.asar与已启动验收的win-unpacked逐字节一致；证据 `release/installer-payload-verification.json`。没有把包外测试归因到未知安装器内容。

交付文件：

- `release/AI Tip Local Setup 1.12.17.exe`：204196124 bytes，SHA-256 `7592e8f5d2109f4e2da9a8bde469bd4d0b466aebacc8463daf399d2d8a7fb7fa`。
- `release/AI Tip API Setup 1.12.17.exe`：204196615 bytes，SHA-256 `5f6ec6fa027f488cdf4eed291289e6a6fbd6d48a8e67666a3c82966a46809463`。

当前两版 Windows EXE 交付为 VERIFIED_LOCAL；签名均 NotSigned。公开 API 下载、GitHub发布、Mac构建/签名/审核仍未执行，不在本轮本地 EXE 更新验收内。证据类别 COMPONENT_CAPABILITY，真实模型与Mac为NOT_CAUSALLY_VERIFIED。
