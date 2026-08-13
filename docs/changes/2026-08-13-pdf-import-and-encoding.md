# 文档标题编码、PDF 保真导入与英文默认 Prompt

## 只读审计结论

正式上传主链当前为：浏览器 `File` → `FormData` → Multer `originalname` → 扩展名判断 → 文本/DOCX 解析 → `DocumentItem.title/originalName/blocks` → JSON 持久化 → 文档库与编辑器。中文文件名在 Multer 边界已经被作为 Latin-1 字符串消费，后续代码没有恢复浏览器发送的 UTF-8 字节，因此错误值真实进入标题、原文件名、磁盘路径和 UI。当前安装数据中已存在 `实习进度1.md` 被保存为 `å®ä¹ è¿åº¦1.md` 的直接证据。

PDF 当前未出现在文件选择器、Multer 白名单、数据类型、解析/保存分支、原文件读取 API 或编辑器渲染中，不具备正式导入路径。只增加 `.pdf` 扩展名最多达到 `LEVEL_1_INVOKED`，不能证明 PDF 内容、字体和图片进入最终界面。

英文语言状态当前只改变 React 文案；服务端 `defaultPrompt` 固定为中文，正式聊天 `baseMessages[0]` 直接消费该中文值。因此英文界面与模型实际 Prompt 不一致。

## 已确认问题

| 问题 | 严重程度 | 代码位置 | 当前实际行为 | 直接证据 | 潜在影响 | 错误验收风险 | 统一修复方向 | 阻止下一阶段 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 中文文件名被错误解码 | 高 | `server/index.ts` 上传路由 | 直接使用 `req.file.originalname` 生成标题、原文件名和磁盘路径 | 正式安装数据持久化了 `å®ä¹ è¿åº¦1.md` | 标题、搜索、排序和文件路径均乱码 | 只改字体或 UI 会掩盖但不会修复数据 | 在扩展名判断和持久化前严格恢复 UTF-8，再做 NFC 与安全文件名规范化 | 是 |
| 已有乱码记录没有迁移 | 高 | `ensureDemoUser` / 启动迁移 | 新代码即使修复未来上传，旧标题仍保持错误值 | 当前用户数据库已有乱码记录 | 用户仍会认为修复无效 | 只用新上传 fixture 会错误通过 | 启动时仅对可严格证明为 UTF-8→Latin-1 误解码的导入记录修复，并同步磁盘文件名 | 是 |
| PDF 被正式入口拒绝 | 高 | `src/App.tsx`、Multer `fileFilter`、`src/types.ts` | 选择器和后端白名单都没有 `.pdf` | `accept` 与白名单只有 TXT/MD/DOCX | 用户无法上传 PDF | 只定义解析函数会被旧入口绕过 | 把 PDF 接入唯一文件选择和唯一上传路由 | 是 |
| 缺少原 PDF 鉴权读取链 | 高 | 服务端文档 API | 上传原文件只写磁盘，没有按文档所有权读取的端点 | 无 `/documents/:id/source` | 前端无法消费原始 PDF 字节 | 仅返回“导入成功”会把在场误称为可用 | 增加所有权校验、PDF 类型校验、原字节响应与禁止缓存 | 是 |
| PDF 字体与图片没有视觉保真路径 | 高 | 编辑器正文渲染 | 仅支持文本块 `contentEditable` | 无 PDF 页面画布或原文件预览 | 抽取文本会丢失版式、字体、矢量和图片 | 只验证文字非空无法证明图片正确 | 用 Mozilla PDF.js 从原始字节按需渲染页面 Canvas；不重新编码 PDF 内图片 | 是 |
| 英文默认 Prompt 未进入模型主链 | 高 | `server/index.ts` 聊天路由、`src/App.tsx` 设置 | 英文 UI 仍展示并发送中文内置 Prompt；模型 system message 也仍为中文 | `baseMessages` 直接使用固定中文 `defaultPrompt` | 语言指令冲突，增加不必要的语言漂移 | 只翻译输入框会留下服务端旧 Prompt | 聊天请求携带规范化语言；仅当 Prompt 等于任一内置默认值时映射到该语言，自定义 Prompt 原样保留 | 是 |

## 设计不变量

- 文件名恢复只接受“原字符串可表示为单字节序列，且该字节序列能被严格 UTF-8 解码”的情况；无法严格证明时保持原值，不能猜测性改写用户标题。
- 文件名统一 NFC 规范化，并在恢复编码后再执行路径分隔符、控制字符和 Windows 禁止字符清理。
- PDF 必须同时满足允许的 `.pdf` 扩展名和文件头 `%PDF-`；伪装 PDF 必须明确失败，不能作为文本或 Markdown 继续解析。
- PDF 原始字节写入后必须能由同一用户通过鉴权端点逐字节读回；其他用户和非 PDF 文档不能读取。
- PDF 编辑器视图必须从原始字节使用 PDF.js Canvas 渲染。PDF 内文字、嵌入字体、矢量和图片不经过 JPEG/WebP 重压缩或 OCR 替换。
- 页面按进入视口附近时渲染，不能一次高分辨率渲染所有页面导致大 PDF 内存失控。
- Canvas 视觉预览是 PDF 的权威显示；可提取文本只用于搜索/Tip 上下文时必须拒绝替换字符和明显乱码，不能用不可靠抽取覆盖视觉原文。
- 永久删除文档时仍必须级联删除原 PDF；回收站恢复不复制或改写原文件。
- 英文模式的内置默认 Prompt 和追加正确性规则都必须为英文；简体中文模式使用中文。
- 只有等于已知内置默认 Prompt 的值才随语言切换；任何用户自定义 Prompt（包括用户主动写的中文）必须逐字保留。
- 语言必须从 UI 进入正式聊天请求，并由生成回答的服务端路径真实读取；不能只记录在 trace 或设置界面。
- Windows 和 Mac App Store 构建均使用同一纯前端 PDF.js 渲染路径，不引入平台专属原生 PDF/Canvas 依赖。

## 非目标

- 本轮不实现 PDF 内容编辑、注释写回、签名、表单填写或 OCR。
- 不保证缺少 Unicode 映射的扫描 PDF 能抽取为可编辑文本；这类 PDF 仍必须以原页面视觉无损显示。
- 不自动翻译用户文档、PDF 正文、标题或用户自定义 Prompt。
- 不把 PDF 页面转成持久化 PNG/JPEG，避免体积膨胀和二次压缩。
- 不修改模型、checkpoint 或训练数据。

## 回归与负向验收条件

1. 中文、英文、重音字符和 Emoji 文件名经正式 multipart 上传后标题及 `originalName` 正确；ASCII 名称不变。
2. 已存在的可证明 UTF-8 误解码标题在正式启动迁移后修复；无法严格证明或用户自定义标题不被改写。
3. 中文名 PDF 经文件选择器进入正式上传 API，返回 `sourceType=pdf` 和正确标题。
4. 伪造 `.pdf`、无文件、未登录和跨用户原文件读取均失败；超过 10MB 的真实 PDF 必须成功上传，完成响应前临时文件必须被清理。
5. 上传后的 PDF 源响应与输入 SHA-256 完全一致；永久删除后源文件不可读取。
6. 含中文正文、嵌入字体、矢量图和带中文像素文字图片的 PDF 能在编辑器中产生非空页面 Canvas；画布不存在替换字符文本或损坏图片占位。
7. 下载正式源响应后，`pdfinfo`/`pdfplumber` 可读取，`pdftoppm` 能逐页渲染；渲染 PNG 视觉检查无方框、乱码、裁切或图片损坏。
8. PDF.js worker、CMap、标准字体和 WASM 资产进入生产 `dist` 与 Electron 打包输入，离线桌面模式不依赖 CDN。
9. 英文设置界面显示英文默认 Prompt；切换中英文时仅内置默认 Prompt 跟随，自定义 Prompt 保持不变。
10. 英文聊天请求的模型首条 system message 使用英文默认 Prompt 和英文正确性规则，不包含中文内置默认内容；中文请求反向成立。
11. 删除语言字段、提供非法语言或直接调用旧客户端时安全回退为简体中文，不出现未定义 Prompt。
12. focused tests、完整技能回归、Electron 烟雾测试、依赖审计和 Windows 构建检查全部通过。

## 预期接入等级

- 标题编码恢复与旧数据迁移：必须达到 `LEVEL_5_PREDICTION_BEARING`，即正式启动改变持久化标题且 UI 读取修复值。
- PDF 导入与原始视觉显示：必须达到 `LEVEL_5_PREDICTION_BEARING`，即文件选择进入正式上传、原字节持久化、鉴权读取并实际驱动编辑器 Canvas。
- 英文默认 Prompt：必须达到 `LEVEL_5_PREDICTION_BEARING`，即语言字段改变模型实际接收的 system message；删除语言字段会使该变化消失。

## 实施结果与证据（2026-08-13）

### COMPONENT_CAPABILITY

- `decodeUploadFilename` 仅在严格 UTF-8 反解成功且存在明确边界误解码信号时恢复名称；中文与 Emoji 恢复，ASCII 与不能证明误解码的 `café.pdf` 保持不变。
- 文件名按 Unicode code point 截断并保留扩展名，不会切断 Emoji 代理对；Windows 保留名与危险路径字符被清理。
- `hasValidPdfContainer` 同时检查 `%PDF-` 文件头和最后 4096 字节内的 `%%EOF`；只有伪造文件头的负向样例被拒绝。
- 两页回归 PDF 为 61,299 字节，SHA-256 固定为 `dcd1efb66c75ce0e39c54b3c2e0a383d2fc81333d2df9d41a6242156a8978749`；包含中文、嵌入字体、矢量框和带中文像素文字的 PNG。

### FORMAL_PATH_INTEGRATION

- 正式启动迁移把旧 UTF-8→Latin-1 乱码标题、`originalName` 和磁盘文件名同步修复；自定义标题不被覆盖。集成测试从启动入口读取迁移后的数据库与文件，而不是直接调用迁移函数。
- 正式 multipart 上传中文名 PDF 后产生 `sourceType=pdf`；同一用户从 `/api/documents/:id/source` 读回的 SHA-256 与输入完全一致，跨用户读取返回 404，永久删除后源文件返回 404。
- Electron 文件选择器实际上传回归 PDF，编辑器从鉴权端点取得原字节并由 PDF.js Canvas 渲染两页；第二页只有滚动到视口附近后才渲染。
- 英文语言从 React 状态进入 `streamTip` 请求，服务端读取后改变回答模型实际收到的首条 system message。模型 mock 捕获到英文内置 Prompt 与英文准确性规则，且不含中文内置内容。

### INDEPENDENT_EVALUATION

- 使用打包后的 `release/win-unpacked/AI Tip.exe --smoke-test`，通过外部测试 PDF 走真实发布代码，退出码为 0，并导出两页 PDF.js Canvas。人工视觉检查确认中文、标点、数值、矢量边框、图片颜色和图片内中文均正常，没有方框、乱码、裁切或损坏占位。
- `pdfplumber` 对两页均提取到预期中文，替换字符 `U+FFFD` 数量为 0；`pypdf` 读取到中文元数据标题；Poppler 可识别为 2 页 A4 PDF。
- 发布 ASAR 内包含 169 个 CMap、2 个 ICC 配置、16 个标准字体资源、10 个 WASM 文件、2 个 worker 构建和 PDF.js 许可证，不依赖 CDN。

### 验收边界

- Windows x64 安装包已在 Windows 真实打包并对解包后的发布应用执行端到端烟雾测试，达到 `LEVEL_5_PREDICTION_BEARING`。
- Mac App Store Universal 构建配置继续复用同一浏览器 PDF.js 路径，但本轮运行环境不是 macOS，尚未执行 Xcode 签名、MAS 构建或真机视觉测试，因此标记 `NOT_CAUSALLY_VERIFIED`，不能用 Windows 结果宣称苹果商店包已验收。
- 当前 PDF 功能是保真只读预览；PDF 编辑、OCR、表单、批注写回以及直接在 PDF Canvas 文字上创建 Tip 属于 `KNOWN_FRAMEWORK_GAP`，没有用静态文本块或 OCR 旁路伪装为已实现。
- 回归 fixture 证明这类嵌入中文字体与图片的 PDF 可正确显示；它不能证明所有损坏、加密、扫描或缺失字体映射的第三方 PDF 都兼容。解析失败会明确报错，不会静默改用可能乱码的文本结果。
