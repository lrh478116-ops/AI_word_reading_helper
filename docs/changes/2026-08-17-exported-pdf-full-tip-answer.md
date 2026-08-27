# 导出 PDF 的 Tip 完整回答

## 审计结论

用户报告“PDF 下载后 Tip 仍有字数上限”。应用内 marker 悬浮预览已经读取第一条 assistant 消息全文，但导出带批注 PDF 使用另一条旧主链：

```text
有效 PDF Tip
→ createAnnotatedPdfCopy
→ selectedText.slice(0, 500)
→ TipThread.summary.slice(0, 500)
→ PDF Highlight/Text Annotation /Contents
→ 下载后的 PDF 阅读器只能看到截断摘要
```

`TipThread.summary` 在回答完成时本来就固定为最多 120 字；导出函数既没有接收 `messages`，也没有读取第一条 assistant 消息。因此此前的“应用内完整悬浮预览”只能证明屏幕组件能力，不能证明下载 PDF 的批注内容完整。下载路径标记为 `NOT_CAUSALLY_VERIFIED`。

## 已确认问题

| 问题 | 严重程度 | 代码位置 | 设计要求 | 当前实际行为 | 直接证据 | 潜在影响 | 错误验收风险 | 统一修复方向 | 阻止发布 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 导出函数不消费聊天消息 | 高 | `server/pdf-tip.ts` | PDF Tip 的 `/Contents` 应来自第一条 assistant 回答全文 | 输入类型只有 `summary`，没有 `messages` | `createAnnotatedPdfCopy` 参数类型排除了 `messages` | 下载 PDF 永远无法包含完整回答 | 应用内悬浮预览通过会掩盖下载缺陷 | 把 `messages` 纳入正式导出输入并选取第一条 assistant 消息 | 是 |
| 导出显式截断选中文字和摘要 | 高 | `server/pdf-tip.ts` | 写入的数据不能在应用层静默丢字符 | `selectedText.slice(0,500)`、`summary.slice(0,500)` | 源码直接截断 | 长选区与回答尾部消失 | 只检查 Tip ID 会误判导出成功 | 取消内容截断，首尾签名逐字验证 | 是 |
| 导出测试只检查 ID | 高 | `scripts/test-pdf-tip-anchors.mjs` | 必须重开 PDF 并读取 Annotation `/Contents` | 只搜索导出字节是否包含 Tip ID | 旧测试对 120/500 字截断不敏感 | 发布包仍可能带缺陷 | 构造超过旧阈值的第一回答并检查全部 Highlight/Text Annotation | 是 |

## 设计不变量

- 下载 PDF 中的 Tip 回答必须来自第一条 `role=assistant` 的 `message.content`；第二轮回答不能替换基准回答。
- `summary` 继续用于记忆和列表摘要，不得承担下载 PDF 的完整回答来源。
- 导出层不得对第一条回答或选中文字使用固定字符截断。
- PDF `/Contents` 必须包含 Tip ID、标题、完整选中文字和完整第一条回答，并能由独立 PDF 解析器重新读取。
- 多矩形 Highlight 与 Text note 必须引用同一份完整内容，避免每个矩形重复序列化超长回答导致文件无谓膨胀。
- 没有 assistant 回答时允许显示明确的“尚无 AI 回答”，不能把空消息伪装成完整回答。
- 原 PDF 字节保持只读；仍然只生成 `-AI-Tip-annotations.pdf` 副本。
- PDF 阅读器自身的弹窗视觉高度可以滚动或有厂商差异，但导出文件中的规范 `/Contents` 数据不得丢字符。

## 非目标

- 不修改原 PDF、Tip 锚点坐标、聊天消息或 Supabase 数据。
- 不承诺第三方 PDF 阅读器的弹窗尺寸；本次保证文件内 Annotation 内容完整。
- 不把全部多轮聊天写入 PDF；仍按产品要求只导出第一条回答。

## 先失败的回归与反事实测试

1. 创建第一条 assistant 回答，长度同时超过旧的 120 字 summary 和 500 字导出阈值，包含唯一开头/结尾签名。
2. 再创建内容完全不同的第二条 assistant 回答，证明导出没有错误读取最后一条回答。
3. 使用包含多个矩形的 PDF Tip 导出副本。
4. 重新加载导出 PDF，枚举目标页全部 Highlight/Text Annotation，并解析间接或直接 `/Contents`。
5. 每个目标 Annotation 都必须包含第一回答的开头和结尾、完整回答正文；不得包含第二回答唯一签名。
6. `/Contents` 不得等于短 `summary`，原 PDF SHA-256 必须不变。
7. 正式 HTTP 导出接口继续验证用户所有权、有效锚点和下载文件名。

## 验收条件

只有“持久化第一回答全文 → 正式导出接口读取同一 Tip → PDF Annotation `/Contents` 包含首尾签名 → 重开导出文件仍可读取完整文本”贯通，才能把下载 PDF 路径判为 `LEVEL_5_PREDICTION_BEARING`。只检查函数存在、文件生成、Tip ID 或文件大小变化最多属于 `COMPONENT_CAPABILITY`。

## 实施与新鲜证据

- `createAnnotatedPdfCopy` 的输入从 `summary` 改为真实 `messages`，并使用 `find(role === "assistant")` 固定选择第一条回答。
- 已删除导出层对选中文字和回答的固定 `slice(0, 500)`；`summary` 不再参与 PDF `/Contents`。
- 同一 Tip 的全部 Highlight 和 Text Annotation 通过一个间接 PDF 字符串对象共享完整内容，避免多矩形锚点重复序列化长回答。
- 先失败测试的第一回答长度为 4115 字：修复前独立重开只读到 154 字；修复后全部 3 个 Annotation 均读到 4165 字的完整结构化内容（包含标题和选区等 50 字元数据）。
- PyPDF 独立验证结果：`annotations=3`、`content_lengths=[4165,4165,4165]`、`all_equal=true`、首尾签名全部存在、第二轮回答签名不存在。
- 正式 HTTP 链测试先通过聊天入口持久化超过 500 字并经 `finish_reason=length` 续写完整的第一回答，再持久化不同第二回答；下载接口生成的 PDF 重开后仍严格使用第一回答全文。
- Poppler 将相关页面重新渲染为 PNG；中文、表格、图片、高亮和 Tip 图标没有乱码、裁切或布局破坏。
- `pnpm skills:test` 完整回归通过，结果含 `pdfExportedFirstAnswerComplete=true`；Supabase、Word、OCR、递归 Tip 与联网/数值技能测试继续通过。
- `pnpm desktop:smoke` 通过，应用内第一回答预览、PDF 页面 Tip、OCR 布局、递归 Tip 和 safeStorage 均未回归。

源码态和正式 HTTP 下载链现达到 `LEVEL_5_PREDICTION_BEARING`。第三方 PDF 阅读器如何设置批注弹窗高度属于阅读器界面行为，但文件内规范 `/Contents` 已无应用层字符截断。

Windows 版本已提升到 `1.9.7` 并生成 `release/AI Tip Setup 1.9.7.exe`。直接启动新 `win-unpacked/AI Tip.exe --smoke-test` 的独立进程退出码为 0，新报告时间为 2026-08-17 12:27:27，结果为 `ok=true`。进一步从新包 `app.asar` 直接读取 `package.json` 和 `dist-electron/server.cjs`：版本确认为 `1.9.7`，正式包包含 `messages.find(role === "assistant")`、共享完整 `noteContents`，且不存在旧 `slice(0,500)` 导出路径，排除了使用旧构建结果的可能。安装器 SHA-256：`3B701FBE1CB84CDD3220F4CE1DC7F76B1356A2D1FCEC77385C68ED3AD064BFBF`。安装器目前仍为 `NotSigned`，公开分发会遇到 Windows SmartScreen 发布者提示；这不影响本次 PDF 数据完整性，但属于发布身份缺口。
