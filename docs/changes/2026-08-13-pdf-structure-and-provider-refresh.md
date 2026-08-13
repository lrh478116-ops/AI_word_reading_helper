# PDF 结构保留与 API 服务商注册表更新

## 审计结论

当前 PDF 主链为 `File → multipart → 原始字节 → sourceType=pdf/blocks=[] → 鉴权读取 → PDF.js Canvas`。它达到原页视觉保真，但 PDF 文本、表格和图片对象没有成为下游可消费的文档结构；文本不能选择或创建 Tip，表格不是表格，图片也没有独立对象。因此上一版的 PDF 能力只能证明 `FORMAL_PATH_INTEGRATION` 的视觉分支，不能证明语义结构正式接入。

当前接口配置在 `src/App.tsx` 和 `server/index.ts` 各维护一份默认服务商数据。前端服务商名称硬编码中文，英文语言状态不影响下拉项。默认模型中存在已经停用或明显落后的标识，且应用没有读取各服务商 `/models` 的能力；本轮手工更新后仍会再次过期。

## 已确认问题

| 问题 | 严重程度 | 直接证据 | 潜在影响 | 错误验收风险 | 统一修复方向 | 阻止发布 |
| --- | --- | --- | --- | --- | --- | --- |
| PDF 文档块固定为空 | 高 | 上传分支直接执行 `blocks=[]` | 文本不可检索、不可选择、不能创建 Tip | Canvas 非空被误称为完整导入 | 上传时从同一原始字节提取结构块 | 是 |
| PDF 只有 Canvas，没有 TextLayer | 高 | `PdfPreview` 只调用 `page.render` | 文字只是像素输出，没有 DOM 语义 | 视觉正常被误称为“文本是文本” | 原始版式上叠加 PDF.js TextLayer，并绑定持久化块 | 是 |
| 表格没有语义结构 | 高 | `BlockType` 无 table，PDF 无结构提取 | 单元格关系丢失，复制/辅助技术/AI 上下文错误 | 对齐文字被武断称为表格 | tagged-PDF 优先；无标签时用连续行与列对齐几何推断并记录置信度 | 是 |
| 图片没有独立对象 | 高 | Canvas 是唯一最终消费者 | 结构化视图无法保留图片 | 整页截图被称为“图片对象” | 记录图像绘制操作与边界；结构视图以独立 `<img>` 呈现 | 是 |
| 旧 PDF 无结构迁移 | 高 | 已导入 PDF 的 `blocks=[]` 且无结构版本 | 旧文档绕过新功能 | 只测新上传 fixture 错误通过 | 启动时对旧 PDF 运行一次可追溯迁移，失败状态显式持久化 | 是 |
| 服务商注册表重复 | 高 | 前端和服务端分别定义 URL/model | 默认值漂移、测试与运行行为不一致 | 只改 UI 下拉项但服务端仍用旧值 | 单一共享版本化注册表 | 是 |
| 接口区域翻译不完整 | 中 | provider label 全部硬编码 | 英文设置仍出现中文 | 其他设置文案已翻译导致误判 | provider、刷新状态、弃用提示、连接结果全部使用语言键 | 是 |
| 默认模型含停用标识 | 高 | DeepSeek 默认 `deepseek-chat` | 当前日期已无法调用 | 连接测试未使用真实服务导致假通过 | 更新官方当前型号并迁移仅由旧内置默认产生的值 | 是 |
| 无实时模型目录 | 中 | 没有 models API 路由或 UI | 下一次下线后再次过期 | 静态列表被当成长期兼容 | 使用当前用户凭据请求服务商 `/models`，明确失败，不静默伪造 | 否 |

## 官方接口基线（核对于 2026-08-13）

- OpenAI：默认 `gpt-5.6-terra`；官方仍提供 Chat Completions，但建议复杂工具与多轮工作流使用 Responses API。本应用本轮保留各服务商共同支持的 Chat Completions 正式链，不把“推荐迁移”误报为“接口已停用”。
- DeepSeek：`https://api.deepseek.com`，默认 `deepseek-v4-flash`；`deepseek-chat` 与 `deepseek-reasoner` 已于 2026-07-24 停用。
- SiliconFlow：`https://api.siliconflow.cn/v1`，默认 `deepseek-ai/DeepSeek-V3.2`；模型目录通过 `/models` 动态读取。
- Kimi：`https://api.moonshot.cn/v1`，默认 `kimi-k2.6`。
- 智谱：`https://open.bigmodel.cn/api/paas/v4`，默认 `glm-5.2`。
- Gemini OpenAI compatibility：`https://generativelanguage.googleapis.com/v1beta/openai`，默认稳定版 `gemini-3.6-flash`。
- Ollama：`http://127.0.0.1:11434/v1`，新安装默认 `qwen3.5:9b`；实际可用型号必须以本机 `/models` 返回为准，不自动替换旧设备已安装的本地模型。

## 设计不变量

### PDF

- 原 PDF 字节仍是版式权威来源，不改写、不压缩、不 OCR 覆盖。
- 原始版式视图必须继续由 PDF.js Canvas 渲染，同时使用 TextLayer 提供真实 DOM 文本选择。
- 结构块必须由正式上传入口生成并持久化；不能只在浏览器临时生成后用于展示。
- 每个 PDF 文本项必须能追溯到页码、PDF text-item 索引、边界、块内偏移和内容哈希。
- Tip 创建必须使用持久化 PDF blockId；服务端仍验证 `content.slice(start,end)===selectedText`，不能放宽为只信客户端。
- 本轮只在至少三行、至少两列、列起点稳定且行距合理时允许几何表格推断；单行或双行多栏内容一律保持文本，避免 fabricated replacement。
- 几何表格必须标记 `heuristic` 与置信度；低置信度内容保持文本，不能 fabricated replacement。
- 图像块必须来自 PDF 绘制操作，包含页码、操作索引、对象 ID（如存在）和 PDF 坐标边界；结构化视图失败时显示明确错误，不用无关占位图。
- 扫描 PDF 没有字符映射时保持图片，不生成虚构文本；OCR 不属于本轮。
- 旧 PDF 迁移必须绑定结构版本；成功后不会每次启动重复解析，失败必须记录状态而不是伪造完成。
- 原始版式与结构化视图共用同一文档和 Tip 数据，不产生两套互相漂移的 PDF 内容。

### API 服务商

- 前后端必须消费同一个注册表，不得再复制默认 URL/model。
- 注册表包含版本、核对日期、服务商标签键、URL、当前默认模型、已知退役默认值和替换值。
- 只自动迁移能证明由旧内置 preset 产生且现已停用的精确值；自定义 URL、模型和本机 Ollama 模型保持不变。
- `/models` 刷新使用用户当前草稿中的 URL/Key，不保存 Key，不消耗聊天调用；返回必须来自真实服务商响应。
- 模型目录失败时明确显示 HTTP/兼容性错误；不得用静态默认数组伪装成刷新成功。
- 英文模式下 provider 标签、刷新按钮、更新时间、弃用警告和连接检查结果不得包含中文内置文案。
- 远程自定义 URL 仍必须使用 HTTPS；localhost 例外仅用于本地 Ollama/兼容服务。

## 非目标与框架边界

- 不实现 OCR，不把扫描图片猜测成文字。
- 不承诺所有未标记 PDF 都能无歧义恢复复杂跨页表格、合并单元格或阅读顺序；这类情况保留原始版式并显示推断置信度。
- tagged PDF 结构树到单元格的完整映射尚未实现，标记为 `KNOWN_FRAMEWORK_GAP`；不能用当前几何表格 fixture 声称已覆盖所有带标签 PDF。
- 不编辑或写回 PDF，不处理签名、批注、表单填写。
- 不在没有用户 API Key 的情况下在线探测付费服务商模型目录。
- 不把 OpenAI Chat Completions 称为已废弃；本轮更新过期模型标识并提供动态目录，Responses API 的完整多服务商适配另行评估。

## 必须先失败的回归与负向测试

1. PDF fixture 同时包含中文段落、标题、2×3 表格、矢量线和嵌入图片；提取结果必须分别产生 text/heading、table、image 块。
2. 两列普通段落、单行多列文字和列起点不稳定的内容不得被识别为表格。
3. 结构提取失败不得返回 `complete` 或空结构成功；扫描 PDF 允许 `visual-only`，但不能生成虚构文本。
4. 正式 multipart 上传后数据库必须持久化结构块；重新启动后仍存在。
5. 旧 `blocks=[]` PDF 经启动迁移后产生结构版本；源文件缺失时明确记录失败。
6. TextLayer 的选择必须映射到真实 blockId 与偏移，并通过正式 Tip API；错误偏移仍返回 400。
7. 结构化视图必须存在真实 `<p>/<h*>`、`<table>` 和 `<img>`；只存在 Canvas 必须失败。
8. 原始版式两页 Canvas 视觉回归仍通过，加入结构层不得造成文字重影、错位或图片消失。
9. provider registry 前后端默认值完全一致；默认模型不得命中已知退役值。
10. 英文设置界面的所有 provider 选项和接口状态不得包含中文。
11. 模型刷新必须调用 mock `/models` 并返回真实列表；401、无效 JSON、空列表和不支持端点均明确失败。
12. 旧内置 DeepSeek/Moonshot/智谱/Gemini/SiliconFlow preset 迁移到当前替代值；custom 和 Ollama 旧模型不被改写。
13. 完整技能回归、桌面烟雾测试、依赖审计和 Windows 打包全部通过；若打包应用视觉/结构检查没有新鲜证据，则不得宣称该项通过。

## 预期接入等级

- PDF 语义结构必须达到 `LEVEL_5_PREDICTION_BEARING`：结构块由正式上传生成，被最终 DOM、Tip 创建、聊天上下文和持久化恢复真实消费。
- 接口注册表必须达到 `LEVEL_5_PREDICTION_BEARING`：改变注册表默认值会改变新设置和连接请求；真实 `/models` 响应会改变用户可选模型；语言会改变最终界面文案。
- macOS MAS 真机构建在 Windows 环境中仍标记 `NOT_CAUSALLY_VERIFIED`。

## 本轮验证结果

- `pnpm typecheck` 与生产构建通过。
- `pnpm skills:test` 全量通过：语义 PDF 产生 8 个持久化块，类型包含 heading、paragraph、table、image；旧 PDF 经正式启动迁移后获得同一结构版本。
- multipart 正式上传、鉴权原字节读取、跨用户拒绝、永久删除与 PDF 文本块 Tip 创建全部通过；读回 PDF 的 SHA-256 与上传字节一致。
- 表格 fixture 以 `heuristic` 和至少 0.75 置信度进入结构；单行双栏文字没有被误识别为表格；含 U+FFFD 的字符映射会使结构提取明确失败。
- 服务商注册表被前后端共同消费；mock `/models` 的两个型号改变最终 datalist，空列表返回 502，英文无效 URL 返回英文错误，自定义与 Ollama 配置不被自动迁移。
- Electron 源码态烟雾测试通过，验证英文服务商标签、PDF 结构化 `<p>/<table>/<img>`、原始版式两页 Canvas 与 TextLayer、嵌套 Tip 和安全存储。
- Windows x64 `AI Tip Setup 1.8.0.exe` 构建成功；解包应用通过结果文件回传内部完整烟雾测试，实际验证 PDF 结构化 DOM、两页原始 Canvas/TextLayer、嵌套 Tip、英文接口标签和安全存储。导出的两页 Canvas 与 Poppler 对同一原 PDF 的独立渲染均完成视觉检查：中文、表格、图片、分页无乱码、无裁切、无损坏占位。
- Mac App Store 构建、签名、沙箱和真机运行仍为 `NOT_CAUSALLY_VERIFIED`；必须在有 Xcode、证书与 provisioning profile 的 macOS 上继续验收。

## 最终接入等级

- PDF 结构提取、持久化、结构化 DOM、Tip 锚点和原字节版式链：源码态与 Windows 打包应用运行态均达到 `LEVEL_5_PREDICTION_BEARING`。
- 共享接口注册表、语言化设置、配置迁移和真实模型目录：达到 `LEVEL_5_PREDICTION_BEARING`。
- tagged PDF 结构树映射与 Mac App Store 产物：`KNOWN_FRAMEWORK_GAP / NOT_CAUSALLY_VERIFIED`。
