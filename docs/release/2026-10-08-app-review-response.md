# 2026-10-08 审核整改与回复草稿

原审核 Submission ID：5ae3a491-d2ca-4da3-af86-054df68145ce；审核设备 MacBook Air (15-inch, M2, 2023)。这里不把 Windows 受控测试当作已提交 Mac 二进制的证据。

## 3.1.1 与 2.1：提交本地模型版，不提供付费 API 解锁

新 MAS 构建只支持内置 llama.cpp、本机 Ollama 和基础参考搜索。移除在线模型/API Key、Tavily Key 输入；后端也拒绝写入/测试云接口、使用旧密钥或通过环境变量恢复在线模型。用户 Skill 仅为可编辑文本指令，不是付费授权或任意执行代码。MAS 不出现 API 版下载导流；站外版本的行为不能用审核状态动态控制。

以下英文只能在真实 Mac 候选构建核验并重新提交后使用，不能回复为旧 1.0(1) 已具备这些修复：

> We will submit a revised Local Model Edition for the Mac App Store. It removes cloud model providers and all model/search API-key entry points. The backend also rejects these configurations. AI inference uses on-device models; basic reference search does not require a paid search service. This build contains no link promoting the separately distributed API Edition, no license-key unlock, and no purchase requirement for these features.
>
> A demo cloud-model API key is not applicable to the revised local-only build. For review, choose “Local use only”, import the supplied sample document, then open AI Settings → Local Models. Import the supplied compatible GGUF file or download a listed ungated model from its displayed official repository. Select source text and open a Tip to test inference. We will provide the exact tested model artifact, size, official download link, sample document and steps in the private App Review Notes.

尚需开发者在 Mac 真机验证模型文件及路径，选择无需账户/许可登录的模型供审核。当前未附送实际 GGUF 或假 demo key；大文件/慢下载不能冒称完整审核可用性。需要重新上传 binary，并按 Apple 提示处理 Developer Reject/版本号/Build Number。

## 2.4.5(i)：network.server 的必要性

不要直接删除：当前主进程 `bootServer` 调用 `startServer(0, "127.0.0.1")`，渲染窗口通过该随机回环端口访问内置文档与 Tip 服务（导入、读取、保存、PDF/OCR、Skill 管理）。内置 llama.cpp helper 同样仅监听随机 `127.0.0.1` 端口。没有对公网或局域网提供服务；不存在远端用户访问该端口的功能。

> The com.apple.security.network.server entitlement is used by two on-device loopback services. The app starts its bundled document service on an OS-assigned port bound only to 127.0.0.1. Its own renderer connects to this service to import, render and save documents, manage source-anchored Tips and user Skills. The bundled local model helper also binds to 127.0.0.1 for on-device inference. Neither service binds to 0.0.0.0 nor exposes a public/LAN server. These services are needed to reproduce the reading workflow after entering Local use only. The network.client entitlement is used to connect to these loopback services and, only when enabled, to reference sites/model download sources.

上文是代码架构解释；提交前用 Mac 打包候选 `lsof -nP -iTCP -sTCP:LISTEN` 确认实际监听地址，并检查主 app/helper 的签名和 entitlement，不能只引用 Windows 结果。

## Guideline 4：恢复主窗口

新增 Window → Show AI Tip（中文：窗口 → 显示 AI Tip 主窗口），快捷键 Cmd+Shift+O。macOS 关闭主窗口时隐藏而不是销毁，因此保持编辑/阅读状态；Dock activate 与菜单都恢复同一窗口。实际退出依然关闭资源。Windows 保留关窗退出习惯。

> The revised app includes Window → Show AI Tip (Cmd+Shift+O). On macOS, closing the main window retains the app window in a hidden state, preserving the reading/editing session. The Window menu item or clicking the Dock icon reopens that window. Quit still exits the application normally.

只有 macOS 真机执行关窗、菜单、Dock 和 Cmd+Q 检查之后才可声称该候选已验证。

## 正式发布阻断项

- Mac 真机、沙箱、universal helper 签名：NOT_CAUSALLY_VERIFIED。
- 新商店 binary 上传、版本号/Build Number 与审核备注：未执行。
- Reviewer 本地模型实际下载/导入和推理：NOT_CAUSALLY_VERIFIED。
- Apple 是否接受最小网络服务用途及功能拆分：只能由审核确认，不保证通过。

依据：[Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)；[network.server entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.network.server)。
