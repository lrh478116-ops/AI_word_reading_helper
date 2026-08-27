import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { downloadOfficialModelArtifact, isOfficialModelDownloadHost } from "../electron/model-download.mjs";

const fixture = Buffer.concat([Buffer.from("GGUF"), Buffer.from("OFFICIAL_CHROMIUM_DOWNLOAD_FIXTURE")]);
const artifact = {
  filename: "fixture.gguf",
  size: fixture.length,
  sha256: createHash("sha256").update(fixture).digest("hex")
};
const officialUrl = "https://www.modelscope.cn/models/OpenBMB/MiniCPM5-1B-GGUF/resolve/revision/fixture.gguf";
const officialCdnUrl = "https://cdn-lfs-cn-1.modelscope.cn/object/fixture.gguf";
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ai-tip-official-download-"));

function redirect(location) {
  return new Response(null, { status: 302, headers: { Location: location } });
}

function rangedResponse(bytes, offset) {
  return new Response(bytes.subarray(offset), {
    status: offset ? 206 : 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(bytes.length - offset),
      ...(offset ? { "Content-Range": `bytes ${offset}-${bytes.length - 1}/${bytes.length}` } : {})
    }
  });
}

async function expectReject(action, pattern) {
  try { await action(); }
  catch (error) {
    if (pattern.test(error instanceof Error ? error.message : String(error))) return;
    throw error;
  }
  throw new Error(`Expected rejection matching ${pattern}`);
}

try {
  for (const host of ["modelscope.cn", "www.modelscope.cn", "cdn-lfs-cn-1.modelscope.cn", "huggingface.co", "us.aws.cdn.hf.co", "transfer.xethub.hf.co"]) {
    if (!isOfficialModelDownloadHost(host)) throw new Error(`官方模型域名被拒绝：${host}`);
  }
  for (const host of ["publisher.example.com", "modelscope.cn.attacker.example", "huggingface.co.attacker.example", "127.0.0.1"]) {
    if (isOfficialModelDownloadHost(host)) throw new Error(`非官方模型域名被接受：${host}`);
  }

  const resumeDirectory = path.join(tempRoot, "resume");
  const partialPath = path.join(resumeDirectory, `${artifact.filename}.part`);
  await import("node:fs/promises").then(({ mkdir }) => mkdir(resumeDirectory, { recursive: true }));
  await writeFile(partialPath, fixture.subarray(0, 9));
  const requests = [];
  const progress = [];
  const result = await downloadOfficialModelArtifact({
    url: officialUrl,
    artifact,
    destinationPath: resumeDirectory,
    sourceId: "modelscope",
    signal: new AbortController().signal,
    proxyDescription: "DIRECT",
    fetchRuntime: async (url, init = {}) => {
      const headers = new Headers(init.headers || {});
      requests.push({ url: String(url), redirect: init.redirect, range: headers.get("range") || "" });
      if (String(url) === officialUrl) return redirect(officialCdnUrl);
      if (String(url) === officialCdnUrl) return rangedResponse(fixture, 9);
      throw new Error(`unexpected URL: ${url}`);
    },
    onProgress: (event) => progress.push(event)
  });
  if ((await readFile(result.finalPath)).compare(fixture) !== 0) throw new Error("续传后的模型内容不一致");
  if (requests.length !== 2 || requests[0].redirect !== "manual" || requests[1].range !== "bytes=9-") throw new Error(`未以手动官方重定向完成 Range 续传：${JSON.stringify(requests)}`);
  if (result.networkStack !== "chromium" || result.initialHost !== "www.modelscope.cn" || result.finalHost !== "cdn-lfs-cn-1.modelscope.cn" || result.proxyDescription !== "DIRECT") throw new Error(`下载来源 lineage 不完整：${JSON.stringify(result)}`);
  if (!progress.some((event) => event.networkStack === "chromium" && event.finalHost === "cdn-lfs-cn-1.modelscope.cn")) throw new Error("进度事件没有声明 Chromium 官方直连");

  let forbiddenFetches = 0;
  await expectReject(() => downloadOfficialModelArtifact({
    url: "https://publisher.example.com/model.gguf",
    artifact,
    destinationPath: path.join(tempRoot, "publisher"),
    sourceId: "modelscope",
    fetchRuntime: async () => { forbiddenFetches += 1; return rangedResponse(fixture, 0); }
  }), /非官方|official/i);
  if (forbiddenFetches !== 0) throw new Error("发布者或第三方首地址仍触发了网络请求");

  let attackerFetches = 0;
  await expectReject(() => downloadOfficialModelArtifact({
    url: officialUrl,
    artifact,
    destinationPath: path.join(tempRoot, "redirect-attack"),
    sourceId: "modelscope",
    fetchRuntime: async (url) => {
      if (String(url).includes("attacker.example")) attackerFetches += 1;
      return redirect("https://attacker.example/model.gguf");
    }
  }), /重定向|非官方|official/i);
  if (attackerFetches !== 0) throw new Error("非官方重定向目标仍被请求");

  await expectReject(() => downloadOfficialModelArtifact({
    url: officialUrl,
    artifact: { ...artifact, sha256: "0".repeat(64) },
    destinationPath: path.join(tempRoot, "bad-digest"),
    sourceId: "modelscope",
    fetchRuntime: async (url) => String(url) === officialUrl ? redirect(officialCdnUrl) : rangedResponse(fixture, 0)
  }), /SHA-256/i);
  await expectReject(() => stat(path.join(tempRoot, "bad-digest", artifact.filename)), /ENOENT/i);

  const ignoredRangeDirectory = path.join(tempRoot, "ignored-range");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(ignoredRangeDirectory, { recursive: true }));
  await writeFile(path.join(ignoredRangeDirectory, `${artifact.filename}.part`), Buffer.from("GGUFBROKEN-PARTIAL"));
  const ignoredRangeResult = await downloadOfficialModelArtifact({
    url: officialUrl,
    artifact,
    destinationPath: ignoredRangeDirectory,
    sourceId: "modelscope",
    fetchRuntime: async (url) => String(url) === officialUrl ? redirect(officialCdnUrl) : rangedResponse(fixture, 0)
  });
  if ((await readFile(ignoredRangeResult.finalPath)).compare(fixture) !== 0) throw new Error("服务器忽略 Range 后没有从零安全重写");

  console.log(JSON.stringify({ officialHostsOnly: true, manualRedirectValidation: true, chromiumLineage: true, rangeResume: true, ignoredRangeRewrite: true, digestFailureBlocksFinalFile: true }));
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
