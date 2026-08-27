import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  downloadOfficialOllamaInstaller,
  fetchLatestOllamaInstallerInfo,
  isOfficialOllamaDownloadUrl,
  ollamaInstallerAssetName,
  ollamaInstallerStartUrl
} from "../electron/ollama-installer.mjs";

const fixture = Buffer.concat([Buffer.from("MZ"), Buffer.from("OFFICIAL_OLLAMA_INSTALLER_FIXTURE")]);
const digest = createHash("sha256").update(fixture).digest("hex");
const startUrl = "https://ollama.com/download/OllamaSetup.exe";
const releaseUrl = "https://github.com/ollama/ollama/releases/download/v9.9.9/OllamaSetup.exe";
const assetUrl = "https://release-assets.githubusercontent.com/github-production-release-asset/fixture";
const root = await mkdtemp(path.join(os.tmpdir(), "ai-tip-ollama-installer-"));

function redirect(location) { return new Response(null, { status: 302, headers: { Location: location } }); }
function bytesResponse(bytes) { return new Response(bytes, { status: 200, headers: { "Content-Length": String(bytes.length), "Content-Type": "application/octet-stream" } }); }
async function expectReject(action, pattern) {
  try { await action(); }
  catch (error) { if (pattern.test(error instanceof Error ? error.message : String(error))) return; throw error; }
  throw new Error(`Expected rejection matching ${pattern}`);
}

try {
  if (ollamaInstallerAssetName("win32") !== "OllamaSetup.exe" || ollamaInstallerStartUrl("win32") !== startUrl) throw new Error("Windows 官方安装器入口错误");
  if (ollamaInstallerAssetName("darwin") !== "Ollama.dmg" || !ollamaInstallerStartUrl("darwin").endsWith("/Ollama.dmg")) throw new Error("macOS 官方安装器入口错误");
  for (const url of [startUrl, releaseUrl, assetUrl]) if (!isOfficialOllamaDownloadUrl(url)) throw new Error(`官方 Ollama URL 被拒绝：${url}`);
  for (const url of ["https://publisher.example/OllamaSetup.exe", "https://ollama.com.attacker.example/OllamaSetup.exe", "http://ollama.com/download/OllamaSetup.exe"]) {
    if (isOfficialOllamaDownloadUrl(url)) throw new Error(`非官方 Ollama URL 被接受：${url}`);
  }

  const info = await fetchLatestOllamaInstallerInfo("win32", async (url) => {
    if (String(url) !== "https://api.github.com/repos/ollama/ollama/releases/latest") throw new Error(`unexpected metadata URL ${url}`);
    return new Response(JSON.stringify({ tag_name: "v9.9.9", assets: [{ name: "OllamaSetup.exe", size: fixture.length, digest: `sha256:${digest}`, browser_download_url: releaseUrl }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  if (info.version !== "v9.9.9" || info.sha256 !== digest || info.size !== fixture.length) throw new Error("官方 release 元数据未被消费");

  const requests = [];
  const progress = [];
  const result = await downloadOfficialOllamaInstaller({
    info,
    destinationPath: path.join(root, "OllamaSetup.exe"),
    proxyDescription: "DIRECT",
    fetchRuntime: async (url, init = {}) => {
      requests.push({ url: String(url), redirect: init.redirect });
      if (String(url) === startUrl) return redirect(releaseUrl);
      if (String(url) === releaseUrl) return redirect(assetUrl);
      if (String(url) === assetUrl) return bytesResponse(fixture);
      throw new Error(`unexpected download URL ${url}`);
    },
    onProgress: (event) => progress.push(event)
  });
  if ((await readFile(result.finalPath)).compare(fixture) !== 0) throw new Error("官方安装器下载内容不一致");
  if (!requests.every((item) => item.redirect === "manual") || result.networkStack !== "chromium" || result.finalHost !== "release-assets.githubusercontent.com") throw new Error("Ollama 官方下载 lineage 不完整");
  if (!progress.some((event) => event.completed === fixture.length && event.total === fixture.length)) throw new Error("Ollama 安装器没有真实字节进度");

  await expectReject(() => downloadOfficialOllamaInstaller({
    info: { ...info, sha256: "0".repeat(64) },
    destinationPath: path.join(root, "bad-digest", "OllamaSetup.exe"),
    fetchRuntime: async (url) => String(url) === startUrl ? redirect(releaseUrl) : String(url) === releaseUrl ? redirect(assetUrl) : bytesResponse(fixture)
  }), /SHA-256/i);
  await expectReject(() => downloadOfficialOllamaInstaller({
    info,
    destinationPath: path.join(root, "attack", "OllamaSetup.exe"),
    fetchRuntime: async () => redirect("https://attacker.example/OllamaSetup.exe")
  }), /官方|official|重定向/i);

  console.log(JSON.stringify({ officialMetadata: true, websiteRoute: true, hostAllowlist: true, chromiumLineage: true, byteProgress: true, digestFailureBlocked: true }));
} finally {
  await rm(root, { recursive: true, force: true });
}
