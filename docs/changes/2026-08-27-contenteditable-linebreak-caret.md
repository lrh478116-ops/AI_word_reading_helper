# 文档换行后光标跳到首行修复

日期：2026-08-27

## 用户要求

修复编辑文档时按 Enter 换行后，后续输入位置跳回当前编辑块第一行的问题；验证后上传 GitHub。

## 修改前只读审计

正式编辑链为：

```text
contentEditable DOM 输入
→ onInput 读取 innerText
→ EditorScreen.updateBlock 更新 documentRef 与 React state
→ EditableBlock 重新渲染
→ React 协调 {item.content} 子文本
→ 浏览器原生选区所依附的文本节点被重写
→ caret 丢失并回到编辑块首行
```

`EditableBlock` 的普通段落、标题、代码、引用、列表项均把 `item.content` 作为 `contentEditable` 的 React children。Word 表格的 `th/td` 也把单元格 `content` 作为 React children，因此具有同一缺陷。

现有 effect 虽然在元素聚焦时不执行 `innerText = item.content`，但 React children 的协调发生在 effect 之前，无法被该判断阻止。自动保存只在 900ms 后读取已经更新的 `documentRef`，不是本次光标跳转的直接原因。

## 接入等级

- 文档内容状态更新和保存已经达到 `LEVEL_5_PREDICTION_BEARING`；
- 光标稳定性没有独立持久化对象，但属于正式输入链的必要交互状态；
- 仅验证保存后的文本含换行，不能证明 caret 没有跳转；必须在真实 Electron `contentEditable` 中继续输入并验证字符落点。

## 统一修复

采用单一 DOM ownership 规则：

1. 聚焦编辑期间，浏览器独占 `contentEditable` 内部 DOM 和 Selection；
2. React 的 `onInput` 只把 `innerText` 写入文档状态，不再把状态作为 children 写回活动 DOM；
3. 初次载入、切换文档或外部状态变化时，仅当对应元素未聚焦且 DOM 与状态不一致，才在 layout effect 中同步 `innerText`；
4. 普通文本块与 Word 表格单元格使用同一原则；
5. Tip 偏移继续基于规范化 `innerText`，保存链、自动保存和结构化表格派生文本保持不变。

## 设计不变量

- Enter 后光标必须停在新行，并允许下一字符写入新行，而不是第一行。
- 普通段落、标题、引用、代码、列表项和 Word 表格单元格不能由 React 在每次输入时重建内部文本节点。
- 首次打开和重新打开文档必须显示已保存内容，不能因为改为非受控 DOM 而出现空块。
- 切换 block ID、文档或服务端恢复内容时，未聚焦元素必须同步新值。
- `onInput → documentRef → saveNow → PATCH → GET` 数据链不得改变。
- 换行保存后重新打开必须保留换行。
- Tip 选区偏移和锚点位置不得因 DOM ownership 调整失效。
- 不允许通过每次输入后强行把光标移到末尾来掩盖问题，因为那会破坏中间插入和选区替换。

## 先失败的回归与负向测试

1. 在真实 Electron 普通文档块中写入“第一行第二行”，把 caret 放在“第一行”之后，执行浏览器原生换行，再输入“续”；最终文本必须严格为 `第一行\n续第二行`。
2. 同一步骤后 caret 线性偏移必须位于“续”之后，不能是 0、首行位置或全文末尾的伪恢复。
3. 等待自动保存后通过正式文档 API 读取，换行与字符落点必须一致。
4. 返回文档库并重新打开，DOM 内容与 API 内容仍一致。
5. Word 表格单元格执行中间换行与继续输入，不能跳到单元格首行，并需保存结构化 rows 与派生 content。
6. 在元素未聚焦时改变上游内容，DOM 必须更新，防止非受控编辑器变成 stale cache。
7. 普通 Tip 文本选区、表格 Tip 选区、保存失败阻断和新增块入口必须继续通过。

## 非目标

- 不把一个块内的 Enter 自动拆成新的 `DocumentBlock`；本次保留块内换行语义。
- 不改变 Shift+Enter、聊天输入框或 PDF 文字层行为。
- 不修改原始 DOCX/PDF 文件；仍保存到 App 本地文档数据。

## 实施结果

- 普通文档块不再把可编辑文本作为 React children 反复协调；聚焦时由浏览器原生 DOM 与 Selection 持有输入位置。
- 未聚焦块通过 `useLayoutEffect` 与文档状态同步，保证首次加载、切换文档和重新打开后仍显示持久化内容。
- Word 表格单元格使用相同的 DOM ownership 规则，避免表格内换行触发相同问题。
- 保留 `onInput → documentRef → 自动/手动保存 → 文档 API → 重新打开` 正式数据链，没有增加移到末尾或静默回退逻辑。

## 新鲜验证证据

验证日期：2026-08-27。

1. 修改前，真实 Electron 回归稳定复现错误：期望 `第一行\n续第二行`，实际得到 `续第一行\n第二行`，caret 偏移为 0。
2. 修改后，源码 Electron 冒烟测试通过普通块换行、继续输入、自动保存、API 读取和重新打开验证。
3. 修改后，Word 表格单元格通过中间换行、继续输入、手动保存、结构化 rows/API 读取和重新打开验证。
4. `pnpm typecheck`、`pnpm desktop:prepare` 和完整 `pnpm skills:test` 均通过；完整回归中的 Supabase 503 日志来自主动注入的负向测试，测试进程最终退出码为 0。
5. Windows 1.12.10 打包成功，并直接运行 `release/win-unpacked/AI Tip.exe --smoke-test` 再次得到 `ok: true`、`contentEditableLinebreakCaret: true`、`wordTableLinebreakCaret: true`、`wordTableSaveRoundTrip: true`。
6. 安装包：`AI Tip Setup 1.12.10.exe`，大小 204,333,938 字节，SHA-256：`155FEB2233FB81D255F87B72627251B1E21EBF0C4D0C5DFE0400295526A9F204`。

## 验收边界

本次换行光标修复已达到正式桌面入口、实际执行、保存与重新打开可追踪的 `LEVEL_5_PREDICTION_BEARING`。安装包当前 `Authenticode` 状态仍为 `NotSigned`；这不影响本次功能因果验证，但会影响 Windows 下载/安装信誉，不能将其误报为已完成代码签名。
