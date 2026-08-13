# Word 表格、直接编辑与可靠保存

## 审计结论

当前 DOCX 正式路径为：

```text
DOCX 字节
→ mammoth.convertToHtml（能产生 table / tr / td）
→ htmlToBlocks（只匹配 h1-h6 / p / li / blockquote / pre）
→ 普通文本块
→ EditableBlock（只渲染 p / heading / quote / code）
→ updateBlock（只更新 content）
→ PATCH blocks
```

表格结构在 `htmlToBlocks` 被消费前已经丢失。测试样本 `mammoth/test/test-data/tables.docx` 的转换结果明确包含两行两列表格，但现有解析器产生的不是 `table` 块。因此当前实现最多是 `LEVEL_1_INVOKED`（DOCX 转换器被调用）；Word 表格没有达到 `LEVEL_3_CONSUMED`，更没有达到可编辑、可保存并影响重新打开结果的 `LEVEL_5_PREDICTION_BEARING`。

保存按钮和 900ms 自动保存已经存在，但它们只保存普通块的 `content`。返回文档库直接切换 screen，没有等待保存门禁；表格也没有任何单元格更新入口。因此不能用“存在保存按钮”证明 Word 表格编辑已接入。

## 已确认问题

| 问题 | 严重程度 | 代码位置 | 设计要求 | 当前实际行为 | 直接证据 | 潜在影响 | 错误验收风险 | 统一修复方向 | 阻止发布 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DOCX 表格结构被扁平化 | 高 | `server/index.ts:htmlToBlocks` | 表格在文档顺序中保留行、列、表头和合并信息 | 解析器不消费 `table/tr/td/th` | Mammoth 对真实 fixture 输出 `<table>`，正则只匹配段落类标签 | 行列关系、表头和单元格边界丢失 | 只加 CSS 或在文本中插入制表符会假装通过 | 解析 Mammoth HTML 树并生成正式 `table` block | 是 |
| Word 表格没有编辑组件 | 高 | `src/App.tsx:EditableBlock` | 单元格可直接点击编辑 | `table` 类型会回退为一个 `<p>` | Tag 分派没有 table 分支 | 用户无法按表格编辑 | 只显示静态 table 不能满足编辑 | 新增可编辑 table，编辑时同步结构与规范文本 | 是 |
| 表格修改不能进入保存请求 | 高 | `src/App.tsx:updateBlock` | 修改的单元格数据必须进入正式 PATCH | updateBlock 只接收字符串 | 回调签名没有 table patch | 刷新或重新打开丢失 | DOM 视觉变化会造成假保存 | 用结构化 block patch 更新 `table` 与 `content` | 是 |
| 服务端信任并透传任意表格对象 | 高 | `server/index.ts` 文档 PATCH | 保存后结构应有界、可序列化、可恢复 | 对 block 使用对象展开，只裁剪 content | 未规范化 rows、cell 文本、span、类型和数量 | 畸形/超大结构、stale content、不可预测渲染 | API 200 不代表保存对象正确 | 服务端按允许类型重建 block，并从单元格重算 content/hash | 是 |
| 返回文档库可能绕过最后编辑 | 高 | `EditorScreen` 的 back button | 离开编辑器前必须等待保存成功 | 直接调用父层 onBack | back click 不经过 saveNow | 防抖计时器随卸载取消，最后编辑可能丢失 | 等待 900ms 的 happy path 隐藏问题 | 返回按钮先 await saveNow，失败则留在原页 | 是 |
| 缺少 Word 表格端到端证据 | 高 | 测试脚本与 desktop smoke | 真实 DOCX 导入、UI 编辑、保存、重新打开均需验证 | 仅验证 PDF 表格；DOCX 只做格式矩阵上传 | 没有 data-word-table、cell edit、reload assertion | 回归可再次扁平化 | 组件调用或静态 DOM 不能证明持久化 | 增加 API 因果测试与桌面 UI 反事实测试 | 是 |

## 设计不变量

- DOCX 中表格必须作为一个 `DocumentBlock(type="table")` 保持在原有段落顺序中。
- 表格保存至少保留行、单元格文字、表头标记、`rowSpan` 与 `colSpan`；坐标或屏幕宽度不是持久化依据。
- `table.content` 必须由结构数据确定性派生（单元格以制表符、行以换行分隔），用于 Tip 上下文、搜索和 hash；禁止结构与 content 静默分叉。
- 单元格可直接点击并编辑；普通段落、标题、代码和引用继续直接编辑。
- “添加段落 / 标题 / 代码 / 引用”四个入口必须保留，这是用户本轮明确要求。
- 手动保存、自动保存、全局拖入前保存以及返回文档库前保存必须调用同一个版本化 `saveNow` 正式门禁。
- 保存失败时必须保留当前编辑页面和 dirty 状态，不能继续返回或显示“已保存”。
- 服务端必须限制表格行数、每行单元格数、单元格长度和 span 范围；畸形对象不得被原样持久化。
- PDF 语义表格继续使用既有 `rows/headerRows` 路径，不得因 Word 表格元数据扩展而回归。

## 非目标

- 不把应用内编辑直接写回用户原始 `.docx` 文件；本轮保存目标是本地 App 文档数据库。后续若提供 DOCX 导出，应生成副本并另行验证 OOXML 格式。
- 不承诺完整复现 Word 的字体、主题、精确列宽、分页和浮动对象；本轮修复的是表格语义结构与可编辑持久化。
- 不移除“添加段落 / 标题 / 代码 / 引用”。
- 不改变 PDF 原始版式阅读和 PDF Tip 主链。

## 先失败的回归与反事实测试

1. 使用真实 `tables.docx`：导入结果必须按 `Above → table → Below` 排序，表格为两行两列，不能出现四个伪段落。
2. 改变表格单元格后执行正式 PATCH，再 GET：返回的 table cell 与派生 content 必须同时变化。
3. 提交 stale `content` 加新 table rows：服务端必须以 rows 重算 content，证明结构是真实输入而不是仅记录。
4. 提交越界 span、过长单元格或畸形 rows：服务端必须规范化或拒绝，不能原样持久化。
5. 桌面 App 导入真实 DOCX，直接编辑一个 `td/th[contenteditable]`，点击保存，再返回并重新打开；DOM 和 API 都必须出现新值。
6. 注入一次保存失败后点击“文档库”：必须留在编辑器，证明旧导航不能绕过保存门禁；恢复后才允许离开。
7. 四个结构化添加按钮仍然存在且可创建对应块。
8. PDF 结构表格测试保持通过，证明共享类型扩展没有改变 PDF 表格正式行为。

## 验收边界

只有真实 DOCX 在 Windows 桌面正式 UI 中完成“导入 → 表格结构显示 → 单元格直接编辑 → 保存请求消费结构 → 数据库更新 → 返回并重新打开仍一致”，并通过保存失败阻断的反事实检查，才可判定 Windows 达到 `LEVEL_5_PREDICTION_BEARING`。组件解析测试只能算 `COMPONENT_CAPABILITY`，API 导入/保存测试属于 `FORMAL_PATH_INTEGRATION`，独立桌面 UI 重开测试属于 `INDEPENDENT_EVALUATION`。

macOS 的解析和 React 代码共用，但仍需在真机沙箱/签名包中验证输入法、contenteditable table 和文件访问，不能从 Windows 结果外推商店包已正式通过。

## 实施与验证结果

- `htmlToBlocks` 已由段落正则改为确定性的轻量 HTML 树解析，正式消费 Mammoth 产生的 `table/tr/td/th`，并在文档原顺序生成 `table` block；单元格内多段文字、中文实体、表头、`colSpan` 和 `rowSpan` 均有结构化测试。
- Word 表格前端使用原生 `table/th/td`，每个单元格可直接编辑；编辑同时更新 `rows/cells` 和制表符/换行规范文本。普通段落、标题、代码、引用仍可直接编辑，四个结构化添加入口也由桌面测试确认保留。
- 文档 PATCH 不再对象展开任意客户端字段；服务端限制表格规模、规范化单元格与 span、从 rows 重算 `content/contentHash`，畸形 `rows` 返回 400。反事实测试证明 stale content 不会覆盖新表格，fabricated replacement 不会破坏已保存数据。
- 编辑回调同步刷新 `documentRef` 保存快照，消除了“单元格刚改完立刻点保存时提交旧数据”的竞态；该竞态由第一次桌面回归实际捕获，而不是理论推断。
- 返回文档库与 `Ctrl/Cmd+S` 已接入同一个 `saveNow`。桌面测试注入 PATCH 失败后，返回被阻止且仍停留编辑器；恢复请求后才保存并离开。
- `pnpm skills:test` 全量通过，继续覆盖 PDF 语义表格/图片、PDF 原始版式 Tip、OCR 布局、递归 Tip、专业/政策联网审查、Python 精确计算、超过 10MB 上传和本地密钥保护。
- 源代码态 Windows desktop smoke 完成真实 DOCX 的“导入 → 2×2 可编辑表格 → 立即手动保存 → API 读取结构与 content → 返回 → 文档卡重新打开 → 单元格值仍一致”，并通过保存失败阻断；这构成 `FORMAL_PATH_INTEGRATION` 与 `INDEPENDENT_EVALUATION`。
- Windows `1.9.4` 解包发布产物再次执行同一测试，返回 `wordTableDirectEdit/wordTableSaveRoundTrip/backSaveFailureBlocked/saveBeforeBack/addBlockControlsPreserved = true`，同时其他桌面回归全部通过。因此 Windows 该能力达到 `LEVEL_5_PREDICTION_BEARING`。
- 文档技能的 LibreOffice 渲染器因本机未安装 LibreOffice 无法运行；随后尝试 Word COM 无界面导出又被 Office 对话框阻塞并已终止仅由本次 QA 创建的隐藏 Word 进程，用户原有可见 Word 进程未受影响。因此没有声称像素级 Word 主题复刻。当前可验证范围是语义表格结构、合并信息、直接编辑和持久化；macOS 商店包仍需真机验证。
