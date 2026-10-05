import { BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadPrivacyPolicy, createPrivacyConsentStore } from './privacy-consent-store.mjs';

export function isConsentSender(event, window, pageURL) {
  return !window.isDestroyed() && event.sender === window.webContents
    && event.senderFrame === window.webContents.mainFrame && event.senderFrame?.url === pageURL;
}

export async function ensurePrivacyConsent({ appRoot, dataDir, locale = 'zh-CN', onReady }) {
  const policy = loadPrivacyPolicy(path.join(appRoot, 'website', 'privacy', 'index.html'));
  const store = createPrivacyConsentStore(path.join(dataDir, 'privacy-consent.json'), policy);
  if (store.hasConsent()) return true;
  const page = path.join(appRoot, 'electron', 'privacy-consent.html');
  const pageURL = pathToFileURL(page).href;
  const window = new BrowserWindow({
    width: 900, height: 820, minWidth: 520, minHeight: 560, show: false,
    title: 'AI Tip · 隐私政策 / Privacy policy', backgroundColor: '#f6f7f2',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true,
      partition: 'privacy-consent', preload: path.join(appRoot, 'electron', 'privacy-consent-preload.cjs') },
  });
  window.setMenu(null);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  // The gate cannot make network requests, even if bundled renderer code regresses.
  window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !details.url.startsWith(pathToFileURL(path.join(appRoot, 'electron')).href + '/') });
  });
  const channels = ['read', 'accept', 'reject', 'open-link'].map(name => `privacy-consent:${name}`);
  let settled = false;
  let complete;
  let fail;
  const decision = new Promise((resolve, reject) => { complete = resolve; fail = reject; });
  const finish = value => { if (!settled) { settled = true; complete(value); } };
  const authorize = event => { if (settled || !isConsentSender(event, window, pageURL)) throw new Error('Privacy consent sender is not authorized'); };
  ipcMain.handle(channels[0], event => { authorize(event); return { ...policy, language: locale.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en' }; });
  ipcMain.handle(channels[1], (event, input) => {
    authorize(event);
    try { store.accept(input); } catch { return { ok: false, code: 'CONSENT_NOT_SAVED' }; }
    finish(true);
    return { ok: true };
  });
  ipcMain.handle(channels[2], event => { authorize(event); finish(false); return { ok: true }; });
  ipcMain.handle(channels[3], async (event, url) => {
    authorize(event);
    const links = { '../account-deletion/': 'https://lrh478116-ops.github.io/ai-tip-support-site/account-deletion/', 'mailto:2280810215@qq.com': 'mailto:2280810215@qq.com' };
    if (!Object.hasOwn(links, url)) throw new Error('Privacy link is not allowed');
    await shell.openExternal(links[url]);
    return { ok: true };
  });
  window.on('closed', () => finish(false));
  try {
    await window.loadFile(page);
    window.show();
    // Test drivers click the same unchecked checkbox and native IPC route as users; no bypass flag.
    if (onReady) void Promise.resolve().then(() => onReady(window)).catch(fail);
    return await decision;
  } finally {
    settled = true;
    for (const channel of channels) ipcMain.removeHandler(channel);
    if (!window.isDestroyed()) window.destroy();
  }
}
