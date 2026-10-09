# 版本化自动保存与关闭前落盘握手

## 修改前审计结论

本轮修复范围是文档标题、普通块、表格块和新增块从编辑器到本地数据库的可靠保存，以及关闭窗口/退出应用前的保存握手。修改前的正式因果链存在五个断点：

```text
contenteditable / title input
→ React documentRef
→ 900 ms debounce（持续输入可无限推迟）
→ 整份 blocks PATCH（每次传输和重建全部文档块）
→ 服务端无 revision 校验
→ 原子 JSON 文件替换
→ 响应中的 document / updatedAt 被客户端丢弃
→ BrowserWindow close / app quit 不等待保存
```

服务端已经用 mutation lock 串行化普通写请求，并用临时文件加 rename 原子替换本地数据库；这些只能证明单次写入具备 `COMPONENT_CAPABILITY`。没有 revision 时，较旧客户端快照仍能在后到请求中覆盖新版本；主进程也没有消费渲染器保存结果。因此当前关闭/退出路径是 `NOT_CAUSALLY_VERIFIED`，不能把界面的“已保存”或一次成功 PATCH 当作端到端可靠保存。

## 已确认问题

| 问题 | 严重程度 | 代码位置 | 当前实际行为 | 因果链断点 | 统一修复方向 | 阻止本轮验收 |
| --- | --- | --- | --- | --- | --- | --- |
| 自动保存可被持续输入无限推迟 | 高 | `src/App.tsx` 编辑器保存 effect | 每次 `documentItem` 变化都重置 900 ms timer | dirty 状态没有最大等待上限 | 350 ms 空闲保存，并从首次 dirty 起设置 2 s 最大等待 | 是 |
| 本地保存状态依赖公网在线状态 | 中 | `SaveState` 与 online/offline listeners | `navigator.onLine=false` 时显示“离线编辑”，即使本机 API 可正常落盘 | UI 状态来源错误 | 状态仅由本机保存请求的真实结果驱动：pending/saving/saved/error | 是 |
| 每次保存整份 blocks | 高 | `api.updateDocument` / 文档 PATCH | 大文档修改一个字符也发送、校验并重建所有块 | 改动粒度与输入规模无关 | 新增 revision-aware changes API，仅 upsert 本轮改变/新增的块与可选标题 | 是 |
| 无乐观版本锁 | 严重 | `DocumentItem` / PATCH route | 旧快照可以覆盖较新内容 | 请求没有绑定服务端当前版本 | `baseRevision` 必须等于当前 revision；冲突返回 409 且不得写库 | 是 |
| 保存回执未被消费 | 高 | `saveNow` | 成功响应中的 `updatedAt`、规范化 block 和 revision 被丢弃 | UI/后续预处理仍使用旧 lineage | 用响应 document 合并已确认字段，并只清理本次 edit version 对应的 dirty 集合 | 是 |
| 关闭窗口和退出不等待保存 | 严重 | `electron/main.mjs` | macOS 直接 hide；Windows 直接销毁；before-quit 立即关闭服务 | Electron 生命周期绕过保存门禁 | 受限 preload IPC 请求 renderer flush；成功后才 hide/close/quit，失败明确提示并保留窗口 | 是 |
| 保存失败被自动保存调用吞掉 | 高 | autosave effect | catch 后没有可操作原因，关闭仍可继续 | error 只影响标签，不影响生命周期 | 保留 error 状态/原因，手动保存与关闭门禁向上抛出 | 是 |

## Scope 与 requirements

1. `DocumentItem` 持久化单调递增的 `revision`；旧数据读取时迁移为 `1`。
2. 编辑器每次用户修改生成本地 edit version，并记录 title dirty 与 changed block IDs。
3. 自动保存采用 350 ms idle timer；从首次未保存编辑起最多 2 s 必须启动一次保存，持续输入不能无限延迟。
4. 同一编辑器同一时刻只有一个保存请求；请求进行中产生的新编辑必须留在下一轮，旧响应不能清除或覆盖它们。
5. 保存请求只提交 changed blocks、可选 title、`baseRevision` 和唯一 `clientEditId`。服务端仅消费这些改动，并返回规范化后的完整 document 回执。
6. 服务端在 mutation lock 内验证 revision；冲突返回 `DOCUMENT_REVISION_CONFLICT`，不写数据库、不恢复旧状态、不 silent retry。
7. pending/saving/saved/error 仅描述本地持久化状态，与 `navigator.onLine` 无关；错误状态显示本次失败原因。
8. 手动保存、返回文档库、全局拖入、创建 Tip、云上传/删除、打开本地模型和桌面关闭/退出必须复用同一个 `saveNow` 门禁。
9. 主进程 close/quit 请求必须带 request ID，且只接受目标 BrowserWindow 主 frame 的回复；超时、renderer 销毁或失败均不得默认视为成功。
10. macOS 普通关闭在 flush 成功后隐藏同一个窗口，Window 菜单仍能恢复；Windows 普通关闭在 flush 成功后关闭。Quit 在 flush 成功后才释放本地服务和模型资源。
11. 关闭保存失败时默认保留窗口并显示可理解原因；显式“放弃未保存内容并退出”必须由用户在系统对话框中主动选择，不得成为默认路径。
12. 服务端保存时长和 payload block 数应进入结构化回执/诊断，以便验证大文档只发送改动块；不采集文档正文。

## 设计不变量

- “已保存”只能由当前 document revision 的真实服务端成功回执产生，不能由 timer 到期、请求发出、online 状态或 UI 推断产生。
- `baseRevision` 不匹配时请求必须失败；禁止自动采用服务器内容、自动覆盖服务器内容或复用旧 revision。
- 保存响应只能确认请求快照中包含的 edit version/dirty block；请求发出后的输入必须保留。
- 服务端返回的规范化 block 是该次提交块的权威结果；未提交块继续保留客户端当前编辑状态，不能被旧响应替换。
- close/quit handshake 必须发生在本地服务关闭之前；否则 renderer 无法完成最后一次 PATCH。
- IPC bridge 只暴露保存请求监听和带 request ID 的结果回复，不暴露 Node/Electron 任意能力。
- 本地保存不以互联网为前提。联网、Supabase 和 Tavily 状态均不得改变本地 save state。
- 所有错误必须显式，不允许 silent fallback、固定等待后假定成功或在失败后继续导航。

## Non-goals 与已知框架边界

- 本轮不把 JSON 本地数据库迁移为 SQLite。该优化有价值，但会扩大 App Store 复审修复面，标记为 `KNOWN_FRAMEWORK_GAP`；本轮仍依赖现有原子临时文件替换。
- 本轮不实现多人实时协同合并。revision 冲突会明确失败，用户重新打开后再编辑，而不是自动三方合并。
- 本轮不改变原始 DOCX/PDF 文件；保存目标仍是 App 的本地文档副本。
- 本轮不改变云端 5 MB 限额、显式云上传语义或搜索/模型功能。
- Windows 可以验证共享代码、正式 Electron 入口和打包行为；真实 macOS sandbox、Cmd+Q、红色关闭按钮和 MAS 签名包仍需真机执行，未取得证据前保持 `NOT_CAUSALLY_VERIFIED`。

## Acceptance criteria 与先失败的负向测试

### 保存协调器（COMPONENT_CAPABILITY）

1. 单次编辑在 350 ms 空闲后保存；持续每 200 ms 编辑时仍在首次 dirty 后不晚于 2 s 启动保存。
2. 保存进行中再次编辑：第一次回执只确认旧 edit version，协调器自动发起第二轮，最终保存新内容。
3. 保存失败：状态为 error、dirty 保留、`flush()` reject；下一次显式重试成功后才能成为 saved。
4. 销毁协调器后 timer 不得继续调用保存。

### 服务端版本化 changes API（FORMAL_PATH_INTEGRATION）

1. revision=1 文档提交一个 changed block 后 revision=2；GET 返回该 block、服务端规范 hash 和相同 revision。
2. 请求只含一个 block 时，其他块保持不变，回执记录 `savedBlockCount=1`。
3. 用旧 baseRevision 再写必须返回 409；数据库内容/revision/updatedAt 均不改变。
4. 表格 changed block 必须从 rows 重算 content；畸形表格必须 400，不能部分保存。
5. fabricated document ID、其他用户文档、重复 block ID、超过块数上限、未知 block 必须失败且不落盘。
6. 旧数据库没有 revision 时读取为 1；云端旧 payload 也必须规范化，不能产生 undefined revision。

### Renderer 正式路径（FORMAL_PATH_INTEGRATION / INDEPENDENT_EVALUATION）

1. 实际 contenteditable 连续输入，UI 先显示 pending，再 saving，真实 GET 确认全文后显示 saved；离线事件不改变本地保存状态。
2. 拦截首个保存请求并在途继续输入，释放后必须看到两次有序 revision 请求，最终 GET 为最新文本。
3. 注入 500/409 后 UI 显示 error 和原因；返回、拖入、创建 Tip、云操作、关闭均不得绕过失败。
4. 大文档只修改一个块，正式请求 payload 必须只有该块，不能出现完整 blocks 数组。
5. 成功回执的 `updatedAt/revision` 必须进入页面元数据和后续预处理依赖。

### Electron close/quit（FORMAL_PATH_INTEGRATION）

1. close request 在 renderer flush 完成前窗口仍存在；成功后 Windows 关闭、macOS 隐藏。
2. renderer 返回失败、超时或被销毁时，默认保留/恢复窗口并展示原因。
3. 伪造 request ID、错误 webContents 或子 frame 回复不能解锁关闭。
4. quit 成功顺序必须是 `flush success → second app.quit → resource cleanup`；不能先关本地 server。
5. 无编辑器页面也要通过同一 handshake 返回成功，不能因未注册保存函数而卡死。

## Requirement closure 证据要求

每项 requirement 必须形成：

```text
Requirement
→ production implementation
→ focused test
→ applicable negative control
→ formal entry consumption
→ current-run evidence
→ acceptance status
```

只存在 class、函数、IPC channel 或测试 fixture 最多证明 `LEVEL_0_DEFINED` / `COMPONENT_CAPABILITY`。只有真实编辑进入 changes API、服务端 revision 落盘、关闭事件等待同一保存门禁并改变窗口生命周期，才能证明 Windows 正式路径达到 `LEVEL_5_PREDICTION_BEARING`。macOS 在真机证据前不得跨级推断。

## 最终实现

正式保存链现在是：

```text
contenteditable / title input
→ editVersion + title/block dirty lineage
→ 350 ms idle / 2 s maximum-delay coordinator
→ { baseRevision, clientEditId, changed blocks, optional title }
→ mutation lock 内校验 revision 和 block identity
→ 原子本地数据库写入
→ { document, clientEditId, baseRevision, revision, savedBlockCount, durationMs }
→ 校验回执 lineage
→ 仅确认本批次对应的 dirty version
→ pending / saving / saved / error
→ close/quit IPC 使用同一个 flush promise
→ 成功后才 close/hide/quit 和释放服务
```

实现位置：

- `src/document-save-coordinator.ts`：单飞保存、idle/max-delay timer、回执验证和并发编辑合并；
- `src/App.tsx`：标题/块 dirty lineage、所有危险操作共用 `saveNow`、可见错误原因、桌面保存请求处理；
- `server/index.ts`：document revision、增量 `/changes` 路径、冲突和结构校验；
- `electron/save-request-broker.mjs`：request ID、超时、一次性应答和取消；
- `electron/main.mjs` / `electron/preload.cjs`：受限 IPC、窗口关闭与应用退出握手；
- `scripts/test-document-save-coordinator.ts`、`scripts/test-versioned-document-save.ts`、`scripts/test-save-request-broker.mjs`：组件和服务端负向测试；
- `electron/main.mjs --save-lifecycle-test` / `--save-quit-test`：实际打包前桌面入口的生命周期测试。

对抗性复审中额外修复了以下旁路：

1. 新增块在首次创建请求进行中又被编辑时，第一次回执会确认“已创建”，但不会清除后续编辑；下一轮不会错误地再次声明为新块。
2. 内容回执不会回滚同时发生的收藏等非本批次元数据，`updatedAt` 也不会倒退；服务端导出的 `cloudState` 仍被消费。
3. 伪造或不完整回执（包括错误 `savedBlockCount`）在改变 dirty/new-block 状态之前被拒绝。
4. 语言切换不再重新加载整份文档；旧 document ID 的异步响应不能写入新编辑器，切换文档会重建编辑器实例。
5. 聊天保存失败时不再无条件重载整份文档：请求未开始则只移除临时消息，请求已开始则只刷新 Tip，未保存正文不会被服务器旧快照替换。
6. OCR 更新的是独立的 PDF 文字层，并在全局 mutation lock 内写入；它不错误递增仅用于可编辑 title/blocks 的 revision，避免页面未消费 OCR revision 后所有正文保存永久 409。
7. 云文件 Electron 测试服务已消费真实 `/changes` revision 协议，不再用旧全量 PATCH fixture 产生伪失败或伪通过。

## Requirement closure（2026-10-09 当前运行）

| # | Requirement → implementation → evidence | 状态 |
| --- | --- | --- |
| 1 | `DocumentItem.revision`；新建/导入从 1 开始，旧本地/云 payload 规范为 1；服务端迁移测试验证 | `VERIFIED` |
| 2 | 每次标题/块修改生成 edit version，并分别记录 dirty lineage；协调器测试与真实编辑测试消费 | `VERIFIED` |
| 3 | 350 ms idle、2 s maximum dirty interval；fake-clock 反事实测试证明持续输入不能无限推迟 | `VERIFIED`（`COMPONENT_CAPABILITY`） |
| 4 | 单飞请求；请求期间新增输入进入下一 revision；真实 Electron 测试最终从 revision 2 连续保存到 4 | `VERIFIED`（Windows `LEVEL_5_PREDICTION_BEARING`） |
| 5 | 正式 UI 的 3 块文档只提交第 1 个改动块；真实 GET 证明其余 2 块保持不变 | `VERIFIED`（Windows `LEVEL_5_PREDICTION_BEARING`） |
| 6 | mutation lock 内验证 base revision；stale 请求为 409 且正文、revision、updatedAt 不变；旧全量 PATCH 不能绕过 revision | `VERIFIED`（`FORMAL_PATH_INTEGRATION`） |
| 7 | 状态只由协调器真实结果产生；真实 Chromium 中把 `navigator.onLine` 设为 false 后仍完成本地 revision 保存 | `VERIFIED`（Windows `LEVEL_5_PREDICTION_BEARING`） |
| 8 | 手动保存、返回、拖入、Tip、聊天、云上传/删除和本地模型入口共用 `saveNow`；桌面 smoke、云客户端和正式关窗测试覆盖关键入口 | `VERIFIED`；个别入口证据为组件/真实 UI smoke，不冒充独立评估 |
| 9 | broker + preload/main frame 校验；超时、destroy、重复回复、伪 request ID 和错误 BrowserWindow 均不能解锁关闭 | `VERIFIED`（Windows `FORMAL_PATH_INTEGRATION`） |
| 10 | Windows 成功后关闭；macOS 分支成功后隐藏同一窗口；Quit 成功后才清理资源 | Windows `VERIFIED`；macOS `NOT_CAUSALLY_VERIFIED` |
| 11 | 保存失败保留/恢复窗口并显示具体原因；Quit 只有系统对话框显式第三选项才能放弃 | 默认失败路径 `VERIFIED`；真实人工点击“放弃”未自动化，保留为发布前手工检查 |
| 12 | 回执含 block 数与耗时，不含正文诊断；服务端测试验证有限非负耗时，客户端校验 block 数 | `VERIFIED` |

### 当前负向控制

- stale revision、旧 PATCH 无 revision、未知/重复块、把既有块冒充新增块、2001 块超限、缺失文档、跨用户文档；
- 畸形表格、表格 stale content、回执缺块、错误 saved-block count；
- 保存失败后 dirty 保留、保存期间继续输入、创建新块期间继续输入、销毁后的 stale timer；
- renderer 失败、renderer 不可用、超时、重复回执、取消、伪 request ID、错误窗口回复；
- 关窗保存失败、关窗时保存阻塞、退出时保存阻塞、本地服务提前关闭、离线状态误导；
- 云端 fixture 仍走旧 PATCH 的 stale-test 路径（已修复并重新执行完整门禁）。

## 当前验证结果

以下命令均在 2026-10-09、Windows 当前源码修改之后退出码为 0：

```text
pnpm save:reliability:test
pnpm skills:test
pnpm desktop:smoke
pnpm editions:test
pnpm privacy:test
pnpm stream-rag:test
pnpm ux:test
pnpm python:offline:test
```

关键正式路径结果：

```text
Windows close:
  noEditorHandshake=true
  failedSaveKeptWindow=true
  closeWaitedForInFlightSave=true
  inFlightEditReachedNextRevision=true
  forgedRequestIdRejected=true
  wrongWindowReplyRejected=true
  navigator.onLine=false does not change local save state
  one changed block sent from a three-block document
  untouchedBlocksPreserved=true
  persistedRevision=4

Windows quit:
  quitWaitedForInFlightSave=true
  localServerAliveUntilSaveReply=true
  cleanupAfterPersistedRevision=true
  persistedRevision=2
```

构建仍报告既有的 esbuild CJS `import.meta` warning；构建和运行测试均成功，但该 warning 不是本轮保存链修复的通过证据，也没有被静默称为已修复。

## 最终边界与发布前状态

- Windows 当前正式保存、关窗和退出链有实际 Electron + 本地 API + 持久化 revision 证据，可评为 `LEVEL_5_PREDICTION_BEARING`。
- 共享代码、local-direct、api-direct 和 local-mas 三个变体均已构建和启动验证；这不能替代 macOS 真机。
- macOS 红色关闭按钮、Window 菜单恢复、Cmd+Q、sandbox 和签名 MAS 包仍是 `NOT_CAUSALLY_VERIFIED`。`pnpm save:reliability:test` 已按平台分支编写，可在 macOS 上验证 close=hidden 与 quit 顺序。
- SQLite 迁移仍为 `KNOWN_FRAMEWORK_GAP`。当前增量协议减少 renderer→server 的 payload 和解析/重建范围，但底层 JSON 数据库依然进行原子整库序列化；不能宣称大数据库磁盘写入已经变成页级增量。
- 因缺少 macOS 真机运行证据，跨平台发布 requirement closure 总状态为 `NOT CLOSED`；Windows 本轮实现与验证范围已关闭。
