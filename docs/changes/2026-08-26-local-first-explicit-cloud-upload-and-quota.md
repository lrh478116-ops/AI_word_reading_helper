# 本地优先、显式云上传与每用户 5 MiB 配额

## 审计结论

当前云账户的正式写入路径是自动同步：

```text
本地文档 / Tip / 聊天变更
→ writeDb
→ AsyncLocalStorage 中的 cloud token
→ upsertCloudChanges
→ Supabase Data API
```

导入还存在独立自动路径：

```text
导入并解析原文件
→ 先 upsert ai_documents
→ gzip
→ Supabase Storage
→ 本地落盘
```

永久删除文档和删除 Tip 也会直接删除云端。云账号的每个鉴权请求还会拉取云快照，并用远端数组替换本机同用户数据。因此当前行为与“默认仅保存在本地，点击上传云端才上传”相反；只增加前端按钮不能构成真实接入。

生产项目当前有一个用户目录，Storage 对象共约 `2,840,207` 字节，文档 JSON 约 `355,609` 字节，Tip JSON 约 `18,671` 字节，合计约 `3.21 MB`，未超过 5 MiB。

## 统一设计

### 本地优先

- 登录 Supabase 只提供云身份和读取既有云文档的能力，不再授权后台自动写云端。
- 新建、导入、编辑、OCR、创建/修改/删除 Tip、聊天、收藏、回收站和永久删除默认只更新本机数据库与本机原文件。
- 云账号新导入文档的默认状态为 `local`；任何 Supabase Data API 或 Storage 写入都必须来自显式 `POST /documents/:id/cloud`。
- 编辑已经上传的文档或 Tip 后状态变为 `modified`；再次点击按钮才更新云端。
- 登录时合并云文档与本机文档：不得用云快照覆盖本机从未上传或上传后又修改的版本。
- “从云端移除”是独立显式操作；本地删除不得暗中删除云副本。

### 5 MiB 用户累计配额

固定常量：

```text
5 × 1024 × 1024 = 5,242,880 bytes
```

配额包含：

- 私有 Storage 中该用户目录下的所有对象，包括旧版本对象和孤立对象；
- `ai_documents.payload` 的 UTF-8 JSON 字节；
- `ai_tips.payload` 的 UTF-8 JSON 字节。

不能使用 bucket `file_size_limit` 代替，因为它只限制单个对象，不限制每用户累计使用量。

正式约束分为三层：

1. 应用在 gzip 完成后先拒绝单个压缩包超过 5 MiB 的上传，提供明确错误；
2. `ai_documents` 和 `ai_tips` 的 BEFORE trigger 在事务内获取按用户划分的 advisory lock，计算替换后的总量并拒绝超限写入；
3. Storage INSERT/UPDATE RLS 调用私有 quota 函数，在同一事务锁下以 `metadata.size` 计算替换后的累计总量，防止用户绕过 App 直接调用 Storage API，也防止多设备并发超额。

私有 quota 函数必须位于非暴露 schema，使用固定空 `search_path`，显式校验 `auth.uid()`，撤销 `PUBLIC`/`anon` 执行权。`storage.objects` 只读查询元数据，文件增删仍必须走 Storage API。

## 设计不变量

- 没有点击“上传云端”时，普通业务操作产生 0 个 Supabase Data API/Storage 写请求。
- Supabase Auth 验证请求不等于云数据上传；两者必须在测试中分开统计。
- 显式上传必须同步当前文档、该文档全部 Tip/聊天以及存在的 gzip 源文件。
- 云端状态必须由本机最后成功上传时间与文档/Tip 最新修改时间计算，不能由按钮点击或前端乐观状态伪造。
- 只有全部必需步骤成功后才能标记 `synced`；失败后保持 `local` 或 `modified`。
- 新源文件继续只以 `.gz` 上传；本地原文件保持不变。
- 5 MiB 是总量，不是每文件 5 MiB；旧对象和孤立对象也必须计入。
- 超额必须返回稳定错误码 `CLOUD_QUOTA_EXCEEDED` 和当前使用量，不得折叠成“服务不可用”。
- 仅本地账号不能调用云上传/云移除接口。
- 不上传模型 API Key、Tavily Key、Prompt、登录密码或设备凭据。

## 已确认问题

| 问题 | 严重程度 | 位置 | 当前行为 | 影响 | 统一修复 | 阻止验收 |
| --- | --- | --- | --- | --- | --- | --- |
| 所有本地变更自动上云 | 严重 | `writeDb` | 自动差异 upsert | 违反默认本地保存 | 移除隐式 cloud context 写入 | 是 |
| 导入自动上传 | 严重 | `/documents/import` | Data API + Storage 自动写 | 用户未授权即消耗空间 | 导入只落本机，上传移到显式端点 | 是 |
| 删除自动影响云端 | 高 | 文档/Tip DELETE | 云端对象与行直接删除 | 本地操作扩大为云操作 | 增加独立显式云移除 | 是 |
| 云拉取覆盖本地数组 | 严重 | `hydrateCloudUser` | 远端替换本机同用户数据 | 未上传本地文档可能丢失 | 按 ID 合并并保护 local/modified | 是 |
| 无累计用户配额 | 严重 | schema / Storage RLS | 只校验目录所有权 | 可耗尽项目空间 | DB trigger + Storage RLS + 用户锁 | 是 |
| Bucket 限制不能满足需求 | 高 | `storage.buckets.file_size_limit` | 只能限制单对象 | 多文件可绕过 5 MiB | 保持 bucket 无固定上限，使用累计权威函数 | 是 |
| UI 没有真实上传状态 | 中 | 文档库/编辑器 | 保存图标混淆本地与云端 | 用户无法判断数据位置 | 本地保存、上传云端、云状态与用量分离 | 是 |

## 先失败的回归与负向测试

1. 云账号新建、编辑、导入、创建 Tip、聊天和删除后，Supabase Data API/Storage 写请求数必须保持 0。
2. 只点击本地“保存”不得触发云请求；点击“上传云端”后文档、Tips、最终回答和 `.gz` 源文件才进入正式云链。
3. 上传成功前不得把 `cloudState` 标为 `synced`；注入 Data API 或 Storage 失败后状态必须仍为 `local/modified`。
4. 已同步文档再次编辑后必须变为 `modified`，且不自动更新远端 payload。
5. 云快照与本地未上传文档并存时，登录合并不得删除或覆盖本地文档。
6. 单个 gzip 超过 5 MiB 必须在任何 Storage 上传前被拒绝。
7. 多个对象、文档 JSON 与 Tip JSON 累计超过 5 MiB 必须被权威约束拒绝。
8. 直接绕过应用调用 Storage INSERT/UPDATE，或直接调用 Data API 写入超额 payload，必须被 RLS/trigger 拒绝。
9. 两个并发上传各自单独可用、合计超额时，事务锁后最多一个成功。
10. 覆盖同名对象按“总量减旧对象再加新对象”计算，不能重复计费，也不能借覆盖绕过。
11. 旧对象和没有 Data API 行的孤立对象必须计入用量。
12. 仅本地账号调用显式云接口必须失败，且不能产生 Supabase 请求。
13. 模型 Key、Tavily Key、Prompt 和凭据不得进入任何云请求体。
14. “从云端移除”必须走 Storage remove 和 Data API delete；普通本地删除不得调用这条路径。

## 验收等级

只有下面整条链产生新鲜证据，才能称为正式接入：

```text
用户显式点击上传
→ 本机保存完成
→ gzip 与本地 5 MiB 预检
→ Storage RLS 累计配额判定
→ Data trigger 累计配额判定
→ 文档 / Tips / 源文件实际写入
→ 本机 cloudSyncedAt 只在成功后更新
→ UI 显示 synced 与准确用量
```

仅出现按钮、调用函数、显示“已上传”或 mock 返回 200，最多是 `LEVEL_1_INVOKED`/`LEVEL_2_RECORDED`。数据库与 Storage 的真实反事实，以及从云端恢复同一内容，才允许判定 `LEVEL_5_PREDICTION_BEARING`。

## 非目标与兼容边界

- 本次不自动批量重压缩或删除历史对象，避免在用户未确认时改变云端内容；它们仍计入 5 MiB。
- 本次不实现多设备同时编辑的自动内容合并；本机未上传修改优先保留，冲突不得静默覆盖。
- 5 MiB 是应用定义的每用户实时上限，不等同于 Supabase 套餐按 GB-Hours 统计的项目计费用量。

## 2026-08-26 实施后证据

### COMPONENT_CAPABILITY

- 生产迁移 `20260826081722_local_first_explicit_cloud_upload_and_user_quota` 已应用。
- `ai-document-files` 保持 `public=false`，并增加 `file_size_limit=5242880` 作为单对象防线；累计限制由私有函数负责。
- 真实用量函数在 authenticated 身份下返回 `3,214,487 / 5,242,880` 字节，其中 Storage `2,840,207` 字节、数据库 payload `374,280` 字节、对象 6 个。
- 回滚事务中的约 2.1 MB 新文档 payload 因累计超额被 trigger 以 `AI_TIP_CLOUD_QUOTA_EXCEEDED` 拒绝，没有留下测试行。
- Storage quota 函数反事实：新增 1,000 字节允许；新增 3 MiB 因累计超额返回 false；跨用户路径返回 false。
- Storage INSERT/UPDATE 策略的 `with_check` 已查询确认真实调用私有累计 quota 函数。
- Performance Advisor 为 0 项；Security Advisor 仅保留既有的 Auth 泄露密码检测未启用警告，没有报告本次函数、trigger 或 Storage RLS 新问题。

### FORMAL_PATH_INTEGRATION

`scripts/test-supabase-integration.mjs` 从应用正式 HTTP 入口验证：

- 云账号本地新建、编辑、导入、Tip 和最终聊天回答在点击前产生 0 个 Data API/Storage 写请求；
- 显式上传后文档、全部 Tip/最终回答和 gzip 源对象才进入云端，状态变为 `synced`；
- 已同步文档本地编辑后变为 `modified`，云 payload 不变，再次显式更新后才变化；
- 单压缩包超过 5 MiB 在任何 Storage 写入前返回 `CLOUD_QUOTA_EXCEEDED`；
- 清空云文档本机缓存后可恢复远端文档，同时保留从未上传的本机文档；
- 普通本地删除不触碰云对象，显式“移出云端”才同时删除新旧 Storage 路径、Tips 和文档行；
- 云服务故障不阻断本地保存，只有显式上传返回明确上游错误。

完整 `pnpm skills:test` 与 `pnpm desktop:smoke` 均通过。应用链与可控协议链达到 `LEVEL_5_PREDICTION_BEARING`。

Windows `1.12.7` 安装包与 `win-unpacked` 目录已重新生成；打包程序的 `--smoke-test` 通过独立结果文件返回 `ok: true`，实际覆盖 PDF/DOCX 导入、PDF/OCR Tip、递归 Tip、保存、拖放导入、语言、本地模型门控、Python 与安全密钥存储。安装包 SHA-256 为 `65CFE710FE4D8F02B8224549B59C9B437883AA2058E58888DE587306551CB4AB`。当前安装包没有 Authenticode 签名，正式外部分发前仍需使用发布者代码签名证书签名。

### 独立评估边界

真实生产数据库的 Data trigger、Storage quota 函数、RLS 策略和用量查询已经产生回滚式反事实证据。为了不改变用户云文档，本轮没有以真实 App 会话上传测试文件；生产 UI 点击上传后跨设备恢复仍标记为 `NOT_CAUSALLY_VERIFIED`。
