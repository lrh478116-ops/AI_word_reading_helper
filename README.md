# AI Tip 智能文档

一个把局部 AI 多轮对话绑定到原文位置的智能文档 MVP。支持文档创建、TXT/Markdown/DOCX/PDF 导入、块级编辑、自动保存、文档管理，以及可折叠、可恢复的 Tip 对话。

## 运行桌面应用

需要 Node.js 20+ 与 pnpm。

```bash
pnpm install
pnpm desktop:dev
```

命令会直接打开独立的 AI Tip 桌面窗口，不需要浏览器。可以点击“仅本地使用”，或使用：

- 邮箱：`demo@aitip.local`
- 密码：`demo1234`

“仅本地使用”会通过正式登录接口进入本机账户，不会绕过账户隔离。首次进入时文档库为空，不再自动创建 Transformer 示例文档。登录页和“设置 → 接口与 Prompt”都可以在简体中文与 English 之间切换；选择会保存在本机并立即应用到应用界面。英文模式会在设置中显示英文内置默认 Prompt，并把英文准确性规则作为实际模型 system message 发送；用户自定义 Prompt 不会被自动翻译或覆盖。

普通注册和登录已经连接到 Supabase 项目 `AI_reading_helper`，但云账号也采用本地优先：新建、导入、编辑、Tip 和聊天默认只保存在当前设备，只有用户点击文档上的“上传云端”后才同步。文档库和编辑器会区分“仅本地”“本地有修改”“已在云端”，并显示当前云空间用量；本地删除不会暗中删除云副本，“移出云端”是独立显式操作。每个用户最多使用 5 MiB 云空间，权威配额同时计算私有 Storage 对象、文档 JSON 和 Tip/聊天 JSON，并由数据库 trigger、Storage RLS 与按用户事务锁约束，不能通过直接调用 API 或并发上传绕过。

导入源文件在本地保持原样，显式上传前统一 gzip 压缩，私有 `ai-document-files` Storage bucket 的新对象只保存 `.gz`；恢复时由应用透明解压，旧版本的非压缩对象仍可读取。应用不重新设置本地导入大小上限；5 MiB 只约束用户选择上传的云副本。PDF、DOCX 与图片通常已经压缩，gzip 不保证每个文件都会变小。

“仅本地使用”是严格隔离路径：不会调用 Supabase Auth、Data API 或 Storage，Supabase 故障也不会影响本地文档。模型 API Key、Tavily Key、自定义 Prompt 和接口设置永远只保存在当前设备，不会上传到 Supabase。桌面安装包只包含可公开的 publishable key，不包含 `service_role` 或 secret key；云数据安全依赖数据库迁移中的显式 `GRANT`、表级 RLS 与 Storage 所有权策略。

下载安装后的本地模式不会使用开发者或打包机器的模型 API Key。Electron 桌面模式明确禁用服务端环境 Key fallback；每台设备只能使用该设备用户在“设置”中主动保存的模型与搜索 Key。`.env`、开发数据目录和开发者 Key 不会进入安装包。

本地运行生产桌面版：

```bash
pnpm desktop:start
```

应用数据会保存在 Windows/macOS 各自的用户应用数据目录，而不是安装目录。

## Windows 与 Mac App Store 打包

Windows x64 安装包（可在 Windows 上执行）：

```bash
pnpm desktop:dist:win
```

Mac App Store Universal 包（Apple Silicon + Intel，必须在安装 Xcode 的 macOS 上执行）：

```bash
pnpm desktop:dist:mas
```

MAS 构建已启用 App Sandbox、网络客户端/本地服务、用户选择文件读写权限。正式上传前仍需在 Apple Developer 后台创建 `com.aitip.reader` App ID、Mac App Store provisioning profile，并通过 Xcode/Transporter 完成签名上传。Windows 打包配置与 MAS 权限互相独立。

## 配置真实 AI

推荐直接在桌面应用的“设置 → 接口与 Prompt”中配置。支持 OpenAI、DeepSeek、硅基流动、Moonshot、智谱 AI、Gemini 兼容接口、AI Tip 内置本地模型、Ollama 高级本地接口，以及任意支持 Chat Completions 与 Tool Calls 的 OpenAI 兼容接口；远程自定义接口必须使用 HTTPS。桌面版 API Key 由 Electron `safeStorage` 使用 Windows 系统凭据保护或 macOS Keychain 加密，前端只会得到掩码。

没有配置模型 API 时，TXT、Markdown、DOCX 与 PDF 的导入、阅读、编辑和 Tip 创建仍然可用；发送 Tip 问题会在界面与服务端同时被阻止，右侧明确提供“前往设置”和“下载本地模型”。本地模型页列出 11 款经版本化登记的轻量模型，并显示 Q4 大小、内存/GPU 建议与特点。无需安装 Ollama：桌面包内置固定版本的 `llama.cpp`，可从作者/机构的 ModelScope 国内仓库或固定 revision 的 Hugging Face 仓库直接下载，也可离线导入 `.gguf`。下载管理器支持原生目录选择、真实字节进度、速度、ETA、取消与 `.part` 断点续传。下载完成后必须通过固定大小、SHA-256、`GGUF` 文件头以及内置 `/v1/models` 加载验证，之后才会切换到本地接口。renderer 不能提交任意 URL、仓库、文件名或摘要。

内置 `llama-server` 只监听随机的 `127.0.0.1` 端口，使用 `shell=false` 启动；可执行文件在构建时从 llama.cpp 官方 release 以固定 SHA-256 纳入 App 资源，不会在运行时下载或执行网络代码。Windows 包含 x64 CPU 构建；macOS 包含 arm64 与 x64 构建，MAS 文件/目录访问使用安全作用域书签，helper 随 App 签名。Ollama 仍保留为设置中的高级可选接口，但不再是应用内模型下载的前置条件。模型目录和当前 GGUF 路径只保存在当前设备，不上传 Supabase。

## 可调用技能与正确性约束

1. **多来源交叉验证**：至少需要两个独立域名和两篇成功读取的原文，否则保持警告状态。
2. **原始网页读取**：搜索后读取前三个 HTTPS 原始页面；包含重定向、内网地址、类型与大小限制。
3. **引用审计**：外部事实必须标注 `[S#]`，先确定性检查编号，再由独立审计调用检查证据支持情况。
4. **单位与量纲检查**：支持常见长度、质量、时间、数据量、压力、能量、功率和温度换算，拒绝跨量纲计算。
5. **不确定性计算**：在 Python 中进行独立标准不确定性传播并返回相对不确定性。
6. **符号数学**：使用 SymPy 验证方程求解、化简、求导、积分、因式分解和展开。
7. **代码执行与测试**：在可强制终止的隔离 Worker 中运行候选 Python 代码和断言测试。
8. **结构化数据分析**：使用 Pandas 对 CSV 执行描述统计、缺失值检查和数值相关性分析。
9. **来源冲突检测**：检测多个版本号或数值候选；缺少可比主张时不宣称检查通过。
10. **时效性检查**：只有存在可解析且足够新的发布日期时才通过。
11. **Prompt 注入防御**：扫描并从送入模型的网页证据中移除疑似指令片段。
12. **高风险专业复核**：必须取得模型、联网搜索、两个独立来源和两篇原文，否则阻断个性化结论。
13. **模型专业程度评估**：配置模型后，每个问题在正式聊天入口先由模型评估一般、进阶或专业等级、领域、分类置信度及是否需要联网；规则保留为不可降级的安全下限，模型不能把已识别的高风险问题降级后绕过审查。
14. **政策与公共治理审查**：政策制定、工具、执行、评估、比较、监管和公共治理被视为独立专业领域；现行政策、法规及政策效果问题必须联网，优先核对政府、立法机关、监管机构、国际组织和权威研究机构原文。
15. **专业回答联网审查**：模型或规则判定需要审查后，服务端预执行搜索，不能由回答模型绕过；回答在权威来源与引用审查结束前保持缓冲，审查失败则不展示原回答。

此外保留 **Python Decimal 精确计算** 和强制路由：数值问题优先进入本地 Pyodide/WASM；模型判定为专业、政策敏感或涉及“最新、当前、价格、版本”等问题时进入联网研究。模型专业度评估本身不调用 Tavily；免费额度模式下，随后发生的专业预搜索计作本轮唯一一次搜索。每条消息会持久化实际使用的技能、状态、计算摘要和来源。

Tavily 默认使用免费额度保护模式：固定 `basic` 搜索、每条回答最多一次搜索、相同查询缓存 30 分钟，并通过 `/usage` 查询额度而不消耗搜索次数。发布或额度充足时可在设置中切换“质量优先”，每条回答最多三次搜索；缓存仍然生效。

Pyodide 核心随安装包分发，不依赖系统 Python。SymPy 与 Pandas 首次使用时由 Pyodide 官方包仓库加载，之后使用本机缓存；因此首次高级分析需要联网。

这些机制能显著提高答案可靠性，但不能保证任何开放域 AI 回答绝对正确。高风险结论仍应核对原始来源、计算假设和适用范围。

复制 `.env.example` 为 `.env`：

```env
OPENAI_API_KEY=your-server-side-key
OPENAI_MODEL=gpt-5.6-sol
JWT_SECRET=replace-with-a-long-random-string
PORT=8787
# 如需仅在开发环境关闭云账户：
# AI_TIP_SUPABASE_ENABLED=0
```

密钥只由 Express 服务端读取，不会打包到前端。未配置远程模型 API 且没有可用本地模型时，Tip 聊天会明确阻止发送，不会生成演示回答、伪造模型输出或写入半条用户消息；文档导入、阅读、编辑和 Tip 锚定不受影响。联网搜索总开关默认关闭：关闭时所有问题（包括专业、政策和高风险问题）都不会访问 Tavily、百科、参考站点或原始网页，只依据文档、对话、Tip 记忆和本地工具回答，并明确标记外部事实未联网核验。用户显式开启后，专业问题才会进入联网审查；搜索失败时仍保留基于文档的有效回答。

## 已实现的 MVP 闭环

- Supabase Auth 云账户、access/refresh token 自动刷新、RLS 云数据隔离，以及完全不调用 Supabase 的“仅本地使用”账户
- 本地优先的显式 Supabase 同步；只有点击“上传云端”才上传当前文档、全部 Tip/聊天和 `.gz` 源文件，本地删除与云端移除严格分离
- 每用户 5 MiB 累计云空间，Storage、文档 JSON、Tip/聊天 JSON 全部计入，并由 Data trigger、Storage RLS 和事务锁共同约束
- 新建、搜索、排序、收藏、回收站、恢复和永久删除
- TXT、Markdown、DOCX、PDF 导入不再设置固定 10MB 上限；上传先写入本机临时文件，解析结束后确定性清理，并保留原始文件；中文、重音字符和 Emoji 文件名在 multipart 边界恢复为 UTF-8
- PDF 原始版式由 PDF.js Canvas + TextLayer 从鉴权读取的原始字节渲染；原文件逐字节保留，不经过 OCR 或 JPEG/WebP 二次编码
- 原始 PDF 页面可直接选择文字创建 Tip；锚点同时保存原文件 SHA-256、页码、权威文字偏移、前后文、页内归一化多矩形、旋转角度、来源和置信度，缩放与高 DPI 下由当前 viewport 重算覆盖位置
- 扫描 PDF 可按页使用安装包内置的 Tesseract.js、简体中文与英文数据离线 OCR；识别文字、坐标、引擎版本和页级置信度持久化后才能创建 `source=ocr` 的 PDF Tip，不访问 CDN
- PDF Tip 可导出为不覆盖原文件的 `原名-AI-Tip-annotations.pdf`，副本含标准 Highlight/Text Annotation、可追踪 Tip ID、完整选中文字和第一条 AI 回答全文；多轮聊天与 Tip 树仍保存在应用数据库
- PDF 结构化视图把可映射文字、满足严格几何条件的表格和原生图片绘制操作分别持久化为真实文本、`<table>` 与 `<img>`；表格显示推断置信度，扫描件不虚构文字
- 统一块模型：标题、段落、列表、引用、代码、PDF 表格和 PDF 图片
- 块级 `contentEditable` 编辑、900ms 防抖自动保存、手动保存和状态反馈
- 文字选区浮动工具条与 Tip 创建
- Tip 独立多轮历史、流式输出、停止生成、复制、折叠、恢复、解决和删除
- 文档段落、标题、引用、代码、列表与 Word 表格单元格采用浏览器原生光标所有权；在中间按 Enter 换行后继续输入不会跳回首行，自动保存和重新打开保留字符落点与换行
- 每个 Tip 输入框的纸飞机旁提供用户级联网总开关，与“设置 → 联网搜索”双向同步；回答生成期间锁定，保存失败不会伪造开关状态
- 主页面左侧栏在“设置”上方显示联系邮箱，点击后通过桌面原生系统剪贴板复制，并提供成功或失败反馈
- Tip 的完整聊天相互隔离；可单独开关“记忆”，仅共享同一文档其他 Tip 的摘要
- 任意持久化聊天消息也可选中文字创建子 Tip，并可继续递归创建孙 Tip；消息锚点保存父 Tip、来源消息和精确偏移
- 进入子 Tip 时，父聊天替换原文档区域，子聊天替换原 Tip 区域；逐层收回时按父链确定性恢复原位置
- 存在两级 Tip 后显示左上角 Tip 树，支持按层级定位对话、编辑节点名称以及父节点删除时级联清理后代
- 通俗解释、详细解释、专业解释和举例四种快捷提问
- 中英双语的共享 API 服务商注册表、当前默认模型、自定义兼容地址、真实 `/models` 刷新、连接测试与系统 Prompt 设置
- 无模型时文档能力保持可用、Tip 前后端双重发送门禁，以及 11 款本地模型的原生目录选择、ModelScope/Hugging Face 固定 artifact、断点续传、SHA-256/GGUF 验证、内置 llama.cpp 加载和接口自动连接
- 默认关闭的联网搜索总开关；只有显式开启后才允许 Tavily、有限中外参考站点和原网页读取
- 专业问题分级；联网开启时执行权威来源搜索与缓冲式引用审查，关闭时明确标记审查未执行并继续基于文档回答
- Pyodide/WASM 精确计算、单位与量纲检查等纯本地技能
- `blockId + offsets + selectedText + 前后文` 复合锚点；内容修改后自动重定位，无法恢复时保留为失效锚点
- 桌面三栏阅读布局与移动端底部全屏式 Tip 面板
- Electron Windows/macOS 桌面封装、Windows NSIS 与 Mac App Store Universal 构建配置
- JSON 原子写入持久化，数据保存在本地 `data/`（已加入 `.gitignore`）

## 项目结构

```text
src/
  App.tsx        前端页面与核心交互
  api.ts         鉴权、文档、Tip 与流式请求封装
  PdfPreview.tsx PDF.js 原始版式与 PDF 语义结构视图
  providers.ts   共享服务商 URL、默认模型与迁移注册表
  prompts.ts     中英文内置 Prompt 与准确性规则
  types.ts       统一文档块和 Tip 数据模型
  styles.css     桌面/移动端视觉系统
server/
  index.ts       Express API、持久化、导入解析、锚点恢复与 AI
  supabase.ts    Supabase Auth、RLS Data API 与私有 Storage/TUS 接入
  pdf-structure.ts PDF 文本行、几何表格和图片绘制操作提取
  pdf-tip.ts     PDF 页锚点权威验证与批注副本生成
```

## 验证命令

```bash
pnpm typecheck
pnpm build
pnpm skills:test
pnpm desktop:smoke
```

Supabase 的可复现迁移保存在 `supabase/schema.sql`；云接入的因果链、设计不变量、负向测试和验收边界记录在 `docs/changes/2026-08-16-supabase-cloud-connection.md`，压缩上传升级记录在 `docs/changes/2026-08-26-supabase-compressed-source-archives.md`，本地优先与 5 MiB 用户配额记录在 `docs/changes/2026-08-26-local-first-explicit-cloud-upload-and-quota.md`。
