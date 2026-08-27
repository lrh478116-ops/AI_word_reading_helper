import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

const METADATA_URL = "https://api.github.com/repos/ollama/ollama/releases/latest";
const MAX_REDIRECTS = 8;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const OFFICIAL_HOSTS = new Set(["ollama.com", "github.com", "release-assets.githubusercontent.com"]);

export function ollamaInstallerAssetName(platform = process.platform) {
  if (platform === "win32") return "OllamaSetup.exe";
  if (platform === "darwin") return "Ollama.dmg";
  throw new Error("当前平台不支持 App 内 Ollama 安装器下载");
}

export function ollamaInstallerStartUrl(platform = process.platform) {
  return `https://ollama.com/download/${ollamaInstallerAssetName(platform)}`;
}

function validatedUrl(value, context) {
  let parsed;
  try { parsed = new URL(String(value)); } catch { throw new Error(`${context}不是有效 URL`); }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || !OFFICIAL_HOSTS.has(host)) throw new Error(`${context}不是 Ollama 官方 HTTPS 地址：${host}`);
  if (host === "ollama.com" && !/^\/download\/(OllamaSetup\.exe|Ollama\.dmg)$/.test(parsed.pathname)) throw new Error(`${context}不是 Ollama 官网安装器路径`);
  if (host === "github.com" && !/^\/ollama\/ollama\/releases\/(latest\/download|download\/[^/]+)\/(OllamaSetup\.exe|Ollama\.dmg)$/.test(parsed.pathname)) throw new Error(`${context}不是 Ollama 官方 GitHub release 路径`);
  if (host === "release-assets.githubusercontent.com" && !parsed.pathname.startsWith("/github-production-release-asset/")) throw new Error(`${context}不是 GitHub 官方 release asset 路径`);
  return parsed;
}

export function isOfficialOllamaDownloadUrl(value) {
  try { validatedUrl(value, "下载地址"); return true; } catch { return false; }
}

export async function fetchLatestOllamaInstallerInfo(platform = process.platform, fetchRuntime = fetch) {
  const assetName = ollamaInstallerAssetName(platform);
  const response = await fetchRuntime(METADATA_URL, { headers: { Accept: "application/vnd.github+json", "User-Agent": "AI-Tip-Ollama-Installer" }, redirect: "error", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Ollama 官方 release 元数据返回 ${response.status}`);
  const release = await response.json();
  const asset = Array.isArray(release?.assets) ? release.assets.find((item) => item?.name === assetName) : null;
  const digest = String(asset?.digest || "").replace(/^sha256:/i, "").toLowerCase();
  if (typeof release?.tag_name !== "string" || !release.tag_name || !asset || !Number.isSafeInteger(asset.size) || asset.size < 2 || !/^[a-f0-9]{64}$/.test(digest)) {
    throw new Error("Ollama 官方 release 缺少可校验的安装器大小或 SHA-256");
  }
  const releaseUrl = validatedUrl(asset.browser_download_url, "Ollama release 资产");
  if (releaseUrl.hostname !== "github.com" || path.posix.basename(releaseUrl.pathname) !== assetName) throw new Error("Ollama release 资产名称或仓库不匹配");
  return { platform, version: release.tag_name, assetName, size: asset.size, sha256: digest, releaseUrl: releaseUrl.href, startUrl: ollamaInstallerStartUrl(platform) };
}

async function sha256File(filename) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(filename)) digest.update(chunk);
  return digest.digest("hex");
}

async function officialRedirects(initial, init, fetchRuntime) {
  let current = validatedUrl(initial, "Ollama 安装器下载地址");
  const redirectChain = [current.href];
  for (let count = 0; count <= MAX_REDIRECTS; count += 1) {
    const response = await fetchRuntime(current.href, { ...init, redirect: "manual" });
    if (!REDIRECT_STATUSES.has(response.status)) return { response, finalUrl: current, redirectChain };
    const location = response.headers.get("location");
    if (!location || count === MAX_REDIRECTS) throw new Error("Ollama 官方安装器重定向无效或次数过多");
    const next = validatedUrl(new URL(location, current).href, "Ollama 安装器重定向");
    await response.body?.cancel().catch(() => undefined);
    current = next;
    redirectChain.push(current.href);
  }
  throw new Error("Ollama 官方安装器重定向失败");
}

export async function downloadOfficialOllamaInstaller({ info, destinationPath, fetchRuntime, signal, onProgress = () => undefined, proxyDescription = "" }) {
  if (!info || !Number.isSafeInteger(info.size) || info.size < 2 || !/^[a-f0-9]{64}$/i.test(String(info.sha256 || ""))) throw new Error("Ollama 安装器元数据无效");
  const expectedName = ollamaInstallerAssetName(info.platform);
  if (info.assetName !== expectedName || path.basename(String(destinationPath || "")) !== expectedName || !path.isAbsolute(String(destinationPath || ""))) throw new Error("Ollama 安装器保存路径无效");
  if (typeof fetchRuntime !== "function") throw new Error("Chromium 下载控制器不可用");
  const initial = validatedUrl(info.startUrl, "Ollama 官网下载入口");
  const finalPath = path.resolve(destinationPath);
  const partialPath = `${finalPath}.part`;
  await mkdir(path.dirname(finalPath), { recursive: true });
  let offset = 0;
  try {
    const partial = await stat(partialPath);
    if (partial.isFile() && partial.size <= info.size) offset = partial.size; else await rm(partialPath, { force: true });
  } catch {}
  let finalHost = initial.hostname;
  let redirectChain = [initial.href];
  const lineage = () => ({ networkStack: "chromium", initialHost: initial.hostname, finalHost, redirectChain: [...redirectChain], proxyDescription });
  onProgress({ type: "start", status: offset ? "resuming" : "connecting", completed: offset, total: info.size, ...lineage() });
  if (offset < info.size) {
    const fetched = await officialRedirects(initial, { headers: offset ? { Range: `bytes=${offset}-` } : undefined, signal }, fetchRuntime);
    const response = fetched.response;
    finalHost = fetched.finalUrl.hostname;
    redirectChain = fetched.redirectChain;
    if (!response.ok || !response.body) throw new Error(`Ollama 官方安装器下载返回 ${response.status}`);
    const append = offset > 0 && response.status === 206;
    if (append && !String(response.headers.get("content-range") || "").startsWith(`bytes ${offset}-`)) throw new Error("Ollama 安装器续传 Content-Range 不一致");
    if (!append) offset = 0;
    const file = await open(partialPath, append ? "a" : "w");
    try {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        await file.write(value);
        offset += value.byteLength;
        if (offset > info.size) throw new Error("Ollama 安装器超过官方固定大小");
        onProgress({ type: "progress", status: "downloading", completed: offset, total: info.size, ...lineage() });
      }
    } finally { await file.close(); }
  }
  const details = await stat(partialPath);
  if (!details.isFile() || details.size !== info.size) throw new Error(`Ollama 安装器大小不匹配：应为 ${info.size}，实际为 ${details.size}`);
  if (info.platform === "win32") {
    const file = await open(partialPath, "r");
    try { const magic = Buffer.alloc(2); await file.read(magic, 0, 2, 0); if (magic.toString("ascii") !== "MZ") throw new Error("下载内容不是 Windows PE 安装器"); } finally { await file.close(); }
  }
  const digest = await sha256File(partialPath);
  if (digest !== info.sha256.toLowerCase()) throw new Error(`Ollama 安装器 SHA-256 校验失败：${digest}`);
  await rm(finalPath, { force: true });
  await rename(partialPath, finalPath);
  onProgress({ type: "progress", status: "verified", completed: info.size, total: info.size, ...lineage() });
  return { finalPath, networkStack: "chromium", initialHost: initial.hostname, finalHost, redirectChain, proxyDescription };
}
