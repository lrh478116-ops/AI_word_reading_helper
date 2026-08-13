# PDF OCR 期间的界面布局稳定性

## 审计结论

点击“识别本页文字”后，OCR 识别本身不会移动 Electron 窗口。真正的布局变化发生在 OCR 结果持久化之后：`onOcrSaved` 替换当前 `pageSource`，`PdfPageCanvas` 的渲染 effect 因依赖变化再次执行，并无条件把状态切换为 `rendering`。CSS 对所有非 `rendered` 页面执行 `.pdf-page-surface { display: none; }`，同时显示固定为 A4 纵向比例的 skeleton。

对于 PPT 导出的横向 PDF，页面会在“真实横向高度”和“A4 纵向 skeleton 高度”之间切换。页面列表的累计高度随之改变，滚动锚定会补偿这些变化，所以中心 PDF、左侧导航和右侧 Tip 面板看起来整体上移或出现底部空白。当前实现最多证明 OCR 输出可用，不能证明 OCR 期间布局稳定，标记 `NOT_CAUSALLY_VERIFIED`。

## 已确认问题

| 问题 | 严重程度 | 代码位置 | 直接证据 | 影响 | 错误验收风险 | 统一修复方向 | 阻止发布 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 已渲染页面在 OCR 写回时被隐藏 | 高 | `src/PdfPreview.tsx` | `pageSource` 变化触发 effect，随后无条件 `setState("rendering")` | 当前页高度短暂失真，滚动位置漂移 | 单页、页面顶部 OCR 烟雾测试无法发现 | 区分首次渲染和后台文字层刷新；已有 Canvas 始终保留 | 是 |
| skeleton 强制 A4 纵向比例 | 高 | `src/styles.css` | `.pdf-page-skeleton { aspect-ratio: 210 / 297 }` | 横向 PPT PDF 高度被替换为错误比例 | 只测试 A4 扫描件会误过 | 初次加载才显示 skeleton；后台刷新不得切换 skeleton | 是 |
| 验收未测滚动和三栏几何 | 高 | `electron/main.mjs` | OCR 只在单页、顶部、无活跃 Tip 时执行 | 无法证明用户截图中的场景 | “OCR 成功”被误称为“界面稳定” | 使用多页横向扫描 PDF，在第 3 页且 Tip 打开时记录高度、scrollTop、导航和 Tip 面板边界 | 是 |

## 设计不变量

- OCR 计算期间不得修改 Canvas 的 CSS 宽高、PDF page shell 高度、编辑器滚动位置或三栏顶/底边界。
- OCR 结果写回只更新文字层、OCR 来源、置信度和 Tip 能力，不得把已经渲染的页面重新降级为 skeleton。
- 首次渲染仍必须显示加载状态；后台重绘失败时不得销毁最后一次成功的 Canvas。
- ResizeObserver 引起的真实宽度变化允许按 PDF 宽高比重新布局，但 OCR 数据变化本身不能触发几何变化。
- 验收必须覆盖多页、横向页面、滚动到中间页、活跃 Tip 面板、OCR 写回后的完整场景。

## 先失败的回归测试

1. 固定夹具改为至少 4 页、16:9、纯图片 PDF，独立提取文本必须为空。
2. 先 OCR 第 1 页并创建 OCR Tip，让右侧 Tip 面板保持打开。
3. 滚动到第 3 页并等待 Canvas 与三栏布局稳定。
4. 记录第 3 页 shell 高度、`.editor-scroll.scrollTop`、左侧导航和右侧 Tip 面板的边界。
5. 点击第 3 页 OCR，按动画帧持续采样直到 OCR 文字层完成。
6. 任一时刻页面高度变化超过 2 CSS px、滚动位置变化超过 2 px、导航或 Tip 面板边界变化超过 2 px即失败。
7. OCR 完成后仍需选择文字创建 PDF Tip，以证明布局修复没有绕过 OCR 正式主链。

## 验收等级

只有源码态和 Windows 打包态都通过上述多页反事实测试，才能把“PDF OCR 不导致界面上移”判定为 `LEVEL_5_PREDICTION_BEARING`。macOS 仍需真机重复测试，不能由 Windows 结果代替。

## 实施结果

- 把 OCR DOM 同步抽成 `syncOcrTextLayer`；`pageSource` 写回只删除/重建透明 `.pdf-ocr-word`，不再触发 PDF Canvas 渲染 effect。
- 已显示的页面即使因真实宽度变化后台重绘，也继续保持 `rendered` 布局，不再降级成首次加载 skeleton；后台重绘失败时保留最后一次成功 Canvas。
- 修改前，同一多页回归捕获到最大 `383.35px` 几何漂移并失败。
- 修改后，源码 Electron 测试在第 1 页创建 OCR Tip、右侧面板打开、第 3 页滚动居中的场景完成 OCR，最大几何变化为 `0.600006px`，低于 `2px` 阈值；随后第 3 页 OCR 文字仍通过正式接口创建 `source=ocr` PDF Tip。
- 清理旧 release 后重新生成 `AI Tip Setup 1.9.1.exe`；Windows 打包态运行同一 smoke test，最大几何变化同样为 `0.600006px`，并通过 OCR Tip 主链验证。因此 Windows 源码态与打包态均达到 `LEVEL_5_PREDICTION_BEARING`。
