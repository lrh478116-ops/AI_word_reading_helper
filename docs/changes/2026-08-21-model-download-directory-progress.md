# 本地模型下载目录与桌面下载进度

## 审计结论

当前本地模型页已经消费 Ollama `/api/pull` 的 `completed` 与 `total`，但下载只显示在底部小型 dock；页面展示的存储路径来自 `OLLAMA_MODELS` 或平台默认推断，用户没有原生目录选择入口。更重要的是，客户端即使增加一个目录文本框，现有服务端也不会读取它，Ollama `/api/pull` 也没有单次下载目标目录参数，因此这种界面修改只会达到 `LEVEL_2_RECORDED`，不会改变真实落盘位置。

Ollama 官方路径语义是：模型目录由 Ollama 进程启动时的 `OLLAMA_MODELS` 决定；Windows 与 macOS 的桌面 Ollama 修改后需要重启。为避免只显示假路径，本次使用以下正式链路：

```text
模型与来源
→ Electron 原生文件夹选择器
→ 主进程签发一次性目录选择令牌
→ 普通 Windows/macOS 构建以 OLLAMA_MODELS=所选目录启动受管 Ollama serve
→ 设置本机受管回环端口
→ 服务端重新读取运行时
→ destinationPath 必须严格等于当前运行时目录
→ /api/pull 真实下载
→ completed/total 进入桌面下载面板
→ /api/show + /api/tags 验证
→ 自动接入 Tip 正式聊天
```

## 已确认问题

| 问题 | 严重程度 | 当前行为 | 错误验收风险 | 统一修复方向 | 阻止发布 |
| --- | --- | --- | --- | --- | --- |
| 没有原生目录选择 | 高 | 只能接受默认目录 | 把显示路径误称为可选择路径 | Electron `dialog.showOpenDialog(openDirectory)` | 是 |
| 下载接口不消费目录 | 严重 | `/api/pull` 完全由现有 daemon 决定落盘 | UI 有路径但模型仍写入 C 盘 | 受管 Ollama 继承 `OLLAMA_MODELS`，服务端强制目录一致 | 是 |
| 进度信息不足 | 中 | 仅百分比和 Ollama 状态字符串 | 大文件下载无法判断已下载量、速度和剩余时间 | 独立下载对话框显示字节、速度、ETA、路径与取消 | 否 |
| 任意路径可能被伪造 | 高 | 尚无路径参数 | 恶意 renderer 可能把任意路径交给主进程 | 只接受原生选择器签发的一次性令牌；服务端仅接受当前运行时目录 | 是 |
| App Store 沙箱不能启动外部 Ollama | 高 | 当前只依赖外部 daemon | 假装选定目录已生效 | `process.mas` 明确阻止受管运行时并提示配置外部 Ollama | 是 |

## 设计不变量

1. 路径选择必须来自 Electron 原生目录对话框，网页或 renderer 不能任意命令主进程启动目录。
2. 一次性选择令牌只能消费一次，过期、伪造或重复使用必须失败。
3. `destinationPath` 缺失或与当前 Ollama 运行时目录不一致时，下载正式入口必须失败，且不得调用 `/api/pull`。
4. Ollama `/api/pull` 请求体不伪造不存在的 `destination` 字段；路径通过受管进程的 `OLLAMA_MODELS` 生效。
5. 受管 Ollama 只监听随机的本机回环端口，不开放局域网地址。
6. 下载完成仍必须经过 `/api/show` 与 `/api/tags`，路径选择不能绕过既有安装验证。
7. 进度必须来自本轮 `/api/pull` 原始事件；界面可计算速度与 ETA，但不能伪造完成字节数。
8. 取消下载必须中止当前 HTTP 流；失败或取消不得修改模型设置。
9. 受管运行时配置只保存在当前设备，不上传 Supabase。
10. Mac App Store 无法启动第三方运行时时必须明确失败，不能 silent fallback 到默认目录或开发者 API。

## 非目标与已知边界

- 模型由多个 manifest/blob 文件组成，不伪装为一个可任意命名的单独 EXE 文件；用户选择的是模型目录，而不是单文件名。
- 不修改用户已经运行的系统 Ollama 进程，不强制结束托盘应用；选择非当前目录时启动 AI Tip 专用回环实例。
- 当前没有把 Ollama 二进制打进安装包；本机必须已经安装可执行的 Ollama CLI。
- Mac App Store 若要在沙箱内完全自动管理自定义目录，需要把经过签名和审核的推理运行时随 App 分发，这是 `KNOWN_FRAMEWORK_GAP`。

## 回归与反事实测试

1. 缺少 `destinationPath` 时返回 `MODEL_DESTINATION_REQUIRED`，且 `/api/pull` 调用数不变。
2. 路径不是绝对路径时拒绝。
3. 绝对路径与当前运行时 `OLLAMA_MODELS` 不一致时返回 `MODEL_DESTINATION_NOT_ACTIVE`，且 `/api/pull` 调用数不变。
4. 正确目录进入 start/progress/done 原始事件，`completed/total` 可追溯到 mock Ollama。
5. 下载完成事件、运行时状态和设置均记录同一目录及模型 lineage。
6. 伪造、过期或重复目录令牌不能启动受管 Ollama。
7. 桌面烟测必须看到目录选择对话框、路径字段、已下载量、速度/ETA 区域和取消入口。
8. 删除目录消费或把服务端改回忽略目录后，测试必须失败。

## 最终验收证据（2026-08-21）

- `COMPONENT_CAPABILITY`：受管运行时测试确认 `spawn(executable, ["serve"], { shell:false })` 的环境真实包含所选绝对目录 `OLLAMA_MODELS` 和随机回环 `OLLAMA_HOST`；同目录不会重复 spawn，设备配置可恢复，CLI 缺失与 MAS 自定义目录均明确失败。
- `FORMAL_PATH_INTEGRATION`：正式下载接口把缺失、相对或与当前运行时不一致的目录分别拒绝为 `MODEL_DESTINATION_REQUIRED`、`INVALID_MODEL_DESTINATION`、`MODEL_DESTINATION_NOT_ACTIVE`，这些负向请求的 `/api/pull` 调用数保持为零。
- `LEVEL_5_PREDICTION_BEARING`（受控 Ollama）：正确目录进入 `start → aggregate progress → verified → done`，原始 `completed/total` 被聚合为下载字节进度；随后 `/api/show` 与 `/api/tags` 验证、设置自动切换、本地 `/v1/chat/completions` 回答及 model lineage 均通过。删除模型后正式聊天再次失败。
- Electron 桌面烟测确认下载来源按钮打开独立下载对话框，原生选择返回的目录进入只读路径字段，界面包含已下载量、速度、ETA、进度条和取消；伪造与重复目录令牌被拒绝。
- `pnpm skills:test` 全量通过，既有文档、PDF/OCR、Word 表格、递归 Tip、联网、Python 与 Supabase 回归未被破坏。
- Windows 1.10.0 `win-unpacked` 安装后代码完成同一桌面烟测，结果包含 `localModelNativeDirectory=true`、`localModelDirectoryTokenSecurity=true`、`localModelDetailedProgress=true`。

当前测试机仍未安装真实 Ollama CLI，也没有执行多 GB 公网模型拉取，因此真实磁盘吞吐、代理、断点恢复与 GPU 推理属于 `INDEPENDENT_EVALUATION: NOT_CAUSALLY_VERIFIED`。受控进程环境、Ollama 协议与最终 Tip prediction lineage 已验证，但不能据此宣称所有真实设备下载性能均已通过。
