# Supabase 云端源文件仅上传压缩包

## 结论与当前断点

当前正式导入链路仍把 PDF、DOCX、Markdown 和 TXT 的原始字节直接上传到私有 Storage。`ai_documents.source_path` 记录原文件对象路径，恢复入口把 Storage 响应直接写成本地原文件，永久删除也只删除该单一路径。

因此现状虽然已经达到“原文件可云端恢复”，但没有节省 Storage 容量：压缩组件尚不存在，属于 `LEVEL_0_DEFINED` 以下，不能称为已经接入压缩上传。

## 统一设计

新上传对象统一采用以下链路：

```text
原始导入字节
→ Node.js gzip（最高压缩等级）
→ `<auth.uid()>/<documentId>/source.<ext>.gz`
→ 按压缩后大小选择普通上传或 6 MiB TUS 分块
→ 私有 Supabase Storage（Content-Type: application/gzip）
→ 下载压缩对象
→ 严格 gzip 解压
→ 写回原扩展名的本地缓存
→ PDF/Word/文本正式读取入口
```

压缩必须封装在唯一的 `uploadCloudSource` 正式上传函数中，而不是由调用者自愿选择。任何新源文件云上传都不得绕过压缩。

## 设计不变量

- 云端新源文件对象只保存 `.gz` 压缩包；数据库 `source_path` 也必须指向 `.gz`。
- Storage 对象 MIME 固定为 `application/gzip`。原文件 MIME 只作为压缩包元数据，不得把压缩字节伪装成 `application/pdf` 或 DOCX。
- 普通上传与 TUS 上传的阈值使用“压缩后的实际上传字节数”。TUS 块大小严格保持 Supabase 要求的 6 MiB。
- 下载 `.gz` 对象必须严格解压。损坏或伪造的 `.gz` 必须明确失败，不能静默当成原文件继续解析。
- 旧版本已经上传的非 `.gz` 原对象必须继续可读；仅当新路径返回明确的 404 时才尝试旧路径。鉴权失败、网络失败或损坏压缩包不得触发旧路径静默降级。
- 永久删除同时清理新 `.gz` 路径与旧原始路径，避免升级后留下占用配额的孤儿对象。
- 本地模式与本地缓存仍保存原始文件，不改变 PDF 原版式、Word 表格、图片或文本字节。
- Data API 只保存文档元数据和路径，不保存压缩包、原始字节、模型 API Key、Tavily Key 或设备凭据。
- Storage bucket 保持私有、RLS 所有权策略不变，并只新增 `application/gzip` MIME 许可。

## 兼容与容量边界

- TXT 与 Markdown 通常会显著缩小。
- PDF、DOCX 和图片本身往往已经压缩，gzip 可能只节省少量空间，极端情况下会略微变大。“只上传压缩包”保证对象形态，但不能保证每个文件都减少容量。
- 本次不主动批量迁移既有云对象，避免同时保留新旧副本导致短期容量翻倍。旧对象在再次导入后会走新路径，永久删除会清理两种路径。
- 本次不压缩 `ai_documents`/`ai_tips` 的 JSON 行；用户要求针对占用最大的导入源文件，业务表结构保持可查询和可同步。

## 已确认问题与统一修复方向

| 问题 | 严重程度 | 位置 | 当前行为 | 风险 | 修复方向 | 阻止验收 |
| --- | --- | --- | --- | --- | --- | --- |
| 新源文件原样上传 | 高 | `server/supabase.ts:uploadCloudSource` | 原始 Buffer 直接进入 Storage | 500 MB 配额快速消耗 | 上传函数内强制 gzip | 是 |
| 路径不能表达压缩格式 | 高 | `cloudSourcePath` / `ai_documents.source_path` | 路径以 `.pdf/.docx/.md/.txt` 结束 | 下载端无法可靠判定是否解压 | 新路径追加 `.gz` | 是 |
| 恢复入口直接写 Storage 响应 | 高 | `ensureDocumentSource` | 压缩字节会被写成 PDF/DOCX | 文件损坏、PDF 签名失败 | `.gz` 严格解压后写回 | 是 |
| 旧对象兼容缺失 | 中 | `ensureDocumentSource` | 路径切换后旧云文件不可恢复 | 升级造成历史文档失效 | 仅 404 时尝试旧路径 | 是 |
| 删除只清一个对象 | 高 | 永久删除入口 | 旧对象可能成为孤儿 | 配额无法释放 | 同时删除新旧路径 | 是 |
| Bucket 不允许 gzip | 高 | `supabase/schema.sql` 与生产 bucket | `application/gzip` 会被拒绝 | 正式上传全部失败 | schema 与受控迁移同步更新 | 是 |

## 先失败的回归与负向测试

1. 新导入 PDF 的 Storage 路径必须以 `.gz` 结尾，存储字节必须具有 gzip 魔数，且不得等于原 PDF。
2. 对存储对象解压后必须与导入原字节逐字节相同；清空本地缓存后，正式 `/source` 入口必须恢复同一 PDF。
3. 普通上传和 TUS 创建元数据都必须声明 `application/gzip`。
4. 原文件大于 6 MiB、但压缩后小于 6 MiB 时不得错误使用 TUS；压缩后仍大于 6 MiB 时必须使用 6 MiB TUS PATCH。
5. `.gz` 对象损坏时必须返回明确错误，且不得写入损坏的本地缓存。
6. 新 `.gz` 路径 404、旧原始对象存在时必须恢复历史文件；新路径 401/500 时不得绕过到旧对象。
7. 永久删除必须使新旧两个对象路径都不可读取。
8. 仅本地模式导入后 Supabase 请求数仍为 0，本地源文件保持原始字节。
9. Supabase Data API 请求体不得包含源文件字节、模型 Key、Tavily Key 或凭据。
10. 反事实：让上传层跳过 gzip、让下载层跳过 gunzip、或只删除新路径，至少一个正式路径测试必须失败。

## 验收边界

可控协议服务器上的正式 HTTP 导入、Storage、清缓存恢复与删除链路可以证明 `FORMAL_PATH_INTEGRATION`。生产 bucket 配置与安全顾问只能证明 `COMPONENT_CAPABILITY`。在真实账户中完成一次“导入 → 新设备/清缓存 → 恢复 → 删除”前，生产环境字节级端到端仍标记为 `NOT_CAUSALLY_VERIFIED`，不能用 mock 测试替代。

## 参考

- Supabase 官方可续传上传文档：超过 6 MB 建议 TUS，块大小要求 6 MB，并通过 metadata 传递 content type。
- Supabase 官方私有 bucket 下载文档：下载必须携带用户 JWT 并受 RLS 控制。
- Supabase 官方 bucket 文档：bucket 可限制允许的 MIME 类型。

## 2026-08-26 实施与新鲜证据

### COMPONENT_CAPABILITY

- 生产项目 `kaqonqxygajosgddhmaq` 已应用迁移 `20260826044422_allow_gzip_cloud_source_archives`。
- 迁移后查询确认 `ai-document-files` 仍为 `public=false`、`file_size_limit=null`，且 MIME 白名单已包含 `application/gzip`。
- Supabase Performance Advisor 为 0 项；Security Advisor 没有报告 Storage/RLS 新问题，但报告了既有的 `auth_leaked_password_protection` 警告。本次不擅自改变账户密码策略。

### FORMAL_PATH_INTEGRATION

`scripts/test-supabase-integration.mjs` 通过应用正式 HTTP 导入、私有 Storage mock、清空本地缓存后的 `/source` 恢复与永久删除入口验证：

- 新对象路径与 Data API `source_path` 均为 `.gz`；对象具有 gzip 魔数、对象 MIME 为 `application/gzip`，存储字节不等于原 PDF；
- gunzip 后与 PDF 原字节逐字节一致，正式恢复入口返回相同 PDF；
- 高度可压缩的 6 MiB 以上原文件按压缩后大小走普通上传；压缩后仍超过 6 MiB 的对象走 TUS，每个非末尾 PATCH 块严格等于 6 MiB；
- gzip 损坏明确失败；新对象 503 不会绕到旧对象；只有新路径 404 才读取旧非压缩路径；
- 永久删除同时移除新压缩路径与旧原始路径；
- 仅本地导入产生 0 个 Supabase 请求，并保持本地原始字节。

这些反事实使压缩数据真实影响 Storage 对象、恢复结果和删除状态，正式可控协议链达到 `LEVEL_5_PREDICTION_BEARING`。`pnpm skills:test` 完整回归和 `pnpm desktop:smoke` 均通过。

### INDEPENDENT_EVALUATION 边界

生产 bucket 类型配置已有真实查询证据，但本轮没有用真实账户上传测试文件，以免消耗用户的 500 MB 配额。在真实账户完成一次跨设备“导入 → 恢复 → 永久删除”前，生产字节链仍为 `NOT_CAUSALLY_VERIFIED`。
