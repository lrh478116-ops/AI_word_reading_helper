# Ollama 官方安装器、登录凭据记忆与文档导入可靠性

日期：2026-08-22
状态：已实施并通过 2026-08-22 新鲜回归

## 目标

1. 用户选择 Ollama 下载来源时，如果桌面 App 未检测到 Ollama CLI，显示 App 内的官方安装器下载窗口；允许选择保存路径、查看真实进度、速度和剩余时间，下载流量不经过开发者服务器。
2. 登录页增加“记住账号和密码”。凭据只保存在当前操作系统账户的安全存储中，不写入网页 `localStorage`、Supabase、应用业务数据库或日志。
3. 修复部分 TXT、Markdown、DOCX、PDF 在解析成功或云端源文件上传成功后仍无法完成导入的问题，并保证失败时不留下错误的正式记录或孤立云文件。

## 只读审计结论

### 问题 1：Ollama 来源未接入正式下载链

- 严重程度：高，阻止 Ollama 来源验收。
- 接入等级：`LEVEL_2_RECORDED`。目录和按钮中存在 Ollama 来源，且 `ManagedOllamaRuntime` 有独立测试；正式下载接口却返回 `SOURCE_REQUIRES_OLLAMA`。
- 代码位置：`src/App.tsx` 的 `openDownload`/`startDownload`、`server/index.ts` 的 `/api/local-models/download`、`electron/main.mjs` 的运行时控制器。
- 当前行为：所有来源进入 GGUF 目录准备流程；Ollama 来源最终被服务端拒绝。CLI 缺失时没有安装器下载界面。
- 直接证据：`ManagedOllamaRuntime` 没有在 Electron 正式入口实例化；服务端控制器只有 `info`、`downloadArtifact`、`activateModel`。
- 错误验收风险：组件测试只能证明 `ManagedOllamaRuntime` 可单独启动，不能证明点击 Ollama 来源会安装 CLI、拉取模型并改变最终 AI provider。
- 统一修复方向：Electron 主进程查询 GitHub 官方 release 元数据，通过 `https://ollama.com/download/OllamaSetup.exe` 或 `Ollama.dmg` 的官网同一路径直接下载，并校验官方资产大小与 SHA-256。安装器下载完成后必须二次确认才打开。CLI 存在后，由受管 Ollama 在用户选择的目录启动，并通过本机 `/api/pull` 拉取目录中声明的模型。

### 问题 2：登录密码没有安全记忆链

- 严重程度：中。
- 接入等级：`LEVEL_0_DEFINED`（Electron 已使用 `safeStorage` 保护 API Key，但登录凭据没有数据结构或 IPC）。
- 代码位置：`src/App.tsx` 的 `AuthScreen`、`electron/main.mjs`、`electron/preload.cjs`。
- 当前行为：登录成功只保存访问令牌与刷新令牌；邮箱和密码每次都需要重新输入。
- 直接证据：登录表单状态仅存在于 React 内存；`localStorage` 只有 token 键。
- 安全要求：禁止明文 fallback。`safeStorage.isEncryptionAvailable()` 为 false 时必须明确提示无法安全保存，但仍允许正常登录。
- 统一修复方向：Electron 主进程维护独立的 `remembered-login.json`，内容仅包含版本和 `safeStorage` 密文。渲染进程只能通过最小 IPC 读取、保存、清除；普通退出登录保留用户主动勾选的凭据，取消勾选或点击清除时删除。

### 问题 3：云端导入在源文件上传后与文档记录持久化之间断链

- 严重程度：高，阻止文档导入验收。
- 接入等级：当前导入解析和 Storage 上传分别达到 `LEVEL_5`，但完整导入 prediction lineage 只达到 `LEVEL_3_CONSUMED`，未保证最终文档记录与源文件共同提交。
- 代码位置：`server/index.ts` 的 `/api/documents/import`、`writeDb`、`hydrateCloudUser`，以及 `server/supabase.ts` 的 `uploadCloudSource`/`upsertCloudChanges`。
- 当前行为：先上传源文件，再依赖通用 `writeDb` 的差异推断决定是否 upsert 文档记录。并发云同步、旧快照或上下文丢失会使这一步被跳过或覆盖。
- 直接证据：2026-08-22 的 Supabase Storage 日志显示以下三个 DOCX 对象均成功 `POST 200`：
  - `fbe1f97f-19a5-4929-9b75-7aecb274796c/source.docx`
  - `ca1b4c65-02df-4ac7-8c72-3fb9efd43d06/source.docx`
  - `0027642e-c03b-4d3e-a245-09024d50898a/source.docx`
  但对应 ID 没有进入 `ai_documents` 的正式 upsert 日志。本地留下同 ID 源文件目录。Mammoth 对三份文件的只读转换均成功，因此失败发生在解析之后。
- 潜在影响：用户看到“服务不可用”；云端产生孤立对象；后续云快照可能覆盖本地已解析文档。
- 错误验收风险：只检查 `uploadCloudSource` 为 200 或只测试 Mammoth 转换会错误宣布导入成功。
- 统一修复方向：导入路由显式执行 `文档解析 → 本地暂存 → 云文档记录 upsert → 云源文件上传 → 本地原子提交`，每一步使用当前文档 ID，不再依赖通用 diff 猜测新文档。任何后续步骤失败均补偿删除已创建的云记录/源文件与本地目录；成功后强制更新云同步缓存，避免旧快照覆盖。

### 问题 4：合法文本/PDF 兼容范围过窄

- 严重程度：中。
- 当前行为：文本只按 UTF-8/GB18030 猜测；UTF-16LE/BE 可能乱码。PDF 仅接受第 0 字节 `%PDF-` 且 `%%EOF` 必须位于最后 4096 字节，部分带 BOM、有限前导空白或较长尾部的可解析 PDF 被提前拒绝。
- 统一修复方向：增加确定性的 BOM/UTF-16 解码；PDF 容器检查允许有限前导区和更合理的尾部搜索窗口，但仍必须经过 PDF.js 真正解析，不能仅凭伪造文件头接纳。

## 平台边界

- Windows：允许下载官方 `OllamaSetup.exe`，校验完成后二次确认打开。
- 非 Mac App Store 的 macOS 包：允许下载官方 `Ollama.dmg`，校验完成后二次确认打开。
- Mac App Store：根据 App Review Guideline 2.5.2，App 不下载或启动会改变功能的外部安装器。只检测/连接用户已安装的 Ollama；缺失时显示明确的商店版限制。不能用隐藏 fallback 绕过。
- Ollama 安装器和模型字节均不得经过 AI Tip 开发者服务器。

## 设计不变量

1. Ollama 安装器元数据来自 `api.github.com/repos/ollama/ollama/releases/latest`；下载起点必须是 `ollama.com/download/...`，重定向主机和路径采用白名单。
2. 下载必须使用 Electron Chromium 网络栈、系统代理、`.part` 临时文件、可取消流和最终 SHA-256/大小验证。
3. 未通过校验的安装器不得打开；用户未二次确认不得执行或挂载。
4. Ollama 模型名只能来自内置目录，不能让请求体注入任意 CLI 参数；不得使用 shell。
5. 记住密码为用户主动选择；磁盘文件不得出现明文邮箱或密码；安全存储不可用时不得降级成明文。
6. 文档导入成功响应必须同时意味着：文档记录已持久化、源文件已就位、该文档可通过正式读取入口打开。
7. 云端失败必须返回具体阶段与可重试错误，不得只返回“服务不可用”，不得静默转成本地成功。
8. 现有本地账户、无云同步导入、GGUF 直连、拖放导入和文档自动保存行为保持兼容。

## 非目标

- 不修改 Supabase 表结构、RLS 或用户数据。
- 不把登录密码上传到 Supabase，也不实现无交互自动登录。
- 不在 Mac App Store 包内下载 Ollama 安装器。
- 不修复已经存在的孤立云对象；本次只阻止新孤立对象，并提供可审计的补偿路径。

## 回归与负向测试

1. 凭据密文往返、清除、损坏文件、安全存储不可用、磁盘无明文。
2. Ollama 官方元数据验证、非官方资产/主机/重定向拒绝、大小或 SHA 不符拒绝、取消保留 `.part`、MAS 阻断。
3. Ollama CLI 缺失时正式 UI 必须打开安装器窗口；CLI 存在时不得打开安装器窗口，而应进入模型目录与 `/api/pull`。
4. 模拟文档记录 upsert 失败：不得上传源文件或返回 201。
5. 模拟源文件上传失败：必须删除已 upsert 的文档记录与本地暂存。
6. 模拟旧云快照：不得覆盖刚成功导入的文档。
7. UTF-8、UTF-8 BOM、UTF-16LE、UTF-16BE、GB18030 文本导入；合法 PDF 前导/尾部兼容；伪 PDF、损坏 DOCX、后端不支持格式必须失败。
8. 反事实：移除文档显式 upsert、改变安装器 SHA、关闭 `safeStorage` 时，正式路径必须分别明确失败，不能由旧路径或缓存继续给出成功结果。

## 验收条件

- 三项功能均达到 `LEVEL_5_PREDICTION_BEARING`：正式 UI 入口产生的对象被正式后端消费，并影响最终登录表单、Ollama provider/模型或可打开文档。
- focused tests、类型检查、产品行为测试、完整 `skills:test` 与 Windows 打包通过。
- 若没有新鲜的桌面 UI 烟测与实际安装器下载校验，只能标记 `NOT_CAUSALLY_VERIFIED`，不得宣称发布验收通过。

## 实施结果与新鲜证据

- 登录凭据：`electron/login-credentials.mjs` 使用 Electron `safeStorage` 的密文信封；无明文 fallback。密文往返、清除、损坏密文和安全存储不可用测试通过。
- Ollama 安装器：已实测读取 GitHub 官方最新 release 元数据。2026-08-22 返回 Windows `v0.32.15`、`OllamaSetup.exe`、1,564,819,104 字节和 SHA-256 `bb49a9366dacf07e3fc94e87869d1a0ad5df3a8cbd9ee54503d4b6b1c0843cb0`。下载器的官网起点、每跳白名单、字节进度、大小、PE 文件头和 SHA-256 负向测试通过。
- Ollama 正式链：桌面 UI 烟测已从 `data-model-source="ollama"` 点击到 `data-ollama-installer-dialog`；受管运行时测试已消费 `/api/pull` 流并通过 `/api/tags`；服务端正式下载入口测试最终把设置更新为 `provider=ollama` 和目录中的 `modelRef`。达到 `LEVEL_5_PREDICTION_BEARING` 的可重复模拟集成证据。
- 文档导入：Supabase 模拟集成测试确认文档记录先于 Storage 对象写入；文档 upsert 失败时不会上传源文件，Storage 上传失败时会补偿删除新文档记录。三份本机历史失败 DOCX 均通过正式 `/api/documents/import` 返回 201，块数分别为 27、27、628。
- 兼容性：UTF-16LE、UTF-16BE、UTF-8 BOM、GB18030 路径与有限 PDF 前导/尾部兼容测试通过；伪 PDF 仍被拒绝。
- 完整验证：`pnpm skills:test`、`pnpm desktop:smoke`、Windows NSIS x64 打包均通过。

### 仍需区分的证据边界

出于避免消耗用户约 1.56 GB 流量，本轮没有把当前官方 Windows 安装器完整下载一遍。完整文件写入与 SHA-256 使用确定性 fixture 验证，实时官方元数据使用真实 GitHub API 验证，桌面 UI 使用烟测元数据验证。因此“当前 1.56 GB 资产在用户所在网络可完整传输”仍属于运行时网络条件，标记为 `NOT_CAUSALLY_VERIFIED`；下载失败会保留 `.part` 并明确报错，不会打开未校验文件。
