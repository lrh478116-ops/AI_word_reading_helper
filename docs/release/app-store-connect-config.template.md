# App Store Connect 配置（Mac · 中英文文案）

> 更新：2026-09-16。面向论文、课程与技术/政策资料阅读者，以“原文提问—逐层追问—回溯理解路径”为定位。商品页字段来自 [metadata.json](../../store-assets/metadata.json)；可粘贴的纯文本在 [store-assets/text](../../store-assets/text)。本文件不是已上架声明，方括号须由运营者真实填写。

## 1. App Information / 应用信息

| 字段 | 值 / 要求 |
| --- | --- |
| Platform | macOS |
| Primary Category | Productivity / 效率 |
| Secondary Category | Education / 教育（可选） |
| Bundle ID | com.aitip.reader（须与 Apple Developer 中正式 App ID 一致） |
| SKU | [运营者内部唯一编号] |
| Primary Language | [按实际首发本地化选择；提供简体中文与英文] |
| Privacy Policy URL | https://lrh478116-ops.github.io/ai-tip-support-site/privacy/ |
| Support URL | https://lrh478116-ops.github.io/ai-tip-support-site/ |
| Marketing URL | https://lrh478116-ops.github.io/ai-tip-support-site/（可选） |
| User Privacy Choices / 账户删除 | https://lrh478116-ops.github.io/ai-tip-support-site/account-deletion/ |
| Contact email | 2280810215@qq.com |
| Copyright | [年份 + 真实权利人姓名或法人名称] |
| Age Rating | [按 AI 与用户内容实际能力完成当前问卷] |
| Price / Availability | [由运营者确认，不能从开源许可证推定商店价格] |
| EU Trader Status | [真实主体及分发地区验证] |

## 2. Localizable Information / 本地化字段

### 简体中文 / zh-Hans

Name（13/30）

AI Tip · 原文深读

Subtitle（16/30）

读论文、解难点，让追问留在原文旁

Promotional Text（89/170；仅在后台提供该字段时使用）

把读不懂的一句话，变成有上下文的讨论。从原文创建 Tip，从回答继续追问，用 Tip Tree 找回思路。支持 PDF 原版式阅读、本地 OCR 和自选模型，文档默认保存在本机。

Description（1156/4000；粘贴以下正文，不复制 Markdown 标题）

读到一个陌生概念，不必把原文和问题反复搬进聊天窗口。

AI Tip 为论文、教材、技术规范和政策资料提供一处可以边读边问的空间。选中原文创建 Tip，让解释留在产生疑问的位置；从回答中继续提问，让一个难点逐步展开，同时保留返回原文的路径。

让问题有出处
一句话、一个术语或一段论证，都可以成为 Tip 的起点。对话与选中的位置关联，重新打开文档时仍可定位。通俗解释、详细解释、专业解释和举个例子，帮助你按需要切换理解方式。

沿着回答继续探索
回答中的概念也能创建子 Tip。进入下一层时，父对话成为左侧上下文，新的问题在右侧展开；收回后恢复上一层。每个 Tip 独立保存聊天，可通过记忆开关决定是否参考其他 Tip 的摘要。

把思考整理成 Tip Tree
分支多了，也不必在聊天记录中来回翻找。树状图呈现对话之间的关系，点击节点回到对应问题，并为节点改成便于回顾的名称。从“这句话是什么意思”到“这个结论有什么前提”，理解过程可以逐层找回。

阅读复杂 PDF，不拆散原始页面
保留 PDF 的分页、图表和原始版式，在文字层选取内容并标记 Tip。扫描页可使用本地中英文 OCR 识别后提问。需要带走阅读成果时，可导出带 Tip 批注的 PDF 副本，原文件不被覆盖。OCR 可能存在识别误差，请结合原页核对。

长文档也有针对性的上下文
面对较大的文档，应用会在本机检索与问题相关的文本片段，连同选中的原文交给模型。不是每次都发送整篇文档，也不代表模型已经阅读或记住全部页面；扫描内容需要先识别出文字。

文档由你保管，模型由你选择
支持 PDF、DOCX、Markdown 和文本文件。导入、编辑、Tip 与聊天默认保存在当前设备，登录云账户不会自动上传文档。只有主动点击上传，才创建云端副本；当前每个用户云端限额为 5 MB。

可接入自己的兼容大模型 API，也可在应用内下载或导入兼容 GGUF 本地模型。内置推理运行环境，本地模型路线无需另装独立 AI 服务。模型文件需另行下载并占用磁盘、内存；是否适合运行取决于 Mac 配置与所选模型。

联网与核验，按需开启
联网搜索默认关闭，可在设置或对话输入框旁切换。启用后可查找外部资料；数值问题还可调用本地计算工具。AI 回答、检索结果与计算过程仍需结合原文和具体条件判断，不保证事实始终准确或资料始终最新。

使用前请了解
没有配置模型时仍可导入和阅读文档；生成 AI 回答需要可用的在线接口或已下载并加载的本地模型。使用在线 API 时，问题及相关文档上下文会发送给你选择的服务商，其费用和条款由该服务商决定。本地推理不等于开启联网搜索后仍完全离线。

支持简体中文与英文界面。

让每一次追问，都能回到原文；让读懂的过程，值得再次回顾。

Keywords（85/100 UTF-8 bytes）

PDF,论文阅读,文献笔记,扫描识别,知识管理,技术文档,本地模型,OCR

### English / en-US

Name（22/30）

AI Tip: Read & Explore

Subtitle（30/30）

Follow questions, keep context

Promotional Text（146/170；仅在后台提供该字段时使用）

Ask beside a passage, explore a reply, and find your way back with Tip Tree. Read original-layout PDFs with local OCR and your choice of AI model.

Description（3124/4000；粘贴以下正文，不复制 Markdown 标题）

A difficult passage deserves more than a disconnected chat.

AI Tip is a reading workspace for research papers, textbooks, technical specifications and policy documents. Start a Tip from a passage, explore an unfamiliar idea inside a reply, and keep the route back to your source.

ASK WHERE THE QUESTION BEGINS
Select a sentence, term or argument to open a conversation linked to that location. Return to it as you read. Choose a plain-language explanation, a detailed explanation, a technical explanation or an example.

EXPLORE A REPLY WITHOUT LOSING YOUR PLACE
Create a child Tip from text in a conversation. The parent conversation moves into the context pane while the new question opens beside it. Close the child to return to the previous view. Each Tip keeps its own chat; memory controls let it refer to summaries from other Tips.

SEE HOW YOUR QUESTIONS CONNECT
Tip Tree maps the branches of your discussion. Select a node to revisit a conversation and rename it for easier review. Keep track of the assumptions, definitions and follow-up questions behind an idea.

KEEP THE ORIGINAL PDF IN VIEW
Read original PDF pages with their page layout and figures intact. Select native text to create an anchored Tip, or run local Chinese and English OCR on scanned pages. Export PDF Tips to an annotated copy without overwriting the original. OCR can make mistakes; check recognized text against the page.

FIND RELEVANT CONTEXT IN LONG DOCUMENTS
For large documents, on-device text retrieval finds passages related to your question and supplies them alongside your selection. It does not mean the model has read or remembered every page. Scanned content needs recognized text before it can be searched.

YOUR DOCUMENTS, YOUR MODEL
Import PDF, DOCX, Markdown and text files. Documents, edits, Tips and conversations are saved locally by default. Signing in does not upload them automatically. Cloud copies are created only when you choose to upload, with a current 5 MB quota per user.

Connect your own compatible AI API, or download or import a compatible GGUF model in the app. The built-in inference runtime supports the local-model route without a separate AI server. Model weights require a separate download, disk space and sufficient memory; suitability depends on your Mac and the model.

LOOK BEYOND THE PAGE WHEN YOU CHOOSE
Web search is off by default. Switch it on in Settings or beside the message input when you want external sources. Local calculation tools can assist with numerical questions. AI answers, sources and calculations still need review against the document and their assumptions; accuracy and freshness are not guaranteed.

BEFORE YOU START
Importing and reading documents do not require a model API. AI replies require a working online provider or a downloaded, loaded local model. Online providers receive your questions and relevant document context and may charge under their own terms. Local inference is not fully offline if you enable web search.

Available in Simplified Chinese and English.

Keep your questions connected to the text, and your path to understanding easy to revisit.

Keywords（85/100 UTF-8 bytes）

PDF,OCR,papers,research,annotation,notes,local models,document reader,study,knowledge

## 3. Screenshots / 图片与展示顺序

[中英文图册与来源说明](../../store-assets/README.md)。新稿每种语言 4 张，2880×1800，以实际 UI 为主要画面；当前为 Windows 客户端实拍与文字排版，不是 Mac 提交截图。每张图均标注“待 Mac 实机复拍”，不能直接上传 App Store Connect。

| 顺序 | 主题 | 必须真实出现的状态 |
| --- | --- | --- |
| 1 | 原文旁的提问 | 文档原文、选区与对应 Tip 回答（本轮展示可编辑文档路径；PDF 需完成锚点问题复核后另拍） |
| 2 | 回答中的子 Tip | 父聊天作为上下文，子聊天在旁边展开 |
| 3 | Tip Tree | 多层有意义的节点名称、实际可定位的树 |
| 4 | 本地模型选择 | 实际模型选择界面；不承诺权重预装、所有 Mac 都能流畅运行或在线调用不传数据 |

扫描 OCR、文档导入、本地存储、计算辅助写入描述和审核步骤，不用一张图堆满所有功能。正式 Mac 复拍必须使用同语言签名候选包、实际模型生成的示例回答、无私人文件/Key，去除草稿标识后重新记录来源和哈希。

## 4. App Review Information / 审核信息（非公开）

Contact Name / Phone：填写真实联系人与可接听国际号码（+国家码）。Email：2280810215@qq.com。审核账号、密码和可用模型凭据只填 App Store Connect 私密审核区域，不写进 Git。

Notes for Review：

1. 候选版本若包含首次隐私确认，启动时阅读并主动同意；不同意会退出。确认实际上传构建包含该功能再提交此说明。
2. 点击“仅本地使用”即可无云账户导入和阅读文档。导入与创建 Tip 不代表已配置推理；AI 回答需要工作中的模型 API 或已下载、已加载的本地模型。
3. 导入有文字层的 PDF，选中原文创建 Tip，提问；从回复中选择术语创建子 Tip。展开左上 Tip Tree，重命名节点、点击定位，再收回返回上一层。
4. 扫描 PDF 点击“识别本页文字”，核对 OCR 后创建 Tip；导出 Tip 批注生成 PDF 副本，不覆盖原文件。
5. 本地模型路线：设置中下载/导入兼容 GGUF，完成加载再测试回答。Mac 沙箱、模型目录书签、helper 签名与两种架构必须实测。
6. 提供可用的审核推理路径：在私密说明提供短期受限测试配置或已验证本地下载步骤。不要让审核员使用未经验证的模型或无法访问的源；不得让开发者私钥进入公开安装包。
7. 联网默认关闭，设置和输入框开关同步；开启后才访问资料来源。在线模型调用与搜索是不同配置，在线模型仍接收上下文。
8. 云账户凭据在私密 Sign-in required 区域填写；登录不会自动上传。每个文档需主动上传，当前配额 5 MB。“删除云端文件”不删除本地内容。
9. 删除云账户：设置 → 账户与隐私 → 删除账户；本地模式对应清除本地数据。真实邮件、云删除验证成功后再提交审核。

## 5. Version / Release / 更新说明

首次上架不填写 What's New（Apple 不为首个版本提供该字段）。后续版本仅写相对于上一商店版本的真实变化，不把 Windows 构建号当作已发布的 Mac 版本。Version、Build、Release Type、Phased Release、定价和地区均按实际候选包及运营选择填写。

## 版本提交前必填

- [ ] 正式运营主体名称、地址和支持责任人已确认。
- [ ] App Review 联系人、真实邮箱和可接听电话已填写；电话号码使用 `+国家码` 国际格式。
- [ ] 正式 HTTPS 域名可从公网访问，隐私页和删除页返回 200。
- [ ] Bundle ID、签名证书、App Sandbox 与 entitlements 和开发者账户匹配。
- [ ] App Privacy 问卷与 `privacy-labels.md` 及实际流量复核一致。
- [ ] 2026 年版年龄分级问卷已按应用可访问的 AI/用户生成内容真实作答，没有照抄旧评级。
- [ ] 出口合规问卷已根据 TLS、系统安全存储和实际加密用途完成；未经过运营者/法律确认前，不硬编码 `ITSAppUsesNonExemptEncryption` 结论。
- [ ] Content Rights、版权字段、价格/地区与欧盟 DSA 交易者状态已由真实权利人确认。
- [ ] 私密云测试账号已创建，并完成真实注册邮件、恢复邮件和删除验证。
- [ ] 截图来自候选构建，未包含真实邮箱、API Key、未公开文档或测试密码。
- [ ] 至少一次在签名后的 universal macOS 候选包上完成 Intel/Apple Silicon、文件选择、PDF/OCR、Tip、本地模型和删除账户实测；当前 Windows 截图不能替代该证据。
- [ ] 中国大陆分发所需备案/许可由真实主体完成；未完成时不勾选不具备资质的地区或能力。
- [ ] 商店版本号、构建号、发行说明和支持时段已填写。

## 明确不可填写的伪信息

- 不得编造 ICP/APP 备案号、公司名称或地址。
- 不得把 mock 验证码测试写成真实邮件已验收。
- 不得公开 App Store 审核账号密码。
- 不得把 Windows 生成的包描述为已完成 macOS 签名、公证或 Mac App Store 上传。

## 字段与素材验收依据

核查日期 2026-09-16：[应用信息](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information)、[版本字段](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information)、[Mac 图片规格](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications)、[准确元数据 2.3](https://developer.apple.com/app-store/review/guidelines/)。

运行 `node scripts/test-store-metadata.mjs` 和 `node scripts/test-store-assets.mjs` 检查字段与草稿。正式发布额外运行 `node scripts/test-store-assets.mjs --submission`；当前草稿应明确失败，不能把尺寸合规当成上架通过。
