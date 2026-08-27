import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

const MAX_REDIRECTS = 8;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function normalizedHost(value) {
  return String(value || "").trim().toLowerCase().replace(/\.$/, "");
}

function isHostOrSubdomain(hostname, parent) {
  const host = normalizedHost(hostname);
  return host === parent || host.endsWith(`.${parent}`);
}

export function isOfficialModelDownloadHost(hostname) {
  const host = normalizedHost(hostname);
  return isHostOrSubdomain(host, "modelscope.cn")
    || isHostOrSubdomain(host, "huggingface.co")
    || isHostOrSubdomain(host, "hf.co");
}

function validatedOfficialUrl(value, context) {
  let parsed;
  try { parsed = new URL(String(value)); }
  catch { throw new Error(`${context}不是有效 URL`); }
  if (parsed.protocol !== "https:") throw new Error(`${context}必须使用 HTTPS`);
  if (parsed.username || parsed.password) throw new Error(`${context}不得包含认证信息`);
  if (!isOfficialModelDownloadHost(parsed.hostname)) throw new Error(`${context}指向非官方模型域名：${parsed.hostname}`);
  return parsed;
}

async function sha256File(filename) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(filename)) digest.update(chunk);
  return digest.digest("hex");
}

async function assertDownloadedGguf(filename, artifact) {
  const details = await stat(filename);
  if (!details.isFile() || details.size !== artifact.size) throw new Error(`下载大小不匹配：应为 ${artifact.size} 字节，实际为 ${details.size} 字节`);
  const handle = await open(filename, "r");
  try {
    const magic = Buffer.alloc(4);
    const result = await handle.read(magic, 0, 4, 0);
    if (result.bytesRead !== 4 || magic.toString("ascii") !== "GGUF") throw new Error("下载内容不是 GGUF（可能是官方仓库错误页）");
  } finally { await handle.close(); }
  const actualSha256 = await sha256File(filename);
  if (actualSha256 !== String(artifact.sha256 || "").toLowerCase()) throw new Error(`模型 SHA-256 校验失败：${actualSha256}`);
}

function validateRequest({ url, artifact, destinationPath, sourceId, fetchRuntime }) {
  const initial = validatedOfficialUrl(url, "模型下载地址");
  if (sourceId === "modelscope" && !isHostOrSubdomain(initial.hostname, "modelscope.cn")) throw new Error("ModelScope 来源没有使用 ModelScope 官方地址");
  if (sourceId === "huggingface" && !isHostOrSubdomain(initial.hostname, "huggingface.co")) throw new Error("Hugging Face 来源没有使用 Hugging Face 官方地址");
  if (!artifact || !Number.isSafeInteger(artifact.size) || artifact.size < 4 || !/^[a-f0-9]{64}$/i.test(String(artifact.sha256 || ""))) throw new Error("模型 artifact 的大小或 SHA-256 无效");
  const filename = String(artifact.filename || "");
  if (!filename || path.basename(filename) !== filename || !filename.toLowerCase().endsWith(".gguf")) throw new Error("模型 artifact 文件名无效");
  if (!path.isAbsolute(String(destinationPath || ""))) throw new Error("模型下载目录必须是绝对路径");
  if (typeof fetchRuntime !== "function") throw new Error("Chromium 下载控制器不可用");
  return initial;
}

async function fetchFollowingOfficialRedirects(initialUrl, init, fetchRuntime) {
  let current = initialUrl;
  const redirectChain = [current.href];
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await fetchRuntime(current.href, { ...init, redirect: "manual" });
    if (!REDIRECT_STATUSES.has(response.status)) {
      if (response.status >= 300 && response.status < 400) throw new Error(`官方仓库返回不支持的重定向状态：${response.status}`);
      return { response, finalUrl: current, redirectChain };
    }
    const location = response.headers.get("location");
    if (!location) throw new Error(`官方仓库返回 ${response.status}，但没有 Location`);
    if (redirectCount === MAX_REDIRECTS) throw new Error(`官方模型下载重定向超过 ${MAX_REDIRECTS} 次`);
    const next = validatedOfficialUrl(new URL(location, current).href, "模型下载重定向");
    await response.body?.cancel().catch(() => undefined);
    current = next;
    redirectChain.push(current.href);
  }
  throw new Error("官方模型下载重定向失败");
}

export async function downloadOfficialModelArtifact({
  url,
  artifact,
  destinationPath,
  sourceId,
  fetchRuntime,
  signal,
  onProgress = () => undefined,
  proxyDescription = ""
}) {
  const initialUrl = validateRequest({ url, artifact, destinationPath, sourceId, fetchRuntime });
  const destination = path.resolve(destinationPath);
  const finalPath = path.join(destination, artifact.filename);
  const partialPath = `${finalPath}.part`;
  await mkdir(destination, { recursive: true });

  let offset = 0;
  try {
    const partial = await stat(partialPath);
    if (partial.isFile() && partial.size <= artifact.size) offset = partial.size;
    else await rm(partialPath, { force: true });
  } catch { /* A missing partial file means a fresh download. */ }

  let finalHost = initialUrl.hostname;
  let redirectChain = [initialUrl.href];
  const common = () => ({
    networkStack: "chromium",
    sourceId,
    initialHost: initialUrl.hostname,
    finalHost,
    proxyDescription,
    redirectChain: [...redirectChain]
  });
  onProgress({ type: "start", status: offset ? "resuming" : "connecting", total: artifact.size, completed: offset, resumed: offset > 0, ...common() });

  if (offset < artifact.size) {
    const fetched = await fetchFollowingOfficialRedirects(
      initialUrl,
      { headers: offset > 0 ? { Range: `bytes=${offset}-` } : undefined, signal },
      fetchRuntime
    );
    const { response } = fetched;
    finalHost = fetched.finalUrl.hostname;
    redirectChain = fetched.redirectChain;
    if (!response.ok || !response.body) throw new Error(`${sourceId} 官方下载接口返回 ${response.status}`);
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (contentType.includes("text/html") || contentType.includes("application/json")) throw new Error(`官方下载来源返回了 ${contentType}，不是 GGUF`);
    const append = offset > 0 && response.status === 206;
    if (append && !String(response.headers.get("content-range") || "").startsWith(`bytes ${offset}-`)) throw new Error("断点续传 Content-Range 与本地 .part 不一致");
    if (offset > 0 && response.status !== 200 && response.status !== 206) throw new Error(`官方下载来源不支持断点续传：${response.status}`);
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
        if (offset > artifact.size) throw new Error("下载内容超过目录中固定大小");
        onProgress({ type: "progress", status: append ? "resuming" : "downloading", total: artifact.size, completed: offset, ...common() });
      }
    } finally { await file.close(); }
  }

  onProgress({ type: "progress", status: "verifying", total: artifact.size, completed: artifact.size, ...common() });
  await assertDownloadedGguf(partialPath, artifact);
  await rm(finalPath, { force: true });
  await rename(partialPath, finalPath);
  onProgress({ type: "progress", status: "verified", total: artifact.size, completed: artifact.size, ...common() });
  return { finalPath, networkStack: "chromium", sourceId, initialHost: initialUrl.hostname, finalHost, redirectChain, proxyDescription };
}
