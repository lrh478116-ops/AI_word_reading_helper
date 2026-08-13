# 已有 PDF Tip 打开时的根页面滚动隔离

## 审计结论

用户报告的“点击《00百穰新能源介绍-通用-市场版（202602)》中的 Tip 后，App 内所有显示上移”已在用户数据的隔离副本中精确复现。该文档第 2 页的 PDF Tip `e9158ac9-7941-45dd-b6a0-91fc3ca134cf` 含 2 条历史消息。点击前 `window.scrollY = 0`、顶部栏 `top = 0`；点击后 `window.scrollY = 155.2px`、顶部栏 `top = -155.2px`，而 `.editor-scroll.scrollTop` 保持 `700.8px` 不变。

真实因果链为：

```text
点击 PDF 页面已有 Tip
→ activeTip 变化并挂载 TipPanel
→ 历史消息渲染使 message end 位于可视区外
→ TipPanel effect 调用 endRef.scrollIntoView({ behavior: "smooth" })
→ 浏览器同时滚动 message-list 和更外层根滚动容器
→ documentElement.scrollTop 增加 155.2px
→ editor-nav、editor-main、editor-topbar 整体移动到视口上方
```

此前“四页扫描 PDF + 新建空 Tip”的测试只证明空 Tip 打开不会改变 PDF 页面几何，属于组件能力证据，未覆盖历史消息触发的正式路径，因此对本缺陷标记为 `NOT_CAUSALLY_VERIFIED`。本次真实数据副本复现属于 `FORMAL_PATH_INTEGRATION` 证据。

## 已确认问题

| 问题 | 严重程度 | 代码位置 | 设计要求 | 当前实际行为 | 直接证据 | 潜在影响 | 错误验收风险 | 统一修复方向 | 阻止发布 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Tip 自动滚动没有限定在消息列表 | 高 | `src/App.tsx` 的 `TipPanel` | 打开或续写 Tip 时只能滚动 `.message-list` | `scrollIntoView` 会滚动所有必要祖先 | 真实文档点击后根滚动 155.2px | 顶栏、导航、PDF 和 Tip 面板整体上移，底部露白 | 空 Tip 测试会误判通过 | 持有消息列表 ref，直接设置该元素的 `scrollTop` | 是 |
| 编辑器根布局允许产生页面级溢出 | 高 | `src/styles.css` 的 `.editor-shell` | 编辑器应固定在一个视口内，内部区域各自滚动 | `min-height: 100vh` 与子列高度/内容可形成超过视口的根页面 | 复现时 `documentElement.scrollHeight = 909`，视口高度仅 754 | 任何后续 `scrollIntoView` 都可能再次带动整个 App | 只修当前 effect 可能遗漏未来入口 | 把编辑器 shell 固定为 `height: 100vh; min-height: 0; overflow: hidden`，并为网格子项补 `min-height: 0` | 是 |
| smoke test 没有历史消息和根滚动断言 | 高 | `electron/main.mjs` | 点击已有消息的 PDF Tip 后根滚动必须始终为 0 | 新建空 Tip 后立即折叠再打开，未触发历史消息路径；只比较 marker/nav 相对坐标 | 用户真实 Tip 有 2 条消息，旧 smoke Tip 为 0 条 | 打包产物仍可带缺陷却显示测试通过 | 先发送消息形成持久化历史，再折叠并从 PDF marker 重开；逐帧断言 window/document/body 滚动和固定列边界 | 是 |

## 设计不变量

- Tip 消息自动滚动只能修改对应 `.message-list.scrollTop`，不得调用会影响未知祖先的 `scrollIntoView`。
- 点击已有 PDF Tip、文档 Tip、聊天子 Tip时，`window.scrollY`、`document.documentElement.scrollTop` 和 `document.body.scrollTop` 必须保持 0。
- `.editor-scroll.scrollTop` 是 PDF/文档阅读位置的唯一滚动状态；打开 Tip 不得改变它。
- 左侧导航、顶部栏和右侧 Tip 面板的视口边界不得因聊天历史长度而改变。
- 聊天历史仍必须在面板内部自动定位到底部；修复不能以取消自动滚动作为代价。
- 不能通过清空历史消息、缩短回答、关闭动画或只修该文档 ID 来绕过缺陷。

## 非目标

- 不修改用户原 PDF、OCR 结果、Tip 锚点、聊天内容或 Tip 树结构。
- 不改变 PDF 页面缩放算法和 OCR 文本层坐标。
- 不以特定文档标题、Tip ID 或固定 155.2px 偏移编写特例。

## 先失败的回归与负向测试

1. 在四页横向扫描 PDF 上完成 OCR 并创建 PDF Tip。
2. 通过正式聊天接口发送问题并等待 assistant 消息持久化，使 Tip 至少包含 user/assistant 两条历史消息。
3. 折叠 Tip，通过 PDF 页面 marker 重新打开同一 Tip。
4. 点击前把根页面滚动归零，记录阅读区滚动、PDF marker、顶部栏、导航和根滚动。
5. 点击后按动画帧持续采样至少 500ms。
6. 任意时刻 `window.scrollY`、`documentElement.scrollTop` 或 `body.scrollTop` 超过 1px即失败。
7. 阅读区滚动或固定列边界变化超过 2px即失败。
8. 同时断言消息列表已滚到其底部，证明功能不是通过禁用消息自动滚动获得假通过。
9. 在 Windows 打包产物中运行同一测试，避免源代码通过而发布包仍为旧实现。

## 验收等级

只有真实数据隔离副本中的原 Tip 和通用 smoke fixture 两条路径都证明：历史消息被正式消费、消息列表内部滚到底部、根页面保持 0、阅读位置和列边界稳定，才可将 Windows 验收提升为 `LEVEL_5_PREDICTION_BEARING`。macOS 仍需真机重复验证，不能由 Windows 结果替代。

## 实施与验证结果

- `TipPanel` 不再调用消息末端元素的 `scrollIntoView`；改为在 `useLayoutEffect` 中仅设置当前 `.message-list.scrollTop = scrollHeight`。
- 编辑器 shell、主阅读区和 Tip 网格补齐固定视口高度、`min-height: 0` 与内部 overflow 约束；编辑器存在时，`html/body/#root` 使用 `overflow: clip` 阻止根页面成为滚动目标。
- 通用桌面 smoke 现会创建 OCR PDF Tip、通过正式聊天接口形成 3 轮（至少 6 条）持久化历史，再从 PDF marker 重开；同时验证消息列表到达底部、根滚动不超过 1px、阅读区与固定列变化不超过 2px。
- 修复前，在用户数据隔离副本中点击真实 Tip 后，`window.scrollY` 与 `documentElement.scrollTop` 从 0 增至 `155.2px`，顶部栏变为 `top = -155.2px`，而阅读区滚动不变，确认问题由根滚动造成。
- 修复后，对同一文档、同一第 2 页 Tip、同一 2 条历史消息连续采样 2.5 秒：根滚动最大值 `0px`、顶部栏位移 `0px`、阅读区滚动位移 `0px`；聊天列表底部误差 `0.2px`，说明自动定位功能保留。
- 真实 PDF 使用 Poppler 独立核对为 41 页、每页 `960 × 540 pt`、无旋转；第 2 页渲染中的中文、图片和原版式正常。
- Windows `1.9.2` 解包发布产物再次在用户数据隔离副本上打开同一真实 Tip：275 次连续采样中根滚动、顶部栏位移和阅读区位移均为 `0px`，历史消息仍滚到底部；因此 Windows 正式发布路径达到 `LEVEL_5_PREDICTION_BEARING`。
