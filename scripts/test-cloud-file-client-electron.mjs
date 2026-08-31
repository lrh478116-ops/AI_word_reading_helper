import { app, BrowserWindow } from "electron";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const stamp = new Date().toISOString();
const user = { id: "11111111-1111-4111-8111-111111111111", name: "云端客户端测试", email: "cloud-client@example.test", authMode: "supabase" };
const documents = new Map([
  ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", makeDocument("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "文档库云删除测试")],
  ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", makeDocument("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "编辑器云删除测试")]
]);
const trace = [];

function makeDocument(id, title) {
  return {
    id, userId: user.id, title, sourceType: "blank", favorite: false, status: "active",
    blocks: [{ id: `${id}-block`, documentId: id, type: "paragraph", content: "本机内容必须保留。", order: 0, contentHash: "", createdAt: stamp, updatedAt: stamp }],
    createdAt: stamp, updatedAt: stamp, lastOpenedAt: stamp, tipCount: 0,
    cloudSyncedAt: "2026-08-30T00:00:00.000Z", cloudState: "modified"
  };
}

function json(response, value, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

const mime = new Map([[".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"], [".mjs", "text/javascript; charset=utf-8"], [".css", "text/css; charset=utf-8"], [".png", "image/png"]]);
const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  const token = String(request.headers.authorization || "");
  if (url.pathname.startsWith("/api/")) {
    if (token !== "Bearer cloud-client-token") return json(response, { error: "unauthorized" }, 401);
    if (url.pathname === "/api/auth/me") return json(response, { user });
    if (url.pathname === "/api/documents" && request.method === "GET") {
      const status = url.searchParams.get("status") || "active";
      return json(response, { documents: status === "active" ? [...documents.values()] : [] });
    }
    if (url.pathname === "/api/cloud/usage") return json(response, { usage: { usedBytes: 1024, limitBytes: 5242880, storageBytes: 512, databaseBytes: 512, objectCount: 2 } });
    if (url.pathname === "/api/settings") return json(response, { settings: { provider: "openai", baseURL: "https://api.openai.com/v1", model: "gpt-5-mini", apiKey: "", systemPrompt: "", webSearchEnabled: false, searchBudgetMode: "free", searchApiKey: "", pythonEnabled: true, reliabilityEnabled: true } });
    if (url.pathname === "/api/ai/status") return json(response, { status: { configured: false, provider: "openai", model: "", reason: "no-api-key", local: false } });
    const match = url.pathname.match(/^\/api\/documents\/([0-9a-f-]{36})(\/cloud)?$/);
    if (match) {
      const document = documents.get(match[1]);
      if (!document) return json(response, { error: "not found" }, 404);
      if (!match[2] && request.method === "GET") return json(response, { document, tips: [] });
      if (!match[2] && request.method === "PATCH") {
        const chunks = []; for await (const chunk of request) chunks.push(chunk);
        const patch = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        Object.assign(document, patch, { updatedAt: new Date().toISOString(), cloudState: "modified" });
        trace.push({ action: "save-local", id: document.id });
        return json(response, { document });
      }
      if (match[2] && request.method === "DELETE") {
        trace.push({ action: "delete-cloud", id: document.id });
        delete document.cloudSyncedAt; document.cloudState = "local";
        return json(response, { document, usage: null });
      }
    }
    return json(response, { error: `unhandled ${request.method} ${url.pathname}` }, 404);
  }

  const relative = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  const target = path.resolve(dist, relative);
  if (!target.startsWith(`${dist}${path.sep}`) && target !== path.join(dist, "index.html")) { response.writeHead(403); return response.end(); }
  try {
    const body = await readFile(target);
    response.writeHead(200, { "Content-Type": mime.get(path.extname(target)) || "application/octet-stream" }); response.end(body);
  } catch { response.writeHead(404); response.end(); }
});

const port = await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve(server.address().port)); });
console.log("[cloud-client] mock ready");
async function run() {
  console.log("[cloud-client] electron ready");
  const window = new BrowserWindow({ width: 1280, height: 800, show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  try {
  const origin = `http://127.0.0.1:${port}`;
  await window.loadURL(origin);
  console.log("[cloud-client] initial page loaded");
  await window.webContents.executeJavaScript(`localStorage.setItem('ai-tip-token', 'cloud-client-token'); localStorage.setItem('ai-tip-language', 'zh-CN'); true`);
  const reloaded = new Promise((resolve, reject) => {
    window.webContents.once("did-finish-load", resolve);
    window.webContents.once("did-fail-load", (_event, code, description) => reject(new Error(`reload failed: ${code} ${description}`)));
  });
  window.reload();
  await reloaded;
  console.log("[cloud-client] authenticated page loaded");
  const rendererTest = window.webContents.executeJavaScript(`(async () => {
    const wait = async (test, label, timeout = 10000) => { const started = Date.now(); while (Date.now() - started < timeout) { const value = test(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 40)); } throw new Error('timeout: ' + label); };
    window.confirm = () => true;
    await wait(() => document.querySelector('.app-nav'), 'library');
    const firstId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const secondId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const firstDelete = await wait(() => document.querySelector('[data-delete-cloud-file="' + firstId + '"]'), 'library cloud delete');
    const firstCard = firstDelete.closest('.document-card');
    if (!firstCard.textContent.includes('更新云端') || !firstCard.textContent.includes('删除云端文件')) throw new Error('modified library document does not expose both update and delete');
    firstDelete.click();
    await wait(() => !document.querySelector('[data-delete-cloud-file="' + firstId + '"]') && document.body.innerText.includes('文档库云删除测试'), 'library deletion preserves local card');
    const secondCard = [...document.querySelectorAll('.document-card')].find(card => card.querySelector('h3')?.textContent === '编辑器云删除测试');
    secondCard.click();
    await wait(() => document.querySelector('[data-editor-document="' + secondId + '"]'), 'editor');
    const deleteInEditor = await wait(() => document.querySelector('[data-delete-cloud-file="' + secondId + '"]'), 'editor cloud delete');
    if (!document.querySelector('.cloud-upload-button')?.textContent.includes('更新云端')) throw new Error('modified editor does not retain update action');
    const title = document.querySelector('.document-title');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(title, '编辑器删除前已保存');
    title.dispatchEvent(new Event('input', { bubbles: true }));
    deleteInEditor.click();
    await wait(() => !document.querySelector('[data-delete-cloud-file="' + secondId + '"]') && document.querySelector('[data-editor-document="' + secondId + '"]'), 'editor deletion preserves local document');
    return { libraryEntry: true, modifiedShowsBothActions: true, editorEntry: true, localDocumentPreserved: true };
  })()`);
  const result = await Promise.race([rendererTest, new Promise((_, reject) => setTimeout(async () => {
    const diagnostic = await window.webContents.executeJavaScript(`({ text: document.body.innerText.slice(0, 800), token: localStorage.getItem('ai-tip-token'), url: location.href })`).catch(() => ({}));
    reject(new Error(`cloud client UI timeout: ${JSON.stringify(diagnostic)}`));
  }, 30000))]);

  const firstDeleteIndex = trace.findIndex(item => item.action === "delete-cloud" && item.id.startsWith("a"));
  const secondSaveIndex = trace.findIndex(item => item.action === "save-local" && item.id.startsWith("b"));
  const secondDeleteIndex = trace.findIndex(item => item.action === "delete-cloud" && item.id.startsWith("b"));
  if (firstDeleteIndex < 0 || secondSaveIndex < 0 || secondDeleteIndex <= secondSaveIndex) throw new Error(`invalid client lineage: ${JSON.stringify(trace)}`);
  console.log(JSON.stringify({ ...result, bearerAuthenticated: true, saveBeforeDelete: true, deletionRequests: trace.filter(item => item.action === "delete-cloud").length }));
  } finally {
    window.destroy();
    await new Promise(resolve => server.close(resolve));
    app.quit();
  }
}

app.whenReady().then(run).catch(async (error) => {
  console.error(error);
  if (server.listening) await new Promise(resolve => server.close(resolve));
  app.exit(1);
});
