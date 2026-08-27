# 官方模型渠道的客户端直连下载

## 只读审计结论

1. 当前目录的 ModelScope URL 是模型作者/机构仓库的公开 `resolve` 地址，实测重定向到 `cdn-lfs-cn-1.modelscope.cn`；Hugging Face URL 是固定 revision 的公开 `resolve` 地址，实测重定向到 `us.aws.cdn.hf.co`。没有使用 Supabase、AI Tip 发布服务器或自建对象存储。
2. 当前 `POST /api/local-models/download` 在桌面 App 中由用户电脑上的 `127.0.0.1` Express 服务执行 Node `fetch`。因此现有桌面版本不消耗发布者服务器带宽，但网络实现不是官网浏览器使用的 Chromium 网络栈。
3. 同一台机器对 16 MiB Range 的新鲜实测：ModelScope 官方 CDN 约 `1.95 MB/s`；Hugging Face 官方国际 CDN 约 `0.47 MB/s`。低于 1 MB/s 可以由来源/CDN/代理路径造成，不能仅根据速度推断经过发布者服务器。
4. 虽然非桌面部署因为没有 `localModelRuntimeController` 会在下载前返回 503，但“模型字节下载属于服务端路由”仍然容易造成架构误解，也不能复用 Electron 对系统代理、PAC、HTTPS 隧道和代理认证的原生支持。

当前接入等级：

- 官方 URL 白名单：`LEVEL_5_PREDICTION_BEARING`（固定 artifact 确实影响最终 Tip 模型）。
- 官网同等客户端网络栈：`LEVEL_0_DEFINED`，尚未接入。
- 发布者服务器零模型流量：桌面路径事实成立，但尚缺少“服务端 fetch 被禁止”的反事实测试，因此标记 `NOT_CAUSALLY_VERIFIED`。

## 统一修复

```text
renderer 只提交 modelId/sourceId/destinationPath
→ 本机 Express 校验登录、目录授权、模型和来源白名单
→ 构造与官网按钮相同的官方 resolve URL
→ 调用 Electron 主进程下载控制器
→ Electron net.request（Chromium 原生网络栈）
→ 手动验证每一级官方 HTTPS 重定向
→ 官方 CDN → 用户电脑 .part 文件
→ 大小/SHA-256/GGUF 验证
→ llama.cpp 加载与 /v1/models 验证
→ 本机 Express 只接收进度/最终校验信息并保存本地设置
```

模型数据不会进入 renderer，不会进入 Supabase，不会进入发布者云服务器，也不会从 Electron 主进程回传给本机 Express；本机 Express 只传递小型进度事件。

## 设计不变量

1. 只有 Electron 桌面主进程能够执行模型字节下载；没有主进程控制器的云端/网页服务必须在网络请求前返回 `BUNDLED_RUNTIME_UNAVAILABLE`。
2. 下载使用 Electron `net.request`，即 Chromium 原生网络栈，继承系统代理/PAC/HTTPS 隧道能力；不得静默回退到 Node `fetch` 或发布者代理。不能使用 `session.fetch(..., redirect: "manual")`，因为 Electron 43 会把手动重定向直接取消；必须消费 `net.request` 的 `redirect` 事件并在下一次请求前验证 Location。
3. 首个 URL 必须是目录中固定的官方 HTTPS `resolve` URL。renderer 不能提交 URL。
4. 手动检查每次 30x：只允许 `modelscope.cn` 子域、`huggingface.co`、`hf.co` 子域和 Hugging Face 官方 Xet 域；跳到任意其他域立即失败。
5. ModelScope 与 Hugging Face 是用户明确选择的两条路径；失败时不静默跨来源切换。
6. `.part`、Range、大小、SHA-256、GGUF magic 和原子重命名保持不变。
7. 断点续传请求收到 200 时必须从零安全重写；206 的 `Content-Range` 必须与本地偏移一致。
8. 进度事件必须标记 `networkStack=chromium`，并可显示初始官方主机、最终官方 CDN 主机及系统代理解析结果；不得把发布者服务器标成来源。
9. 下载失败、取消、非法重定向、摘要错误或运行时加载失败均不得修改模型设置。

## 负向与反事实测试

1. 把首个 URL 换成发布者服务器、IP、HTTP 或任意第三方域，Electron 下载器在调用 fetch 前失败。
2. 官方入口 302 到非官方域时失败，目标域请求次数为零。
3. 删除主进程 `downloadArtifact` 控制器后，正式 HTTP 入口在任何官方 fetch 前失败。
4. 让服务端全局 `fetch` 在遇到 ModelScope/Hugging Face 时直接抛错，正式下载仍应成功；否则说明模型字节仍经过服务端网络栈。
5. Chromium 下载控制器收到 Range 并写入固定目录；修改 `.part` 偏移、摘要、大小或 magic 均改变最终结果。
6. 下载成功后 Tip 必须仍由该 GGUF 产生；停止运行时后聊天必须失败且消息数不变。

## 非目标与边界

- 更换到官网同等网络栈不能保证任何地区都达到固定速度。实际吞吐仍由用户网络、代理、运营商、官方 CDN 负载和来源地区决定。
- 不使用多连接分片轰炸官方 CDN；保持与普通浏览器单文件下载相近的请求语义和 Range 恢复行为。
- 不把官方模型复制到发布者服务器“加速”，因此发布者带宽保持为零，但无法控制官方 CDN 的速度。

## 本轮验证结果

### COMPONENT_CAPABILITY

- `node scripts/test-electron-model-download.mjs`：通过。覆盖官方域名白名单、非官方首地址在 fetch 前拒绝、官方入口跳到攻击者域名时不请求攻击者、`.part` Range 续传、206 `Content-Range`、服务器忽略 Range 后从零重写、SHA-256 失败不生成最终文件。
- 真实 Electron 43 网络探针：通过。系统代理解析为 `DIRECT`；ModelScope 官方入口返回 `302`，Location 为 `cdn-lfs-cn-1.modelscope.cn`；验证域名后请求该官方 CDN，返回 `206`，读取的首个 31,880 字节以 `GGUF` 开头，随后立即取消探针，未下载完整模型。
- 反例：`session.defaultSession.fetch(url, { redirect: "manual" })` 在 Electron 43 的真实探针中返回 `Redirect was cancelled`，因此没有作为正式实现或通过证据；正式实现改用 `net.request` 的可审计 `redirect` 事件。

### FORMAL_PATH_INTEGRATION

- `node scripts/test-local-model-integration.mjs`：通过。测试把服务端 `globalThis.fetch` 对 ModelScope、Hugging Face 与 `*.hf.co` 全部设置为立即抛出 `SERVER_FETCH_MUST_NOT_DOWNLOAD_MODEL_BYTES`，正式 `/api/local-models/download` 仍完成固定 artifact → Electron 控制器 → 本地文件 → llama.cpp 加载 → 设置保存 → Tip 最终回答。
- 移除 Electron `downloadArtifact` 控制器后，同一正式 HTTP 入口在任何官方网络请求前返回 `BUNDLED_RUNTIME_UNAVAILABLE`；不存在 Node fetch、发布者代理或旧下载路径的 silent fallback。
- `done.download.networkStack` 必须为 `chromium`，且返回文件必须位于本轮原生选择器授权目录并使用目录中的固定 filename，否则正式入口拒绝激活。

### INDEPENDENT_EVALUATION

- `pnpm skills:test`：完整套件通过，覆盖文档/PDF/OCR/Word 表格/Tip 树/联网失败仍回答/Python/Supabase/本地模型与新下载负向测试。
- 开发目录桌面烟测：通过。
- Windows 1.11.1 `win-unpacked/AI Tip.exe --smoke-test`：通过；结果写入 `release/packaged-smoke-result-1.11.1.json`。
- 当前结论：在受控固定 GGUF 的正式 HTTP 入口测试中，官方客户端直连达到 `LEVEL_5_PREDICTION_BEARING`：Chromium 下载控制器产生本地 GGUF，实际被 llama.cpp 加载并生成 Tip 回答；移除控制器或停止运行时会改变最终结果并明确失败。真实 ModelScope 网络已独立验证到官方 CDN 的首个 GGUF 数据块。为避免额外消耗 688 MB 流量，本轮没有重新下载完整生产模型，因此“完整生产 artifact 下载 → 摘要校验 → 实际模型回答”的独立远端评估仍标记 `NOT_CAUSALLY_VERIFIED`，不能用受控 fixture 冒充这一项。

## 仍需发布者处理

- Windows 1.11.1 安装包当前 `Authenticode` 状态为 `NotSigned`。这不改变下载链路和服务器带宽结论，但正式公开分发前仍应使用发布者代码签名证书签名。
- 官方直连不等于固定高速。实测当前机器 ModelScope 明显快于 Hugging Face，因此中国大陆默认建议选择 ModelScope；不能把任一时刻的测速承诺为用户侧最低速度。
