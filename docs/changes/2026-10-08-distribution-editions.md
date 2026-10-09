# 本地模型版与 API 版拆分

## 只读审计与当前 scope

用户要求：本地模型版仅支持本地推理与基础参考搜索，保留用户 Skill 导入和逐项选择；主页邮箱上方放 API 版下载链接。API 版保留当前功能。不称为“完整版”。后续提供 Apple 2026-10-08 审核意见，涉及付费 API、network.server、审核可用性和主窗口恢复。

当前仓库 HEAD f5ae4da，工作区初始干净，没有仓库 AGENTS.md，遵循用户工程规则。已阅读设置、聊天真实入口、模型运行时、搜索路径、Skill 入口、Electron 启动/菜单、Vite、package scripts、权限和发布说明。GitHub 当前没有公开 Release，不能声称下载链接已可用。

确认问题及统一方案：

1. 仅隐藏 UI 不足：normalizeSettings、旧存储、模型测试/列表和 chat 均能调用云接口。使用构建期不可变 edition，在所有真实模型请求前校验；旧云配置不授予权限，旧密钥不解密/消费。
2. Tavily 可由已有 searchApiKey 触发；本地版读取/保存必须移除密钥，搜索与额度接口另设硬门控，不允许环境变量切回 API 版。
3. 发布产物目前只有单套 dist/release。构建为各自独立输出与产物标识，前端、服务端和桌面主进程读取同一构建策略；MAS 只能构建本地模型版。
4. Apple 内置回环服务实际需要 network.server；直接删权限会破坏当前架构。保留最小用途并写审核解释，不宣称已通过 Apple。
5. 窗口菜单没有“显示主窗口”；补充明确恢复入口，避免重复窗口，并在 macOS 关闭时保留页面/自动保存状态。
6. 商店内 API 版下载导流有再次拒审风险，已向用户请求确定分发策略；默认审慎方案为 MAS 不展示，站外本地版展示。具体公开下载地址/是否发布也等待用户选择。

## 不变量、non-goals 与验收条件

- API 版默认行为、供应商、Tavily、Prompt、Skill、文档/账户和云空间规则不变；不改付费方案，不加入 IAP，不修改 Supabase 服务。
- 本地版只允许内置 llama.cpp 和本机 Ollama；拒绝远端 URL、userinfo、非回环和跳转到外网。所有真实模型 HTTP 请求保留回环校验。
- 本地版无云模型/搜索 key 输入，不能通过 REST、旧文件、环境变量、伪装本地 provider 绕过；基础搜索开关关闭后所有搜索仍无请求。
- Skill 导入/编辑/启停/实际进入本地模型上下文不变；文档导入和 Tip 不依赖模型预配置。
- 两版构建可独立运行、安装不互相覆盖；API 版保留已有应用身份/用户目录，本地版使用独立站外身份；MAS 保留已提交 bundle ID。
- 下载链接位置与命名有真实客户端证据；未发布安装包不能判为可下载。
- 单元/受控 HTTP/Electron 测试属于 COMPONENT_CAPABILITY，不替代真实模型、macOS 沙箱、签名或审核。相关正式验收为 NOT_CAUSALLY_VERIFIED。

## 验证计划

先写失败回归：构建策略存在且拒绝 API+MAS；本地版本正式 API 默认本地配置、禁云 PUT/test/models、旧云 key 和环境 key 不绕过、不能伪装远端本地模型、基础搜索有/无结果仍输出、关闭零请求、Skill 开关影响实际模型输入/回答。API 对照仍接受云接口与 Tavily。

客户端实际窗口：本地版只列本地 provider、无 key 字段、Skill 管理/选择可用，链接在邮箱前；API 版仍有原 9 provider 和 key 输入、无新增导流。Window 菜单真实 callback 恢复隐藏窗口；macOS 实机不能在 Windows 冒称验收。

focused/负向通过后独立重枚举 requirement closure，做对抗性复审，再运行 package 定义的完整相关 gates。公开分发 URL、MAS 真机/签名未确认时任务保持 NOT CLOSED。

## Requirement closure（重新读取本轮全部用户请求）

用户明确确认 MAS 不显示 API 版下载链接，Windows/站外本地版保留。尚未确认是否公开发布 GitHub 安装包或其他真实下载位置。本轮没有获授权操作 App Store Connect、发送审核回复或给审核员真实私有 API Key。

| Requirement | 实现、测试与证据 | 当前验收 |
| --- | --- | --- |
| 两版名称，无“完整版” | local/api 编译策略、双语 edition 字典与实际客户端截图 | Windows 受控已验证 |
| 本地版只支持本机模型 | 设置/test/models/chat 真实消费构建策略；每个模型 HTTP 请求校验回环地址并拒绝跳转 | 受控 provider、恶意 REST、环境 key、假 runtime origin、307 均覆盖 |
| 基础搜索且无 Tavily | 本地版清除搜索密钥、额度/search 独立硬门控，原参考检索不变 | 实际搜索内容进入模型与输出；失败仍答、关闭零请求；Tavily 0 请求 |
| 旧配置不能绕过/静默替代 | 旧配置不解密；标記限制，显示原因，chat 409 在用户历史写入前阻止；保存本机配置后解除 | 新负向先观察旧实现实际返回 200，再修复为 EDITION_SETTINGS_RESTRICTED |
| Skill 导入和逐项开关 | 原管理器与选择器不变，实际文件 input 导入、管理/聊天开关 PATCH、模型上下文和回答包含所选指令 | 两版实际客户端与本地服务受控测试 |
| 文档/Tip 等原能力 | 不删文档格式/存储/Tip 代码；无模型仍导入并打开 Tip | 分版 UI 导入打开测试；完整现有回归必须复验 |
| API 版原能力不削减 | 默认构建保留9 provider、密钥、Tavily、Skill；仅共享窗口恢复缺陷修复 | API 对照真实模型/搜索请求 + 原回归 |
| 下载入口邮箱上方、MAS 不出现 | 站外策略链接，DOM 顺序与 actual href 验证；MAS 编译策略强制无链接 | 界面 VERIFIED_LOCAL；公开 API 安装包 NOT CLOSED |
| 独立构建/身份 | 三种分发配置独立目录、policy 与 server 一致性启动门控；本地站外独立 appId/userData、API 与 MAS 保留原 ID | 原生主进程真实启动/隐私同意/设置2或9项验证；实际安装包/签名未验证 |
| Window 菜单恢复 | 正式 installMenu 消费 showMainWindow；实际主进程菜单 callback 恢复原 window ID；mac close hide，Quit 标记 | Windows 真入口已验证；macOS 关窗/Dock/Cmd+Q NOT_CAUSALLY_VERIFIED |
| network.server 审核解释 | 指向真实 bootServer→startServer(0,127.0.0.1) 和 llama helper；不删必要权限 | 架构证据，Apple 接受与 Mac entitlement/lsof 未验证 |

## 对抗性复审与发现

- 不能只禁云 provider 字段：伪装 ollama/local 的远端地址、userinfo、环境 key 和307跳转都需要阻止；实际请求发送前复核，搜索/模型 status 查询也禁跳转。
- 旧云配置的“换成本地默认值”虽然不再泄漏 key，却可能静默换模型。反事实测试增加已安装默认模型后，修复前 chat 实际200；修复后必须明确409且模型调用数不变。当前设置页明确提醒重新保存本机模型。
- 进一步反事实发现只改搜索开关也会清除旧配置限制；失败回归确认原实现返回200。现在只有用户明确“保存本机配置”或实际通过导入/下载连接并验证模型，才解除限制；无关设置变更400，不把新旧模型 Binding 混用。
- 不能移错搜索质量提示：搜索失败的“不核验来源”与人工百科链接保留，本地版只替换 Tavily 升级文案。
- staged Electron main 与 server policy 绑定，验证器逐字节检查 staging 的 electron 文件与本轮源码相同，不能仅 hash 仓库文件冒称打包源一致。
- 实际前端切换读取异步列表时不能只等管理器根 DOM 存在。完整回归曾在“Loading local Skills…”期间立即点击不存在卡片失败，测试已修复为等待真实卡片；不跳过断言、不以旧数据代替新列表。
- 图像须等待界面动画完成；本地英文设置不得仍显示“API provider”，已改为“Model runtime”。
- 构建脚本强制 API+MAS 和分发/target 不匹配失败；Mac package 必须 Mac 主机，不伪造签名或 binary。站外本地正式打包必须显式给真实下载 URL，不将开发 Releases 页冒称可用安装包。
- 实际 Windows API 打包暴露 config 重复合并：staged package 已有 build，程序再传同一份 config 会让 electron-builder 拼接 extraResources（真实 getConfig：8项而非4项），重复复制/签名导致 DLL EBUSY。已移除重复 overlay 并加入防回归检查；实际包必须重建验证，不以构建配置存在代替安装包成功。
- 当前所有独立提供方和 Electron 专项证据仍是 COMPONENT_CAPABILITY。真实模型、macOS、公开下载与商店发布不能跨级声称通过。
- 商店原始 metadata 仍宣传云 API，与新 MAS 二进制不一致；先新增失败门槛，再同步 metadata.json、双语纯文本与配置模板为本地模型/基础搜索，移除在线模型付费承诺。保留站外 API 版功能，商店文案不当作全产品能力清单。

## 最终验证与状态

当前 Windows 本地受控范围为 VERIFIED_LOCAL；正式公开下载与商店发布仍 NOT CLOSED。

- `pnpm skills:test` exit 0：原有功能完整回归与新 Skill UI 回归。此前测试在列表加载中点击空卡片的错误已修复；没有跳过断言。最终 Skill 报告 run ID `73b54da4-ce2a-4884-b918-bbd824904106`。
- `pnpm stream-rag:test`、`pnpm privacy:test` exit 0：流式、取消、长文档与原隐私门禁保留。
- `pnpm editions:test` 在最后的构建/商店回归测试修改之后 exit 0：run ID `89565406-7301-44ae-a3e9-6471a7f197d8`，13 个步骤，包含三份当前构建、local/API 真实请求对照、三种实际客户端、三种正式桌面启动、实际 Window 菜单。源码执行期间未变，结束后源码/构建摘要再次核对均无过期条目。
- `node scripts/test-store-metadata.mjs` exit 0：商店仅本地、字符/UTF-8上限、纯文本导出一致；中文描述1188字符、英文3216字符。
- `pnpm typecheck` 与 `git diff --check` exit 0。
- `pnpm desktop:dist:api:win` 在移除重复 config 后 exit 0：生成 `release/api-direct/AI-Tip-API-Setup.exe`，204196151 bytes，SHA-256 `730aeb81a5684801afb556ec21befdb7f70e6fbd544304eb7282fb400a3fcaa7`。这是本地候选包，未发布，Authenticode 为 NotSigned。
- 候选 app.asar 与当前 staging 的 223 个业务/客户端/PDF资源/隐私文件逐字节一致；package.json 的身份、版本、入口、依赖、productName、aiTipBuildPolicy 分别一致（electron-builder 正常剔除 scripts/build/devDependencies，不以全 package 字节不同冒称损坏）。Windows 的 asar 内路径须使用本机 path.normalize；错误的斜杠查询不能当作文件丢失证据。
- 打包后的真实 `AI Tip.exe --startup-test` exit 0，实际点击隐私同意、进入本地模式、校验9个原provider、恢复同一个主窗口。日志与包对照在 `release/api-direct`，测试账户/模型不代表独立真实模型评估。

仍未关闭：用户尚未选择 API 包的公开发布位置；开发预览链接仅为 Releases 页面，不是已可下载安装包。站外本地模型版正式安装包需真实 URL 后生成。Mac 签名、沙箱、实际模型推理、版本/Build Number、App Store Connect 上传及 Apple 审核未执行，均不得冒称通过。本轮代码尚未提交/push，未公开发布 Release、未代发审核回复。
