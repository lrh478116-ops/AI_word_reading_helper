# 对话联网开关与联系邮箱复制

日期：2026-08-26

## 用户要求

1. 每个 Tip 对话框的纸飞机发送按钮旁显示联网搜索开关。
2. 对话开关与设置页的“联网搜索”使用同一份持久化设置，任一处修改后另一处必须显示相同状态。
3. 主页面左侧栏“设置”上方显示“联系我们：2280810215@qq.com”，点击后直接复制邮箱。

## 修改前只读审计

正式回答链已经在每次 `/api/tips/:id/chat` 请求中读取用户当前 `StoredAiSettings.webSearchEnabled`。关闭时不会注册 `web_search` 工具，搜索计划也会得到 `disabled`；开启后才允许 Tavily、免 Key 参考站点及专业/政策联网审查。因此服务端开关达到 `LEVEL_5_PREDICTION_BEARING`，当前缺口是对话输入区没有读取或更新同一字段。

设置弹窗从 `GET /api/settings` 读取该字段，并通过 `PUT /api/settings` 保存。`normalizeSettings` 对未提交的字段保留已有 API Key、Tavily Key、Prompt 和模型配置，允许对话开关只提交 `webSearchEnabled`，而不会清空密钥或覆盖其他设置。

主页面设置入口位于 `AppNav` 的 `.nav-bottom`。修改前没有联系入口，也没有复制成功/失败反馈。

## 设计不变量

- 对话开关和设置开关必须写入同一个用户级 `webSearchEnabled`，不得建立只存在于前端的新开关。
- 所有同时显示的父 Tip、子 Tip、孙 Tip 必须共享一个状态；不能每个 Tip 各自联网。
- 对话开关保存成功后才更新视觉状态；失败时恢复原状态并明确报错。
- 回答生成期间禁止改变开关，避免界面状态与已开始回答所使用的设置不一致。
- 设置弹窗保存后，对话开关必须重新读取正式设置；对话开关更新后，再打开设置必须显示新值。
- 关闭联网仍必须阻断 Tavily、百科、备用参考站点和专业/政策审查，不能只隐藏工具轨迹。
- 联系入口必须是 button，可键盘聚焦，并提供明确的可访问名称和复制结果状态。
- 复制失败不能静默显示成功；优先使用 Clipboard API，并保留兼容性回退。

## 先失败的回归与负向测试

1. 中英文必须都有对话联网开/关、切换失败、联系邮箱、复制成功与失败文案。
2. 主页面必须存在 `[data-contact-copy]`，点击后系统剪贴板内容必须等于 `2280810215@qq.com`。
3. 初始设置关闭时，对话开关 `aria-pressed=false`。
4. 对话开关打开后，`GET /api/settings` 必须返回 `webSearchEnabled=true`。
5. 随后打开设置弹窗，其联网开关也必须为打开。
6. 在设置弹窗关闭联网并保存后，所有已显示对话开关必须恢复为关闭。
7. 切换请求失败时不得改变视觉状态，也不得影响当前保存的其他 API、Prompt 或密钥字段。
8. 发送中的回答不得允许切换联网，避免只改变显示却不改变本轮正式执行设置。

## 验收等级

```text
对话开关点击
→ PUT /api/settings 写入用户级 webSearchEnabled
→ GET /api/settings 返回相同值
→ 设置弹窗显示相同值
→ 下一次正式聊天读取该值
→ 决定是否创建 web_search 工具及搜索计划
→ 实际回答与工具轨迹发生相应变化
```

按钮存在或 `aria-pressed` 变化只属于 `LEVEL_0_DEFINED`/`LEVEL_2_RECORDED`。只有持久化设置进入下一次回答的真实搜索决策，才能称为正式同步。

## 非目标

- 本次不把联网设置改成按 Tip 独立保存；用户要求与设置同步，因此它仍是用户级总开关。
- 本次不改变 Tavily 免费额度策略、备用参考站点或专业问题判断逻辑。
- 本次不把邮箱写入云端，也不发送邮件；联系按钮只在本机复制公开显示的地址。

## 实施结果与新鲜证据

### COMPONENT_CAPABILITY

- `api.updateWebSearchEnabled` 只向正式 `/api/settings` 入口提交 `webSearchEnabled` 与语言。
- 服务端回归证明部分更新前后 provider、model、Prompt、模型 API Key 与 Tavily Key 均保持不变，两个 Key 继续以系统安全存储密文保存。
- Electron preload 只暴露有长度上限的 `copyText(value)`，主进程使用系统原生 clipboard 写入并立即回读确认；普通浏览器开发环境保留 Clipboard API 与 DOM 回退。

### FORMAL_PATH_INTEGRATION

桌面 UI 烟雾测试从正式界面验证：

1. 点击主页面 `[data-contact-copy]` 后，Electron 主进程系统剪贴板内容严格等于 `2280810215@qq.com`，测试结束后恢复测试前的剪贴板内容；
2. 初始设置关闭时，Tip 对话开关为 `aria-pressed=false`；
3. 点击对话开关后，正式 `GET /api/settings` 返回 `webSearchEnabled=true`；
4. 打开设置弹窗后，其联网开关同步显示为开启；
5. 在设置中关闭并保存后，已打开 Tip 的对话开关同步恢复为关闭；
6. 对设置 PUT 注入 503 后，对话开关保持关闭并显示错误，没有产生乐观伪成功；
7. 所有父、子、孙 Tip 面板读取同一个 `EditorScreen` 用户级状态，回答生成期间按钮禁用。

既有完整回归同时证明：设置关闭时产生 0 个外部搜索请求、不会向模型注册 `web_search` 工具；打开时 AI 搜索判断与专业/政策安全审查才能进入真实搜索主链。因此本次 UI 入口对同一正式设置的更新达到 `LEVEL_5_PREDICTION_BEARING`，不是只改变按钮外观。

### 发布验证

- `pnpm skills:test`：通过；
- 开发版 Electron 完整桌面烟雾测试：通过；
- 打包后 `release/win-unpacked/AI Tip.exe --smoke-test`：独立结果文件返回 `ok: true`；
- Windows 安装包：`AI Tip Setup 1.12.8.exe`；
- SHA-256：`816882FC7AE77E2F78B5052354BF81A057FE6DC55CA7D8BD1B0E0EB799562B80`；
- Authenticode：`NotSigned`，正式外部分发前仍需发布者证书签名。
