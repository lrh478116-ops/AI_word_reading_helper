# Supabase 中文文件名导入修复

## 已确认问题

云账户导入文档时，应用把 `originalName` 原样拼入 Supabase Storage 对象键：

```text
{userId}/{documentId}/{originalName}
```

Supabase Storage 当前只接受受限的 ASCII 文件名字符。中文、Emoji 等 Unicode
原文件名会令正式上传请求返回 `400 InvalidKey`。导入路由没有把该上游错误转换为
可读的业务错误，最终又被全局错误处理器折叠为“服务暂时不可用”。

2026-08-21 的生产日志证明 DOCX/PDF 解析请求已经进入正式导入链，但四次中文对象键
上传全部返回 400；同一用户、同一 bucket、同一 RLS 下的 ASCII 对象键探针返回 200。

## 设计不变量

- `DocumentItem.originalName`、界面标题、本地文件名和下载名必须继续保留原始 Unicode。
- Supabase Storage 的内部对象键不得依赖用户文件名，只能使用稳定、受限的 ASCII。
- 对象键仍以 `userId` 为第一层，继续满足现有 RLS 所有权约束。
- 小文件标准上传和大文件 TUS 上传必须使用完全相同的对象键规则。
- 云端上传失败时不得写入本地成功状态，也不得静默降级为“仅本地已保存”。
- 本地账户导入不应依赖 Supabase，云端故障不得阻断本地账户。

## 统一修复

内部对象键统一为：

```text
{userId}/{documentId}/source{canonicalExtension}
```

扩展名仅从应用正式支持的类型映射为 `.pdf`、`.docx`、`.md` 或 `.txt`；未知类型不把
用户输入拼入对象键。原始文件名只保留在文档元数据里。

同时让全局错误处理器保留 `SupabaseRequestError` 的可读消息和合理 HTTP 状态，避免
把确定性的 `InvalidKey`、RLS 或配额错误伪装成服务宕机。

## 回归与反事实验收

- Mock Storage 必须像真实 Supabase 一样拒绝 Unicode 对象键；旧实现应因此失败。
- 中文与 Emoji 文件名的小 PDF 必须通过标准上传，并保留原始字节和原文件名。
- 中文文件名的大 PDF 必须通过 TUS 上传，且对象键仍为 ASCII。
- 删除与本地缓存丢失后的云端恢复必须读取同一内部对象键。
- 改回原始中文文件名对象键后，测试必须重新失败，以证明断点具有因果性。
- 云端故障必须显式失败；本地账户导入仍可独立工作。

## 非目标

- 不改变用户看到的文件名或文档标题。
- 不放宽 Storage RLS，也不引入 `service_role` 密钥。
- 不把云端失败静默改成本地成功。
- 不改变 PDF、DOCX、Markdown、TXT 的解析实现。
