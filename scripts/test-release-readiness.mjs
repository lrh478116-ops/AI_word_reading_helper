import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(".");
const website = path.join(root, "website");
const read = (relative) => readFile(path.join(root, relative), "utf8");
const requiredPages = ["website/index.html", "website/privacy/index.html", "website/account-deletion/index.html"];

for (const file of requiredPages) assert.equal((await stat(path.join(root, file))).isFile(), true, `${file} is missing`);

const pages = await Promise.all(requiredPages.map(read));
for (const [index, html] of pages.entries()) {
  assert.match(html, /lang="zh-CN"/i, `${requiredPages[index]} has no Chinese primary language`);
  assert.doesNotMatch(html, /<(script|img|iframe|link)\b[^>]+(?:src|href)=["']https?:\/\//i, `${requiredPages[index]} loads a third-party runtime resource`);
  assert.doesNotMatch(html, /(google-analytics|googletagmanager|facebook\.net|clarity\.ms|umami|plausible|matomo)/i, `${requiredPages[index]} contains analytics or tracking`);
}

const [home, privacy, deletion, siteCss, siteScript, appCss, appSource, i18n, pagesWorkflow] = await Promise.all([
  read("website/index.html"), read("website/privacy/index.html"), read("website/account-deletion/index.html"),
  read("website/assets/site.css"), read("website/assets/site.js"), read("src/styles.css"), read("src/App.tsx"), read("src/i18n.ts"),
  read(".github/workflows/pages.yml")
]);
assert.match(home, /2280810215@qq\.com/);
assert.match(home, /privacy\//);
assert.match(home, /account-deletion\//);
assert.match(privacy, /本地.{0,30}默认|默认.{0,30}本地/s);
assert.match(privacy, /5\s*MB/i);
assert.match(privacy, /Supabase/);
assert.match(privacy, /Tavily/);
assert.match(privacy, /操作系统.{0,40}(加密|安全存储)/s);
assert.match(privacy, /删除账户/);
assert.match(deletion, /设置.{0,60}账户与隐私.{0,60}删除账户/s);
assert.match(deletion, /2280810215@qq\.com/);
assert.doesNotMatch(`${siteCss}\n${siteScript}\n${appCss}`, /fonts\.googleapis\.com|fonts\.gstatic\.com/i, "remote Google Fonts request remains");
assert.match(appSource, /data-account-privacy/);
assert.match(appSource, /data-delete-account/);
assert.ok((appSource.match(/data-delete-cloud-file/g) || []).length >= 2, "cloud file deletion must be present in both the library and editor clients");
assert.match(i18n, /删除云端文件/);
assert.match(i18n, /account\.delete/);
assert.match(pagesWorkflow, /actions\/configure-pages@v\d+/);
assert.match(pagesWorkflow, /enablement:\s*true/, "Pages workflow must initialize Pages when the repository has not enabled it yet");
assert.match(pagesWorkflow, /actions\/upload-pages-artifact@v\d+/);
assert.match(pagesWorkflow, /actions\/deploy-pages@v\d+/);
assert.match(pagesWorkflow, /path:\s*website\/?\s*$/m, "Pages artifact must contain only website/");
assert.match(pagesWorkflow, /contents:\s*read/);
assert.match(pagesWorkflow, /pages:\s*write/);
assert.match(pagesWorkflow, /id-token:\s*write/);
assert.doesNotMatch(pagesWorkflow, /peaceiris|JamesIves|gh-pages/i, "third-party Pages deployment action is not allowed");

const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  const relative = url.pathname === "/" ? "index.html" : `${url.pathname.replace(/^\//, "").replace(/\/$/, "")}/index.html`;
  try {
    const body = await readFile(path.join(website, relative));
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); response.end(body);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
try {
  for (const route of ["/", "/privacy/", "/account-deletion/"]) {
    const response = await fetch(`http://127.0.0.1:${address.port}${route}`);
    assert.equal(response.status, 200, `${route} did not resolve through the formal static route`);
  }
} finally { await new Promise((resolve) => server.close(resolve)); }

const assetDir = path.join(root, "store-assets", "macos", "zh-CN");
const screenshots = (await readdir(assetDir)).filter((name) => name.endsWith(".png"));
assert.ok(screenshots.length >= 3, "at least three real macOS screenshots are required");
const accepted = new Set(["1280x800", "1440x900", "2560x1600", "2880x1800"]);
for (const name of screenshots) {
  const bytes = await readFile(path.join(assetDir, name));
  assert.equal(bytes.subarray(1, 4).toString("ascii"), "PNG", `${name} is not a PNG`);
  const size = `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
  assert.ok(accepted.has(size), `${name} has unsupported Mac App Store dimensions ${size}`);
}

console.log(JSON.stringify({ releaseWebsite: true, privacyDisclosures: true, deletionInstructions: true, trackerFree: true, appPrivacyEntry: true, macScreenshots: screenshots.length }));
