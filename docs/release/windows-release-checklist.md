# Windows 发布检查表

## 当前工程目标

- Windows 10/11 x64 桌面应用；当前不声明 Windows on ARM 原生支持。
- 安装器允许用户选择路径并创建桌面快捷方式。
- 候选包必须由当前提交重新构建，运行 `pnpm desktop:smoke` 后再运行 `pnpm desktop:dist:win` 与 `pnpm release:manifest:win`。

## 不可跳过的门禁

- [ ] `pnpm skills:test`、`pnpm desktop:smoke`、`pnpm audit --prod` 和完整 `pnpm audit` 均通过。
- [ ] `release/release-manifest.json` 的版本、提交、SHA-256 和当前候选一致，`sourceDirty` 为 `false`。
- [ ] `release/win-unpacked/resources/THIRD-PARTY-NOTICES.txt` 存在。
- [ ] 安装、首次启动、文档拖入、PDF/OCR Tip、Word 表格编辑、退出重开和卸载均在干净 Windows 账户验证。
- [ ] 安装器和主 EXE 使用同一可信发布者身份完成 Authenticode 时间戳签名；签名后不再修改文件。
- [ ] 从最终下载地址重新下载候选包，核对 SHA-256 与签名，而不是只测试构建目录中的副本。

## 当前外部阻断

没有可信代码签名证书时，`create-release-manifest.mjs` 会如实记录 `NotSigned`。这不是测试可忽略的提示：Microsoft SmartScreen 会把无签名文件作为每个新哈希重新建立信誉，部分企业策略或 Smart App Control 会直接阻止运行。可选择可信 Authenticode/Artifact Signing，或通过 Microsoft Store 分发由商店签名；不能用自签名冒充正式发布签名。
