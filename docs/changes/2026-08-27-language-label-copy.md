# 中文语言标签文案调整

日期：2026-08-27

## 要求

将中文界面中的“界面语言”改为用户指定的小写英文 `language`。

## 审计结论

登录页与设置页均通过共享翻译键 `language.label` 渲染该标签，没有第二条硬编码路径。因此只修改中文词典中的共享键即可同时影响两个正式入口；英文词典继续使用 `Language`。

## 验收条件

- `translate("zh-CN", "language.label")` 必须严格等于 `language`，包括小写形式；
- 英文标签仍严格等于 `Language`；
- 登录页和设置页继续消费同一个翻译键；
- 类型检查和桌面 UI 烟雾测试不得回归。

## 实施与验证

- 中文词典的共享 `language.label` 已严格改为小写 `language`；英文词典仍为 `Language`。
- 先失败的产品回归在旧文案下返回“语言标签没有按要求区分”，修改后通过。
- TypeScript 类型检查通过。
- Electron 正式登录页 UI 断言确认中文状态下标签文本严格等于 `language`。
- 开发版与打包后 Windows 桌面完整烟雾测试均通过。
- 新安装包：`AI Tip Setup 1.12.9.exe`。
- SHA-256：`9D98644AE128417A527F0C9E9BF7F5BD2618BF383FC0E9420E4D4208A8D61954`。
- Authenticode 状态仍为 `NotSigned`。
