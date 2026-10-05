# 用户 Skill 管理

## 只读审计与 scope

已读取 README、现有技能/长文档说明、App 设置与导航、认证与本地 JSON 存储、chat 正式入口、流式/取消测试配置。仓库没有 AGENTS.md；采用用户当前工程指令。Git pull --ff-only --autostash 更新至 afafce0，隐私相关既有未提交修改已恢复。

确认断点：当前 SkillTrace 仅表示内置工具，没有可导入的 Skill 对象、账户隔离存储或模型输入消费。只增加文件列表不构成接入。

统一方案：本地包解析与校验 → 用户隔离存储 → 管理 UI → chat 请求开始时取得不可变快照 → 所有生成/恢复请求消费完整指令与文本参考 → 回答记录附 ID、内容摘要和版本。无需改云数据库，不自动上传 Skill。

## Requirements、设计不变量与 non-goals

- 主页面管理区有“Skills · 技能”入口；设置内有说明卡与入口。模态双栏列表/详情使当前文档保持挂载；关闭后阅读位置保持。
- 导入 SKILL.md、普通 .md、文件夹或单 Skill ZIP；预览后保存，默认关闭。支持新建、搜索、筛选、启停、编辑、导出和确认删除。
- 标准 SKILL.md 使用 YAML name/description 与正文；文本参考支持 md/txt/json/csv/yaml。拒绝缺失入口、多入口、错误 UTF-8、穿越/绝对路径、链接文件、二进制与脚本依赖、重复路径、超限、损坏 ZIP，失败不得部分保存。
- 指令为用户配置，权限不能覆盖联网开关、计算开关或既有工具绑定。禁止任意导入脚本运行。KNOWN_FRAMEWORK_GAP：外部代码执行型 Skill 不在本次受支持能力内，导入明确失败。
- 按用户隔离，本地持久化、删除账户时清理。重名导入明确冲突，不悄悄覆盖。变更使用内容摘要进行并发冲突检测。
- 每个启用 Skill 的完整正文/文本资料必须进入实际模型请求；预算不足明确失败而非截断。下一请求消费编辑/启停结果；正在生成的请求保留启动快照。记录“载入指令”不冒称工具执行。
- 不调用真实付费模型作为测试，不推送未授权发布、不重构内置搜索、PDF 或旧隐私改动。

## 验收与负向验证

- focused：解析标准/普通 MD、文件夹/ZIP保真；非法包、重复名称、资源缺失、旧摘要、跨账号、超限、关闭/删除反事实。
- 正式入口受控集成：import/enable → /tips/:id/chat → 实际 HTTP 模型输入 → 实际回答与持久化记录；编辑/禁用/删除改变输入和输出，恢复路径仍消费 Skill，重启保持，失效绑定明确失败。
- UI：主页面与设置入口、导入预览保存、启停编辑导出删除、语言切换、窄窗口、无横向溢出、全局文档拖放不会抢 Skill 包。
- Requirement closure 独立重读原始请求，逐项标明实施/证据；final review 后执行 package 定义的 build/typecheck、技能和相关回归。
- 受控模型测试属于 COMPONENT_CAPABILITY，虽然真实业务入口被运行，也不替代真实模型 FORMAL_PATH_INTEGRATION / INDEPENDENT_EVALUATION。真实模型语义遵循性为 NOT_CAUSALLY_VERIFIED。

## Requirement closure（独立重读原始请求）

原始请求包含：先 git pull；添加用户可导入的 Skill 管理；入口一目了然；美观；方便管理。没有要求本轮 push、发布安装包或任意外部程序执行。

追加用户要求：每一个 Skill 有独立开关，方便选择使用。管理页已有逐项开关；新增聊天输入旁的 Skills 选择器，逐项开关与管理页使用同一份持久状态。保存期间阻止发送，成功后用于下一条问题；当前生成版本保持不变。需要验证选择器开关真实 PATCH、重新打开/管理页同步、错误不伪显示成功、聊天仍保持挂载，以及入口不遮挡输入或造成溢出。

| Requirement | 实施与当前证据 | 负向/反事实 | 验证范围 |
| --- | --- | --- | --- |
| 同步远端与保护已有修改 | git pull --ff-only --autostash，HEAD afafce0；恢复原隐私改动，无冲突 | 先检查相交 package.json；恢复后 git status 核对 | 实际 Git 状态 |
| 用户能导入 Skill | parseSkillFiles / parseSkillUpload → authenticated /skills/preview → store.create；实际客户端 file input 预览后保存 | 预览不保存、格式/编码/缺资源/ZIP 损坏/重名/重复路径/CRC 失败均阻止 | COMPONENT_CAPABILITY，实际客户端与本地 API 已运行 |
| 容易找到 | 文档库侧边栏管理区、AI 设置卡、窄窗口右上拼图图标 | UI 从文档库及编辑器设置分别打开 | COMPONENT_CAPABILITY |
| 逐项开关便于选择（追加要求） | 聊天输入旁 Skills 选择器，每项独立开关，与管理页共用持久状态 | 实际 UI 开一项、另一项保持关；纸飞机发送后实际回答保存所选 ID；管理页关闭后下一次发送无该 Skill；保存中禁发，500 不伪开，成功响应后刷新失败仍消费真实保存回执；560/1280 viewport 与真实按钮锚定、Esc 返回焦点 | COMPONENT_CAPABILITY，受控提供方 |
| 美观且不破坏阅读 | olive 色系双栏，工具区/列表/详情/底部操作，编辑器保持挂载 | 3 个真实 viewport 尺寸无横向溢出；关闭管理页仍是同一 editor DOM；未保存内容不丢失 | COMPONENT_CAPABILITY，Windows 截图人工复核 |
| 方便管理 | 新建、导入预览、搜索/启用筛选、启停、编辑正文/参考、ZIP 导出/确认删除、版本冲突反馈 | 启停/编辑后的旧摘要拒绝；跨用户不可访问；导出中文名称/描述/正文往返一致 | COMPONENT_CAPABILITY |
| Skill 对真实业务输入有影响 | chat 起始读取当前用户快照 → full JSON 指令/资料 → baseMessages 与搜索失败恢复请求 → actual HTTP model request → 回答持久化 Skill ID/revision/signature | 关闭/删除移除模型指令，编辑变更受控最终输出；在途编辑保持旧快照，下一次读取新快照；损坏本地数据 409，禁止旧路径继续回答 | 受控入口回归为 COMPONENT_CAPABILITY；真实模型 FORMAL_PATH_INTEGRATION / INDEPENDENT_EVALUATION 未验收 |
| 本地优先与工具边界 | 独立 user-skills.json 按用户隔离；账户清理 purge；搜索/Python 权限保留既有绑定 | provider 返回关闭的 web_search → error/no done/no network/no completed assistant；脚本包明确 unsupported | COMPONENT_CAPABILITY |

## Final review 已确认并修复的问题

- ZIP 库会合并重复 central-directory 文件名：先增加失败测试，再做原始目录检查；实际解压仍逐块限制大小，检查 CRC，拒绝链接和越界。
- 普通 Markdown 导出标准包可能丢失自定义中文名称/描述：增加往返失败测试，再使用规范允许的 vendor metadata 保留。
- 状态切换也需要乐观版本锁：摘要绑定内容、启用状态和 revision，旧开关操作不能覆盖新状态。
- Node 直接运行现有 TS 测试与 Bundler 的引用规则不同：完整回归暴露 .js 引用不存在；统一新字典使用 .ts 引用，noEmit 的 app 配置允许 TS 扩展，与已有 node 配置一致。focused product-behavior 与 typecheck 复验通过。
- UI 验收不能只看 aria 状态或窗体 setSize 调用：新增实际开关颜色/滑块位置与 viewport 等待断言；offscreen Electron 避免隐藏窗口冻结绘制；记录实际 DIP 四舍五入后的 viewport，不以调用参数冒称尺寸变化。
- 操作按钮在长指令下不能丢到折叠下方：详情正文独立滚动，保存/导出/删除固定可见。
- 报告不能把受控提供方当真实模型：verification 绑定源码、测试、配置及当前完整构建摘要、运行 ID、实际输出/退出码，并明确 evidence=COMPONENT_CAPABILITY。
- 完整回归暴露旧云文件客户端测试的假通过：finally 中 app.quit 会在失败 catch 之前退出 0；加入受控失败，修复前实际 exit=0，修复后 exit=1 且原错误可见。测试按实际 UI 点击隐私同意后再验证云删除，正常路径 exit=0、确实发生两次删除且保存先于删除。失败退出控制进入新验证器，避免仅依赖旧整套命令的退出码。
- 追加选择器审计：按钮 ref 未绑定时定义/点击存在但选项不出现，实际客户端失败测试捕获并修复；缩放后的旧位置不能被“在 viewport 内”测试误接受，新增实际按钮锚定断言并在下一帧/按钮尺寸变化后重定位。
- 成功 PATCH 后的后续列表请求可能失败：原实现忽略保存回执，导致后台已开启而 UI 仍显示关闭。受控 500 测试在旧构建上确实失败；现在先消费本次真实保存回执，再同步列表。
- 加载指令不是执行脚本：折叠区统一称“处理与技能记录”，避免把仅载入上下文的记录当作工具执行次数。
- 最终导入复审发现正文 trim 会破坏 Markdown 首行缩进和末尾换行；正则链接检查还会把代码示例误作真实资源依赖。先确认失败，再保留正文并使用现有 marked 语法树检查实际链接，导出不额外增删正文换行；新增实际 /skills/preview 保真回归。

## 验收状态与边界

独立 requirement closure 与对抗性复审后，当前实现的 Windows 本地受控验证状态为 VERIFIED_LOCAL。以下最终命令均在正文保真、Markdown AST 资源检查与选择器同步修复后的源码/构建上运行：

- `pnpm skills:test`：exit 0，包含当前源码重新构建、现有技能/文档/模型/云文件/发布回归和新增 Skill 验证。
- `pnpm stream-rag:test`：exit 0，包含流式取消、长文档检索与账户隔离反事实。
- `pnpm privacy:test`：exit 0，既有隐私同意流程未被绕过。
- `git diff --check`：exit 0。

最新 Skill 验证运行 ID 为 `1de2a4c5-debc-4261-9edc-55b0ce598b19`；报告 `docs/changes/verification/user-skills-latest.json` 的 focusedChecksPassed 与 sourceUnchangedDuringVerification 均为 true，复核当前文件摘要与报告一致，无过期条目。三个正常测试实际 exit 0；云文件 UI 受控失败实际 exit 1 且对应错误文本可见，不把预期失败冒充正常成功。验证报告保留实际模型请求 lineage、测试输出和源码/构建摘要。

以上证据分类仍为 COMPONENT_CAPABILITY；真实模型语义遵循、独立研究任务评估、macOS 真机/签名为 NOT_CAUSALLY_VERIFIED，其正式验收保持 NOT CLOSED。执行外部脚本型 Skill：KNOWN_FRAMEWORK_GAP（本轮明确不支持，导入会失败）。本次没有提交/push 或重建发布安装包；最终报告只确认当前本地验证范围，不授权商店发布或语义正确性保证。
