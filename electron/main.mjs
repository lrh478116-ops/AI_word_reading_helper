import { app, BrowserWindow, Menu, safeStorage, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let mainWindow = null;
let localServer = null;
let localURL = null;
let pythonCalculation = null;
let pythonWorkerTest = null;
let smokeDataDir = null;

async function bootServer() {
  if (localURL) return localURL;
  process.env.AI_TIP_EMBEDDED = "1";
  if (process.argv.includes("--smoke-test")) smokeDataDir ||= mkdtempSync(path.join(tmpdir(), "ai-tip-desktop-smoke-"));
  process.env.AI_TIP_DATA_DIR = smokeDataDir || path.join(app.getPath("userData"), "data");
  process.env.AI_TIP_DIST_DIR = path.join(appRoot, "dist");
  const serverModule = await import(new URL("../dist-electron/server.cjs", import.meta.url));
  const startServer = serverModule.startServer || serverModule.default?.startServer;
  const configureSecretProtection = serverModule.configureSecretProtection || serverModule.default?.configureSecretProtection;
  pythonCalculation = serverModule.runPythonCalculation || serverModule.default?.runPythonCalculation;
  pythonWorkerTest = serverModule.runPythonWorker || serverModule.default?.runPythonWorker;
  if (!startServer) throw new Error("本地服务模块加载失败");
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
  const serverURL = await bootServer();
  const smokeTest = process.argv.includes("--smoke-test");
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    show: false,
    backgroundColor: "#f5f6f1",
    title: "AI Tip",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
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
    console.log(`Desktop smoke test passed: ${snapshot.title}; ${pythonResult}; advanced worker and safeStorage ok`);
    app.quit();
  }
}

app.whenReady().then(async () => {
  installMenu();
  await createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
}).catch((error) => {
  console.error(error);
  app.quit();
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => {
  localServer?.close();
  if (smokeDataDir) { try { rmSync(smokeDataDir, { recursive: true, force: true }); } catch {} smokeDataDir = null; }
});
