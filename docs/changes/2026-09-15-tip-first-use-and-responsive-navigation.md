# Tip 首次使用与响应式导航

## 只读审计、统一方案

| 问题 | 严重性 / 位置 | 当前行为与证据 | 影响 / 验收风险 | 修复方向 / 阻断 |
| --- | --- | --- | --- | --- |
| Python 扩展包依赖开发机缓存 | 中，server/python-worker.mjs、package.json | loadPackage(sympy/pandas) 在缓存缺失时下载；1.12.13 实物已有 7 个 wheel，但没有构建期完整性门禁 | 开发机成功不能代表干净安装离线可用 | 根据锁文件依赖闭包准备并校验资源，运行期缺失明确失败；阻止离线能力验收 |
| 首条回答之前等待不可见 | 中，server/index.ts chat → 模型专业评估 → 可选搜索 → 模型生成；src/api.ts / App.tsx | 首个技能事件在评估完成后才发送，期间只有跳动圆点 | 用户无法区分模型等待、搜索、工具初始化；不能认定全部是下载 | 从实际阶段发送状态，并显示本轮等待时长；不删除专业判断，不伪造进度百分比 |
| 全屏目录仍是固定 10px | 中，src/styles.css .outline button | 侧栏固定 215px，目录固定 10px，单行截断 | 大窗口文字过小、长标题难辨；不能只检查 CSS 字符串 | 受上下限约束的响应式字号/宽度，长标题换行及悬停完整标题；实际多尺寸窗口验收 |

## 不变量与非目标

- 先失败回归，再修改。包清单来自当前 pyodide 锁文件，校验 SHA-256，依赖缺失/篡改不得回落到 CDN。运行时不能向安装目录下载或写缓存。
- 不改变联网总开关、模型判断、答案或引用审查；不把模型权重偷偷塞进安装包，不做付费 API 预热请求。
- Python 工作线程仍按请求隔离并保留超时终止。状态事件是体验反馈，不冒充已执行工具或准确性证据。
- 字号按 CSS 视口变化，保留小窗口导航隐藏与 PDF/Tip 布局约束；不以全局 zoom 改变文档内容。
- 本轮不修改云服务器、认证或账号数据，不自动上传 GitHub。

## 验收条件

组件：依赖闭包/摘要校验、缺包/篡改失败、断网首次 Python 运算；正式路径：Tip 的阶段实际来自服务器、界面消费；不同窗口目录字号增大且无页面横向溢出。完整回归与最终安装包检查分开记录。生产模型首字延迟在无真实模型测量时标记 NOT_CAUSALLY_VERIFIED，不声称已消除模型冷启动。

## 本轮实际验证（2026-09-15 / 1.12.14）

- 修改前目录窗口测试失败 `Directory font must grow with the viewport`；阶段消费测试收到空数组而失败。修改后 `pnpm ux:test` 三项通过。资源缺失/摘要损坏会拒绝，未知阶段不会进入 UI，回答正文保持原值。
- 实际 Chromium 渲染：1280 宽窗口目录为 12px，1920 宽窗口目录为 15.2512px（CSS 内容宽度受窗口边框影响），侧栏从 215.2875px 增至 320px；900px 窗口未出现根页面横向溢出。此项为 COMPONENT_CAPABILITY，不替代 macOS 实机验收。
- 使用 `--require ./scripts/fixtures/forbid-python-network.cjs` 禁止主进程及继承参数的 Worker 使用 fetch/http/https/net，`test-python.mjs` 与 `test-advanced-skills.mjs` 通过。属于真实本地组件执行，不是生产模型时延评估。
- `pnpm skills:test` 完整回归通过。正式 chat 路径的阶段事件与 Python 输出同时校验，未改变答案生成与专业审查策略。
- 打包后 `release/win-unpacked/AI Tip.exe --smoke-test` 通过；新增断言从真实 Tip 面板读到 `assessing` 和等待时长，随后原回答到达。PDF、OCR、嵌套 Tip、编辑、自动保存及桌面系统密钥存储旧回归通过。受控模型属于 FORMAL_PATH_INTEGRATION，不声称对生产模型的 INDEPENDENT_EVALUATION。
- 最终资源目录含 7 个 wheel，总计 12,467,480 字节；开发机 pyodide 目录中的重复 wheel 没有进入包。桌面正式 Worker 显式接收资源目录，不依赖用户从哪个工作目录启动应用。
- 安装包：`release/AI Tip Setup 1.12.14.exe`，SHA-256 `6b4fd1d3d2fcee370945ff7f4081f150cdbb3b9d3c6e94052b68e0c53fe87c15`；app.asar SHA-256 `1be3e211fcc19f8d60d808abfcb09fc42514603392a1759648acd3f11ab7936e`。结果记录在 `release/packaged-smoke-1.12.14.json` 与 `release/release-manifest.json`；工作区变更未提交，manifest 如实标记 sourceDirty=true，不能把旧 HEAD 视为本轮完整源码快照。Windows 仍未数字签名。

## 尚未处理的体验优化点与边界

以下为 1.12.14 的历史状态；流式/取消/预加载现已在 [1.12.15 变更记录](2026-09-15-stream-cancel-preparation-rag.md) 中更新。证据口径更正：本文受控模型冒烟测试不能替代真实模型集成或独立评估，按当前严格口径只计 COMPONENT_CAPABILITY。

- 工具规划路径仍使用 `stream: false`，无工具调用时也是等完整正文返回后才展示。这是另一种等待来源；下一步需要具备工具调用增量拼装、审查缓冲与无结果搜索兼容性的真正流式改造，本轮没有把阶段提示冒称为首字延迟降低。
- 前端停止读取与后端模型/工具取消还没有统一的取消信号链，取消资源消耗仍有优化空间。本轮保持原有停止行为，没有宣称后端任务已立即终止。
- 不在未获用户模型选择的情况下预下载数 GB 权重；不做额外付费模型预热请求。macOS 配置包含同一份 WASM 依赖，实机兼容性仍需在 macOS 构建验证。
