# 无 API Tip 门禁与本地模型自动接入

## 审计结论

当前正式 `POST /api/tips/:id/chat` 路径在确认模型是否可用之前就持久化用户消息；未配置模型 API 时，随后调用 `demoAnswer` 生成看似来自 AI 的回答，并把消息模型记录为 `demo`。前端 Tip 面板既不读取模型运行状态，也没有进入本地模型下载流程。因此现状最多属于 `LEVEL_1_INVOKED` 的演示路径，不能称为真实模型接入。

本次统一修复以下架构断点：

```text
Tip 打开
→ 读取当前用户的模型设置
→ 云 API Key / Ollama 运行时与已安装模型校验
→ 未配置：只显示配置提示，不写入聊天消息
→ 选择本地模型与下载来源
→ 用户确认
→ 本地 Ollama /api/pull 流式下载
→ /api/show 与 /api/tags 验证模型真实存在
→ 保存 provider=ollama、模型名与本地 OpenAI 兼容接口
→ Tip 正式聊天调用该模型
→ 最终消息的 model 与回答内容可追溯到已下载模型
```

## 已确认问题

| 问题 | 严重程度 | 当前实际行为 | 错误验收风险 | 统一修复方向 | 阻止下一阶段 |
| --- | --- | --- | --- | --- | --- |
| 无模型时仍生成 `demoAnswer` | 严重 | 用户会得到伪 AI 回答 | 把静态模板误认为本地模型 | 服务端在任何消息写入前返回 `MODEL_NOT_CONFIGURED`，删除正式入口演示分支 | 是 |
| 用户消息先于模型校验落库 | 严重 | 失败请求污染 Tip 历史 | UI 看似失败但聊天状态已变化 | 前移模型可用性检查；失败时消息数量保持不变 | 是 |
| Tip 面板不消费模型状态 | 高 | 只能发送后才看到错误 | 组件存在但不可发现、不可操作 | Tip 直接显示“设置 API / 下载本地模型”两个入口 | 是 |
| 本地模型只有手填 Ollama 设置 | 高 | 没有模型目录、确认、进度或自动接入 | 下载链接可能不产生可用接口 | 内置受控目录，通过 Ollama API 拉取并验证后自动保存设置 | 是 |
| 用户给出的部分量化大小与官方包不一致 | 中 | Llama 1B 把 Q8 1.3GB 当 Q4；Gemma 4 E2B/E4B 明显低估 | 用户按错误磁盘/RAM 预算下载 | 展示核对后的实际下载量与量化类型 | 否 |
| “清华镜像”缺少可验证的 Hugging Face 权重镜像 | 高 | 若硬编码会成为不可用或冒名通道 | 下载失败或来源误导 | 使用可验证的 `hf-mirror.com`，明确标注“国内镜像，非清华 TUNA” | 是 |
| 新鲜环境没有推理运行时 | 高 | 单独 GGUF 不能提供聊天 API | 文件已下载却谎称接入成功 | 只在本机 Ollama 可达时允许下载；不动态执行未经签名的运行时 | 是 |

## 模型目录与核对值

目录固定为 11 个模型，但不保留已经被官方数据否定的大小。大小是下载包近似值，不等于运行时峰值内存。

| 档位 | 模型 | 本次默认量化/包 | 大致下载量 | RAM 建议 | GPU 建议 | 特点与优势 |
| --- | --- | --- | ---: | ---: | ---: | --- |
| 极轻量 | MiniCPM5-1B | Q4_K_M | 0.69GB | 8GB | 无需 | 中文、工具调用、代码与混合推理，低配置首选 |
| 极轻量 | Llama 3.2 1B | Q4_K_M | 0.81GB | 8GB | 无需 | 英文生态成熟，摘要、改写和端侧任务资源丰富 |
| 轻量 | Gemma 4 E2B | Q4_K_M | 7.2GB | 16GB | 6GB+ | 端侧 MoE、图文理解、思考模式与工具调用；“E2B”不是总参数量 |
| 轻量 | SmolLM3 3B | Q4_K_M | 1.92GB | 8GB | 无需 | Apache 2.0、开放 GGUF、长上下文；中文能力相对有限 |
| 轻量 | Llama 3.2 3B | Q4_K_M | 2.0GB | 8GB | 无需 | 指令遵循、摘要、提示词改写与工具生态成熟 |
| 主流甜点 | Phi-4-mini 3.8B | Q4_K_M | 2.5GB | 16GB | 4GB+ | 数学、逻辑、推理和 Windows 本地生态较好 |
| 主流甜点 | Qwen3.5-4B | Q4_K_M | 3.4GB | 16GB | 4–6GB+ | 中文、多语言、Agent、视觉、工具调用与思考模式均衡 |
| 主流甜点 | Gemma 4 E4B | Q4_K_M | 9.6GB | 16–32GB | 8GB+ | 更高有效容量的端侧 MoE，图文、推理、代码和 Agent 能力均衡 |
| 高端本地 | MiniCPM4.1-8B | Q4_K_M | 5.0GB | 16–32GB | 8GB | 中文端侧效率、混合思考与非思考模式 |
| 高端本地 | InternLM3-8B | Q4_K_M | 5.36GB | 16–32GB | 8GB | 中文、通用任务与深度推理；使用官方 Hugging Face GGUF |
| 高端本地 | Gemma 4 12B | Q4_K_M | 7.6GB | 32GB | 8–12GB | 更高推理、代码、Agent 与多模态能力 |

## 下载来源语义

- `Ollama 官方库`：调用本机 `POST /api/pull` 拉取官方模型标签。
- `Hugging Face`：仍由本机 Ollama 拉取 `hf.co/<repo>:Q4_K_M`，完成后由同一个本地 API 服务模型；不是只保存孤立 GGUF。
- `HF-Mirror 国内镜像`：调用 `hf-mirror.com/<repo>:Q4_K_M`。这是 Ollama 官方仓库维护者公开确认支持的镜像主机写法，但不是清华 TUNA。
- 页面不使用会跳出桌面应用的下载链接。下载来源必须是内置白名单，客户端不能传入任意 URL 或模型名。

## 设计不变量

1. 导入 TXT、Markdown、DOCX、PDF 不依赖模型 API 或 Ollama。
2. 未配置模型时，打开 Tip、创建 Tip 与浏览历史不受影响；只有发送聊天被禁止。
3. `MODEL_NOT_CONFIGURED`、Ollama 不可达、模型未安装时，不得新增用户或助手消息。
4. 下载按钮必须先显示包含模型、量化、大小、来源和磁盘提示的确认框。
5. 下载完成不等于接入完成；必须同时通过 `/api/show` 和 `/api/tags`，然后保存设置。
6. 设置成功后，聊天必须使用保存的 Ollama 模型名；最终消息不得记录为 `demo`。
7. 下载失败、取消、来源不可达或模型验证失败时，不得修改当前模型设置。
8. 下载进度不持有全局文档写锁，下载期间文档自动保存仍可完成。
9. Ollama 地址只允许本机回环地址；下载模型与来源均来自服务端目录，避免 SSRF 和任意 registry 拉取。
10. 模型存储路径优先读取 `OLLAMA_MODELS`；否则显示 Ollama 官方平台默认路径，并明确它是默认推断而非 API 返回值。
11. 云端用户的模型设置仍只保存在当前设备，不上传 Supabase。
12. macOS App Store 构建不动态下载并执行第三方推理二进制；Ollama 未安装或未运行时明确阻断，不能伪装成功。

## 非目标与已知框架缺口

- 不把 Ollama 二进制打进本轮安装包，也不在 macOS 沙箱内下载并执行未随 App 签名的运行时。
- 不静默切换到开发者 API Key、云端免费接口或 `demoAnswer`。
- 不保证小模型回答绝对正确；现有专业问题联网审查、来源和 Python 计算约束继续生效。
- 当前测试机没有安装 Ollama，因此真实多 GB 模型下载与推理属于 `INDEPENDENT_EVALUATION` 缺口；协议级正式入口可使用可控 Ollama 协议服务器验证。标记为 `KNOWN_FRAMEWORK_GAP / NOT_CAUSALLY_VERIFIED`，直到在装有 Ollama 的 Windows 与 macOS 设备各完成一次真实下载和 Tip 回答。

## 验收与负向测试

1. 无模型配置时导入真实 TXT 成功，并可创建 Tip。
2. 同一 Tip 发送消息返回 HTTP 409 + `MODEL_NOT_CONFIGURED`，消息数不变。
3. 删除 UI 门禁后直接调用 HTTP 仍被服务端拒绝。
4. 伪造模型 ID、来源 ID、下载 URL 或 `confirmed=false` 必须拒绝。
5. Ollama 不可达、`/api/pull` 报错、下载流中断、`/api/show` 失败、`/api/tags` 不含目标模型时，不得保存设置。
6. 只有 Action 被创建但模型未出现在 `/api/tags` 时，不得标记安装成功。
7. 下载过程中并发保存文档必须完成，证明没有被长下载占用全局写锁。
8. 成功拉取后设置必须变为 `provider=ollama`、本地 `/v1`、真实模型名。
9. 随后的 Tip 回答必须命中本地 `/v1/chat/completions`，最终持久化内容与模型 lineage 一致。
10. 反事实删除已安装模型后，状态变为不可用；后续聊天再次被拒绝且历史不变。
11. 旧 `demoAnswer` 路径不得再影响正式聊天输出。
12. 完整测试、桌面烟测和安装包烟测必须使用本轮源码重新生成。

## 最终验收证据（2026-08-17）

- `COMPONENT_CAPABILITY`：11 项目录、服务端白名单、确认门禁、Ollama `/api/pull` NDJSON 进度、`/api/show` + `/api/tags` 双重安装验证、运行状态查询、前端进度与取消均通过 focused test。
- `FORMAL_PATH_INTEGRATION`：无模型时 `POST /api/tips/:id/chat` 在持久化用户消息之前返回 409；客户端禁用输入只是第一道门，直接 HTTP 绕过同样失败。文档导入与 Tip 创建仍成功。
- `LEVEL_5_PREDICTION_BEARING`（受控 Ollama 协议环境）：模型拉取成功并通过验证后，正式设置被写为 Ollama；随后 Tip 请求实际命中本地 `/v1/chat/completions`，持久化回答为 `LOCAL_MODEL_CAUSAL_ANSWER`，消息 model 字段为下载所得模型引用。删除 `/api/tags` 中该模型后，同一正式入口立即变为不可用且不新增消息。
- 桌面源码烟测：11 项模型页、无模型 Tip 门禁、服务端防绕过、真实受控模型回答、Word 表格、PDF 原版锚点、离线 OCR、递归 Tip、首次回答完整预览、系统密钥加密均通过。
- 安装包烟测：`release/win-unpacked/AI Tip.exe --smoke-test` 通过同一桌面验收集合。
- 全量回归：`pnpm skills:test` 通过，包含文档导入、PDF 锚点、递归 Tip、Python、联网与引用审计、Supabase 正式模型回答同步。

真实 Ollama 二进制和多 GB 模型未安装在当前测试机，因此真实 Windows/macOS 下载吞吐、磁盘不足、代理和模型推理质量仍为 `INDEPENDENT_EVALUATION: NOT_CAUSALLY_VERIFIED`。这不降低受控协议链的 LEVEL_5 结论，但会阻止宣称“所有真实设备下载均已验收”。
