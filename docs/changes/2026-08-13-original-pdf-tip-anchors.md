# PDF 原始版式 Tip 锚点

## 审计结论

当前 PDF.js 原始版式已经渲染 Canvas 和 TextLayer，但 `PdfPageCanvas` 不读取 TextLayer 选区，也不接收 Tip 数据。`SelectionInfo` 只能表达文档块，`TipThread.anchorType` 只有 `document|message`，正式创建路由只验证 `blockId + 字符偏移`，`recoverAnchors`、聊天入口和 `contextFor` 均不知道 PDF 页锚点。已有 PDF Tip 只能来自结构化块，不能在原始页面显示或创建。

因此现状最多证明 PDF TextLayer 具备 `COMPONENT_CAPABILITY`；原版式 TextLayer 到最终 Tip 的 `FORMAL_PATH_INTEGRATION` 未建立，标记 `NOT_CAUSALLY_VERIFIED`。

## 已确认问题

| 问题 | 严重程度 | 代码位置 | 当前实际行为 | 潜在影响 | 错误验收风险 | 统一修复方向 | 阻止发布 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TextLayer 选区未进入 Tip 主链 | 高 | `src/PdfPreview.tsx` | 原始页只渲染，不监听选择 | 无法在原版式创建 Tip | 把“可选择文字”误称为“可插 Tip” | 建立 PDF 专用 Selection 与正式创建分支 | 是 |
| Tip 模型无 PDF 锚点 | 高 | `src/types.ts`、数据库迁移 | 只有 document/message | 页码、坐标、指纹全部丢失 | 用结构块 ID 伪装原版式定位 | 新增 `anchorType=pdf` 和版本化 `PdfTipAnchor` | 是 |
| 服务端无权威页文本 | 高 | `server/pdf-structure.ts` | 只持久化重排后的结构块 | 无法验证 TextLayer 偏移 | 只信客户端 selectedText | 上传时保存规范页文本、text-item 偏移和 PDF SHA-256 | 是 |
| 无覆盖标签 | 高 | `PdfPageCanvas` | 原版式页面没有 Tip 层 | 已创建 Tip 无法视觉定位 | 侧栏存在 Tip 被误称为页面插入 | 根据 PDF 坐标在页面叠加高亮和小标签 | 是 |
| 坐标会受缩放/旋转影响 | 高 | 无坐标模型 | 无法恢复 | DPI/Retina/旋转后漂移 | 保存 CSS 像素的测试在单分辨率误过 | 保存未旋转 PDF 页坐标系中的 0..1 矩形，由 viewport 双向转换 | 是 |
| 恢复路径会把 PDF 当文档块 | 高 | `recoverAnchors` | 非 message 一律查 blockId | 新锚点启动后变孤儿或被错误恢复 | 字段存在但正式 GET 改坏 | PDF 指纹、页文本、偏移、矩形逐项验证 | 是 |
| 聊天入口不验证 PDF 锚点 | 高 | `/api/tips/:id/chat` | 只额外验证 message | 损坏 PDF 锚点仍可回答 | 旧聊天路径绕过新验证 | 回答前重新验证 PDF 权威来源，失败返回 409 | 是 |
| 聊天上下文不知道页位置 | 中 | `contextFor` | 只读取文档块邻域 | 双栏/表格上下文可能错误 | 仅 selectedText 进入 Prompt 被误称为页上下文 | 使用同页规范文本前后文和页码 | 是 |
| 无导出副本 | 中 | 无路由 | Tip 只在应用数据库 | 无法生成外部可见批注 | 直接覆盖原文件风险 | 只生成带 Highlight/Text Annotation 的下载副本 | 否 |
| 扫描 PDF 无本地 OCR 层 | 高 | 无 OCR 运行时 | 图片页只能看 | 不能创建文字 Tip | 伪造 OCR 文本或调用 CDN | 独立离线 OCR 来源、置信度和持久化结果；失败不得降级为原生文本 | 是（仅对 OCR 声明） |

## 设计不变量

- 原 PDF 永远只读；页面 Tip 是应用覆盖层，删除 Tip 不修改原文件。
- PDF 指纹使用上传原字节 SHA-256，不使用文件名、页面数或 PDF.js 临时对象 ID 代替。
- `PdfTipAnchor` 至少包含版本、指纹、页码、来源、规范文字偏移、多矩形、置信度和创建时页面旋转。
- 矩形存储在 PDF 页自身坐标系中并归一化到 0..1；不得保存屏幕像素。
- 原生 TextLayer 选区必须映射到上传时由同一 PDF.js 版本提取并持久化的规范页文本；服务端验证 `page.text.slice(start,end)===selectedText`。
- 跨页选区明确拒绝；单页多行选区保存全部非空矩形。
- 创建时服务端验证指纹、页码、偏移、文字哈希、矩形范围、来源和重叠，不信任客户端声称的有效状态。
- 打开文档和发起聊天时都重新验证锚点；失败显示 `orphaned` 并阻断回答，不能静默挂到相似句。
- 覆盖标签由当前 PDF.js viewport 把规范 PDF 坐标转换为 CSS 坐标；缩放、DPI 和 0/90/180/270 度旋转后仍指向相同 PDF 区域。
- PDF 根 Tip 继续使用现有消息子 Tip、树、重命名、记忆隔离、收回和级联删除，不建立第二套聊天模型。
- OCR 锚点必须标记 `source=ocr`、页级 OCR 版本和置信度；低置信度不得显示为原生文字锚点。
- 导出必须创建新文件，名称为 `原名-AI-Tip-annotations.pdf`；Annotation 只保存标题、选中文字摘要和 Tip ID，完整聊天仍在本地数据库。
- 导出失败不能覆盖、移动或删除原文件。

## 非目标与边界

- 不允许跨页一次创建一个 Tip；用户应分页面创建。
- 不声称公式、竖排文字、损坏字体映射或复杂双栏的 TextLayer 阅读顺序总是正确；坐标高亮仍保留视觉位置。
- 不把整页 Canvas 截图持久化为 PDF 内容。
- 不覆盖原 PDF，不修改签名文件，不把完整聊天写入批注。
- macOS MAS 构建和真机仍必须在 macOS/Xcode/证书环境验证。

## 先失败的回归与反事实测试

1. 正式 PDF 上传必须保存 SHA-256、页尺寸、旋转、规范页文本和 text-item 偏移；只保存 blocks 时失败。
2. `anchorType=pdf` 缺指纹、错误指纹、越界页码、越界偏移、文字不匹配、空矩形、NaN/越界矩形均返回 400/409。
3. 同页重叠原生文字锚点返回 409；不同页或不重叠允许。
4. 正式创建后重新 GET，PDF Tip 仍为 valid，页码、全部矩形、指纹和偏移不变。
5. 删除或改变权威页文本后必须变 orphaned；旧 document 恢复路径不得把它重新挂到结构块。
6. orphaned PDF Tip 的聊天入口返回 409；有效 PDF Tip 的上下文包含页码及同页前后文。
7. 改变缩放、DPI 或旋转后，覆盖层重新计算但规范矩形不变；只测试固定 CSS 像素不通过。
8. 原始 TextLayer 选择必须调用正式 PDF Tip API；结构化块创建接口不能作为替代证据。
9. 页面最终 DOM 必须包含选区高亮与可点击 Tip 标签；只有侧栏列表不通过。
10. PDF 根 Tip 创建子/孙 Tip、树定位、重命名、收回、记忆和级联删除继续通过。
11. 导出响应文件名不同于原文件，原字节 SHA-256 不变；导出 PDF 重开后必须存在匹配 Tip ID 的 Highlight/Text Annotation。
12. 导出前后逐页渲染，除批注覆盖区域外不得出现乱码、裁切、丢图或页面尺寸变化。
13. 扫描页无 OCR 结果时不能创建原生文字 Tip；OCR 成功时必须保存来源和置信度，失败不得 fabricated replacement。
14. Windows 源码态、Windows 打包态、完整回归、依赖审计和视觉检查全部产生新鲜证据。

## 同轮追加：解除固定 10MB 上传上限

- 上传入口不得再配置固定的 10MB `fileSize` 限制，也不得在界面宣称 10MB 是产品上限。
- multipart 内容先写入应用数据目录下的随机临时文件，再交给解析器读取，避免 Multer 在接收阶段把整个大文件常驻内存。
- 成功响应必须在临时文件清理完成后发出；解析失败、伪造文件和异常退出路由也必须经过 `finally` 清理。
- 测试使用一份大于 10MB 且仍可由 PDF.js 正常解析的真实 PDF 容器，不能只上传任意二进制或伪造 `Content-Length`。
- “无固定 10MB 上限”不等于无限：实际可导入大小仍受本机磁盘空间、解析器能力、内存和操作系统资源约束。

## 实施后的因果证据

- `COMPONENT_CAPABILITY`：锚点验证拒绝错误指纹、越界页码、越界文字偏移、空/越界矩形；批注生成输出与原字节不同且包含 Tip ID，原字节 SHA-256 不变。
- `FORMAL_PATH_INTEGRATION`：正式上传持久化 PDF SHA-256 与权威页文本；正式 PDF Tip 创建接口消费这些字段；文档恢复与聊天入口再次验证；正式导出接口只消费当前用户的有效 PDF Tip。
- `INDEPENDENT_EVALUATION`：Electron 真实选择 PDF.js TextLayer 中的“可选择”，经正式接口形成 PDF Tip，收回后在原页面出现可点击覆盖标签并重新打开同一 Tip。
- `INDEPENDENT_EVALUATION`：图像型扫描 PDF 经本地 `tesseract.js 7.0.0`、内置 `chi_sim+eng` 数据识别，OCR 文字层被真实选择并形成 `source=ocr` 的持久化 PDF Tip；服务器记录引擎、版本、语言、时间和页级置信度。
- `INDEPENDENT_EVALUATION`：改变持久化权威页文本会使现有 PDF Tip 变成 `orphaned`，聊天入口返回 409；恢复权威数据后才重新变为 `valid`，旧文档块路径不能绕过。
- `INDEPENDENT_EVALUATION`：PDF 根 Tip 的实际模型回复能创建 `anchorType=message`、`depth=2` 的子 Tip，证明复用同一递归树，而不是另建孤立 PDF 聊天。
- `INDEPENDENT_EVALUATION`：超过 10MB 的 PDF 通过正式 multipart 路由导入，响应后 `upload-temp` 为空。

Windows 源码态达到上述 `LEVEL_5_PREDICTION_BEARING` 验收条件。清理 1.8.0 旧产物后，本轮重新构建了 `AI Tip Setup 1.9.0.exe`；对 `win-unpacked/AI Tip.exe --smoke-test` 的打包态测试再次完成原生 PDF 选区、覆盖标签重开、离线 OCR、OCR Tip 持久化、递归 Tip、Python 与系统密钥存储主链。安装器 SHA-256 为 `EDF6774DA7CAECAF16FF696E51C8202CF190A85962AA1056AAA08DD21A041654`。

Windows 安装器当前没有 Authenticode 签名，公开分发时仍会面临 SmartScreen 身份提示；这不影响本机功能证据，但属于发布身份缺口。macOS/MAS 因当前主机没有 Xcode、Apple Distribution/Installer 证书和苹果沙箱运行环境，仍标记 `NOT_CAUSALLY_VERIFIED`，不得用 Windows 结果替代；提交 App Store 前必须在 macOS 真机完成 Universal 构建、签名、安装和同等烟雾测试。

## 预期接入等级

- 原生 PDF TextLayer Tip：必须达到 `LEVEL_5_PREDICTION_BEARING`。
- PDF 根 Tip 与现有递归聊天：必须达到 `LEVEL_5_PREDICTION_BEARING`。
- 导出批注副本：必须达到 `LEVEL_5_PREDICTION_BEARING`，即持久化 Tip 真正改变导出 PDF Annotation，而非仅改变文件名。
- OCR：只有离线 OCR 输出被正式创建、恢复、页面覆盖和聊天消费时才能达到 `LEVEL_5`；否则标记 `KNOWN_FRAMEWORK_GAP / NOT_CAUSALLY_VERIFIED`。
