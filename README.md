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

推荐直接在桌面应用的“设置 → 接口与 Prompt”中配置。支持 OpenAI、DeepSeek、硅基流动、Moonshot、智谱 AI、Gemini 兼容接口、Ollama 本地模型，以及任意支持 Chat Completions 与 Tool Calls 的 OpenAI 兼容接口；远程自定义接口必须使用 HTTPS。桌面版 API Key 由 Electron `safeStorage` 使用 Windows 系统凭据保护或 macOS Keychain 加密，前端只会得到掩码。

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
AI_TIP_FEEDBACK_RELAY_URL=https://your-feedback-relay.example/submit
AI_TIP_FEEDBACK_RELAY_TOKEN=your-relay-token
```

密钥只由 Express 服务端读取，不会打包到前端。未配置密钥时，一般问题使用演示回答；专业问题会明确阻断，直到当前设备配置了模型 API 和联网搜索。

设置中提供“修改建议箱”。前端只提交建议类别和内容到本机鉴权接口，不包含收件邮箱、文档、Tip 对话、API Key 或 Prompt。本机服务再调用 `AI_TIP_FEEDBACK_RELAY_URL` 指定的 HTTPS 中继；目标邮箱与邮件服务凭据必须保存在中继端，不能放进桌面安装包。中继未配置或发送失败时，界面会保留建议内容并明确显示未发送。

## 已实现的 MVP 闭环

- 注册、登录、JWT 鉴权和用户数据隔离
- 新建、搜索、排序、收藏、回收站、恢复和永久删除
- TXT、Markdown、DOCX、PDF 导入，10MB 大小限制并保留原始文件；中文、重音字符和 Emoji 文件名在 multipart 边界恢复为 UTF-8
- PDF 由 PDF.js 从鉴权读取的原始字节按视口延迟渲染；嵌入字体、矢量和图片不经过 OCR 或 JPEG/WebP 二次编码，CMap、标准字体、ICC 与 WASM 资产随桌面安装包离线分发
- 统一块模型：标题、段落、列表、引用和代码
- 块级 `contentEditable` 编辑、900ms 防抖自动保存、手动保存和状态反馈
- 文字选区浮动工具条与 Tip 创建
- Tip 独立多轮历史、流式输出、停止生成、复制、折叠、恢复、解决和删除
- Tip 的完整聊天相互隔离；可单独开关“记忆”，仅共享同一文档其他 Tip 的摘要
- 任意持久化聊天消息也可选中文字创建子 Tip，并可继续递归创建孙 Tip；消息锚点保存父 Tip、来源消息和精确偏移
- 进入子 Tip 时，父聊天替换原文档区域，子聊天替换原 Tip 区域；逐层收回时按父链确定性恢复原位置
- 存在两级 Tip 后显示左上角 Tip 树，支持按层级定位对话、编辑节点名称以及父节点删除时级联清理后代
- 通俗解释、详细解释、专业解释和举例四种快捷提问
- 多服务商 API、模型、自定义兼容地址、连接测试与系统 Prompt 设置
- Tavily 联网搜索、来源展示与 Pyodide/WASM 精确计算技能
- 专业问题分级、强制权威来源搜索、缓冲式引用审查与失败阻断
- 设置内修改建议箱与隐藏收件人的 HTTPS 邮件中继
- `blockId + offsets + selectedText + 前后文` 复合锚点；内容修改后自动重定位，无法恢复时保留为失效锚点
- 桌面三栏阅读布局与移动端底部全屏式 Tip 面板
- Electron Windows/macOS 桌面封装、Windows NSIS 与 Mac App Store Universal 构建配置
- JSON 原子写入持久化，数据保存在本地 `data/`（已加入 `.gitignore`）

## 项目结构

```text
src/
  App.tsx        前端页面与核心交互
  api.ts         鉴权、文档、Tip 与流式请求封装
  PdfPreview.tsx PDF.js 原页面渲染与按视口加载
  prompts.ts     中英文内置 Prompt 与准确性规则
  types.ts       统一文档块和 Tip 数据模型
  styles.css     桌面/移动端视觉系统
server/
  index.ts       Express API、持久化、导入解析、锚点恢复与 AI
```

## 验证命令

```bash
pnpm typecheck
pnpm build
pnpm skills:test
pnpm desktop:smoke
```
