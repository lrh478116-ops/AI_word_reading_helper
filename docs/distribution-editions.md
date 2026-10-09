# 本地模型版与 API 版

同一仓库维护两个功能版本，构建策略在编译时写入前端和本地服务，再绑定桌面包。不能通过运行时环境变量把本地模型版切回 API 版。

| 能力 | 本地模型版 | API 版 |
| --- | --- | --- |
| 文档导入/编辑、PDF/OCR、递归 Tip/树 | 保留 | 原功能保留 |
| Skill 导入/管理、每项开关 | 保留 | 原功能保留 |
| 内置 llama.cpp、GGUF、Ollama | 支持，只允许本机 HTTP 回环模型接口 | 原功能保留 |
| 基础参考站点搜索 | 支持；默认关闭，搜索失败仍按文档回答 | 原功能保留 |
| 云模型配置、模型 API Key | 不支持，界面和后端都限制 | 原功能保留 |
| Tavily 配置/调用 | 不支持 | 原功能保留 |
| Prompt、Python、工具权限、账户/可选云存储 | 保留原规则 | 原功能保留 |

“本地模型版”不是承诺整个应用永不联网：模型下载、主动开启的基础搜索、用户选择的登录/云上传仍可能访问网络。这里仅限制推理模型和搜索 API 提供方。Skill 不能解锁额外提供方/网络权限；恶意改源码或自行部署会转发云请求的假本机服务器不属于本机端点校验能证明的边界。

## 分发差异

- Windows / 站外本地模型版：主页面邮箱上方显示“下载 API 版”。安装身份使用 `ltd.mijiu.aitip.local`，产品名 `AI Tip Local`，独立本地用户目录，不覆盖 API 版。
- Mac App Store 本地模型版：同样只允许本地模型和基础搜索，按开发者确认不显示 API 版下载链接；保留已提交 bundle ID `ltd.mijiu.aitip`。
- API 版：原应用身份和功能保留，只站外分发；共用的窗口恢复缺陷修复也生效。

旧云配置若被手工放入本地版数据目录，会明确显示已禁用；聊天在写入用户问题之前返回 `EDITION_SETTINGS_RESTRICTED`，要求用户选择并保存本机模型，不静默换用默认模型。旧密钥不解密、不消费；正常两版使用各自数据目录。

## 运行与构建

```powershell
pnpm desktop:start:local
pnpm desktop:start:api
```

构建目录分别为 `.edition-build/local-direct`、`.edition-build/local-mas`、`.edition-build/api-direct`。它们属于构建产物，不上传 Git。现有 `desktop:prepare` / `desktop:start` 继续对应 API 功能。

```powershell
pnpm desktop:dist:api:win
# 如已有真实下载地址，可配置；没有地址也能打包本地版：
$env:AI_TIP_API_DOWNLOAD_URL = 'https://你的真实下载地址/AI-Tip-API-Setup.exe'
pnpm desktop:dist:local:win
```

站外本地包不再被公开下载地址阻止。没有配置真实 URL 时，邮箱上方显示“API 版下载待发布”，不提供虚假超链接；配置后显示“下载 API 版”。`v1.12.17` 已在 [GitHub Releases](https://github.com/lrh478116-ops/AI_word_reading_helper/releases/tag/v1.12.17) 公开发布，本地版内置链接指向该 Release 的 `AI-Tip-API-Setup.exe`。Windows 固定下载资产名分别为 `AI-Tip-API-Setup.exe` 和 `AI-Tip-Local-Setup.exe`，产物分别在 `release/api-direct` 和 `release/local-direct`。构建命令只生成候选文件，不会自动发布 GitHub；后续版本仍必须先提供真实 Release URL 并独立完成发布验证。

在有正确证书/Provisioning 的 Mac 主机上：

```sh
pnpm desktop:dist:mas-dev
pnpm desktop:dist:mas
pnpm desktop:dist:api:mac
```

MAS 命令只能构建本地模型版且使用 universal。直接绕过包装脚本的 API+MAS 组合也会在启动时拒绝，不是通过隐藏界面或审核检测来切换版本。Windows 无法替代 Mac 签名、沙箱、GGUF 实际推理和审核验证。

## 验证与审核

`pnpm editions:test` 重新构建三种分发配置，运行真实 API/受控模型与 Electron 客户端、真实桌面启动入口回归。报告 `docs/changes/verification/editions-latest.json` 绑定运行 ID、源码/构建 SHA-256、实际退出码和输出；受控 HTTP/Electron 证据为 COMPONENT_CAPABILITY，真实模型与 macOS 为 NOT_CAUSALLY_VERIFIED。

Window → Show AI Tip / 窗口 → 显示 AI Tip 主窗口恢复同一页面；macOS 关闭时隐藏窗口，实际退出仍释放资源。`network.server` 保留给内置回环服务，不能直接删除。详细解释与英文草稿见 [审核回复说明](release/2026-10-08-app-review-response.md)，必须在真实候选 Mac 构建验证后使用，不能把旧提交描述为已修复。
