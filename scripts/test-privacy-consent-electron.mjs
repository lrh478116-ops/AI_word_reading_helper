import { app, BrowserWindow } from 'electron';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ensurePrivacyConsent, isConsentSender } from '../electron/privacy-consent.mjs';
import { loadPrivacyPolicy } from '../electron/privacy-consent-store.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = mkdtempSync(path.join(tmpdir(), 'ai-tip-privacy-electron-'));
app.setPath('userData', path.join(root, 'profile'));
app.on('window-all-closed', () => {});
const waitReady = window => window.webContents.executeJavaScript(`(async () => {
  for (let i = 0; i < 200 && document.getElementById('consent-checkbox').disabled; i++) await new Promise(r => setTimeout(r, 25));
  if (document.getElementById('consent-checkbox').disabled) throw new Error(document.getElementById('error').textContent || 'Policy loading timed out');
  return { disabled: document.getElementById('accept').disabled, checked: document.getElementById('consent-checkbox').checked, businessBridge: Boolean(window.aiTipDesktop), text: document.getElementById('policy').textContent };
})()`);
const click = (window, id) => window.webContents.executeJavaScript(`document.getElementById(${JSON.stringify(id)}).click()`);
const timeout = setTimeout(() => { console.error('Privacy UI test timed out'); app.exit(1); }, 90000);
void (async () => {
try {
  await app.whenReady();
  const policy = loadPrivacyPolicy(path.join(appRoot, 'website/privacy/index.html'));
  let businessStarts = 0;
  const run = async (name, driver, locale = 'zh-CN') => {
    const dataDir = path.join(root, name);
    const accepted = await ensurePrivacyConsent({ appRoot, dataDir, locale, onReady: async window => {
      const ready = await waitReady(window);
      assert.equal(ready.disabled, true); assert.equal(ready.checked, false); assert.equal(ready.businessBridge, false);
      assert.ok(ready.text.includes('Supabase') && ready.text.includes('AI Tip Privacy Policy'));
      await driver(window, dataDir);
    } });
    if (accepted) businessStarts++;
    return accepted;
  };
  assert.equal(await run('decline', window => click(window, 'reject')), false);
  assert.equal(existsSync(path.join(root, 'decline/privacy-consent.json')), false);
  assert.equal(await run('close', window => window.close()), false);
  assert.equal(businessStarts, 0);
  assert.equal(await run('negative', async window => {
    const invalid = await window.webContents.executeJavaScript(`window.privacyConsent.accept({ checked: false, hash: ${JSON.stringify(policy.hash)} })`);
    assert.equal(invalid.ok, false);
    const stale = await window.webContents.executeJavaScript(`window.privacyConsent.accept({ checked: true, hash: 'outdated' })`);
    assert.equal(stale.ok, false);
    const pageURL = pathToFileURL(path.join(appRoot, 'electron/privacy-consent.html')).href;
    assert.equal(isConsentSender({ sender: {}, senderFrame: window.webContents.mainFrame }, window, pageURL), false);
    assert.equal(isConsentSender({ sender: window.webContents, senderFrame: { url: pageURL } }, window, pageURL), false);
    assert.equal(isConsentSender({ sender: window.webContents, senderFrame: window.webContents.mainFrame }, window, 'https://evil.example'), false);
    await click(window, 'reject');
  }), false);
  assert.equal(await run('write-failure', async (window, dataDir) => {
    writeFileSync(dataDir, 'not a directory');
    await click(window, 'consent-checkbox');
    await click(window, 'accept');
    const message = await window.webContents.executeJavaScript(`(async () => {
      for (let i = 0; i < 100 && !document.getElementById('error').textContent; i++) await new Promise(r => setTimeout(r, 25));
      return document.getElementById('error').textContent;
    })()`);
    assert.match(message, /无法保存同意记录/);
    assert.match(message, /2280810215@qq.com/);
    await click(window, 'reject');
  }), false);
  assert.equal(businessStarts, 0);
  assert.equal(await run('accepted', async window => {
    await window.webContents.executeJavaScript(`document.getElementById('language').value = 'en'; document.getElementById('language').dispatchEvent(new Event('change'))`);
    const english = await window.webContents.executeJavaScript(`({ lang: document.documentElement.lang, title: document.getElementById('title').textContent, zhHidden: getComputedStyle(document.querySelector('[data-lang="zh"]')).display === 'none' })`);
    assert.equal(english.lang, 'en'); assert.equal(english.zhHidden, true); assert.match(english.title, /privacy policy/);
    for (const [width, height] of [[900, 820], [520, 560], [1440, 1000]]) {
      window.setSize(width, height);
      await new Promise(r => setTimeout(r, 100));
      const layout = await window.webContents.executeJavaScript(`({ overflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight, buttonBottom: document.getElementById('accept').getBoundingClientRect().bottom, height: innerHeight, scrollable: document.getElementById('policy').scrollHeight > document.getElementById('policy').clientHeight })`);
      assert.equal(layout.overflow, false, JSON.stringify(layout));
      assert.ok(layout.buttonBottom <= layout.height);
    }
    window.setSize(900, 820);
    await window.webContents.executeJavaScript(`document.getElementById('language').value = 'zh-CN'; document.getElementById('language').dispatchEvent(new Event('change'))`);
    await new Promise(r => setTimeout(r, 150));
    if (process.env.AI_TIP_PRIVACY_SCREENSHOT) writeFileSync(process.env.AI_TIP_PRIVACY_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
    await click(window, 'consent-checkbox');
    await click(window, 'accept');
  }), true);
  assert.equal(businessStarts, 1);
  assert.equal(await ensurePrivacyConsent({ appRoot, dataDir: path.join(root, 'accepted'), onReady: () => { throw new Error('Current consent unnecessarily prompted again'); } }), true);
  const receiptPath = path.join(root, 'accepted/privacy-consent.json');
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  writeFileSync(receiptPath, JSON.stringify({ ...receipt, policyHash: 'old-policy' }));
  assert.equal(await run('accepted', window => click(window, 'reject')), false, 'Changed policy requires fresh consent');
  mkdirSync(path.join(root, 'existing-login'));
  writeFileSync(path.join(root, 'existing-login/remembered-login.json'), '{"token":"old-login"}');
  assert.equal(await run('existing-login', window => click(window, 'reject')), false);
  console.log(JSON.stringify({ evidence: 'COMPONENT_CAPABILITY', realElectronWindow: true, rejectAndCloseBlocked: true, uncheckedAndStaleBlocked: true, forgedSenderBlocked: true, writeFailureVisibleAndBlocked: true, explicitConsentEnablesContinuation: true, restartReceiptConsumed: true, languageAndResponsiveLayout: true }));
} catch (error) { console.error(error); process.exitCode = 1; }
finally {
  clearTimeout(timeout);
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  // Chromium may retain locks on the isolated profile until app.exit on Windows.
  try { rmSync(root, { recursive: true, force: true }); } catch (error) { if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error.code)) throw error; }
  app.exit(process.exitCode || 0);
}
})();
