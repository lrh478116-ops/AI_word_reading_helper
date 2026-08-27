# Supabase 云账户与文档同步接入

## 审计结论

Supabase 项目 `AI_reading_helper`（项目 ref `kaqonqxygajosgddhmaq`）存在且状态健康，但当前 `public` schema 没有表、没有迁移、没有 Storage bucket。应用正式入口仍然是：

```text
本机注册/登录 → 本机 bcrypt 用户 → 本机 JWT
→ data/store.json → data/uploads → 最终文档/Tip/回答
```

Supabase 没有被登录、鉴权、文档、Tip、原文件或最终回答主链读取，当前仅为 `LEVEL_0_DEFINED`，不能称为已经连接。

## 统一架构

应用保留两个不可混淆的运行模式：

1. **云账户模式**：普通注册和登录使用 Supabase Auth；文档与 Tip 使用带所有权 RLS 的 Data API；导入的 TXT、Markdown、DOCX、PDF 原文件进入私有 Storage；本机保存工作缓存与离线原文件副本。
2. **仅本地模式**：`demo@aitip.local` 继续使用本机 JWT、JSON 与 uploads；不能调用 Supabase Auth、Data API 或 Storage。

AI 模型 Key、Tavily Key、自定义 Prompt 与接口设置不是云同步数据。它们继续按 Supabase 用户 ID 隔离保存在当前设备，并由 Electron `safeStorage`/系统凭据加密，不能进入 Data API、Storage、安装包或日志。

## 数据设计

- `public.ai_documents`：`id`、`user_id`、完整文档 `payload`、可选 `source_path`、`updated_at`。
- `public.ai_tips`：`id`、`user_id`、`document_id`、完整 Tip/消息/技能轨迹 `payload`、`updated_at`。
- `storage.buckets/ai-document-files`：私有原文件；对象路径固定为 `<auth.uid()>/<documentId>/<filename>`。
- 两张表与 Storage 对象均只向 `authenticated` 授予必要权限，并用 `auth.uid() = user_id` 或首级目录等于 `auth.uid()` 的 RLS 策略限制所有权。
- 不向 `anon` 授予业务表权限；不在客户端或本机服务器中使用 `service_role`/secret key。

## 设计不变量

- 桌面安装包只包含 Supabase publishable key。publishable key 不是秘密，但只有与 RLS 和最小 GRANT 同时存在时才安全。
- 云用户的 Bearer token 必须由 Supabase `/auth/v1/user` 验证；不能只解码 JWT 或相信 `user_metadata`。
- 设备本地 JWT 只能认证本地账户；即使其 `sub` 恰好等于缓存的 Supabase 用户 ID，也必须拒绝，不能绕过 Supabase 权威验证读取云账户的本机缓存。
- access token 到期时只能用当前设备保存的 refresh token 更新，刷新失败必须退出云会话，不得降级成其他用户或本地 demo 用户。
- 普通云请求必须先拉取该用户的云快照，再执行本轮变更；本轮实际变化的文档/Tip 必须在响应成功前写入 Supabase。
- 永久删除文档、级联删除 Tip 和原文件必须有显式云删除路径，不能只删本机缓存。
- 原文件下载必须经过用户 RLS；不能生成公共 bucket 或长期公开 URL。
- 超过 6 MB 的原文件必须使用 Supabase 官方 TUS 路径按 6 MB 分块上传；应用不重新引入固定 10 MB 限制。Storage 永久删除必须调用 Storage API 的 `remove` 语义，不能直接删除 `storage.objects` SQL 行。
- 云故障不得静默声称“已同步”。写操作失败时返回明确错误；本地模式不受云故障影响。
- 不把整个本机 `store.json` 上传；本机用户密码哈希、设备密钥、模型 Key、搜索 Key与设置永不进入云 payload。
- 兼容 2026 年 Data API 默认权限变化：迁移必须显式 `GRANT`，且公开 schema 的每张业务表都必须启用 RLS。

## 非目标

- 本次不把既有本地 demo 文档自动迁移到任意云账户，避免把本机私有内容上传给错误账号。
- 本次不提供离线编辑后的多主合并；云账户要求联网写入，采用每次变更前拉取、按行 `updated_at` 更新的最后写入策略。
- 本次不上传模型 API Key、Tavily Key、Prompt 或反馈邮箱配置。
- 本次不创建或打包 Supabase service-role key。

## 先失败的测试与反事实

1. 仅本地按钮登录、创建文档、Tip 与聊天时，Supabase mock 请求数必须为 0。
2. 普通注册必须调用 Supabase `/auth/v1/signup`；普通登录必须调用 `/auth/v1/token?grant_type=password`，旧本地 bcrypt 路径不得冒充云登录。
3. 云 Bearer token 必须调用 `/auth/v1/user` 验证；伪造 token 即使含用户 ID 也必须返回 401。
4. access token 过期后，客户端必须用 refresh token 调用正式刷新入口并重试原请求；刷新失败必须清空会话。
5. 云用户创建/编辑文档、创建/重命名/删除 Tip 与写入聊天后，对应 Data API 行必须变化；删除上游同步函数后，正式响应不得仍宣称成功。
6. 导入原文件必须写入私有 Storage；删除本机缓存后重新读取 PDF 时必须从 Storage 恢复相同字节。
7. 设置中保存带标记的模型/Tavily Key 后，所有 Supabase 请求体、表 payload 和 Storage 对象都不得出现该标记。
8. 两个不同 `auth.uid()` 的数据库反事实中，A 不能读取、更新或删除 B 的文档/Tip/Storage；`anon` 不能访问业务表。
9. Data API 缺少 GRANT、RLS 关闭、Storage bucket 公开或策略缺失任一条件都阻止安全验收。
10. 云端不可达时，云写操作必须明确失败；同一故障下注入本地模式仍必须完成本地文档保存。
11. 超过 6 MB 的真实 PDF 必须经过 TUS 创建和 PATCH 分块后逐字节一致恢复；永久删除必须命中 Storage `remove` 接口并使对象不可再读取。

## 验收等级

只有下面整条链路产生新鲜证据，才能判定云同步达到 `LEVEL_5_PREDICTION_BEARING`：

```text
Supabase Auth 身份
→ Supabase 验证 token
→ RLS 绑定 auth.uid()
→ 云文档/Tip 被正式入口拉取
→ 本轮编辑改变 Data API 行
→ 新设备/清空本机缓存后重新拉取
→ 最终界面显示同一文档、Tip 与消息
```

只证明表存在、请求出现、trace 有 `cloud` 字段或 mock 返回成功，最多属于 `COMPONENT_CAPABILITY`，不得当作真实 Supabase 端到端验收。

## 2026-08-16 实施后证据

### COMPONENT_CAPABILITY

- `supabase/schema.sql` 已应用到项目 `kaqonqxygajosgddhmaq`，远端迁移版本为 `20260816052618` 与 `20260816053253`。
- `ai_documents`、`ai_tips` 均启用 RLS；私有 bucket `ai-document-files` 的 `public=false`、`file_size_limit=null`。
- Supabase Security Advisor 为 0 项；Performance Advisor 仅报告新建空表索引尚未使用的 INFO，不是安全或执行阻断。
- 只带 publishable key、没有用户 JWT 的真实 Data API 请求返回 HTTP 401。
- 真实数据库事务中的 `authenticated` 角色反事实已验证：A 不能 SELECT/UPDATE/DELETE B 的行，伪造 B 的 INSERT 被拒绝；A 对自己的 INSERT/UPDATE/DELETE 成功。事务最终回滚，没有留下测试用户或业务数据。
- Storage 的真实 RLS 事务验证了跨用户 INSERT/SELECT 被拒绝及本用户 INSERT/UPDATE；DELETE 由 Supabase 的保护触发器强制要求走 Storage API，因此通过策略检查和应用侧 `remove` 接口测试覆盖，未直接删除 `storage.objects`。

### FORMAL_PATH_INTEGRATION

`scripts/test-supabase-integration.mjs` 从应用正式 HTTP 入口执行了注册、Supabase token 权威验证、文档编辑、Tip 创建、最终回答、私有原文件上传/下载、access token 刷新、清空本机缓存后的云恢复、永久删除和云故障注入。测试还反事实验证了：

- “仅本地使用”的全部操作产生 0 个 Supabase 请求；
- 伪造 token 被拒绝；
- 使用设备 JWT 签名但把 `sub` 伪造成云用户 ID 的旁路被拒绝；
- 删除云写入后，正式请求不能继续声称成功；
- 模型 Key 与 Tavily Key 标记没有出现在 Data API 或 Storage；
- 超过 6 MB 的 PDF 必须出现 TUS POST/PATCH，并逐字节恢复；
- Storage 永久删除必须命中 bucket 级 `remove` 请求；
- 云故障阻断云写入，但不阻断本地模式。

该正式路径集成在可控 Supabase 协议服务器上达到 `LEVEL_5_PREDICTION_BEARING`，并随完整 `pnpm skills:test` 回归执行。

### INDEPENDENT_EVALUATION 边界

真实 Supabase 项目的 schema、GRANT、RLS、bucket、策略、匿名拒绝和数据库反事实已有新鲜证据。2026-08-17 的真实 Auth 日志进一步证明普通注册返回 200、确认邮件发出且用户完成邮箱确认；真实重复注册也已通过 App 正式入口返回 `ACCOUNT_EXISTS`。但尚未在另一台设备完成“创建文档/Tip → 清空另一设备缓存 → 恢复相同结果”的独立任务，六位码邮件也受 Free 默认 SMTP 模板限制。因此生产环境的跨设备整链与邮件 OTP 仍标记为 `NOT_CAUSALLY_VERIFIED`，不能用 mock、单设备 Auth 日志或数据库组件测试替代。
