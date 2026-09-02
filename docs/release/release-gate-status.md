# 发布门禁状态（2026-09-02）

本文件只记录可验证状态；每次候选构建后必须更新证据，不继承旧版本的“已通过”。

| 门禁 | 当前状态 | 证据要求 |
| --- | --- | --- |
| 核心源码与回归测试 | 2026-09-02 全量回归与 Electron smoke 已通过，提交后需最终复跑 | 当前提交运行 `pnpm skills:test` |
| Windows 候选包 | 1.12.11 已重建，签名仍阻断正式发布 | 新版本安装器、桌面 smoke、产物 manifest 与哈希 |
| Windows Authenticode | `NOT_CAUSALLY_VERIFIED` | 安装器和主 EXE 均显示可信发布者且时间戳有效 |
| 公开支持/隐私/删除页面 | 已发布并由在线探针确认三个路径均为 200 | `https://lrh478116-ops.github.io/ai-tip-support-site` 与 `pnpm release:verify:online` |
| Supabase RLS / Storage / 删除函数 | 正式配置已审计，真实用户删除仍待最终验收 | Security/Performance Advisor、正式函数版本、一次性审核账户端到端删除 |
| Supabase 泄露密码保护 | `KNOWN_PLAN_GAP` | 官方文档说明仅 Pro 及以上；免费计划无法启用，应用侧最低新密码为 8 位 |
| 注册与找回邮件 | `NOT_CAUSALLY_VERIFIED` | 真实 SMTP 收到 6 位码，错误/过期/复用码失败，旧密码失效 |
| macOS universal 构建和沙箱 | `NOT_CAUSALLY_VERIFIED` | macOS 12+ 的 Intel 与 Apple Silicon 候选包实测 |
| Apple 签名 / App Store 上传 | `NOT_CAUSALLY_VERIFIED` | Developer ID / Mac App Distribution、provisioning profile、Transporter/App Store Connect 处理成功 |
| 商店截图 | 组件尺寸检查通过，候选准确性待验证 | 最终签名 macOS 候选包复拍并人工核对隐私内容 |
| ICP / APP 备案 | `KNOWN_FRAMEWORK_GAP` | 真实运营主体、域名、境内接入商和主管部门编号 |

任何 `NOT_CAUSALLY_VERIFIED` 或 `KNOWN_FRAMEWORK_GAP` 都不能被字段存在、mock、fixture 或旧包结果替代。
