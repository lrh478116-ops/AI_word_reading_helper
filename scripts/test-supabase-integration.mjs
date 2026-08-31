import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import jwt from "jsonwebtoken";
import { gunzipSync } from "node:zlib";

const tempData = await mkdtemp(path.join(os.tmpdir(), "ai-tip-supabase-"));
const pdfBytes = Buffer.from((await readFile(new URL("./fixtures/semantic-pdf.pdf.base64", import.meta.url), "utf8")).replace(/\s+/g, ""), "base64");
const cloudUser = { id: "11111111-1111-4111-8111-111111111111", email: "cloud@example.test", user_metadata: { name: "云端用户" } };
const pendingUser = { id: "22222222-2222-4222-8222-222222222222", email: "pending@example.test", user_metadata: { name: "待确认用户" }, identities: [{ id: "pending-email-identity", provider: "email" }] };
const fakeExistingUser = { id: "33333333-3333-4333-8333-333333333333", email: "existing@example.test", user_metadata: {}, identities: [] };
const recoveryUser = { id: "44444444-4444-4444-8444-444444444444", email: "existing@example.test", user_metadata: { name: "已注册用户" }, identities: [{ id: "recovery-email-identity", provider: "email" }] };
const accessToken = "cloud-access-token-a";
const refreshedToken = "cloud-access-token-refreshed";
const refreshToken = "cloud-refresh-token-a";
const pendingAccessToken = "pending-access-token";
const pendingRefreshToken = "pending-refresh-token";
const recoveryAccessToken = "recovery-access-token";
const recoveryRefreshToken = "recovery-refresh-token";
const documents = new Map();
const tips = new Map();
const objects = new Map();
const objectContentTypes = new Map();
const resumableUploads = new Map();
const requests = [];
let dataFailure = false;
let documentUpsertFailure = false;
let storageUploadFailure = false;
let compressedDownloadFailureStatus = 0;
let cloudUsageFailure = false;
let accountDeletionFailure = false;
let cloudUserDeleted = false;
let accountDeletionCalls = 0;

function validStorageObjectPath(objectPath) {
  return objectPath.split("/").every((segment) => segment.length > 0 && /^[A-Za-z0-9_\-.'!,*&$@=;:+?() ]+$/.test(segment));
}

function authUser(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (token === pendingAccessToken) return pendingUser;
  if (token === recoveryAccessToken) return recoveryUser;
  return !cloudUserDeleted && (token === accessToken || token === refreshedToken) ? cloudUser : null;
}

const mock = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks);
  const url = new URL(req.url, "http://127.0.0.1");
  const requestContentType = String(req.headers["content-type"] || "");
  const textualBody = requestContentType.includes("json") || requestContentType.startsWith("text/") ? raw.toString("utf8") : "";
  requests.push({ method: req.method, path: url.pathname, query: url.search, body: textualBody, contentType: requestContentType });
  res.setHeader("Content-Type", "application/json");
  if (url.pathname === "/auth/v1/signup" && req.method === "POST") {
    const body = JSON.parse(raw.toString("utf8") || "{}");
    if (body.email === pendingUser.email) {
      res.end(JSON.stringify({ ...pendingUser, confirmation_sent_at: new Date().toISOString() }));
      return;
    }
    if (body.email === fakeExistingUser.email) {
      res.end(JSON.stringify(fakeExistingUser));
      return;
    }
    if (body.email === "malformed-session@example.test") {
      res.end(JSON.stringify({ access_token: accessToken, refresh_token: refreshToken, expires_in: 3600 }));
      return;
    }
    res.end(JSON.stringify({ access_token: accessToken, refresh_token: refreshToken, expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: "bearer", user: cloudUser }));
    return;
  }
  if (url.pathname === "/auth/v1/verify" && req.method === "POST") {
    const body = JSON.parse(raw.toString("utf8") || "{}");
    if (body.email === pendingUser.email && body.token === "123456" && (body.type === "signup" || body.type === "email")) {
      res.end(JSON.stringify({ access_token: pendingAccessToken, refresh_token: pendingRefreshToken, expires_in: 3600, token_type: "bearer", user: pendingUser }));
      return;
    }
    if (body.email === recoveryUser.email && body.token === "654321" && body.type === "recovery") {
      res.end(JSON.stringify({ access_token: recoveryAccessToken, refresh_token: recoveryRefreshToken, expires_in: 3600, token_type: "bearer", user: recoveryUser }));
      return;
    }
    res.statusCode = 401; res.end(JSON.stringify({ message: "invalid verification code" })); return;
  }
  if (url.pathname === "/auth/v1/recover" && req.method === "POST") {
    res.end("{}");
    return;
  }
  if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "password" && req.method === "POST") {
    res.end(JSON.stringify({ access_token: accessToken, refresh_token: refreshToken, expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: "bearer", user: cloudUser }));
    return;
  }
  if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "refresh_token" && req.method === "POST") {
    const body = JSON.parse(raw.toString("utf8") || "{}");
    if (body.refresh_token !== refreshToken) { res.statusCode = 401; res.end(JSON.stringify({ message: "invalid refresh token" })); return; }
    res.end(JSON.stringify({ access_token: refreshedToken, refresh_token: refreshToken, expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: "bearer", user: cloudUser }));
    return;
  }
  if (url.pathname === "/auth/v1/user" && (req.method === "GET" || req.method === "PUT")) {
    const user = authUser(req);
    if (!user) { res.statusCode = 401; res.end(JSON.stringify({ message: "invalid token" })); return; }
    if (req.method === "PUT") {
      const body = JSON.parse(raw.toString("utf8") || "{}");
      if (typeof body.password !== "string" || body.password.length < 6) { res.statusCode = 400; res.end(JSON.stringify({ message: "invalid password" })); return; }
    }
    res.end(JSON.stringify(user));
    return;
  }
  if (url.pathname === "/v1/models" && req.method === "GET") {
    res.end(JSON.stringify({ object: "list", data: [{ id: "supabase-sync-model", object: "model", owned_by: "integration" }] }));
    return;
  }
  if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
    const body = JSON.parse(raw.toString("utf8") || "{}");
    const system = String(body.messages?.[0]?.content || "");
    const content = system.includes("PROFESSIONALISM_CLASSIFIER_V1")
      ? JSON.stringify({ professional: false, level: "general", domain: "通用", confidence: 98, requiresWebReview: false, reason: "普通文档解释问题" })
      : system.includes("WEB_SEARCH_DECISION_V1")
        ? JSON.stringify({ required: false, confidence: 98, reason: "普通文档解释只需已给上下文", queryZh: "", queryEn: "" })
        : "SUPABASE_SYNC_MODEL_ANSWER";
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }] }));
    return;
  }
  if (url.pathname === "/functions/v1/delete-account" && req.method === "DELETE") {
    accountDeletionCalls += 1;
    const user = authUser(req);
    if (!user) { res.statusCode = 401; res.end(JSON.stringify({ message: "invalid token" })); return; }
    if (accountDeletionFailure) { res.statusCode = 503; res.end(JSON.stringify({ message: "simulated account deletion failure" })); return; }
    cloudUserDeleted = true;
    res.end(JSON.stringify({ deleted: true, userId: user.id, storageObjectsDeleted: [...objects.keys()].filter((name) => name.startsWith(`${user.id}/`)).length }));
    return;
  }
  const user = authUser(req);
  if (!user) { res.statusCode = 401; res.end(JSON.stringify({ message: "not authenticated" })); return; }
  if (dataFailure && (url.pathname.startsWith("/rest/v1/") || url.pathname.startsWith("/storage/v1/"))) {
    res.statusCode = 503; res.end(JSON.stringify({ message: "simulated cloud outage" })); return;
  }
  if (url.pathname === "/rest/v1/rpc/ai_tip_cloud_usage" && req.method === "POST") {
    if (cloudUsageFailure) { res.statusCode = 503; res.end(JSON.stringify({ message: "simulated usage refresh failure" })); return; }
    const storageBytes = [...objects.entries()].filter(([name]) => name.startsWith(`${user.id}/`)).reduce((total, [, value]) => total + value.length, 0);
    const databaseBytes = [...documents.values()].filter((row) => row.user_id === user.id).reduce((total, row) => total + Buffer.byteLength(JSON.stringify(row.payload)), 0)
      + [...tips.values()].filter((row) => row.user_id === user.id).reduce((total, row) => total + Buffer.byteLength(JSON.stringify(row.payload)), 0);
    res.end(JSON.stringify([{ used_bytes: storageBytes + databaseBytes, limit_bytes: 5 * 1024 * 1024, storage_bytes: storageBytes, database_bytes: databaseBytes, object_count: [...objects.keys()].filter((name) => name.startsWith(`${user.id}/`)).length }]));
    return;
  }
  if (documentUpsertFailure && url.pathname === "/rest/v1/ai_documents" && req.method === "POST") {
    res.statusCode = 503; res.end(JSON.stringify({ message: "simulated document upsert failure" })); return;
  }
  if (storageUploadFailure && (url.pathname === "/storage/v1/upload/resumable" || (url.pathname.startsWith("/storage/v1/object/ai-document-files/") && req.method === "POST"))) {
    res.statusCode = 503; res.end(JSON.stringify({ message: "simulated storage upload failure" })); return;
  }
  if (url.pathname === "/storage/v1/upload/resumable" && req.method === "POST") {
    const metadata = Object.fromEntries(String(req.headers["upload-metadata"] || "").split(",").filter(Boolean).map((entry) => {
      const [key, encoded = ""] = entry.trim().split(" ");
      return [key, Buffer.from(encoded, "base64").toString("utf8")];
    }));
    if (!validStorageObjectPath(metadata.objectName || "")) {
      res.statusCode = 400; res.end(JSON.stringify({ statusCode: "400", error: "InvalidKey", message: `Invalid key: ${metadata.objectName || ""}`, code: "InvalidKey" })); return;
    }
    const uploadId = `upload-${resumableUploads.size + 1}`;
    resumableUploads.set(uploadId, { length: Number(req.headers["upload-length"]), offset: 0, objectPath: metadata.objectName, contentType: metadata.contentType, chunks: [] });
    res.statusCode = 201;
    res.setHeader("Location", `/storage/v1/upload/resumable/${uploadId}`);
    res.setHeader("Tus-Resumable", "1.0.0");
    res.end();
    return;
  }
  if (url.pathname.startsWith("/storage/v1/upload/resumable/") && req.method === "PATCH") {
    const upload = resumableUploads.get(url.pathname.split("/").pop());
    if (!upload || Number(req.headers["upload-offset"]) !== upload.offset) { res.statusCode = 409; res.end(JSON.stringify({ message: "invalid upload offset" })); return; }
    upload.chunks.push(raw);
    upload.offset += raw.length;
    res.statusCode = 204;
    res.setHeader("Upload-Offset", String(upload.offset));
    res.setHeader("Tus-Resumable", "1.0.0");
    if (upload.offset === upload.length) {
      objects.set(upload.objectPath, Buffer.concat(upload.chunks));
      objectContentTypes.set(upload.objectPath, upload.contentType);
    }
    res.end();
    return;
  }
  if (url.pathname === "/rest/v1/ai_documents") {
    if (req.method === "GET") { res.end(JSON.stringify([...documents.values()])); return; }
    if (req.method === "POST") {
      for (const row of JSON.parse(raw.toString("utf8") || "[]")) documents.set(row.id, row);
      res.statusCode = 201; res.end("[]"); return;
    }
    if (req.method === "DELETE") {
      const ids = String(url.searchParams.get("id") || "").match(/[0-9a-f-]{36}/gi) || [];
      ids.forEach((id) => documents.delete(id)); res.end("[]"); return;
    }
  }
  if (url.pathname === "/rest/v1/ai_tips") {
    if (req.method === "GET") { res.end(JSON.stringify([...tips.values()])); return; }
    if (req.method === "POST") {
      for (const row of JSON.parse(raw.toString("utf8") || "[]")) tips.set(row.id, row);
      res.statusCode = 201; res.end("[]"); return;
    }
    if (req.method === "DELETE") {
      const ids = String(url.searchParams.get("id") || "").match(/[0-9a-f-]{36}/gi) || [];
      ids.forEach((id) => tips.delete(id)); res.end("[]"); return;
    }
  }
  const objectPrefix = "/storage/v1/object/ai-document-files/";
  if (url.pathname.startsWith(objectPrefix)) {
    const objectPath = decodeURIComponent(url.pathname.slice(objectPrefix.length));
    if (req.method === "POST") {
      if (!validStorageObjectPath(objectPath)) { res.statusCode = 400; res.end(JSON.stringify({ statusCode: "400", error: "InvalidKey", message: `Invalid key: ${objectPath}`, code: "InvalidKey" })); return; }
      objects.set(objectPath, raw); objectContentTypes.set(objectPath, requestContentType); res.statusCode = 200; res.end(JSON.stringify({ Key: objectPath })); return;
    }
    if (req.method === "GET" || req.method === "HEAD") {
      if (compressedDownloadFailureStatus && objectPath.endsWith(".gz")) { res.statusCode = compressedDownloadFailureStatus; res.end(JSON.stringify({ message: "simulated compressed object download failure" })); return; }
      const value = objects.get(objectPath);
      if (!value) { res.statusCode = 404; res.end(JSON.stringify({ message: "not found" })); return; }
      res.setHeader("Content-Type", objectContentTypes.get(objectPath) || "application/octet-stream"); res.setHeader("Content-Length", String(value.length)); res.end(req.method === "HEAD" ? undefined : value); return;
    }
  }
  if (url.pathname === "/storage/v1/object/ai-document-files" && req.method === "DELETE") {
    const { prefixes = [] } = JSON.parse(raw.toString("utf8") || "{}");
    prefixes.forEach((objectPath) => { objects.delete(objectPath); objectContentTypes.delete(objectPath); });
    res.end(JSON.stringify(prefixes.map((name) => ({ name }))));
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ message: `unhandled ${req.method} ${url.pathname}` }));
});

const listen = (server) => new Promise((resolve, reject) => { server.listen(0, "127.0.0.1", () => resolve(server.address().port)); server.once("error", reject); });
const mockPort = await listen(mock);
process.env.AI_TIP_EMBEDDED = "1";
process.env.AI_TIP_DESKTOP = "1";
process.env.AI_TIP_DATA_DIR = tempData;
process.env.AI_TIP_SUPABASE_URL = `http://127.0.0.1:${mockPort}`;
process.env.AI_TIP_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
process.env.AI_TIP_ALLOW_INSECURE_SUPABASE = "1";
process.env.AI_TIP_CLOUD_PULL_TTL_MS = "0";
delete process.env.OPENAI_API_KEY;

const { startServer } = await import("../dist-electron/server.cjs");
let appServer = await startServer(0, "127.0.0.1");
let base = `http://127.0.0.1:${appServer.address().port}/api`;

async function request(route, init = {}, token = "") {
  const response = await fetch(`${base}${route}`, { ...init, headers: { ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

try {
  const localLogin = await request("/auth/login", { method: "POST", body: JSON.stringify({ email: "demo@aitip.local", password: "demo1234" }) });
  await request("/documents", { method: "POST", body: "{}" }, localLogin.token);
  const localImportForm = new FormData();
  localImportForm.append("file", new File([pdfBytes], "仅本地原文件.pdf", { type: "application/pdf" }));
  const localImported = await request("/documents/import", { method: "POST", body: localImportForm }, localLogin.token);
  const localStoredBytes = await readFile(path.join(tempData, "uploads", localImported.document.id, localImported.document.originalName));
  if (!localStoredBytes.equals(pdfBytes)) throw new Error("仅本地模式没有保持原始文件字节");
  if (requests.length !== 0) throw new Error("仅本地模式错误调用了 Supabase");

  const pendingResponse = await fetch(`${base}/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "待确认用户", email: pendingUser.email, password: "pending-pass-123" }) });
  const pendingRegistration = await pendingResponse.json();
  if (pendingResponse.status !== 202 || pendingRegistration.confirmationRequired !== true || pendingRegistration.token || pendingRegistration.refreshToken) {
    throw new Error(`邮箱确认注册没有返回无会话的 202 响应：${pendingResponse.status} ${JSON.stringify(pendingRegistration)}`);
  }
  const pendingStore = JSON.parse(await readFile(path.join(tempData, "store.json"), "utf8"));
  if (pendingStore.users.some((item) => item.id === pendingUser.id)) throw new Error("未确认或模糊化的 Supabase User 被错误写入本地云用户库");
  if (requests.some((item) => item.path.startsWith("/rest/v1/") || item.path.startsWith("/storage/v1/"))) throw new Error("待确认注册错误触发了云数据同步");

  const verifiedRegistration = await request("/auth/verify-registration", { method: "POST", body: JSON.stringify({ email: pendingUser.email, code: "123456" }) });
  if (verifiedRegistration.token !== pendingAccessToken || verifiedRegistration.refreshToken !== pendingRefreshToken || verifiedRegistration.user.id !== pendingUser.id) throw new Error("注册验证码没有通过 Supabase verify 建立云会话");
  const verifiedStore = JSON.parse(await readFile(path.join(tempData, "store.json"), "utf8"));
  if (!verifiedStore.users.some((item) => item.id === pendingUser.id && item.authMode === "supabase")) throw new Error("验证码验证后的正式云用户没有写入本地用户库");

  const existingResponse = await fetch(`${base}/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "重复用户", email: fakeExistingUser.email, password: "existing-pass-123" }) });
  const existingRegistration = await existingResponse.json();
  if (existingResponse.status !== 409 || existingRegistration.code !== "ACCOUNT_EXISTS" || !String(existingRegistration.error || "").includes("已注册")) throw new Error(`重复注册没有显示已注册状态：${existingResponse.status} ${JSON.stringify(existingRegistration)}`);
  const existingStore = JSON.parse(await readFile(path.join(tempData, "store.json"), "utf8"));
  if (existingStore.users.some((item) => item.id === fakeExistingUser.id)) throw new Error("Supabase 模糊化的重复注册 User 被错误持久化");

  const recoveryRequested = await request("/auth/password/recover", { method: "POST", body: JSON.stringify({ email: recoveryUser.email }) });
  if (!recoveryRequested.verificationRequired || !requests.some((item) => item.path === "/auth/v1/recover")) throw new Error("忘记密码没有调用 Supabase recovery 邮件入口");
  const badRecovery = await fetch(`${base}/auth/password/reset`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: recoveryUser.email, code: "000000", password: "new-pass-123" }) });
  if (badRecovery.status !== 401) throw new Error("错误的恢复验证码没有被 Supabase 拒绝");
  const recovered = await request("/auth/password/reset", { method: "POST", body: JSON.stringify({ email: recoveryUser.email, code: "654321", password: "new-pass-123" }) });
  if (recovered.token !== recoveryAccessToken || recovered.user.id !== recoveryUser.id) throw new Error("恢复验证码没有产生已登录会话");
  const passwordUpdate = requests.find((item) => item.path === "/auth/v1/user" && item.method === "PUT" && item.body.includes("new-pass-123"));
  if (!passwordUpdate) throw new Error("恢复验证码通过后没有调用 Supabase 更新密码入口");

  const malformedResponse = await fetch(`${base}/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "畸形会话", email: "malformed-session@example.test", password: "malformed-pass-123" }) });
  const malformedRegistration = await malformedResponse.json();
  if (malformedResponse.status !== 502 || !String(malformedRegistration.error || "").includes("注册响应") || String(malformedRegistration.error || "").includes("Cannot read properties")) {
    throw new Error(`畸形 Supabase 会话没有被显式拒绝：${malformedResponse.status} ${JSON.stringify(malformedRegistration)}`);
  }

  const registered = await request("/auth/register", { method: "POST", body: JSON.stringify({ name: "云端用户", email: cloudUser.email, password: "cloud-pass-123" }) });
  if (registered.user.authMode !== "supabase" || registered.token !== accessToken || registered.refreshToken !== refreshToken) throw new Error("普通注册没有返回 Supabase 云会话");
  if (!requests.some((item) => item.path === "/auth/v1/signup")) throw new Error("普通注册没有消费 Supabase Auth");

  const invalidMe = await fetch(`${base}/auth/me`, { headers: { Authorization: "Bearer fabricated-cloud-token" } });
  if (invalidMe.status !== 401) throw new Error("伪造云 token 没有被拒绝");
  const locallySignedCloudImpersonation = jwt.sign({ sub: cloudUser.id }, "ai-tip-local-development-secret-change-me", { expiresIn: "1h" });
  const impersonatedMe = await fetch(`${base}/auth/me`, { headers: { Authorization: `Bearer ${locallySignedCloudImpersonation}` } });
  if (impersonatedMe.status !== 401) throw new Error("设备本地 JWT 错误冒充了 Supabase 云用户");

  const cloudWrites = () => requests.filter((item) => (item.path.startsWith("/rest/v1/") || item.path.startsWith("/storage/v1/")) && ["POST", "PATCH", "PUT", "DELETE"].includes(item.method)).length;
  const cloudWritesBeforeLocalChanges = cloudWrites();
  const created = await request("/documents", { method: "POST", body: "{}" }, registered.token);
  const block = created.document.blocks[0];
  const selectedText = "云端同步验证文本";
  await request(`/documents/${created.document.id}`, { method: "PATCH", body: JSON.stringify({ blocks: [{ ...block, content: selectedText }] }) }, registered.token);
  const createdTip = await request(`/documents/${created.document.id}/tips`, { method: "POST", body: JSON.stringify({ blockId: block.id, selectedText, startOffset: 0, endOffset: selectedText.length, prefixText: "", suffixText: "" }) }, registered.token);
  const modelSettings = await request("/settings", {}, registered.token);
  await request("/settings", { method: "PUT", body: JSON.stringify({ ...modelSettings.settings, provider: "custom", baseURL: `http://127.0.0.1:${mockPort}/v1`, model: "supabase-sync-model", apiKey: "supabase-model-test-key", webSearchEnabled: false }) }, registered.token);
  await request(`/tips/${createdTip.tip.id}/chat`, { method: "POST", body: JSON.stringify({ question: "请解释这段文字", language: "zh" }) }, registered.token);
  if (cloudWrites() !== cloudWritesBeforeLocalChanges || documents.has(created.document.id) || tips.has(createdTip.tip.id)) throw new Error("未点击上传云端时，本地文档/Tip/聊天仍自动写入 Supabase");
  const explicitCreatedUpload = await request(`/documents/${created.document.id}/cloud`, { method: "POST", body: "{}" }, registered.token);
  if (explicitCreatedUpload.document.cloudState !== "synced" || !documents.has(created.document.id)) throw new Error("显式上传没有写入文档或没有产生 synced 状态");
  if (!tips.get(createdTip.tip.id)?.payload?.messages?.some((message) => message.role === "assistant")) throw new Error("显式上传没有同步最终 Tip 回答");
  const uploadedTitle = documents.get(created.document.id).payload.title;
  const modifiedAfterUpload = await request(`/documents/${created.document.id}`, { method: "PATCH", body: JSON.stringify({ title: "本地修改后待上传" }) }, registered.token);
  if (modifiedAfterUpload.document.cloudState !== "modified" || documents.get(created.document.id).payload.title !== uploadedTitle) throw new Error("已同步文档本地修改后没有保持 modified，或仍自动更新云端");
  const explicitUpdate = await request(`/documents/${created.document.id}/cloud`, { method: "POST", body: "{}" }, registered.token);
  if (explicitUpdate.document.cloudState !== "synced" || documents.get(created.document.id).payload.title !== "本地修改后待上传") throw new Error("再次点击更新云端没有消费本地修改");

  const currentSettings = await request("/settings", {}, registered.token);
  const secretMarker = "MODEL_SECRET_MUST_STAY_LOCAL";
  const searchMarker = "TAVILY_SECRET_MUST_STAY_LOCAL";
  await request("/settings", { method: "PUT", body: JSON.stringify({ ...currentSettings.settings, provider: "openai", baseURL: "https://api.openai.com/v1", model: "test-model", apiKey: secretMarker, searchApiKey: searchMarker, systemPrompt: "local prompt", language: "zh-CN" }) }, registered.token);
  const leaked = requests.some((item) => item.path.startsWith("/rest/v1/") && (item.body.includes(secretMarker) || item.body.includes(searchMarker)));
  if (leaked) throw new Error("模型或 Tavily Key 泄漏到 Supabase 请求体");

  const form = new FormData();
  form.append("file", new File([pdfBytes], "云端原文件.pdf", { type: "application/pdf" }));
  const imported = await request("/documents/import", { method: "POST", body: form }, registered.token);
  const importedWritesBeforeUpload = cloudWrites();
  if (documents.has(imported.document.id)) throw new Error("云账号导入后未点击按钮仍自动写入 Data API");
  await request(`/documents/${imported.document.id}/cloud`, { method: "POST", body: "{}" }, registered.token);
  if (cloudWrites() <= importedWritesBeforeUpload) throw new Error("点击上传云端没有触发正式云写入");
  const sourcePath = documents.get(imported.document.id)?.source_path;
  const storedArchive = objects.get(sourcePath);
  if (!sourcePath || !sourcePath.endsWith(".pdf.gz") || !storedArchive) throw new Error("PDF 没有以 .gz 压缩包路径进入私有 Storage");
  if (storedArchive.equals(pdfBytes) || storedArchive[0] !== 0x1f || storedArchive[1] !== 0x8b) throw new Error("Storage 对象不是 gzip 压缩包，仍在上传原始 PDF");
  if (!gunzipSync(storedArchive).equals(pdfBytes)) throw new Error("云端压缩包解压后与原始 PDF 字节不一致");
  if (objectContentTypes.get(sourcePath) !== "application/gzip") throw new Error("普通 Storage 上传没有使用 application/gzip");
  const importedDocumentWrite = requests.findIndex((item) => item.method === "POST" && item.path === "/rest/v1/ai_documents" && item.body.includes(imported.document.id));
  const importedSourceWrite = requests.findIndex((item) => item.method === "POST" && item.path.includes(`/storage/v1/object/ai-document-files/${cloudUser.id}/${imported.document.id}/`));
  if (importedDocumentWrite < 0 || importedSourceWrite < 0 || importedSourceWrite > importedDocumentWrite) throw new Error("显式上传没有先写源文件再提交文档快照，失败补偿链可能失效");

  const objectsBeforeUpsertFailure = objects.size;
  const storagePostsBeforeUpsertFailure = requests.filter((item) => item.method === "POST" && item.path.startsWith("/storage/v1/")).length;
  documentUpsertFailure = true;
  const rejectedBeforeStorageForm = new FormData();
  rejectedBeforeStorageForm.append("file", new Blob(["record must exist before source"], { type: "text/plain" }), "upsert-failure.txt");
  const rejectedBeforeStorageImport = await request("/documents/import", { method: "POST", body: rejectedBeforeStorageForm }, registered.token);
  const rejectedBeforeStorage = await fetch(`${base}/documents/${rejectedBeforeStorageImport.document.id}/cloud`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${registered.token}` }, body: "{}" });
  documentUpsertFailure = false;
  if (rejectedBeforeStorage.status !== 503 || objects.size !== objectsBeforeUpsertFailure || requests.filter((item) => item.method === "POST" && item.path.startsWith("/storage/v1/")).length <= storagePostsBeforeUpsertFailure) throw new Error("文档快照失败后没有删除刚上传的源对象，或没有进入显式上传链");

  const documentsBeforeStorageFailure = new Set(documents.keys());
  storageUploadFailure = true;
  const rejectedStorageForm = new FormData();
  rejectedStorageForm.append("file", new Blob(["source upload must roll back record"], { type: "text/plain" }), "storage-failure.txt");
  const rejectedStorageImport = await request("/documents/import", { method: "POST", body: rejectedStorageForm }, registered.token);
  const rejectedStorage = await fetch(`${base}/documents/${rejectedStorageImport.document.id}/cloud`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${registered.token}` }, body: "{}" });
  storageUploadFailure = false;
  if (rejectedStorage.status !== 503 || [...documents.keys()].some((id) => !documentsBeforeStorageFailure.has(id))) throw new Error("源文件上传失败后没有补偿删除新文档记录");
  if (imported.document.originalName !== "云端原文件.pdf") throw new Error("内部 ASCII 对象键错误改变了用户原始文件名");
  if (sourcePath !== `${cloudUser.id}/${imported.document.id}/source.pdf.gz` || !validStorageObjectPath(sourcePath)) throw new Error("云端压缩包没有消费统一的 ASCII Storage 对象键");

  const eofOffset = pdfBytes.lastIndexOf(Buffer.from("%%EOF", "ascii"));
  const compressibleLargePdfBytes = Buffer.concat([
    pdfBytes.subarray(0, eofOffset),
    Buffer.from(`%${"a".repeat(6 * 1024 * 1024 + 1)}\n`, "ascii"),
    pdfBytes.subarray(eofOffset)
  ]);
  const resumableCountBeforeCompressible = resumableUploads.size;
  const compressibleLargeForm = new FormData();
  compressibleLargeForm.append("file", new File([compressibleLargePdfBytes], "可高度压缩的六兆文件.pdf", { type: "application/pdf" }));
  const compressibleLargeImported = await request("/documents/import", { method: "POST", body: compressibleLargeForm }, registered.token);
  await request(`/documents/${compressibleLargeImported.document.id}/cloud`, { method: "POST", body: "{}" }, registered.token);
  const compressibleLargeSourcePath = documents.get(compressibleLargeImported.document.id)?.source_path;
  const compressibleArchive = objects.get(compressibleLargeSourcePath);
  if (!compressibleArchive || !gunzipSync(compressibleArchive).equals(compressibleLargePdfBytes)) throw new Error("大体积可压缩文件没有保持字节级往返");
  if (compressibleArchive.length >= 6 * 1024 * 1024 || resumableUploads.size !== resumableCountBeforeCompressible) throw new Error("错误地按原文件大小而不是压缩后大小选择了 TUS");

  let randomState = 0x12345678;
  const incompressibleComment = Buffer.alloc(8 * 1024 * 1024);
  for (let index = 0; index < incompressibleComment.length; index += 1) {
    randomState ^= randomState << 13; randomState ^= randomState >>> 17; randomState ^= randomState << 5;
    incompressibleComment[index] = 33 + ((randomState >>> 0) % 94);
  }
  const largePdfBytes = Buffer.concat([pdfBytes.subarray(0, eofOffset), Buffer.from("%", "ascii"), incompressibleComment, Buffer.from("\n", "ascii"), pdfBytes.subarray(eofOffset)]);
  const largeForm = new FormData();
  largeForm.append("file", new File([largePdfBytes], "超过六兆的云端原文件.pdf", { type: "application/pdf" }));
  const largeImported = await request("/documents/import", { method: "POST", body: largeForm }, registered.token);
  const storageWritesBeforeQuotaFailure = cloudWrites();
  const quotaFailure = await fetch(`${base}/documents/${largeImported.document.id}/cloud`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${registered.token}` }, body: "{}" });
  const quotaFailureBody = await quotaFailure.json();
  if (quotaFailure.status !== 413 || quotaFailureBody.code !== "CLOUD_QUOTA_EXCEEDED" || documents.has(largeImported.document.id) || cloudWrites() !== storageWritesBeforeQuotaFailure) throw new Error("单个压缩包超过 5 MiB 时没有在任何云写入前被明确拒绝");

  const refreshed = await request("/auth/refresh", { method: "POST", body: JSON.stringify({ refreshToken }) });
  if (refreshed.token !== refreshedToken || refreshed.user.id !== cloudUser.id) throw new Error("Supabase refresh token 没有产生新会话");

  const unsyncedBeforeRestart = await request("/documents", { method: "POST", body: "{}" }, refreshed.token);
  if (documents.has(unsyncedBeforeRestart.document.id)) throw new Error("重启前本地文档被自动上传");
  await new Promise((resolve) => appServer.close(resolve));
  const storePath = path.join(tempData, "store.json");
  const store = JSON.parse(await readFile(storePath, "utf8"));
  store.documents = store.documents.filter((item) => item.userId !== cloudUser.id || item.id === unsyncedBeforeRestart.document.id);
  store.tips = store.tips.filter((item) => item.userId !== cloudUser.id || item.documentId === unsyncedBeforeRestart.document.id);
  await writeFile(storePath, JSON.stringify(store, null, 2), "utf8");
  await rm(path.join(tempData, "uploads", imported.document.id), { recursive: true, force: true });
  appServer = await startServer(0, "127.0.0.1");
  base = `http://127.0.0.1:${appServer.address().port}/api`;
  const reloaded = await request("/documents", {}, refreshed.token);
  if (!reloaded.documents.some((item) => item.id === created.document.id) || !reloaded.documents.some((item) => item.id === imported.document.id) || !reloaded.documents.some((item) => item.id === unsyncedBeforeRestart.document.id && item.cloudState === "local")) throw new Error("云合并没有同时恢复云文档并保留本机未上传文档");
  const remoteDocument = await request(`/documents/${created.document.id}`, {}, refreshed.token);
  if (!remoteDocument.tips.some((item) => item.id === createdTip.tip.id && item.messages.some((message) => message.role === "assistant"))) throw new Error("清空本机缓存后没有恢复 Tip 最终回答");
  const sourceResponse = await fetch(`${base}/documents/${imported.document.id}/source`, { headers: { Authorization: `Bearer ${refreshed.token}` } });
  if (!sourceResponse.ok || !Buffer.from(await sourceResponse.arrayBuffer()).equals(pdfBytes)) throw new Error("本机原文件缺失时没有从私有 Storage 恢复相同字节");

  const importedLocalPath = path.join(tempData, "uploads", imported.document.id, imported.document.originalName);
  const legacySourcePath = `${cloudUser.id}/${imported.document.id}/source.pdf`;
  await rm(path.dirname(importedLocalPath), { recursive: true, force: true });
  objects.set(legacySourcePath, pdfBytes);
  objectContentTypes.set(legacySourcePath, "application/pdf");
  const legacyGetsBeforeFailure = requests.filter((item) => item.method === "GET" && item.path.endsWith(`/${legacySourcePath}`)).length;
  compressedDownloadFailureStatus = 503;
  const blockedFallback = await fetch(`${base}/documents/${imported.document.id}/source`, { headers: { Authorization: `Bearer ${refreshed.token}` } });
  compressedDownloadFailureStatus = 0;
  if (blockedFallback.ok || requests.filter((item) => item.method === "GET" && item.path.endsWith(`/${legacySourcePath}`)).length !== legacyGetsBeforeFailure) throw new Error("新压缩对象非 404 故障时错误绕过到旧对象");

  objects.set(sourcePath, Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x00]));
  objectContentTypes.set(sourcePath, "application/gzip");
  const corruptArchiveResponse = await fetch(`${base}/documents/${imported.document.id}/source`, { headers: { Authorization: `Bearer ${refreshed.token}` } });
  if (corruptArchiveResponse.ok) throw new Error("损坏的 gzip 对象被静默当成原文件");

  objects.delete(sourcePath);
  objectContentTypes.delete(sourcePath);
  const legacySourceResponse = await fetch(`${base}/documents/${imported.document.id}/source`, { headers: { Authorization: `Bearer ${refreshed.token}` } });
  if (!legacySourceResponse.ok || !Buffer.from(await legacySourceResponse.arrayBuffer()).equals(pdfBytes)) throw new Error("升级后没有从旧的非压缩 Storage 路径恢复历史原文件");

  objects.set(sourcePath, storedArchive);
  objectContentTypes.set(sourcePath, "application/gzip");
  await request(`/documents/${imported.document.id}`, { method: "DELETE" }, refreshed.token);
  if (!objects.has(sourcePath) || !objects.has(legacySourcePath)) throw new Error("普通本地删除错误影响了云端副本");
  const modifiedBeforeCloudDelete = await request(`/documents/${imported.document.id}`, { method: "PATCH", body: JSON.stringify({ status: "active" }) }, refreshed.token);
  if (modifiedBeforeCloudDelete.document.cloudState !== "modified" || !modifiedBeforeCloudDelete.document.cloudSyncedAt) throw new Error("云副本存在且本地已修改的测试前提未建立");
  cloudUsageFailure = true;
  const removedCloud = await request(`/documents/${imported.document.id}/cloud`, { method: "DELETE" }, refreshed.token);
  cloudUsageFailure = false;
  if (removedCloud.document.cloudState !== "local" || removedCloud.document.cloudSyncedAt || removedCloud.usage !== null) throw new Error("删除云端文件后没有保留本地文档并清除云状态，或用量刷新失败被误报");
  if (objects.has(sourcePath) || objects.has(legacySourcePath)) throw new Error("显式移出云端没有同时清理新压缩对象与旧原始对象");

  dataFailure = true;
  const locallySavedDuringCloudFailure = await request("/documents", { method: "POST", body: "{}" }, refreshed.token);
  const failedCloudWrite = await fetch(`${base}/documents/${locallySavedDuringCloudFailure.document.id}/cloud`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${refreshed.token}` }, body: "{}" });
  if (failedCloudWrite.ok) throw new Error("云故障时错误声称显式上传已完成");
  const failedCloudBody = await failedCloudWrite.json();
  if (!String(failedCloudBody.error || "").includes("simulated cloud outage") || failedCloudBody.error === "服务暂时不可用") throw new Error("确定的 Supabase 上游错误仍被折叠成笼统服务不可用");
  const localStillWorks = await request("/documents", { method: "POST", body: "{}" }, localLogin.token);
  if (!localStillWorks.document) throw new Error("Supabase 故障错误阻断了仅本地模式");

  dataFailure = false;
  const deletionCallsBeforeMismatch = accountDeletionCalls;
  const mismatchedDeletion = await fetch(`${base}/auth/account`, { method: "DELETE", headers: { "Content-Type": "application/json", Authorization: `Bearer ${refreshed.token}` }, body: JSON.stringify({ confirmation: "wrong@example.test" }) });
  if (mismatchedDeletion.status !== 400 || accountDeletionCalls !== deletionCallsBeforeMismatch) throw new Error("错误确认邮箱仍触发了远端账户删除");

  const storeBeforeFailedDeletion = JSON.parse(await readFile(path.join(tempData, "store.json"), "utf8"));
  const userDocumentsBeforeFailedDeletion = storeBeforeFailedDeletion.documents.filter((item) => item.userId === cloudUser.id).length;
  accountDeletionFailure = true;
  const failedDeletion = await fetch(`${base}/auth/account`, { method: "DELETE", headers: { "Content-Type": "application/json", Authorization: `Bearer ${refreshed.token}` }, body: JSON.stringify({ confirmation: cloudUser.email }) });
  accountDeletionFailure = false;
  if (failedDeletion.status !== 503) throw new Error("远端删除失败没有明确阻止注销完成");
  const storeAfterFailedDeletion = JSON.parse(await readFile(path.join(tempData, "store.json"), "utf8"));
  if (!storeAfterFailedDeletion.users.some((item) => item.id === cloudUser.id) || storeAfterFailedDeletion.documents.filter((item) => item.userId === cloudUser.id).length !== userDocumentsBeforeFailedDeletion) {
    throw new Error("远端删除失败时错误清除了本地用户或文档");
  }

  const successfulDeletion = await request("/auth/account", { method: "DELETE", body: JSON.stringify({ confirmation: cloudUser.email }) }, refreshed.token);
  if (!successfulDeletion.deleted || !successfulDeletion.localDataCleared) throw new Error("远端删除成功后没有返回可验证的完成状态");
  const storeAfterSuccessfulDeletion = JSON.parse(await readFile(path.join(tempData, "store.json"), "utf8"));
  if (storeAfterSuccessfulDeletion.users.some((item) => item.id === cloudUser.id)
    || storeAfterSuccessfulDeletion.documents.some((item) => item.userId === cloudUser.id)
    || storeAfterSuccessfulDeletion.tips.some((item) => item.userId === cloudUser.id)
    || storeAfterSuccessfulDeletion.settings.some((item) => item.userId === cloudUser.id)) {
    throw new Error("账户删除成功后本地身份或数据仍可被正式路径消费");
  }
  const staleToken = await fetch(`${base}/auth/me`, { headers: { Authorization: `Bearer ${refreshed.token}` } });
  if (staleToken.status !== 401) throw new Error("账户删除后旧 access token 仍可进入正式 API");

  const deletionCallsBeforeLocalClear = accountDeletionCalls;
  const localClear = await request("/auth/account", { method: "DELETE", body: JSON.stringify({ confirmation: "demo@aitip.local" }) }, localLogin.token);
  if (localClear.deleted !== false || !localClear.localDataCleared || accountDeletionCalls !== deletionCallsBeforeLocalClear) throw new Error("仅本地清理错误调用云删除或错误声称删除云账户");
  const localAfterClear = await request("/documents", {}, localLogin.token);
  if (localAfterClear.documents.length !== 0) throw new Error("仅本地清理后旧文档仍可恢复");
  const storeAfterLocalClear = JSON.parse(await readFile(path.join(tempData, "store.json"), "utf8"));
  if (!storeAfterLocalClear.users.some((item) => item.id === localLogin.user.id) || storeAfterLocalClear.documents.some((item) => item.userId === localLogin.user.id)) throw new Error("仅本地清理删除了固定入口或保留了本地文档");

  console.log(JSON.stringify({ localSupabaseRequests: 0, cloudAccountLocalWritesBeforeClick: true, explicitCloudUploadPredictionBearing: true, localSourceBytesUnchanged: true, confirmationResponseHandled: true, unverifiedUserNotPersisted: true, signupOtpVerified: true, accountExistsDetected: true, recoveryOtpVerified: true, passwordUpdatedAfterRecovery: true, malformedSessionRejected: true, cloudAuth: true, forgedTokenBlocked: true, localJwtCloudImpersonationBlocked: true, cloudDocuments: true, cloudTipsAndAnswers: true, localSecretsExcluded: true, unicodeOriginalNamePreserved: true, asciiStorageObjectKey: true, compressedArchiveOnly: true, archiveRoundTrip: true, compressedSizeControlsUpload: true, fiveMiBPreflight: true, corruptArchiveRejected: true, legacyRawSourceRecovered: true, non404FallbackBlocked: true, ordinaryDeleteCloudIsolation: true, explicitDualPathCloudRemove: true, modifiedCloudCopyCanBeDeleted: true, usageRefreshFailureDoesNotRewriteDeletion: true, refresh: true, cacheRehydrated: true, cloudFailureExplicit: true, cloudFailureLocalSaveStillWorks: true, localFailureIsolation: true, deletionConfirmationBlocksRemoteCall: true, deletionFailurePreservesLocalData: true, deletionSuccessPurgesLocalData: true, staleDeletedUserTokenBlocked: true, localClearNeverCallsSupabase: true, localDocumentsDoNotReturn: true }, null, 2));
} finally {
  await new Promise((resolve) => appServer?.listening ? appServer.close(resolve) : resolve());
  await new Promise((resolve) => mock.close(resolve));
  await rm(tempData, { recursive: true, force: true });
}
