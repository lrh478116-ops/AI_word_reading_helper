# 内置 GGUF 运行时与国内外双下载链路

## 只读审计结论

当前三个下载按钮并不是三条独立路径。正式入口最终都执行：

```text
目录选择
→ 主进程查找并启动外部 Ollama CLI
→ 服务端检查 Ollama /api/tags
→ Ollama /api/pull
→ /api/show + /api/tags
→ provider=ollama
→ Tip /v1/chat/completions
```

因此 Hugging Face 与 HF-Mirror 只改变传给 Ollama 的 `model` 字符串；没有 Ollama CLI 时，所有来源在发起模型下载前就失败。当前实现最多能证明 Ollama 协议组件能力，不能证明独立的国内/国外下载能力。

## 已确认问题

| 问题 | 严重程度 | 代码位置 | 当前实际行为 | 错误验收风险 | 统一修复方向 | 阻止发布 |
| --- | --- | --- | --- | --- | --- | --- |
| 所有来源强依赖 Ollama | 严重 | `electron/model-runtime.mjs`、`POST /api/local-models/download` | CLI 缺失时在下载前失败 | 把多个按钮误称为多条下载链路 | 随 App 打包并签名 llama.cpp；模型作为 GGUF 数据直接下载 | 是 |
| App Store 路径依赖外部进程 | 严重 | `ManagedOllamaRuntime.activate` | MAS 自定义目录被明确阻断 | Windows 可用但苹果商店版不可用 | 推理 helper 在构建时进入 App 并随主程序签名，不在运行时下载代码 | 是 |
| 没有可恢复的文件下载 | 高 | Ollama `/api/pull` 黑盒 | App 无法校验目标 GGUF 的单文件大小、摘要及头部 | 下载完成事件可能不等于可执行权重 | `.part`、Range 续传、固定大小/SHA-256、GGUF magic、原子重命名 | 是 |
| 国内镜像来源不够可信 | 高 | `hf-mirror` 目录项 | 第三方镜像且没有逐文件摘要 | 供应链替换或陈旧文件 | 国内使用模型作者在 ModelScope 的官方仓库；国外使用 Hugging Face 官方仓库 | 是 |
| 没有离线导入 | 中 | preload/主进程 | 网络受限时没有可靠路径 | 用户被迫安装另一个运行时 | 原生文件选择器导入本地 `.gguf`，同样执行头部与运行时验证 | 否 |
| `provider=ollama` 混淆运行时 | 高 | 设置与状态门禁 | 内置 llama.cpp 会被 `/api/tags` 误判不可用 | 文件和进程存在但 Tip 仍被阻断 | 增加 `provider=local`，通过 `/v1/models` 验证当前模型 | 是 |

## 正式设计

```text
内置白名单模型与不可变 artifact 元数据
→ 用户选择 ModelScope / Hugging Face / 本地 GGUF
→ 原生目录或文件选择令牌
→ 直接下载到 <模型>.part（支持 HTTP Range）或读取本地文件
→ 大小 + SHA-256（目录下载）+ GGUF magic 验证
→ 随 App 分发的 llama-server 仅监听随机 127.0.0.1 端口
→ /v1/models 验证模型别名
→ 保存 provider=local、回环 baseURL、模型 ID
→ Tip 正式入口重新验证 /v1/models
→ /v1/chat/completions 的回答与消息 model 可追溯到该 GGUF
```

Ollama 保留在设置的高级接口中，但不再是“下载本地模型”页面的默认前置条件。

## 设计不变量

1. 运行时二进制只能来自构建时固定版本与 SHA-256 的 llama.cpp 官方 release；应用运行时不得下载、替换或执行网络代码。
2. Windows 包含 x64 CPU helper；macOS 构建分别包含 arm64/x64 helper，并在 universal/MAS 打包阶段签名。
3. 模型 URL 由服务端白名单构造，renderer 不能提交任意 URL、仓库、文件名或摘要。
4. 官方下载必须校验固定 revision、文件大小、SHA-256 和 `GGUF` 文件头；任一失败不得启动模型或修改设置。
5. 断点文件使用 `.part`；仅在完整验证后原子替换最终文件。
6. 来源失败不会静默切换到另一来源。界面保留用户明确选择，失败后可手动选择另一官方来源。
7. 本地文件导入不声称有供应链摘要，但必须验证绝对路径、`.gguf` 后缀、普通文件、GGUF magic，并由真实 llama-server 加载成功。
8. helper 仅监听 `127.0.0.1` 随机端口，`shell=false`；模型路径和别名作为独立参数传入。
9. 下载完成不等于接入完成；只有 `/v1/models` 返回目标模型后才能保存 `provider=local`。
10. 失败、取消、运行时退出、过期目录令牌、摘要不符、HTML 冒充 GGUF均不得改变现有模型设置。

## 非目标与边界

- 不保证小模型生成事实绝对正确；专业问题联网复核、政策审查与 Python 数值验证继续作为独立能力运行。
- 不自动下载 gated、许可不清或没有固定 GGUF 摘要的模型。目录可继续展示，但对应来源必须明确标为需要 Ollama/暂不可直接下载，不能伪造官方直链。
- 当前 Windows 设备可完成真实 helper 启动验证；macOS/MAS 的代码签名、公证及商店审核需要在 Apple 构建设备上完成，属于 `INDEPENDENT_EVALUATION`，未取得新鲜证据前标记 `NOT_CAUSALLY_VERIFIED`。

## 验收与反事实测试

1. 没有 Ollama CLI 时，选择目录仍成功，且不会 spawn Ollama。
2. helper 缺失、不是固定打包路径或退出时，必须失败且不写设置。
3. 伪造 model/source/URL/destination、过期或复用令牌必须拒绝。
4. ModelScope 与 Hugging Face 请求必须分别命中目录中固定 URL；任一失败不自动请求另一来源。
5. 206 响应必须从 `.part` 长度继续；忽略 Range 返回 200 时必须安全重写，不能重复拼接。
6. 大小、SHA-256、GGUF magic 任一不符必须删除最终候选、保留/清理可解释的 `.part`，且不启动 helper。
7. Action 仅创建但 `/v1/models` 没有目标别名时，不得标记已安装。
8. 成功后 Tip 回答必须命中内置 helper 的 `/v1/chat/completions`；移走 GGUF 或停止 helper 后同一入口必须失败且消息数不变。
9. 离线导入非 GGUF、相对路径、目录或加载失败文件必须拒绝。
10. 完整回归与新生成的 Windows 安装包烟测必须来自本轮源码；macOS 未执行时不得宣称商店验收通过。

## 本轮新鲜证据

- `COMPONENT_CAPABILITY`：固定版本 llama.cpp `b10545` 的 Windows helper 在源码目录与 `win-unpacked/resources` 中均真实执行 `--version`；运行时单测证明模型路径、回环端口和模型别名进入 spawn 参数，`shell=false`，非 GGUF 与 helper 缺失均被拒绝。
- `FORMAL_PATH_INTEGRATION`：正式 `POST /api/local-models/download` 对伪造模型、来源、未确认、未授权目录和 Ollama-only 来源均在网络请求前拒绝。ModelScope 测试请求真实消费 `.part` 的 `Range: bytes=9-`，随后经过大小、SHA-256、GGUF magic、`activateModel` 和 `/v1/models` 才保存 `provider=local`。
- `LEVEL_5_PREDICTION_BEARING`（受控 artifact 与真实服务端入口）：下载所得文件被运行时加载后，正式 Tip 请求的最终持久化回答为 `BUNDLED_GGUF_CAUSAL_ANSWER`，消息模型为 `aitip:minicpm5-1b`；停止运行时后同一入口返回 `LOCAL_RUNTIME_UNAVAILABLE` 且消息数不变。
- `INDEPENDENT_EVALUATION`（Windows 打包能力）：Windows 1.11.0 安装包包含官方 helper 和依赖，helper 可启动并报告 build 10545；安装包桌面烟测通过全部既有文档/PDF/OCR/Tip/Word/语言/工具回归。
- 完整 `skills:test` 的所有测试组分别通过；因统一命令的工具输出窗口在本地模型测试后截止，随后独立重跑联网/技能与 Supabase 两组并取得退出码 0。

仍未在本轮下载完整的 688 MB 公开权重并执行真实自然语言质量评测，也没有在 Apple 构建设备完成 universal MAS 签名、公证与商店安装。因此这两项仍为 `INDEPENDENT_EVALUATION: NOT_CAUSALLY_VERIFIED`，不能据受控小 artifact 测试宣称真实模型质量或 App Store 审核已经通过。Windows 产物当前也没有发行者 Authenticode 证书，正式对外发布前需要代码签名证书。
