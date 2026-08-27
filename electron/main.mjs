import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, safeStorage, session, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { BundledLlamaRuntime, ManagedOllamaRuntime, findOllamaExecutable } from "./model-runtime.mjs";
import { downloadOfficialModelArtifact } from "./model-download.mjs";
import { chromiumNetFetch, chromiumProxyDescription } from "./chromium-net-fetch.mjs";
import { createRememberedLoginStore } from "./login-credentials.mjs";
import { downloadOfficialOllamaInstaller, fetchLatestOllamaInstallerInfo, ollamaInstallerAssetName, ollamaInstallerStartUrl } from "./ollama-installer.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let mainWindow = null;
let localServer = null;
let localURL = null;
let pythonCalculation = null;
let pythonWorkerTest = null;
let liveReferenceSearch = null;
let smokeDataDir = null;
let smokeModelServer = null;
let smokeModelURL = "";
let managedLocalRuntime = null;
let managedOllamaRuntime = null;
let managedLocalRestoreAttempted = false;
const modelDirectorySelections = new Map();
const ollamaInstallerSelections = new Map();
const ollamaInstallerDownloads = new Map();
const modelSecurityScopeStops = [];
let modelDirectoryPreparation = null;
let rememberedLoginStore = null;
const smokeResultPath = process.env.AI_TIP_SMOKE_RESULT_PATH ? path.resolve(process.env.AI_TIP_SMOKE_RESULT_PATH) : "";

function bundledLlamaServerPath() {
  const platformFolder = process.platform === "win32" ? "win-x64" : process.arch === "arm64" ? "mac-arm64" : "mac-x64";
  const executable = process.platform === "win32" ? "llama-server.exe" : "llama-server";
  const root = app.isPackaged ? process.resourcesPath : path.join(appRoot, "runtime");
  return path.join(root, "llama.cpp", platformFolder, executable);
}

async function bootSmokeModelServer() {
  if (smokeModelURL) return smokeModelURL;
  smokeModelServer = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/v1/models") return res.end(JSON.stringify({ object: "list", data: [{ id: "desktop-smoke-model", object: "model", owned_by: "smoke" }] }));
    if (req.url === "/v1/chat/completions") {
      const body = JSON.parse(raw || "{}");
      const system = String(body.messages?.[0]?.content || "");
      const lastUser = [...(body.messages || [])].reverse().find((message) => message.role === "user")?.content || "";
      const content = system.includes("问题专业程度分类器")
        ? JSON.stringify({ level: "general", professional: false, domain: "通用", confidence: 97, requiresWebReview: false, reason: "桌面烟测普通问题" })
        : system.includes("WEB_SEARCH_DECISION_V1")
          ? JSON.stringify({ required: false, confidence: 97, reason: "桌面烟测问题只依赖已给上下文", queryZh: "", queryEn: "" })
          : `SMOKE_LOCAL_MODEL_ANSWER: ${String(lastUser).slice(0, 180)}\nhttps://zh.wikipedia.org/w/index.php?search=SMOKE_LINK`;
      return res.end(JSON.stringify({ id: "smoke-completion", object: "chat.completion", created: Math.floor(Date.now() / 1000), model: "desktop-smoke-model", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] }));
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "smoke model route not found" }));
  });
  await new Promise((resolve, reject) => {
    smokeModelServer.once("error", reject);
    smokeModelServer.listen(0, "127.0.0.1", resolve);
  });
  smokeModelURL = `http://127.0.0.1:${smokeModelServer.address().port}/v1`;
  return smokeModelURL;
}

async function bootServer() {
  if (localURL) return localURL;
  process.env.AI_TIP_EMBEDDED = "1";
  process.env.AI_TIP_DESKTOP = "1";
  if (process.argv.includes("--smoke-test")) process.env.AI_TIP_SUPABASE_ENABLED = "0";
  if (process.argv.includes("--smoke-test")) smokeDataDir ||= mkdtempSync(path.join(tmpdir(), "ai-tip-desktop-smoke-"));
  process.env.AI_TIP_DATA_DIR = smokeDataDir || path.join(app.getPath("userData"), "data");
  managedLocalRuntime ||= new BundledLlamaRuntime({ configPath: path.join(app.getPath("userData"), "bundled-local-runtime.json"), helperPath: bundledLlamaServerPath() });
  managedOllamaRuntime ||= new ManagedOllamaRuntime({ configPath: path.join(app.getPath("userData"), "ollama-runtime.json"), isMas: Boolean(process.mas) });
  if (!process.argv.includes("--smoke-test") && !managedLocalRestoreAttempted) {
    managedLocalRestoreAttempted = true;
    try { await managedLocalRuntime.restore(); } catch (error) { console.warn("Saved GGUF model could not be restored:", error instanceof Error ? error.message : String(error)); }
  }
  process.env.AI_TIP_DIST_DIR = path.join(appRoot, "dist");
  process.env.AI_TIP_APP_ROOT = appRoot;
  const serverModule = await import(new URL("../dist-electron/server.cjs", import.meta.url));
  const startServer = serverModule.startServer || serverModule.default?.startServer;
  const configureSecretProtection = serverModule.configureSecretProtection || serverModule.default?.configureSecretProtection;
  const configureLocalModelRuntime = serverModule.configureLocalModelRuntime || serverModule.default?.configureLocalModelRuntime;
  const configureExternalNetworkFetch = serverModule.configureExternalNetworkFetch || serverModule.default?.configureExternalNetworkFetch;
  pythonCalculation = serverModule.runPythonCalculation || serverModule.default?.runPythonCalculation;
  pythonWorkerTest = serverModule.runPythonWorker || serverModule.default?.runPythonWorker;
  liveReferenceSearch = serverModule.searchReferenceWeb || serverModule.default?.searchReferenceWeb;
  if (!startServer) throw new Error("本地服务模块加载失败");
  if (configureExternalNetworkFetch) configureExternalNetworkFetch(chromiumNetFetch, { trustedSystemProxy: true });
  if (configureLocalModelRuntime) configureLocalModelRuntime({
    info: () => managedLocalRuntime.info(),
    downloadArtifact: async (request, signal, onProgress) => {
      const proxyDescription = await chromiumProxyDescription(request.url);
      session.defaultSession.preconnect({ url: request.url, numSockets: 1 });
      return downloadOfficialModelArtifact({
        ...request,
        signal,
        onProgress,
        proxyDescription,
        fetchRuntime: chromiumNetFetch
      });
    },
    activateModel: (modelPath, modelId) => managedLocalRuntime.activateModel(modelPath, modelId)
    ,ollamaInfo: () => managedOllamaRuntime.info()
    ,pullOllamaModel: (modelRef, signal, onProgress) => managedOllamaRuntime.pull(modelRef, { signal, onProgress })
  });
  if (configureSecretProtection && safeStorage.isEncryptionAvailable()) {
    configureSecretProtection(
      (value) => safeStorage.encryptString(value).toString("base64"),
      (value) => safeStorage.decryptString(Buffer.from(value, "base64"))
    );
  }
  localServer = await startServer(process.argv.includes("--dev") ? 8787 : 0, "127.0.0.1");
  const address = localServer.address();
  if (!address || typeof address === "string") throw new Error("无法启动本地服务");
  localURL = `http://127.0.0.1:${address.port}`;
  return localURL;
}

function installDesktopIpc() {
  ipcMain.removeHandler("ai-tip:copy-text");
  ipcMain.handle("ai-tip:copy-text", async (_event, payload = {}) => {
    const value = String(payload?.value || "").slice(0, 10_000);
    if (!value) throw new Error("复制内容为空");
    clipboard.writeText(value);
    return { copied: clipboard.readText() === value };
  });
  ipcMain.removeHandler("ai-tip:choose-model-directory");
  ipcMain.removeHandler("ai-tip:prepare-model-directory");
  ipcMain.removeHandler("ai-tip:choose-local-model-file");
  ipcMain.removeHandler("ai-tip:load-remembered-login");
  ipcMain.removeHandler("ai-tip:save-remembered-login");
  ipcMain.removeHandler("ai-tip:clear-remembered-login");
  ipcMain.removeHandler("ai-tip:get-ollama-status");
  ipcMain.removeHandler("ai-tip:choose-ollama-installer-destination");
  ipcMain.removeHandler("ai-tip:download-ollama-installer");
  ipcMain.removeHandler("ai-tip:cancel-ollama-installer");
  rememberedLoginStore ||= createRememberedLoginStore({
    filePath: path.join(app.getPath("userData"), "remembered-login.json"),
    codec: {
      available: () => safeStorage.isEncryptionAvailable(),
      protect: (value) => safeStorage.encryptString(value).toString("base64"),
      unprotect: (value) => safeStorage.decryptString(Buffer.from(value, "base64"))
    }
  });
  ipcMain.handle("ai-tip:load-remembered-login", async () => ({ available: rememberedLoginStore.available(), credentials: await rememberedLoginStore.load() }));
  ipcMain.handle("ai-tip:save-remembered-login", async (_event, payload = {}) => rememberedLoginStore.save({ email: payload.email, password: payload.password }));
  ipcMain.handle("ai-tip:clear-remembered-login", async () => rememberedLoginStore.clear());
  ipcMain.handle("ai-tip:get-ollama-status", async () => {
    if (process.argv.includes("--smoke-test")) return { installed: false, executable: "", platform: process.platform, supported: true, mas: false, installer: { version: "v-smoke", assetName: process.platform === "darwin" ? "Ollama.dmg" : "OllamaSetup.exe", size: 123_456_789, sha256: "a".repeat(64), startUrl: process.platform === "darwin" ? "https://ollama.com/download/Ollama.dmg" : "https://ollama.com/download/OllamaSetup.exe" } };
    const installed = Boolean(findOllamaExecutable());
    const supported = process.platform === "win32" || process.platform === "darwin";
    const result = { installed, executable: findOllamaExecutable(), platform: process.platform, supported, mas: Boolean(process.mas), installer: null };
    if (!installed && supported && !process.mas) {
      const info = await fetchLatestOllamaInstallerInfo(process.platform, chromiumNetFetch);
      result.installer = { version: info.version, assetName: info.assetName, size: info.size, sha256: info.sha256, startUrl: info.startUrl };
    }
    return result;
  });
  ipcMain.handle("ai-tip:choose-ollama-installer-destination", async () => {
    if (process.mas) return { error: "Mac App Store 版本不能下载或启动外部 Ollama 安装器。", code: "OLLAMA_INSTALLER_MAS_BLOCKED" };
    const assetName = ollamaInstallerAssetName(process.platform);
    const result = await dialog.showSaveDialog(mainWindow, { title: "保存 Ollama 官方安装器", defaultPath: path.join(app.getPath("downloads"), assetName), buttonLabel: "选择保存位置", filters: [{ name: "Ollama installer", extensions: [path.extname(assetName).slice(1)] }] });
    if (result.canceled || !result.filePath) return { canceled: true };
    const resolved = path.resolve(result.filePath);
    if (path.basename(resolved) !== assetName) return { error: `文件名必须为 ${assetName}`, code: "OLLAMA_INSTALLER_PATH_INVALID" };
    const selectionToken = randomUUID();
    ollamaInstallerSelections.set(selectionToken, { path: resolved, expiresAt: Date.now() + 10 * 60_000 });
    return { canceled: false, path: resolved, selectionToken };
  });
  ipcMain.handle("ai-tip:download-ollama-installer", async (_event, payload = {}) => {
    if (process.mas) return { error: "Mac App Store 版本不能下载或启动外部 Ollama 安装器。", code: "OLLAMA_INSTALLER_MAS_BLOCKED" };
    const requestId = String(payload.requestId || "");
    const selectionToken = String(payload.selectionToken || "");
    const selection = ollamaInstallerSelections.get(selectionToken);
    ollamaInstallerSelections.delete(selectionToken);
    if (!requestId || !selection || selection.expiresAt < Date.now()) return { error: "安装器保存位置授权已过期，请重新选择。", code: "OLLAMA_INSTALLER_TOKEN_INVALID" };
    if (ollamaInstallerDownloads.size) return { error: "已有 Ollama 安装器正在下载。", code: "OLLAMA_INSTALLER_BUSY" };
    const controller = new AbortController();
    ollamaInstallerDownloads.set(requestId, controller);
    try {
      const info = await fetchLatestOllamaInstallerInfo(process.platform, chromiumNetFetch);
      const proxyDescription = await chromiumProxyDescription(ollamaInstallerStartUrl(process.platform));
      session.defaultSession.preconnect({ url: info.startUrl, numSockets: 1 });
      const result = await downloadOfficialOllamaInstaller({ info, destinationPath: selection.path, fetchRuntime: chromiumNetFetch, signal: controller.signal, proxyDescription, onProgress: (event) => mainWindow?.webContents.send("ai-tip:ollama-installer-progress", { requestId, ...event }) });
      const confirmation = await dialog.showMessageBox(mainWindow, { type: "question", buttons: ["打开官方安装器", "稍后安装"], defaultId: 0, cancelId: 1, title: "Ollama 官方安装器已校验", message: "下载与 SHA-256 校验已完成。是否现在打开安装器？", detail: `${info.version}\n${result.finalPath}\n下载来源：${result.redirectChain.join(" → ")}` });
      let opened = false;
      if (confirmation.response === 0) {
        const openError = await shell.openPath(result.finalPath);
        if (openError) throw new Error(`无法打开 Ollama 安装器：${openError}`);
        opened = true;
      }
      return { ok: true, opened, finalPath: result.finalPath, version: info.version, size: info.size, sha256: info.sha256, download: result };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error), code: controller.signal.aborted ? "OLLAMA_INSTALLER_CANCELLED" : "OLLAMA_INSTALLER_DOWNLOAD_FAILED" };
    } finally { ollamaInstallerDownloads.delete(requestId); }
  });
  ipcMain.handle("ai-tip:cancel-ollama-installer", async (_event, payload = {}) => {
    const controller = ollamaInstallerDownloads.get(String(payload.requestId || ""));
    if (controller) controller.abort();
    return { canceled: Boolean(controller) };
  });
  ipcMain.handle("ai-tip:choose-model-directory", async (_event, payload = {}) => {
    for (const [token, selection] of modelDirectorySelections) if (selection.expiresAt < Date.now()) modelDirectorySelections.delete(token);
    let selectedPath = "";
    if (process.argv.includes("--smoke-test")) {
      selectedPath = path.join(smokeDataDir || tmpdir(), "ai-tip-desktop-smoke-models");
    } else {
      const suggested = String(payload.suggestedPath || "").trim();
      const result = await dialog.showOpenDialog(mainWindow, {
        title: "选择本地模型存储文件夹",
        defaultPath: suggested && path.isAbsolute(suggested) ? suggested : undefined,
        properties: ["openDirectory", "createDirectory", "promptToCreate"],
        securityScopedBookmarks: Boolean(process.mas)
      });
      if (result.canceled || !result.filePaths[0]) return { canceled: true };
      selectedPath = path.resolve(result.filePaths[0]);
      var securityScopedBookmark = result.bookmarks?.[0] || "";
    }
    const runtimeKind = payload.runtimeKind === "ollama" ? "ollama" : "llama.cpp";
    const selectionToken = randomUUID();
    modelDirectorySelections.set(selectionToken, { path: selectedPath, runtimeKind, securityScopedBookmark: typeof securityScopedBookmark === "string" ? securityScopedBookmark : "", expiresAt: Date.now() + 5 * 60_000 });
    return { canceled: false, path: selectedPath, selectionToken };
  });
  ipcMain.handle("ai-tip:prepare-model-directory", async (_event, payload = {}) => {
    const selectionToken = String(payload.selectionToken || "");
    const selection = modelDirectorySelections.get(selectionToken);
    modelDirectorySelections.delete(selectionToken);
    if (!selection || selection.expiresAt < Date.now()) return { error: "模型目录选择已过期，请重新选择文件夹。", code: "MODEL_DIRECTORY_TOKEN_INVALID" };
    if (process.mas && selection.securityScopedBookmark) modelSecurityScopeStops.push(app.startAccessingSecurityScopedResource(selection.securityScopedBookmark));
    if (process.argv.includes("--smoke-test")) {
      return { directory: selection.path, freeBytes: 100 * 1024 ** 3, runtime: selection.runtimeKind, managed: true };
    }
    if (!managedLocalRuntime) return { error: "本地模型运行时尚未初始化", code: "MODEL_RUNTIME_NOT_READY" };
    if (modelDirectoryPreparation) return { error: "另一个模型目录正在准备中，请稍后重试。", code: "MODEL_DIRECTORY_BUSY" };
    modelDirectoryPreparation = selection.runtimeKind === "ollama" ? Promise.resolve(managedOllamaRuntime.activate(selection.path)) : Promise.resolve(managedLocalRuntime.prepareDirectory(selection.path));
    try { return await modelDirectoryPreparation; }
    catch (error) { return { error: error instanceof Error ? error.message : String(error), code: "MODEL_RUNTIME_PREPARE_FAILED" }; }
    finally { modelDirectoryPreparation = null; }
  });
  ipcMain.handle("ai-tip:choose-local-model-file", async (_event, payload = {}) => {
    if (!managedLocalRuntime) return { error: "本地模型运行时尚未初始化", code: "MODEL_RUNTIME_NOT_READY" };
    const modelId = String(payload.modelId || "aitip:imported-gguf").trim();
    const result = await dialog.showOpenDialog(mainWindow, { title: "选择本地 GGUF 模型", properties: ["openFile"], filters: [{ name: "GGUF 模型", extensions: ["gguf"] }], securityScopedBookmarks: Boolean(process.mas) });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    if (process.mas && result.bookmarks?.[0]) modelSecurityScopeStops.push(app.startAccessingSecurityScopedResource(result.bookmarks[0]));
    try { return { canceled: false, runtime: await managedLocalRuntime.activateModel(path.resolve(result.filePaths[0]), modelId) }; }
    catch (error) { return { error: error instanceof Error ? error.message : String(error), code: "LOCAL_MODEL_IMPORT_FAILED" }; }
  });
}

function installMenu() {
  const template = [
    ...(process.platform === "darwin" ? [{ label: app.name, submenu: [{ role: "about" }, { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" }, { role: "quit" }] }] : []),
    { label: "编辑", submenu: [{ role: "undo", label: "撤销" }, { role: "redo", label: "重做" }, { type: "separator" }, { role: "cut", label: "剪切" }, { role: "copy", label: "复制" }, { role: "paste", label: "粘贴" }, { role: "selectAll", label: "全选" }] },
    { label: "视图", submenu: [{ role: "reload", label: "重新载入" }, { role: "togglefullscreen", label: "切换全屏" }] },
    { label: "窗口", submenu: [{ role: "minimize", label: "最小化" }, { role: "close", label: "关闭" }] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow() {
  const smokeTest = process.argv.includes("--smoke-test");
  if (smokeTest) await bootSmokeModelServer();
  const serverURL = await bootServer();
  mainWindow = new BrowserWindow({
    width: 1440,
    height: smokeTest ? 800 : 920,
    minWidth: 980,
    minHeight: 680,
    show: false,
    backgroundColor: "#f5f6f1",
    title: "AI Tip",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(appRoot, "electron", "preload.cjs")
    }
  });

  mainWindow.once("ready-to-show", () => { if (!smokeTest) mainWindow?.show(); });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowedOrigin = process.argv.includes("--dev") ? "http://127.0.0.1:5173" : serverURL;
    if (!url.startsWith(allowedOrigin)) event.preventDefault();
  });
  await mainWindow.loadURL(process.argv.includes("--dev") ? "http://127.0.0.1:5173" : serverURL);
  if (smokeTest) {
    const snapshot = await mainWindow.webContents.executeJavaScript("({ title: document.title, url: location.href, text: document.body.innerText.slice(0, 300) })");
    if (snapshot.title === "Error" || !snapshot.text.includes("AI Tip")) throw new Error(`桌面页面加载异常：${JSON.stringify(snapshot)}`);
    const externalPdfFixturePath = process.env.AI_TIP_PDF_FIXTURE_PATH ? path.resolve(process.env.AI_TIP_PDF_FIXTURE_PATH) : "";
    const pdfFixturePath = externalPdfFixturePath || path.join(appRoot, "scripts", "fixtures", "semantic-pdf.pdf.base64");
    const pdfFixtureBase64 = existsSync(pdfFixturePath) ? readFileSync(pdfFixturePath, "utf8").replace(/\s+/g, "") : "";
    const ocrPdfFixturePath = path.join(appRoot, "scripts", "fixtures", "scanned-pdf.pdf.base64");
    const ocrPdfFixtureBase64 = existsSync(ocrPdfFixturePath) ? readFileSync(ocrPdfFixturePath, "utf8").replace(/\s+/g, "") : "";
    const docxFixturePath = path.join(appRoot, "node_modules", "mammoth", "test", "test-data", "tables.docx");
    const packagedDocxFixturePath = path.join(appRoot, "scripts", "fixtures", "word-table.docx.base64");
    const docxFixtureBase64 = existsSync(docxFixturePath)
      ? readFileSync(docxFixturePath).toString("base64")
      : existsSync(packagedDocxFixturePath) ? readFileSync(packagedDocxFixturePath, "utf8").replace(/\s+/g, "") : "";
    if (!pdfFixtureBase64 || !ocrPdfFixtureBase64 || !docxFixtureBase64) throw new Error("桌面验收所需的 PDF/DOCX 测试文件缺失");
    let productBehavior;
    const clipboardBeforeSmoke = clipboard.readText();
    const smokeProgressTimer = setInterval(() => {
      void mainWindow?.webContents.executeJavaScript("window.__desktopSmokeStep || 'initializing'")
        .then(step => console.log(`[desktop-smoke] ${step}`))
        .catch(() => undefined);
    }, 30000);
    try { productBehavior = await Promise.race([
      mainWindow.webContents.executeJavaScript(`window.__desktopSmokeStep = 'script started'; (async () => {
      const pdfFixtureBase64 = ${JSON.stringify(pdfFixtureBase64)};
      const ocrPdfFixtureBase64 = ${JSON.stringify(ocrPdfFixtureBase64)};
      const docxFixtureBase64 = ${JSON.stringify(docxFixtureBase64)};
      const smokeModelURL = ${JSON.stringify(smokeModelURL)};
      const capturePdfCanvas = ${JSON.stringify(Boolean(process.env.AI_TIP_PDF_SCREENSHOT_PATH))};
      const waitFor = async (selector, timeout = 5000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          const element = document.querySelector(selector);
          if (element) return element;
          await new Promise(resolve => setTimeout(resolve, 40));
        }
        throw new Error('等待界面元素超时：' + selector);
      };
      const waitUntil = async (test, label, timeout = 10000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          const value = test();
          if (value) return value;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        throw new Error('等待状态超时：' + label);
      };
      const change = (select, value) => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); };
      const setTextArea = (element, value) => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); };
      const setInput = (element, value) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); };
      const placeCaret = (element, offset) => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT); let cursor = 0; let node = null; let local = 0;
        while (walker.nextNode()) { const next = cursor + walker.currentNode.data.length; if (offset <= next) { node = walker.currentNode; local = offset - cursor; break; } cursor = next; }
        if (!node) { node = element; local = element.childNodes.length; }
        const range = document.createRange(); range.setStart(node, Math.max(0, local)); range.collapse(true);
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); element.focus();
      };
      const caretOffset = (element) => {
        const selection = window.getSelection(); if (!selection?.rangeCount || !selection.anchorNode || !element.contains(selection.anchorNode)) return -1;
        const range = document.createRange(); range.selectNodeContents(element); range.setEnd(selection.anchorNode, selection.anchorOffset); return range.toString().length;
      };
      const selectText = (element, start = 0, length = 4) => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let cursor = 0; let startNode = null; let endNode = null; let startOffset = 0; let endOffset = 0;
        while (walker.nextNode()) {
          const node = walker.currentNode; const next = cursor + node.data.length;
          if (!startNode && start >= cursor && start <= next) { startNode = node; startOffset = start - cursor; }
          if (start + length >= cursor && start + length <= next) { endNode = node; endOffset = start + length - cursor; break; }
          cursor = next;
        }
        if (!startNode || !endNode) throw new Error('无法建立测试选区');
        const range = document.createRange(); range.setStart(startNode, startOffset); range.setEnd(endNode, endOffset);
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
        element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      };
      window.__desktopSmokeStep = 'auth language';
      const authLanguage = await waitFor('.auth-language select');
      change(authLanguage, 'zh-CN');
      await new Promise(resolve => setTimeout(resolve, 80));
      if (document.querySelector('.auth-language span')?.textContent !== 'language') throw new Error('中文登录页语言标签没有显示为小写 language');
      if (!document.querySelector('.demo-button')?.textContent?.includes('仅本地使用')) throw new Error('中文本地入口未接入语言状态');
      if (document.body.innerText.includes('直接进入演示')) throw new Error('旧展示入口文案仍然可见');
      change(authLanguage, 'en');
      await new Promise(resolve => setTimeout(resolve, 80));
      if (!document.querySelector('.demo-button')?.textContent?.includes('Local use only')) throw new Error('英文语言切换未改变正式登录界面');
      if (localStorage.getItem('ai-tip-language') !== 'en') throw new Error('登录页语言选择没有持久化');
      window.__desktopSmokeStep = 'local login';
      document.querySelector('.demo-button').click();
      await waitFor('.app-nav');
      const token = localStorage.getItem('ai-tip-token');
      const documents = await fetch('/api/documents', { headers: { Authorization: 'Bearer ' + token } }).then(response => response.json());
      if (!Array.isArray(documents.documents) || documents.documents.length !== 0) throw new Error('本地账户仍含 Transformer 样例文档');
      if (!document.querySelector('.logout-button')?.textContent?.includes('Sign out')) throw new Error('退出登录按钮未显示英文标签');
      window.__desktopSmokeStep = 'contact copy';
      const contactButton = await waitFor('[data-contact-copy]');
      contactButton.click();
      await waitUntil(() => document.querySelector('[data-contact-copy-status]')?.textContent?.includes('Copied'), 'contact copied feedback');
      window.__desktopSmokeStep = 'settings';
      document.querySelector('[data-open-settings]').click();
      const settingsLanguage = await waitFor('.settings-body > .language-select select');
      if (settingsLanguage.value !== 'en') throw new Error('设置与登录页没有共享语言状态');
      const defaultPromptArea = document.querySelector('.settings-body > label textarea[rows="8"]');
      if (!defaultPromptArea?.value?.startsWith('You are') || /[\u3400-\u9fff]/u.test(defaultPromptArea.value)) throw new Error('英文设置仍显示中文内置 Prompt');
      const providerLabels = [...document.querySelectorAll('.settings-grid select option')].map(option => option.textContent || '');
      if (providerLabels.length !== 9 || providerLabels.some(label => /[\u3400-\u9fff]/u.test(label))) throw new Error('英文接口服务商列表仍含中文或条目缺失：' + providerLabels.join(','));
      if (document.querySelector('.feedback-box') || /修改建议箱|Suggestion box/.test(document.body.innerText)) throw new Error('已移除的建议功能仍出现在设置界面');
      const defaultWebToggle = document.querySelector('.skill-setting-row .toggle');
      if (!defaultWebToggle || defaultWebToggle.getAttribute('aria-pressed') !== 'false') throw new Error('联网搜索总开关没有在桌面设置中默认关闭');
      change(settingsLanguage, 'zh-CN');
      await new Promise(resolve => setTimeout(resolve, 80));
      if (!document.querySelector('.logout-button')?.textContent?.includes('退出登录')) throw new Error('设置中的语言切换未传播到导航');
      if (localStorage.getItem('ai-tip-language') !== 'zh-CN') throw new Error('设置页语言选择没有持久化');
      const localModelsButton = [...document.querySelectorAll('.model-refresh-row button')].find(button => button.textContent.includes('下载本地模型'));
      if (!localModelsButton) throw new Error('设置没有本地模型选择入口');
      window.__desktopSmokeStep = 'local model catalog';
      localModelsButton.click();
      await waitFor('[data-local-models-screen]');
      await waitUntil(() => document.querySelectorAll('[data-local-model-id]').length === 11, '11 项本地模型目录');
      if (document.body.innerText.includes('我的评价') || !document.body.innerText.includes('ModelScope 官方仓库（国内）') || !document.body.innerText.includes('导入本地 GGUF') || !document.querySelector('[data-local-model-id="llama-3.2-1b"]')?.textContent?.includes('808 MB') || !document.querySelector('[data-local-model-id="gemma-4-e2b"]')?.textContent?.includes('7.2 GB')) throw new Error('本地模型页面的字段、官方双源或核对大小错误');
      if (!document.body.innerText.includes('内置 llama.cpp 可用，无需 Ollama')) throw new Error('没有明确显示内置运行时不依赖 Ollama');
      document.querySelector('[data-local-model-id="minicpm5-1b"] .source-download').click();
      const modelDownloadDialog = await waitFor('[data-local-download-dialog]');
      if (!modelDownloadDialog.querySelector('[data-model-directory]') || !modelDownloadDialog.querySelector('[data-choose-model-directory]') || !modelDownloadDialog.textContent.includes('下载速度') || !modelDownloadDialog.textContent.includes('预计剩余')) throw new Error('本地模型下载没有使用包含目录、速度和 ETA 的桌面下载对话框');
      modelDownloadDialog.querySelector('[data-choose-model-directory]').click();
      await waitUntil(() => modelDownloadDialog.querySelector('[data-model-directory]').value.includes('ai-tip-desktop-smoke-models'), 'native model directory selection');
      modelDownloadDialog.querySelector('[data-local-download-close]').click();
      await waitUntil(() => !document.querySelector('[data-local-download-dialog]'), 'close model download dialog');
      window.__desktopSmokeStep = 'missing Ollama installer dialog';
      document.querySelector('[data-local-model-id="llama-3.2-1b"] [data-model-source="ollama"]').click();
      const ollamaInstallerDialog = await waitFor('[data-ollama-installer-dialog]');
      if (!ollamaInstallerDialog.textContent.includes('下载 Ollama CLI') || !ollamaInstallerDialog.textContent.includes('ollama.com → GitHub Releases') || !ollamaInstallerDialog.textContent.includes('下载速度') || !ollamaInstallerDialog.textContent.includes('SHA-256')) throw new Error('Ollama CLI 缺失时没有显示官方安装器下载窗口、来源与进度字段');
      ollamaInstallerDialog.querySelector('.icon-button').click();
      await waitUntil(() => !document.querySelector('[data-ollama-installer-dialog]'), 'close Ollama installer dialog');
      const directDirectorySelection = await window.aiTipDesktop.chooseModelDirectory('');
      const preparedDirectory = await window.aiTipDesktop.prepareModelDirectory(directDirectorySelection.selectionToken);
      let reusedDirectoryTokenRejected = false; let fabricatedDirectoryTokenRejected = false;
      try { await window.aiTipDesktop.prepareModelDirectory(directDirectorySelection.selectionToken); } catch { reusedDirectoryTokenRejected = true; }
      try { await window.aiTipDesktop.prepareModelDirectory('fabricated-token'); } catch { fabricatedDirectoryTokenRejected = true; }
      if (!preparedDirectory.directory.includes('ai-tip-desktop-smoke-models') || !reusedDirectoryTokenRejected || !fabricatedDirectoryTokenRejected) throw new Error('原生目录令牌没有一次性消费或伪造令牌未被拒绝');
      window.__desktopSmokeStep = 'return from local model catalog';
      document.querySelector('.local-models-header .secondary').click();
      await waitFor('.app-nav');
      window.__desktopSmokeStep = 'create no-model document';
      document.querySelector('.new-button').click();
      const noModelEditor = await waitFor('[data-editor-document]');
      const noModelDocumentId = noModelEditor.getAttribute('data-editor-document');
      let noModelBlock = await waitFor('[contenteditable][data-block-id]');
      window.__desktopSmokeStep = 'contenteditable linebreak caret';
      noModelBlock.innerText = '第一行第二行';
      noModelBlock.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: noModelBlock.innerText }));
      await new Promise(resolve => setTimeout(resolve, 80));
      placeCaret(noModelBlock, '第一行'.length);
      if (!document.execCommand('insertLineBreak')) throw new Error('测试环境不支持原生 contentEditable 换行');
      await new Promise(resolve => setTimeout(resolve, 80));
      if (!document.execCommand('insertText', false, '续')) throw new Error('测试环境不支持原生 contentEditable 继续输入');
      await new Promise(resolve => setTimeout(resolve, 80));
      const linebreakText = noModelBlock.innerText.replace(/\\r/g, '');
      const linebreakCaret = caretOffset(noModelBlock);
      if (linebreakText !== '第一行\\n续第二行' || linebreakCaret !== '第一行\\n续'.length) throw new Error('换行后输入位置跳转：' + JSON.stringify({ linebreakText, linebreakCaret }));
      await new Promise(resolve => setTimeout(resolve, 1050));
      const persistedLinebreakDocument = await fetch('/api/documents/' + noModelDocumentId, { headers: { Authorization: 'Bearer ' + token } }).then(response => response.json());
      if (persistedLinebreakDocument.document.blocks[0]?.content.replace(/\\r/g, '') !== '第一行\\n续第二行') throw new Error('换行与继续输入没有进入自动保存主链');
      document.querySelector('.back-button').click();
      await waitFor('.app-nav');
      const linebreakDocumentCard = await waitUntil(() => [...document.querySelectorAll('.document-card')].find(card => card.querySelector('h3')?.textContent === '无标题文档'), 'linebreak document card');
      linebreakDocumentCard.click();
      await waitUntil(() => document.querySelector('[data-editor-document]')?.getAttribute('data-editor-document') === noModelDocumentId, 'reopen linebreak document');
      noModelBlock = await waitFor('[contenteditable][data-block-id]');
      if (noModelBlock.innerText.replace(/\\r/g, '') !== '第一行\\n续第二行') throw new Error('重新打开后块内换行或输入位置结果丢失');
      noModelBlock.innerText = '未配置模型时仍可创建文档和 Tip。';
      noModelBlock.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: noModelBlock.innerText }));
      await new Promise(resolve => setTimeout(resolve, 1000));
      selectText(noModelBlock, 0, 6);
      window.__desktopSmokeStep = 'create no-model Tip';
      (await waitFor('.selection-toolbar button')).click();
      const noModelPanel = await waitFor('[data-tip-panel]');
      const noModelTipId = noModelPanel.getAttribute('data-tip-panel');
      const requiredNotice = await waitFor('[data-model-required="no-api-key"]');
      if (!requiredNotice.textContent.includes('未导入大模型 API') || !requiredNotice.textContent.includes('下载本地模型') || !noModelPanel.querySelector('.tip-composer textarea').disabled || !noModelPanel.querySelector('.send-button').disabled) throw new Error('Tip 右侧聊天框没有显示无 API 提示并禁用发送');
      window.__desktopSmokeStep = 'no-model server bypass';
      const blockedBefore = await fetch('/api/documents/' + noModelDocumentId, { headers: { Authorization: 'Bearer ' + token } }).then(response => response.json());
      const blockedChat = await fetch('/api/tips/' + noModelTipId + '/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ question: '不能生成演示回答', language: 'zh-CN' }) });
      const blockedBody = await blockedChat.json();
      const blockedAfter = await fetch('/api/documents/' + noModelDocumentId, { headers: { Authorization: 'Bearer ' + token } }).then(response => response.json());
      if (blockedChat.status !== 409 || blockedBody.code !== 'MODEL_NOT_CONFIGURED' || blockedBefore.tips.find(tip => tip.id === noModelTipId).messages.length !== blockedAfter.tips.find(tip => tip.id === noModelTipId).messages.length) throw new Error('直接绕过 Tip UI 时服务端没有在写入消息前阻断');
      const cleanupNoModelDocument = await fetch('/api/documents/' + noModelDocumentId + '?permanent=true', { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });
      if (!cleanupNoModelDocument.ok) throw new Error('无模型 UI 烟测临时文档清理失败');
      document.querySelector('.back-button').click();
      await waitFor('.app-nav');
      const smokeSettings = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ provider: 'custom', baseURL: smokeModelURL, model: 'desktop-smoke-model', apiKey: 'desktop-smoke-runtime-key', systemPrompt: '你是桌面烟测阅读助手。', webSearchEnabled: false, pythonEnabled: true, reliabilityEnabled: true }) });
      if (!smokeSettings.ok) throw new Error('桌面烟测模型没有通过正式设置入口接入');
      window.__desktopSmokeStep = 'empty import';
      const emptyImport = await waitFor('[data-empty-import]');
      if (!emptyImport.textContent.includes('导入文档') || emptyImport.querySelector('.lucide-plus')) throw new Error('空文档库主操作仍是新建空白文档');
      const acceptedExtensions = (document.querySelector('[data-global-document-input]')?.getAttribute('accept') || '').split(',').map(value => value.trim()).filter(Boolean);
      if (JSON.stringify(acceptedExtensions) !== JSON.stringify(['.txt', '.md', '.markdown', '.docx', '.pdf'])) throw new Error('全局导入类型与服务端支持集不一致：' + JSON.stringify(acceptedExtensions));
      document.querySelector('.header-actions .primary').click();
      const dropSourceEditor = await waitFor('[data-editor-document]');
      const dropSourceId = dropSourceEditor.getAttribute('data-editor-document');
      setInput(document.querySelector('.document-title'), '拖放前必须保存的标题');
      const dropSourceBlock = await waitFor('[contenteditable][data-block-id]');
      dropSourceBlock.innerText = '这段最新修改必须在上传新文档前持久化。';
      dropSourceBlock.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: dropSourceBlock.innerText }));
      document.querySelector('.editor-controls .icon-button:last-child').click();
      const dropTarget = await waitFor('.settings-modal');
      const dispatchFileDrop = (target, files) => {
        const transfer = new DataTransfer(); files.forEach(file => transfer.items.add(file));
        target.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: transfer }));
        target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
        return !target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
      };
      const documentsBeforeDrop = await fetch('/api/documents', { headers: { Authorization: 'Bearer ' + token } }).then(response => response.json());
      window.__desktopSmokeStep = 'unsupported drop';
      const unsupportedPrevented = dispatchFileDrop(dropTarget, [new File(['not a document'], 'unsafe.exe', { type: 'application/octet-stream' })]);
      await waitFor('[data-import-error]');
      const documentsAfterUnsupportedDrop = await fetch('/api/documents', { headers: { Authorization: 'Bearer ' + token } }).then(response => response.json());
      if (!unsupportedPrevented || documentsAfterUnsupportedDrop.documents.length !== documentsBeforeDrop.documents.length || document.querySelector('[data-editor-document]')?.getAttribute('data-editor-document') !== dropSourceId) throw new Error('不支持文件拖放没有阻止默认导航或错误触发了上传');
      const originalFetch = window.fetch.bind(window); const importTrace = []; let failNextSourceSave = true;
      window.fetch = async (input, init = {}) => {
        const url = String(input instanceof Request ? input.url : input); const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
        if (url.includes('/api/documents/' + dropSourceId) && method === 'PATCH') {
          importTrace.push('PATCH:start');
          if (failNextSourceSave) { failNextSourceSave = false; importTrace.push('PATCH:failed'); throw new Error('injected save failure'); }
          const response = await originalFetch(input, init); importTrace.push('PATCH:done'); return response;
        }
        if (url.includes('/api/documents/import') && method === 'POST') importTrace.push('IMPORT:start');
        return originalFetch(input, init);
      };
      const droppedMarkdown = new File(['# Drag import\\n\\nImported from the settings overlay.'], 'drag-import.md', { type: 'text/markdown' });
      window.__desktopSmokeStep = 'failed-save drop';
      dispatchFileDrop(dropTarget, [droppedMarkdown]);
      await waitUntil(() => document.querySelector('[data-import-error]')?.textContent?.length > 0, 'save failure blocks drag import');
      await new Promise(resolve => setTimeout(resolve, 100));
      const afterFailedSave = await originalFetch('/api/documents', { headers: { Authorization: 'Bearer ' + token } }).then(response => response.json());
      if (afterFailedSave.documents.length !== documentsBeforeDrop.documents.length || importTrace.includes('IMPORT:start') || document.querySelector('[data-editor-document]')?.getAttribute('data-editor-document') !== dropSourceId) throw new Error('保存失败后仍上传或替换了原文档');
      window.__desktopSmokeStep = 'successful drop';
      dispatchFileDrop(dropTarget, [droppedMarkdown]);
      const importedEditor = await waitUntil(() => { const editor = document.querySelector('[data-editor-document]'); return editor?.getAttribute('data-editor-document') !== dropSourceId ? editor : null; }, 'drag import opens returned document');
      window.fetch = originalFetch;
      const importedId = importedEditor.getAttribute('data-editor-document');
      const savedSource = await originalFetch('/api/documents/' + dropSourceId, { headers: { Authorization: 'Bearer ' + token } }).then(response => response.json());
      const importedDropDocument = await originalFetch('/api/documents/' + importedId, { headers: { Authorization: 'Bearer ' + token } }).then(response => response.json());
      if (savedSource.document.title !== '拖放前必须保存的标题' || savedSource.document.blocks[0]?.content !== '这段最新修改必须在上传新文档前持久化。' || importedDropDocument.document.sourceType !== 'markdown' || !importedDropDocument.document.blocks.some(block => block.content.includes('Imported from the settings overlay.'))) throw new Error('拖放导入没有保证原文档保存或新文档解析');
      if (importTrace.indexOf('PATCH:done') < 0 || importTrace.indexOf('IMPORT:start') < importTrace.indexOf('PATCH:done') || document.querySelector('.settings-modal')) throw new Error('拖放事务顺序不是保存完成后再上传，或成功后未显示新文档');
      window.__desktopSmokeStep = 'back save gate';
      const importedEditable = await waitFor('[contenteditable][data-block-id]');
      importedEditable.innerText = '返回文档库前必须保存的最后修改。';
      importedEditable.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: importedEditable.innerText }));
      let failBackSave = true;
      window.fetch = async (input, init = {}) => {
        const url = String(input instanceof Request ? input.url : input); const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
        if (failBackSave && url.includes('/api/documents/' + importedId) && method === 'PATCH') { failBackSave = false; throw new Error('injected back-save failure'); }
        return originalFetch(input, init);
      };
      document.querySelector('.back-button').click();
      await new Promise(resolve => setTimeout(resolve, 140));
      if (document.querySelector('[data-editor-document]')?.getAttribute('data-editor-document') !== importedId || !document.querySelector('.save-state.error')) throw new Error('返回文档库绕过了保存失败门禁');
      window.fetch = originalFetch;
      document.querySelector('.back-button').click();
      await waitFor('.app-nav');
      const savedBeforeBack = await originalFetch('/api/documents/' + importedId, { headers: { Authorization: 'Bearer ' + token } }).then(response => response.json());
      if (savedBeforeBack.document.blocks[0]?.content !== '返回文档库前必须保存的最后修改。') throw new Error('返回文档库前没有持久化最后编辑');

      window.__desktopSmokeStep = 'word table direct edit';
      const docxBinary = atob(docxFixtureBase64); const docxBytes = new Uint8Array(docxBinary.length);
      for (let index = 0; index < docxBinary.length; index++) docxBytes[index] = docxBinary.charCodeAt(index);
      const docxTransfer = new DataTransfer();
      docxTransfer.items.add(new File([docxBytes], 'word-table.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
      const docxInput = document.querySelector('[data-global-document-input]'); docxInput.files = docxTransfer.files;
      docxInput.dispatchEvent(new Event('change', { bubbles: true }));
      const docxEditor = await waitUntil(() => { const editor = document.querySelector('[data-editor-document]'); return editor?.getAttribute('data-editor-document') !== importedId ? editor : null; }, 'DOCX import opens editor');
      const docxDocumentId = docxEditor.getAttribute('data-editor-document');
      const wordTable = await waitFor('table[data-word-table]');
      const editableCells = wordTable.querySelectorAll('th[contenteditable], td[contenteditable]');
      if (editableCells.length !== 4 || editableCells[0].textContent !== 'Top left' || editableCells[3].textContent !== 'Bottom right') throw new Error('Word 表格没有按两行两列可编辑结构显示');
      const addControls = [...document.querySelectorAll('.add-block-row button')].map(button => button.textContent.trim());
      if (addControls.length !== 4 || !addControls.some(text => text.includes('添加段落')) || !addControls.some(text => text.includes('标题')) || !addControls.some(text => text.includes('代码')) || !addControls.some(text => text.includes('引用'))) throw new Error('直接编辑修复误删了四个结构化添加入口');
      editableCells[3].innerText = 'Bottomdesktop saved';
      editableCells[3].dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: editableCells[3].innerText }));
      await new Promise(resolve => setTimeout(resolve, 80));
      placeCaret(editableCells[3], 'Bottom'.length);
      if (!document.execCommand('insertLineBreak')) throw new Error('测试环境不支持表格单元格原生换行');
      await new Promise(resolve => setTimeout(resolve, 80));
      if (!document.execCommand('insertText', false, 'right ')) throw new Error('测试环境不支持表格单元格继续输入');
      await new Promise(resolve => setTimeout(resolve, 80));
      const tableLinebreakText = editableCells[3].innerText.replace(/\\r/g, '');
      const tableLinebreakCaret = caretOffset(editableCells[3]);
      if (tableLinebreakText !== 'Bottom\\nright desktop saved' || tableLinebreakCaret !== 'Bottom\\nright '.length) throw new Error('Word 表格换行后输入位置跳转：' + JSON.stringify({ tableLinebreakText, tableLinebreakCaret }));
      document.querySelector('.editor-controls .secondary.compact').click();
      await waitUntil(() => document.querySelector('.save-state')?.textContent?.includes('已保存'), 'Word table manual save');
      const savedDocx = await originalFetch('/api/documents/' + docxDocumentId, { headers: { Authorization: 'Bearer ' + token } }).then(response => response.json());
      const savedWordTable = savedDocx.document.blocks.find(block => block.type === 'table');
      if (savedWordTable?.table?.rows?.[1]?.[1]?.replace(/\\r/g, '') !== 'Bottom\\nright desktop saved' || !savedWordTable.content.includes('Bottom\\nright desktop saved')) throw new Error('Word 单元格换行编辑没有进入正式保存数据');
      document.querySelector('.back-button').click();
      await waitFor('.app-nav');
      const docxCard = await waitUntil(() => [...document.querySelectorAll('.document-card')].find(card => card.querySelector('h3')?.textContent === 'word-table'), 'Word document library card');
      docxCard.click();
      await waitUntil(() => document.querySelector('[data-editor-document]')?.getAttribute('data-editor-document') === docxDocumentId, 'reopen saved Word document');
      const reopenedLastCell = await waitFor('table[data-word-table] tr:last-child td:last-child[contenteditable], table[data-word-table] tr:last-child th:last-child[contenteditable]');
      if (reopenedLastCell.innerText.replace(/\\r/g, '') !== 'Bottom\\nright desktop saved') throw new Error('重新打开后 Word 表格单元格换行编辑丢失');
      document.querySelector('.back-button').click();
      await waitFor('.app-nav');
      let pdfVisual = false;
      let ocrLayoutMaxDelta = 0;
      let pdfTipOpenLayoutMaxDelta = 0;
      let pdfCanvasDataUrl = '';
      let pdfSecondCanvasDataUrl = '';
      if (pdfFixtureBase64) {
        window.__desktopSmokeStep = 'PDF Tip layout stability';
        const binary = atob(pdfFixtureBase64); const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
        const file = new File([bytes], '中文图片资料.pdf', { type: 'application/pdf' });
        const transfer = new DataTransfer(); transfer.items.add(file);
        const fileInput = document.querySelector('input[type="file"]');
        fileInput.files = transfer.files;
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        await waitFor('[data-pdf-document]');
        const originalPages = await waitUntil(() => document.querySelectorAll('[data-pdf-page]').length === 2 ? [...document.querySelectorAll('[data-pdf-page]')] : null, 'PDF original pages');
        await waitUntil(() => originalPages[0].classList.contains('rendered') && originalPages[0].querySelectorAll('.pdf-text-layer span').length >= 5, 'PDF original TextLayer');
        const originalSelectionSpan = await waitUntil(() => [...originalPages[0].querySelectorAll('.pdf-text-layer span')].find(element => element.textContent?.includes('可选择')), 'selectable PDF source text');
        const originalSelectionStart = originalSelectionSpan.textContent.indexOf('可选择');
        selectText(originalSelectionSpan, originalSelectionStart, '可选择'.length);
        (await waitFor('.selection-toolbar button')).click();
        const pdfTipPanel = await waitFor('[data-tip-panel]');
        const pdfTipId = pdfTipPanel.getAttribute('data-tip-panel');
        const pdfDocumentId = document.querySelector('[data-pdf-document]').getAttribute('data-pdf-document');
        const persistedPdf = await fetch('/api/documents/' + pdfDocumentId, { headers: { Authorization: 'Bearer ' + token } }).then(response => response.json());
        const persistedPdfTip = persistedPdf.tips.find(tip => tip.id === pdfTipId);
        if (persistedPdfTip?.anchorType !== 'pdf' || persistedPdfTip?.pdfAnchor?.pdfFingerprint !== persistedPdf.document.pdfStructure?.fingerprint || persistedPdfTip?.selectedText !== '可选择') throw new Error('PDF TextLayer selection did not create a fingerprint-bound PDF Tip through the formal path');
        pdfTipPanel.querySelector('.tip-head .icon-button').click();
        await waitUntil(() => !document.querySelector('[data-tip-panel]') && document.querySelector('.pdf-page-tip'), 'PDF Tip overlay after collapse');
        document.querySelector('.pdf-page-tip').click();
        await waitUntil(() => document.querySelector('[data-tip-panel="' + pdfTipId + '"]'), 'reopen PDF Tip from overlay');
        document.querySelector('[data-tip-panel="' + pdfTipId + '"] .tip-head .icon-button').click();
        await waitUntil(() => !document.querySelector('[data-tip-panel]'), 'restore PDF page after Tip collapse');
        if (document.querySelector('.document-title')?.value !== '中文图片资料') throw new Error('Electron 文件输入没有保留中文 PDF 标题');
        document.querySelector('.pdf-view-switch button:first-child').click();
        const semanticText = await waitFor('[data-pdf-semantic-block] p');
        const semanticTable = await waitFor('[data-pdf-table-block]');
        const semanticImage = await waitUntil(() => document.querySelector('[data-pdf-image-block]')?.naturalWidth > 100 ? document.querySelector('[data-pdf-image-block]') : null, 'PDF 独立图片对象');
        if (!semanticText.textContent.includes('可选择') || semanticTable.querySelectorAll('tr').length !== 3 || semanticImage.tagName !== 'IMG') throw new Error('PDF 结构化视图没有分别保留文本、表格和图片');
        document.querySelector('.pdf-view-switch button:nth-child(2)').click();
        const pages = await waitUntil(() => document.querySelectorAll('[data-pdf-page]').length === 2 ? [...document.querySelectorAll('[data-pdf-page]')] : null, 'PDF 两页结构');
        const firstCanvas = await waitUntil(() => pages[0].classList.contains('rendered') && pages[0].querySelector('canvas')?.width > 500 ? pages[0].querySelector('canvas') : null, 'PDF 第一页 Canvas');
        if (pages[0].querySelectorAll('.pdf-text-layer span').length < 5) throw new Error('PDF 原始版式没有叠加真实可选择 TextLayer');
        const pixels = firstCanvas.getContext('2d').getImageData(0, 0, firstCanvas.width, firstCanvas.height).data;
        let coloredPixels = 0;
        for (let index = 0; index < pixels.length; index += 64) {
          const red = pixels[index], green = pixels[index + 1], blue = pixels[index + 2], alpha = pixels[index + 3];
          if (alpha > 0 && Math.max(red, green, blue) - Math.min(red, green, blue) > 35) coloredPixels += 1;
        }
        if (coloredPixels < 150) throw new Error('PDF 第一页彩色图片或矢量内容没有进入 Canvas');
        if (capturePdfCanvas) pdfCanvasDataUrl = firstCanvas.toDataURL('image/png');
        pages[1].scrollIntoView({ block: 'center' });
        const secondCanvas = await waitUntil(() => pages[1].classList.contains('rendered') && pages[1].querySelector('canvas')?.height > 500 ? pages[1].querySelector('canvas') : null, 'PDF 第二页按需渲染');
        if (capturePdfCanvas) pdfSecondCanvasDataUrl = secondCanvas.toDataURL('image/png');
        pdfVisual = true;
        document.querySelector('.back-button').click();
        await waitFor('.app-nav');
        if (ocrPdfFixtureBase64) {
          const ocrBinary = atob(ocrPdfFixtureBase64); const ocrBytes = new Uint8Array(ocrBinary.length);
          for (let index = 0; index < ocrBinary.length; index++) ocrBytes[index] = ocrBinary.charCodeAt(index);
          const ocrFile = new File([ocrBytes], 'scanned-ocr-test.pdf', { type: 'application/pdf' });
          const ocrTransfer = new DataTransfer(); ocrTransfer.items.add(ocrFile);
          const ocrInput = document.querySelector('input[type="file"]'); ocrInput.files = ocrTransfer.files;
          ocrInput.dispatchEvent(new Event('change', { bubbles: true }));
          const ocrDocument = await waitFor('[data-pdf-document]');
          const ocrDocumentId = ocrDocument.getAttribute('data-pdf-document');
          const ocrPage = await waitFor('[data-pdf-page="1"]');
          await waitUntil(() => ocrPage.classList.contains('rendered'), 'scanned PDF canvas');
          const ocrButton = await waitFor('.pdf-page-shell > header button');
          ocrButton.click();
          await waitUntil(() => ocrPage.querySelectorAll('.pdf-ocr-word').length >= 3 && ocrPage.querySelector('header small'), 'offline OCR word layer', 120000);
          const ocrWord = await waitUntil(() => [...ocrPage.querySelectorAll('.pdf-ocr-word')].find(element => /OCR/i.test(element.textContent || '')), 'OCR selectable word');
          selectText(ocrWord, 0, Math.min(3, ocrWord.textContent.trim().length));
          (await waitUntil(() => document.querySelector('.selection-toolbar button'), 'first-page OCR selection toolbar')).click();
          let ocrTipPanel = await waitUntil(() => document.querySelector('[data-tip-panel]'), 'first-page OCR Tip panel');
          const ocrTipId = ocrTipPanel.getAttribute('data-tip-panel');
          const persistedOcr = await fetch('/api/documents/' + ocrDocumentId, { headers: { Authorization: 'Bearer ' + token } }).then(response => response.json());
          const persistedOcrTip = persistedOcr.tips.find(tip => tip.id === ocrTipId);
          if (persistedOcr.document.pdfStructure?.pages?.[0]?.source !== 'ocr' || persistedOcrTip?.anchorType !== 'pdf' || persistedOcrTip?.pdfAnchor?.source !== 'ocr' || !(persistedOcrTip?.pdfAnchor?.confidence > 0)) throw new Error('offline OCR output did not become a persisted PDF Tip authority');
          const ocrComposer = ocrTipPanel.querySelector('.tip-composer textarea');
          for (let turn = 1; turn <= 3; turn++) {
            setTextArea(ocrComposer, 'Explain this selected text in more detail, turn ' + turn + '.');
            ocrTipPanel.querySelector('.send-button').click();
            await waitUntil(() => ocrTipPanel.querySelectorAll('.message.assistant .message-content').length >= turn && [...ocrTipPanel.querySelectorAll('.message.assistant .message-content')].every(element => element.textContent.length > 8), 'persisted OCR Tip answer ' + turn);
          }
          const persistedOcrConversation = await fetch('/api/documents/' + ocrDocumentId, { headers: { Authorization: 'Bearer ' + token } }).then(response => response.json());
          if ((persistedOcrConversation.tips.find(tip => tip.id === ocrTipId)?.messages?.length || 0) < 6) throw new Error('PDF Tip reopening regression requires persisted multi-turn history');
          ocrTipPanel.querySelector('.tip-head .icon-button').click();
          const firstOcrTipMarker = await waitUntil(() => !document.querySelector('[data-tip-panel]') && document.querySelector('[data-pdf-tip-id="' + ocrTipId + '"]'), 'collapsed first-page OCR Tip marker');
          firstOcrTipMarker.scrollIntoView({ block: 'center' });
          await new Promise(resolve => setTimeout(resolve, 500));
          window.scrollTo(0, 0); document.documentElement.scrollTop = 0; document.body.scrollTop = 0;
          const tipOpenScroll = document.querySelector('.editor-scroll'); const tipOpenNav = document.querySelector('.editor-nav'); const tipOpenTopbar = document.querySelector('.editor-topbar');
          const sampleTipOpenLayout = () => ({ anchorTop: firstOcrTipMarker.getBoundingClientRect().top, scrollTop: tipOpenScroll.scrollTop, navTop: tipOpenNav.getBoundingClientRect().top, navBottom: tipOpenNav.getBoundingClientRect().bottom, topbarTop: tipOpenTopbar.getBoundingClientRect().top, windowScroll: window.scrollY, documentScroll: document.documentElement.scrollTop, bodyScroll: document.body.scrollTop });
          const initialTipOpenLayout = sampleTipOpenLayout(); const tipOpenSamples = [initialTipOpenLayout];
          const tipOpenTimer = setInterval(() => tipOpenSamples.push(sampleTipOpenLayout()), 8);
          firstOcrTipMarker.click();
          ocrTipPanel = await waitUntil(() => document.querySelector('[data-tip-panel="' + ocrTipId + '"]'), 'reopened OCR Tip panel');
          await waitUntil(() => { const list = ocrTipPanel.querySelector('.message-list'); return list && list.scrollHeight - list.clientHeight - list.scrollTop <= 2 ? list : null; }, 'reopened PDF Tip internal message scroll');
          tipOpenSamples.push(sampleTipOpenLayout()); clearInterval(tipOpenTimer);
          const messageList = ocrTipPanel.querySelector('.message-list');
          if (messageList.scrollHeight - messageList.clientHeight - messageList.scrollTop > 2) throw new Error('reopened PDF Tip did not scroll its own message history to the bottom');
          const maximumRootScroll = tipOpenSamples.reduce((result, sample) => Math.max(result, Math.abs(sample.windowScroll), Math.abs(sample.documentScroll), Math.abs(sample.bodyScroll)), 0);
          if (maximumRootScroll > 1) throw new Error('opening a PDF Tip with history scrolled the application root by ' + maximumRootScroll + 'px');
          pdfTipOpenLayoutMaxDelta = tipOpenSamples.reduce((result, sample) => Math.max(result, Math.abs(sample.anchorTop - initialTipOpenLayout.anchorTop), Math.abs(sample.navTop - initialTipOpenLayout.navTop), Math.abs(sample.navBottom - initialTipOpenLayout.navBottom), Math.abs(sample.topbarTop - initialTipOpenLayout.topbarTop)), 0);
          if (pdfTipOpenLayoutMaxDelta > 2) {
            const layoutDeltas = tipOpenSamples.map(sample => ({ anchorTop: sample.anchorTop - initialTipOpenLayout.anchorTop, navTop: sample.navTop - initialTipOpenLayout.navTop, navBottom: sample.navBottom - initialTipOpenLayout.navBottom, topbarTop: sample.topbarTop - initialTipOpenLayout.topbarTop, scrollTop: sample.scrollTop - initialTipOpenLayout.scrollTop }));
            const distinctDeltas = layoutDeltas.filter((sample, index) => index === 0 || JSON.stringify(sample) !== JSON.stringify(layoutDeltas[index - 1]));
            throw new Error('opening an existing PDF Tip moved the reading anchor or app columns by ' + pdfTipOpenLayoutMaxDelta + 'px: ' + JSON.stringify({ initialTipOpenLayout, distinctDeltas }));
          }
          const scannedPages = [...document.querySelectorAll('[data-pdf-page]')];
          if (scannedPages.length !== 4) throw new Error('OCR layout regression requires a four-page scanned PDF');
          const layoutPage = scannedPages[2];
          layoutPage.scrollIntoView({ block: 'center' });
          await waitUntil(() => layoutPage.classList.contains('rendered') && layoutPage.querySelector('header button'), 'middle scanned PDF page');
          await new Promise(resolve => setTimeout(resolve, 500));
          const editorScroll = document.querySelector('.editor-scroll'); const editorNav = document.querySelector('.editor-nav');
          const sampleLayout = () => ({ pageHeight: layoutPage.getBoundingClientRect().height, scrollTop: editorScroll.scrollTop, navTop: editorNav.getBoundingClientRect().top, navBottom: editorNav.getBoundingClientRect().bottom, tipTop: ocrTipPanel.getBoundingClientRect().top, tipBottom: ocrTipPanel.getBoundingClientRect().bottom });
          const initialLayout = sampleLayout(); const layoutSamples = [initialLayout];
          const layoutTimer = setInterval(() => layoutSamples.push(sampleLayout()), 8);
          layoutPage.querySelector('header button').click();
          await waitUntil(() => layoutPage.querySelectorAll('.pdf-ocr-word').length >= 3 && layoutPage.querySelector('header small'), 'middle-page OCR word layer', 120000);
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          layoutSamples.push(sampleLayout()); clearInterval(layoutTimer);
          const maximumLayoutDelta = layoutSamples.reduce((result, sample) => Math.max(result, Math.abs(sample.pageHeight - initialLayout.pageHeight), Math.abs(sample.scrollTop - initialLayout.scrollTop), Math.abs(sample.navTop - initialLayout.navTop), Math.abs(sample.navBottom - initialLayout.navBottom), Math.abs(sample.tipTop - initialLayout.tipTop), Math.abs(sample.tipBottom - initialLayout.tipBottom)), 0);
          ocrLayoutMaxDelta = maximumLayoutDelta;
          if (maximumLayoutDelta > 2) throw new Error('OCR changed page height, scroll position, or three-column geometry by ' + maximumLayoutDelta + 'px');
          ocrTipPanel.querySelector('.tip-head .icon-button').click();
          await waitUntil(() => !document.querySelector('[data-tip-panel]') && document.querySelector('.pdf-page-tip'), 'first OCR Tip overlay');
          const middleOcrWord = await waitUntil(() => [...layoutPage.querySelectorAll('.pdf-ocr-word')].find(element => /OCR/i.test(element.textContent || '')), 'middle-page OCR selectable word');
          selectText(middleOcrWord, 0, Math.min(3, middleOcrWord.textContent.trim().length));
          (await waitUntil(() => document.querySelector('.selection-toolbar button'), 'middle-page OCR selection toolbar')).click();
          const middleOcrTipPanel = await waitUntil(() => document.querySelector('[data-tip-panel]'), 'middle-page OCR Tip panel');
          const verifiedLayoutOcr = await fetch('/api/documents/' + ocrDocumentId, { headers: { Authorization: 'Bearer ' + token } }).then(response => response.json());
          const middleOcrTip = verifiedLayoutOcr.tips.find(tip => tip.id === middleOcrTipPanel.getAttribute('data-tip-panel'));
          if (verifiedLayoutOcr.document.pdfStructure?.pages?.[2]?.source !== 'ocr' || middleOcrTip?.pdfAnchor?.pageNumber !== 3 || middleOcrTip?.pdfAnchor?.source !== 'ocr') throw new Error('layout-stable OCR result did not continue into the formal PDF Tip path');
          middleOcrTipPanel.querySelector('.tip-head .icon-button').click();
          await waitUntil(() => !document.querySelector('[data-tip-panel]'), 'middle-page OCR Tip collapse');
          document.querySelector('.back-button').click();
          await waitFor('.app-nav');
        }
      }
      document.querySelector('.header-actions .primary').click();
      const editableBlock = await waitFor('[contenteditable][data-block-id]');
      editableBlock.innerText = '这是用于验证聊天内递归 Tip 的原文内容。';
      editableBlock.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: editableBlock.innerText }));
      await new Promise(resolve => setTimeout(resolve, 1100));
      selectText(editableBlock, 0, 6);
      (await waitFor('.selection-toolbar button')).click();
      const rootPanel = await waitFor('[data-tip-panel]');
      const rootId = rootPanel.getAttribute('data-tip-panel');
      window.__desktopSmokeStep = 'chat web search synchronization';
      const chatWebToggle = rootPanel.querySelector('[data-chat-web-search-toggle]');
      if (!chatWebToggle || chatWebToggle.getAttribute('aria-pressed') !== 'false') throw new Error('对话纸飞机旁没有显示与设置一致的关闭状态');
      chatWebToggle.click();
      await waitUntil(() => rootPanel.querySelector('[data-chat-web-search-toggle]')?.getAttribute('aria-pressed') === 'true', 'chat web search enabled');
      const enabledFromApi = await fetch('/api/settings', { headers: { Authorization: 'Bearer ' + token } }).then(response => response.json());
      if (enabledFromApi.settings?.webSearchEnabled !== true) throw new Error('对话联网开关只改变了界面，没有写入正式设置');
      document.querySelector('.editor-controls .icon-button:last-child').click();
      const synchronizedSettingsModal = await waitFor('.settings-modal');
      const synchronizedSettingsToggle = synchronizedSettingsModal.querySelector('.skill-setting-row .toggle');
      if (synchronizedSettingsToggle?.getAttribute('aria-pressed') !== 'true') throw new Error('对话打开联网后，设置弹窗没有同步显示');
      synchronizedSettingsToggle.click();
      await waitUntil(() => synchronizedSettingsToggle.getAttribute('aria-pressed') === 'false', 'settings web search draft disabled');
      synchronizedSettingsModal.querySelector('footer .primary').click();
      await waitUntil(() => synchronizedSettingsModal.querySelector('.settings-message.ok'), 'settings web search disabled save');
      synchronizedSettingsModal.querySelector('header .icon-button').click();
      await waitUntil(() => !document.querySelector('.settings-modal'), 'close synchronized settings');
      await waitUntil(() => rootPanel.querySelector('[data-chat-web-search-toggle]')?.getAttribute('aria-pressed') === 'false', 'settings disabled reflected in chat');
      const liveFetch = window.fetch.bind(window);
      window.fetch = (input, init = {}) => String(input).endsWith('/api/settings') && String(init.method || 'GET').toUpperCase() === 'PUT'
        ? Promise.resolve(new Response(JSON.stringify({ error: 'SMOKE_SETTINGS_WRITE_FAILED' }), { status: 503, headers: { 'Content-Type': 'application/json' } }))
        : liveFetch(input, init);
      rootPanel.querySelector('[data-chat-web-search-toggle]').click();
      await waitUntil(() => rootPanel.querySelector('.chat-error')?.textContent?.includes('SMOKE_SETTINGS_WRITE_FAILED'), 'chat web search write failure visible');
      if (rootPanel.querySelector('[data-chat-web-search-toggle]').getAttribute('aria-pressed') !== 'false') throw new Error('联网设置写入失败后仍错误改变了对话开关状态');
      window.fetch = liveFetch;
      const rootComposer = rootPanel.querySelector('.tip-composer textarea');
      setTextArea(rootComposer, '这个概念是什么意思？');
      rootPanel.querySelector('.send-button').click();
      const streamingSkillResults = await waitFor('[data-tip-panel="' + rootId + '"] .message.assistant details[data-skill-results]');
      if (streamingSkillResults.open) throw new Error('流式工具调用轨迹没有默认折叠');
      const rootMessage = await waitUntil(() => {
        const element = document.querySelector('[data-tip-panel="' + rootId + '"] .message.assistant .message-content');
        return element?.textContent?.length > 8 ? element : null;
      }, '根 Tip 回答');
      const rootAnswerText = rootMessage.textContent;
      const rootAnswerLink = rootMessage.querySelector('a[data-message-link]');
      if (rootAnswerLink?.getAttribute('href') !== 'https://zh.wikipedia.org/w/index.php?search=SMOKE_LINK' || rootAnswerLink.target !== '_blank') throw new Error('聊天正文中的百科 HTTPS 地址没有渲染为安全外部超链接');
      const rootSkillResults = rootPanel.querySelector('details[data-skill-results]');
      if (!rootSkillResults || rootSkillResults.open || !rootSkillResults.querySelector('summary')) throw new Error('工具调用轨迹没有默认折叠或缺少折叠摘要');
      rootSkillResults.querySelector('summary').click();
      await waitUntil(() => rootSkillResults.open && rootSkillResults.querySelector('.skill-result'), '展开工具调用轨迹');
      rootSkillResults.querySelector('summary').click();
      await waitUntil(() => !rootSkillResults.open, '收回工具调用轨迹');
      selectText(rootMessage, 0, 4);
      (await waitFor('.selection-toolbar button')).click();
      const childPanel = await waitUntil(() => [...document.querySelectorAll('[data-tip-panel]')].find(element => element.getAttribute('data-tip-panel') !== rootId), '子 Tip 面板');
      const childId = childPanel.getAttribute('data-tip-panel');
      if (document.querySelector('.tip-panel-context')?.getAttribute('data-tip-panel') !== rootId || !document.querySelector('.tip-tree-button')) throw new Error('子 Tip 没有形成父聊天替换文档的双栏布局或树入口');
      document.querySelector('.tip-tree-button').click();
      await waitFor('.tip-tree-dialog');
      const childVertex = document.querySelector('[data-tip-tree-id="' + childId + '"]');
      if (!childVertex) throw new Error('Tip 树没有显示子对话节点');
      const childName = '可修改的子对话名称';
      childVertex.querySelector('input').focus();
      setInput(childVertex.querySelector('input'), childName);
      childVertex.querySelector('.tip-tree-save').click();
      await new Promise(resolve => setTimeout(resolve, 180));
      document.querySelector('[data-tip-tree-id="' + rootId + '"] .tip-tree-locate').click();
      await waitUntil(() => document.querySelector('.document-page') && document.querySelector('[data-tip-panel="' + rootId + '"]') && !document.querySelector('.tip-panel-context'), '树节点定位根 Tip');
      document.querySelector('.tip-tree-button').click();
      await waitFor('.tip-tree-dialog');
      document.querySelector('[data-tip-tree-id="' + childId + '"] .tip-tree-locate').click();
      await waitUntil(() => document.querySelector('.tip-panel-context')?.getAttribute('data-tip-panel') === rootId && document.querySelector('[data-tip-panel="' + childId + '"]:not(.tip-panel-context)'), '树节点定位子 Tip');
      const childComposer = document.querySelector('[data-tip-panel="' + childId + '"] .tip-composer textarea');
      setTextArea(childComposer, '请继续解释这个局部概念');
      document.querySelector('[data-tip-panel="' + childId + '"] .send-button').click();
      const childMessage = await waitUntil(() => {
        const element = document.querySelector('[data-tip-panel="' + childId + '"] .message.assistant .message-content');
        return element?.textContent?.length > 8 ? element : null;
      }, '子 Tip 回答');
      selectText(childMessage, 0, 4);
      (await waitFor('.selection-toolbar button')).click();
      const grandPanel = await waitUntil(() => [...document.querySelectorAll('[data-tip-panel]')].find(element => ![rootId, childId].includes(element.getAttribute('data-tip-panel'))), '孙 Tip 面板');
      const grandId = grandPanel.getAttribute('data-tip-panel');
      if (document.querySelector('.tip-panel-context')?.getAttribute('data-tip-panel') !== childId) throw new Error('孙 Tip 没有递归显示为子聊天 + 孙聊天');
      grandPanel.querySelector('.tip-head .icon-button').click();
      await waitUntil(() => document.querySelector('.tip-panel-context')?.getAttribute('data-tip-panel') === rootId && document.querySelector('[data-tip-panel="' + childId + '"]:not(.tip-panel-context)'), '收回孙 Tip 恢复父子布局');
      document.querySelector('[data-tip-panel="' + childId + '"]:not(.tip-panel-context) .tip-head .icon-button').click();
      await waitUntil(() => document.querySelector('.document-page') && document.querySelector('[data-tip-panel="' + rootId + '"]') && !document.querySelector('.tip-panel-context'), '收回子 Tip 恢复文档与根 Tip');
      const rootFollowupComposer = document.querySelector('[data-tip-panel="' + rootId + '"] .tip-composer textarea');
      setTextArea(rootFollowupComposer, '这是第二轮追问，悬浮预览仍应显示第一轮回答。');
      document.querySelector('[data-tip-panel="' + rootId + '"] .send-button').click();
      const rootSecondMessage = await waitUntil(() => {
        const elements = [...document.querySelectorAll('[data-tip-panel="' + rootId + '"] .message.assistant .message-content')];
        const element = elements.at(-1);
        return elements.length >= 2 && element?.textContent?.includes('这是第二轮追问') ? element : null;
      }, '根 Tip 第二轮回答');
      const rootSecondAnswerText = rootSecondMessage.textContent;
      if (rootSecondAnswerText === rootAnswerText) throw new Error('反事实前提失败：根 Tip 的第一轮和第二轮回答内容相同');
      document.querySelector('[data-tip-panel="' + rootId + '"] .tip-head .icon-button').click();
      await waitUntil(() => document.querySelector('.document-page') && !document.querySelector('[data-tip-panel]'), '收回根 Tip 恢复文档');
      window.__desktopSmokeStep = 'full Tip answer preview';
      const rootMarker = await waitUntil(() => [...document.querySelectorAll('[data-tip-marker-id]')].find(element => element.getAttribute('data-tip-marker-id') === rootId), 'root Tip marker');
      if (rootMarker.hasAttribute('title')) throw new Error('Tip marker 仍使用可能截断的原生 summary title');
      rootMarker.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      const fullPreview = await waitFor('[data-tip-answer-preview="' + rootId + '"] .tip-answer-preview-body');
      if (fullPreview.textContent !== rootAnswerText || fullPreview.textContent === rootSecondAnswerText || !fullPreview.textContent.includes('SMOKE_LOCAL_MODEL_ANSWER')) throw new Error('Tip 悬浮预览没有完整显示第一条真实模型回答：' + JSON.stringify({ expectedFirstLength: rootAnswerText.length, secondLength: rootSecondAnswerText.length, actualLength: fullPreview.textContent.length, tail: fullPreview.textContent.slice(-80) }));
      rootMarker.click();
      await waitUntil(() => document.querySelector('[data-tip-panel="' + rootId + '"]'), 'full preview marker still opens Tip');
      document.querySelector('[data-tip-panel="' + rootId + '"] .tip-head .icon-button').click();
      await waitUntil(() => !document.querySelector('[data-tip-panel]'), 'close Tip after full preview');
      const nestedDocuments = await fetch('/api/documents', { headers: { Authorization: 'Bearer ' + token } }).then(response => response.json());
      const nestedDocument = await fetch('/api/documents/' + nestedDocuments.documents[0].id, { headers: { Authorization: 'Bearer ' + token } }).then(response => response.json());
      if (!nestedDocument.tips.some(tip => tip.id === childId && tip.parentTipId === rootId && tip.title === childName) || !nestedDocument.tips.some(tip => tip.id === grandId && tip.parentTipId === childId && tip.depth === 3)) throw new Error('树改名或递归 lineage 没有持久化：' + JSON.stringify({ rootId, childId, grandId, tips: nestedDocument.tips.map(tip => ({ id: tip.id, parentTipId: tip.parentTipId, title: tip.title, depth: tip.depth })) }));
      document.querySelector('.back-button').click();
      await waitFor('.app-nav');
      document.querySelector('.logout-button').click();
      await waitFor('.auth-shell');
      if (localStorage.getItem('ai-tip-token') !== null) throw new Error('退出登录没有清除正式会话');
      const forgotPasswordButton = await waitFor('[data-auth-mode="login"] .auth-inline-action');
      forgotPasswordButton.click();
      await waitFor('[data-auth-mode="recover"]');
      if (!document.querySelector('[data-auth-mode="recover"] input[type="email"]') || !document.querySelector('[data-auth-mode="recover"] .auth-switch button')) throw new Error('忘记密码页面缺少邮箱或返回登录入口');
      document.querySelector('[data-auth-mode="recover"] .auth-switch button').click();
      await waitFor('[data-auth-mode="login"]');
      if (!document.querySelector('[data-remember-login]') || !document.body.innerText.includes('记住账号和密码')) throw new Error('登录页没有接入安全凭据记忆控件');
      return { localEntry: true, languageShared: true, englishDefaultPrompt: true, rememberedLoginControl: true, contactClipboard: true, localModelCatalog: true, localModelNativeDirectory: true, localModelDirectoryTokenSecurity: true, localModelDetailedProgress: true, ollamaInstallerDialog: true, localRuntimeMissingVisible: true, noModelTipGate: true, noModelServerBypassBlocked: true, feedbackRemoved: true, webSearchDefaultOff: true, chatWebSearchSynchronized: true, transformerRemoved: true, emptyImportDefault: true, globalDropImport: true, unsupportedDropBlocked: true, saveFailureBlocked: true, saveBeforeDropUpload: true, backSaveFailureBlocked: true, saveBeforeBack: true, contentEditableLinebreakCaret: true, wordTableDirectEdit: true, wordTableLinebreakCaret: true, wordTableSaveRoundTrip: true, addBlockControlsPreserved: true, toolTracesCollapsed: true, clickableSearchLink: true, firstTipAnswerPreview: true, previewMarkerOpen: true, pdfVisual, pdfOriginalTipSelection: true, pdfTipOverlayReopen: true, pdfTipOpenLayoutStable: true, pdfTipOpenLayoutMaxDelta, offlineOcr: true, ocrTipAuthority: true, ocrLayoutStable: true, ocrLayoutMaxDelta, pdfCanvasDataUrl, pdfSecondCanvasDataUrl, nestedTipSelection: true, recursiveLayout: true, treeRename: true, collapseRestored: true, logoutCleared: true, forgotPasswordEntry: true };
    })()`),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Desktop UI smoke exceeded 10 minutes")), 600000)),
    ]);
      if (clipboard.readText() !== '2280810215@qq.com') throw new Error('联系按钮没有把邮箱写入系统剪贴板');
    }
    catch (error) {
      const diagnostic = await mainWindow.webContents.executeJavaScript("({ step: window.__desktopSmokeStep || 'unknown', text: document.body.innerText.slice(-700), importError: document.querySelector('[data-import-error]')?.textContent || '', editor: document.querySelector('[data-editor-document]')?.getAttribute('data-editor-document') || '' })").catch(() => ({}));
      throw new Error(`Desktop UI smoke failed at ${JSON.stringify(diagnostic)}: ${error instanceof Error ? error.message : String(error)}`);
    }
    finally { clearInterval(smokeProgressTimer); clipboard.writeText(clipboardBeforeSmoke); }
    if (process.env.AI_TIP_PDF_SCREENSHOT_PATH && productBehavior.pdfCanvasDataUrl) {
      const png = String(productBehavior.pdfCanvasDataUrl).replace(/^data:image\/png;base64,/, "");
      writeFileSync(path.resolve(process.env.AI_TIP_PDF_SCREENSHOT_PATH), Buffer.from(png, "base64"));
      if (productBehavior.pdfSecondCanvasDataUrl) {
        const requested = path.parse(path.resolve(process.env.AI_TIP_PDF_SCREENSHOT_PATH));
        const secondPath = path.join(requested.dir, `${requested.name.replace(/-page-1$/, "")}-page-2${requested.ext || ".png"}`);
        const secondPng = String(productBehavior.pdfSecondCanvasDataUrl).replace(/^data:image\/png;base64,/, "");
        writeFileSync(secondPath, Buffer.from(secondPng, "base64"));
      }
    }
    delete productBehavior.pdfCanvasDataUrl;
    delete productBehavior.pdfSecondCanvasDataUrl;
    if (!pythonCalculation) throw new Error("Python 技能模块未加载");
    const pythonResult = await pythonCalculation("decimal.Decimal('0.1') + decimal.Decimal('0.2')");
    if (!pythonResult.includes("0.3")) throw new Error(`Python 技能自检失败：${pythonResult}`);
    if (!pythonWorkerTest) throw new Error("高级 Python Worker 未加载");
    const uncertainty = await pythonWorkerTest("uncertainty", { terms: [{ value: 10, uncertainty: 0.2 }, { value: 5, uncertainty: 0.1, coefficient: -1 }] }, 15000);
    if (!uncertainty.includes("standard_uncertainty")) throw new Error(`高级技能自检失败：${uncertainty}`);
    const secretResult = await mainWindow.webContents.executeJavaScript(`(async () => {
      const login = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'demo@aitip.local', password: 'demo1234' }) }).then(r => r.json());
      const response = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.token }, body: JSON.stringify({ provider: 'openai', baseURL: 'https://api.openai.com/v1', model: 'gpt-5-mini', apiKey: 'desktop-smoke-secret', systemPrompt: 'test', webSearchEnabled: false, pythonEnabled: true, reliabilityEnabled: true }) });
      return response.ok;
    })()`);
    if (!secretResult || !smokeDataDir) throw new Error("系统密钥存储自检请求失败");
    const persisted = readFileSync(path.join(smokeDataDir, "store.json"), "utf8");
    if (persisted.includes("desktop-smoke-secret") || !persisted.includes("safe:v1:")) throw new Error("系统密钥存储自检失败");
    rmSync(smokeDataDir, { recursive: true, force: true }); smokeDataDir = null;
    const smokeResult = `Desktop smoke test passed: ${snapshot.title}; ${JSON.stringify(productBehavior)}; ${pythonResult}; advanced worker and safeStorage ok`;
    if (smokeResultPath) writeFileSync(smokeResultPath, JSON.stringify({ ok: true, result: smokeResult }), "utf8");
    console.log(smokeResult);
    app.quit();
  }
}

app.whenReady().then(async () => {
  if (process.argv.includes("--live-reference-search-test")) {
    process.env.AI_TIP_SUPABASE_ENABLED = "0";
    smokeDataDir ||= mkdtempSync(path.join(tmpdir(), "ai-tip-live-reference-electron-"));
    await bootServer();
    if (!liveReferenceSearch) throw new Error("备用参考检索入口没有导出");
    const result = await liveReferenceSearch("GPT encode-only decode-only encoder decoder architecture");
    if (!result?.sources?.length) throw new Error(`Chromium 系统网络没有取得真实参考来源：${JSON.stringify(result)}`);
    console.log(JSON.stringify({ ok: true, networkStack: "electron-chromium", sourceCount: result.sources.length, sources: result.sources, skippedSites: result.skippedSites || [] }));
    app.quit();
    return;
  }
  if (process.argv.includes("--smoke-test")) smokeDataDir ||= mkdtempSync(path.join(tmpdir(), "ai-tip-desktop-smoke-"));
  installDesktopIpc();
  installMenu();
  await createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
}).catch((error) => {
  if (smokeResultPath) {
    try { writeFileSync(smokeResultPath, JSON.stringify({ ok: false, error: error instanceof Error ? error.stack || error.message : String(error) }), "utf8"); } catch {}
  }
  console.error(error);
  app.exit(1);
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => {
  if (smokeModelServer) { smokeModelServer.close(); smokeModelServer = null; smokeModelURL = ""; }
  localServer?.close();
  void managedLocalRuntime?.stop();
  void managedOllamaRuntime?.stop();
  modelDirectorySelections.clear();
  ollamaInstallerSelections.clear();
  for (const controller of ollamaInstallerDownloads.values()) controller.abort();
  ollamaInstallerDownloads.clear();
  for (const stopAccessing of modelSecurityScopeStops.splice(0)) { try { stopAccessing(); } catch {} }
  if (smokeDataDir) { try { rmSync(smokeDataDir, { recursive: true, force: true }); } catch {} smokeDataDir = null; }
});
