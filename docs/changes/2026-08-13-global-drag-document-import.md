# 空文档库上传入口与全局拖放导入

## 审计结论

当前文件导入能力只存在于 `LibraryScreen`：隐藏文件输入、`api.upload` 调用和导入后的路由跳转均由文档库局部持有。编辑器、Tip 面板和设置弹窗没有正式导入入口。编辑器的保存则是组件内部 900ms 防抖 effect；一旦上传完成后父层切换 screen，effect cleanup 会取消尚未触发的保存计时器。

因此，直接给根节点增加 drop 监听只能达到 `LEVEL_1_INVOKED`：文件可能被上传，但无法证明旧文档修改在路由替换前已持久化。正式路径必须是：

```text
系统文件拖入任意已登录界面
→ 阻止浏览器默认文件导航
→ 校验扩展名属于 TXT / MD / MARKDOWN / DOCX / PDF
→ 调用当前编辑器注册的保存门禁并等待成功
→ 调用正式 multipart 导入 API
→ 服务端解析并持久化文档与原文件
→ 返回新 document ID
→ 关闭遮挡弹窗并打开新文档
```

## 已确认问题

| 问题 | 严重程度 | 代码位置 | 设计要求 | 当前行为 | 直接证据 | 潜在影响 | 错误验收风险 | 统一修复方向 | 阻止发布 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 空库主操作仍是新建空白文档 | 中 | `src/App.tsx` 的 empty state | 没有文档时主流程应为上传 | 按钮直接调用 `createDocument()` | empty state 使用 `Plus` 与 `nav.new` | 用户进入错误的空白编辑流程 | 只改文案但仍调用 create 会造成假通过 | 改为调用根层文件选择器，显示支持类型 | 是 |
| 上传能力局限在 LibraryScreen | 高 | `src/App.tsx` | 已登录后的任意界面均可拖放 | 编辑器和弹窗没有 drop 消费者 | 文件 input 和 upload 函数均为 LibraryScreen 局部变量 | 编辑时拖文件可能被浏览器默认打开并覆盖 App | 只在主页面加 `onDrop` 会漏掉用户要求 | 把导入事务提升到 AppContent，并在 window capture 阶段接管文件拖放 | 是 |
| 屏幕替换前不能强制刷新旧文档 | 高 | `EditorScreen` 保存 effect | 上传打开新文档前必须等待旧文档保存成功 | 900ms timer 在卸载时被清除 | 父组件没有 save handler，dirty 只存在于编辑器内部 | 最后一次标题/正文编辑可能丢失 | 等待固定 900ms 或只看“已保存”标签不构成因果证明 | Editor 注册可等待的 `saveNow`；全局导入必须先 await | 是 |
| 保存并发可能清除较新的 dirty 状态 | 高 | `EditorScreen` 自动/手动保存 | 较旧请求完成不得把较新编辑标记为已保存 | 当前响应完成后无条件 `dirty=false` | 没有 edit revision 或 in-flight 串行化 | 快速编辑加拖放时可持久化旧快照 | 单次成功测试无法发现竞态 | 引入编辑版本号和串行保存循环 | 是 |
| Windows 原子替换存在瞬时 EPERM | 高 | `server/index.ts` 的 `writeDb` | 保存门禁遇到短暂文件占用应重试，持续失败才明确中止导入 | 单次 `rename(temp, store)` 遇到 Windows Defender/索引器短时占用即返回 500 | 第二次桌面回归捕获 `EPERM rename store.json.tmp -> store.json`，导入按设计被阻止 | 用户拖放时偶发保存失败 | 只跑一次 smoke 可能误判稳定 | 对 EPERM/EACCES/EBUSY 实施有界退避重试，其他错误立即抛出 | 是 |
| 缺少负向拖放门禁 | 高 | desktop smoke | 保存失败、非支持文件、任意界面均需覆盖 | 当前没有 drag/drop 测试 | smoke 只通过 Library input 导入 PDF | 回归可绕过保存或让默认导航发生 | “上传接口可用”被误称为全局拖放完成 | 在设置弹窗上拖放；注入一次 PATCH 失败并断言没有 POST import；再恢复并验证旧文档保存与新文档打开 | 是 |

## 设计不变量

- 支持类型与服务端保持一致：`.txt`、`.md`、`.markdown`、`.docx`、`.pdf`，大小不设 10MB 客户端限制。
- 已登录界面的任何可见区域均可接收文件拖放，包括文档库、编辑器、PDF、Tip 面板和设置弹窗。
- 所有文件拖放都必须阻止浏览器默认导航；非文件拖动不能被误判为导入。
- 当前编辑器有未保存内容时，导入 API 必须严格发生在保存成功之后。
- 保存失败必须阻止上传和路由替换，保留旧页面与 dirty 状态并显示错误；禁止 silent fallback。
- 本地数据库原子替换只对 Windows 常见的瞬时占用错误做有限重试；耗尽重试仍必须失败，不能跳过保存。
- 上传成功后自动打开服务端实际返回 ID 对应的新文档，不通过标题猜测。
- 多文件拖放按输入顺序导入；全部成功后打开最后一个文档。部分失败时停止后续导入，不伪造完整成功。
- 同一时刻只允许一个导入事务，避免重复 drop 和文件选择器并发。

## 非目标

- 不移除导航栏和页头已有的“新建空白文档”能力；只改变空库默认主操作。
- 不新增文件格式，也不改变服务端解析器、PDF 原始版式或上传大小策略。
- 不在未登录界面静默保存待上传文件。

## 先失败的回归与反事实测试

1. 本地账户文档为零时，空状态主按钮必须是导入按钮且不调用 `createDocument`。
2. 新建空白文档，立刻修改标题和正文，不等待 900ms 自动保存。
3. 打开设置弹窗，把受支持的 Markdown 文件拖到弹窗上，证明不是主界面专用路径。
4. 第一次把当前文档 PATCH 注入为失败：必须停留原文档、显示错误，文档数不变且 `/documents/import` 未被调用。
5. 恢复 PATCH 后重复拖放：正式 trace 必须显示 PATCH 完成在 POST import 之前；旧文档 API 内容等于拖放前最后编辑，新文档自动打开且内容由上传文件产生。
6. 拖入 `.exe`：drop 默认行为被取消，保存与上传均不得调用，当前 screen 不变。
7. 通用导入集成测试继续分别验证 TXT、Markdown、DOCX、PDF 的服务端解析与字节持久化；前端 accept/扩展名集合必须与这五个扩展名精确一致。

## 验收等级

只有源代码态与 Windows 打包态均通过“设置弹窗拖放 + 保存失败阻断 + 保存成功先于上传 + 返回 ID 自动打开”的正式 UI 路径，才可判定 Windows 达到 `LEVEL_5_PREDICTION_BEARING`。macOS 仍需真机拖放、沙箱文件访问与签名包测试。

## 实施与源代码态验证结果

- 空文档库的图标、标题、说明和唯一主按钮已改为上传文档；导航栏与页头仍保留显式“新建文档”，符合非目标约束。
- 隐藏文件输入和导入事务提升至 `AppContent`，accept 精确为 `.txt,.md,.markdown,.docx,.pdf`，不包含文件大小限制，并支持多选与多文件拖放。
- window capture 阶段接管已登录界面中的文件 `dragenter/dragover/dragleave/drop`，因此设置弹窗、Tip、PDF 和编辑器子元素无法截断正式入口；非文件拖动不受影响。
- 编辑器向父层注册 `saveNow` 门禁；保存使用 edit revision 和单一 in-flight 请求循环，旧请求完成不会清除较新修改。全局导入严格 await 该门禁后才调用 multipart API。
- 保存失败时保持 dirty 与原 screen，并显示可关闭错误；不支持扩展名会阻止默认导航且不触发保存或上传。
- Windows 数据库原子替换对 `EPERM/EACCES/EBUSY` 增加 7 次有界退避尝试；第二次 smoke 捕获的瞬时 `EPERM` 不再成为 silent fallback，耗尽后仍明确失败并阻止导入。
- 两次连续源代码态桌面 smoke 均在设置弹窗上完成正式拖放：先注入 PATCH 失败并证明导入未调用，再恢复后验证 `PATCH:done` 早于 `IMPORT:start`、旧文档标题/正文由 API 读回一致、新 Markdown 按服务端返回 ID 自动打开、设置弹窗关闭。
- 同一 smoke 证明 `.exe` drop 被 `preventDefault` 且文档数不变；完整集成回归继续验证 TXT、Markdown、DOCX、PDF 解析、PDF 原字节保留和超过 10MB 上传。
- Windows `1.9.3` 解包发布产物再次执行同一正式 UI 流程，返回 `emptyImportDefault/globalDropImport/unsupportedDropBlocked/saveFailureBlocked/saveBeforeDropUpload = true`，同时保留 PDF、OCR、递归 Tip、Python 与系统密钥存储回归。因此 Windows 发布路径达到 `LEVEL_5_PREDICTION_BEARING`；macOS 仍标记为待真机商店包验证。
- 另在独立、空白的 1.9.3 打包态用户目录中执行五格式拖放矩阵：依次从文档库/编辑器拖入 `matrix.txt`、`matrix.md`、`matrix.markdown`、真实 DOCX 和真实 PDF。五次 drop 均取消默认导航、分别创建 `txt/markdown/markdown/docx/pdf` 类型、使用五个不同的服务端返回 ID 自动打开。该证据补足“所有支持种类”在拖放正式路径中的独立评估。
