import { strict as assert } from "node:assert";
import { access, readFile } from "node:fs/promises";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");
const [mainSource, indexHtml, appSource, packageSource, lockSource, workspaceSource] = await Promise.all([
  read("electron/main.mjs"),
  read("index.html"),
  read("src/App.tsx"),
  read("package.json"),
  read("pnpm-lock.yaml"),
  read("pnpm-workspace.yaml")
]);
const packageJson = JSON.parse(packageSource);

assert.match(mainSource, /from\s+["']\.\/navigation-policy\.mjs["']/, "正式 Electron 主进程没有消费独立导航策略");
const { isAllowedAppNavigation, isAllowedExternalUrl } = await import("../electron/navigation-policy.mjs");
const allowed = "http://127.0.0.1:43123";
assert.equal(isAllowedAppNavigation(`${allowed}/editor/1`, allowed), true);
assert.equal(isAllowedAppNavigation(`${allowed}@evil.example/`, allowed), false, "带 userinfo 的伪造 URL 绕过了 origin 校验");
assert.equal(isAllowedAppNavigation("http://127.0.0.1:43124/", allowed), false, "不同端口被错误放行");
assert.equal(isAllowedAppNavigation("not a url", allowed), false, "无效 URL 被错误放行");
assert.equal(isAllowedExternalUrl("https://example.com/help"), true);
assert.equal(isAllowedExternalUrl("mailto:support@example.com"), true);
assert.equal(isAllowedExternalUrl("javascript:alert(1)"), false);
assert.equal(isAllowedExternalUrl("file:///C:/Windows/System32/drivers/etc/hosts"), false);

assert.match(indexHtml, /http-equiv=["']Content-Security-Policy["']/i, "渲染入口缺少 CSP");
const csp = indexHtml.match(/http-equiv=["']Content-Security-Policy["'][^>]+content="([^"]+)"/i)?.[1] || "";
for (const directive of ["default-src 'self'", "script-src 'self'", "object-src 'none'", "frame-src 'none'", "base-uri 'none'"]) {
  assert.ok(csp.includes(directive), `CSP 缺少发布门禁：${directive}`);
}
assert.ok(!/script-src[^;]*unsafe-inline/i.test(csp), "CSP 对脚本错误放开了 unsafe-inline");
assert.ok(!/script-src[^;]*(?:^|\s)'unsafe-eval'(?:\s|;|$)/i.test(csp), "CSP 对普通 JavaScript 错误放开了 unsafe-eval");
assert.match(csp, /script-src[^;]*'wasm-unsafe-eval'/i, "离线 OCR/Python 所需的 WebAssembly 编译权限缺失");

assert.equal(packageJson.version, "1.12.11", "发布修复后必须生成新版本，不能覆盖旧 1.12.10 产物");
assert.equal(packageJson.build?.mac?.minimumSystemVersion, "12.0", "macOS 最低兼容版本没有显式固定");
assert.match(workspaceSource, /^\s*nanoid:\s*3\.3\.18\s*$/m, "已知 nanoid 高危版本没有被锁定到修复版");
assert.doesNotMatch(lockSource, /nanoid@3\.3\.17(?:\b|:)/, "锁文件仍包含已知脆弱的 nanoid 3.3.17");

assert.match(appSource, /https:\/\/lrh478116-ops\.github\.io\/ai-tip-support-site/, "应用仍指向不可用的旧支持站点");
await access(new URL("../THIRD-PARTY-NOTICES.txt", import.meta.url));
await access(new URL("../LICENSE", import.meta.url));
await access(new URL("../runtime/llama.cpp/win-x64/LICENSE", import.meta.url));
assert.equal(packageJson.license, "MIT", "公开仓库没有声明开源许可证");
assert.ok(packageJson.build?.win?.extraResources?.some((item) => item.from === "LICENSE"), "Windows 包未包含应用开源许可证");
assert.ok(packageJson.build?.mac?.extraResources?.some((item) => item.from === "LICENSE"), "macOS 包未包含应用开源许可证");
assert.ok(packageJson.build?.win?.extraResources?.some((item) => item.from === "THIRD-PARTY-NOTICES.txt"), "Windows 包未包含第三方许可清单");
assert.ok(packageJson.build?.mac?.extraResources?.some((item) => item.from === "THIRD-PARTY-NOTICES.txt"), "macOS 包未包含第三方许可清单");

const { MIN_PASSWORD_LENGTH, isAcceptableNewPassword } = await import("../server/password-policy.ts");
assert.equal(MIN_PASSWORD_LENGTH, 8);
assert.equal(isAcceptableNewPassword("1234567"), false, "7 位密码被错误接受");
assert.equal(isAcceptableNewPassword("12345678"), true, "8 位密码被错误拒绝");
assert.match(mainSource, /isAllowedAppNavigation\(url, allowedOrigin\)/, "主窗口没有真实消费精确导航策略");

const { getWindowsAuthenticodeStatus } = await import("./windows-authenticode.mjs");
const unsignedProbe = process.platform === "win32"
  ? getWindowsAuthenticodeStatus(new URL("../runtime/llama.cpp/win-x64/llama.exe", import.meta.url))
  : getWindowsAuthenticodeStatus(new URL("../package.json", import.meta.url));
if (process.platform === "win32") {
  assert.equal(unsignedProbe.status, "NotSigned", "Windows 签名探针未能在当前 PowerShell 环境检查普通未签名 PE 文件");
  assert.equal(unsignedProbe.signed, false, "普通未签名 PE 文件被错误报告为有效签名");
} else {
  assert.equal(unsignedProbe.status, "NotChecked");
}

console.log(JSON.stringify({ exactNavigationOrigin: true, csp: true, dependencyHighFix: true, noticesPackaged: true, minimumPasswordLength: MIN_PASSWORD_LENGTH, publicSiteConfigured: true, authenticodeProbe: unsignedProbe.status }));
