import { app, BrowserWindow } from 'electron';
import { strict as assert } from 'node:assert';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
app.on('window-all-closed', () => {});
void (async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'ai-tip-nav-test-'));
  app.setPath('userData', temp);
  await app.whenReady();
  const css = await readFile('src/styles.css', 'utf8');
  const window = new BrowserWindow({ show: false, width: 1280, height: 800 });
  try {
    await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<style>${css}</style><div class="editor-shell"><aside class="editor-nav"><nav class="outline"><button>测试一个很长的目录标题以确认字号增大后仍可以完整阅读</button></nav></aside><main class="editor-main"></main></div>`));
    const measure = () => window.webContents.executeJavaScript(`({ font: parseFloat(getComputedStyle(document.querySelector('.outline button')).fontSize), nav: document.querySelector('.editor-nav').getBoundingClientRect().width, overflow: document.documentElement.scrollWidth > innerWidth, wrapping: getComputedStyle(document.querySelector('.outline button')).whiteSpace })`);
    const small = await measure();
    window.setSize(1920, 1080);
    await new Promise(r => setTimeout(r, 350));
    const large = await measure();
    assert.ok(large.font > small.font && small.font >= 12, 'Directory font must grow with the viewport');
    assert.ok(large.nav > small.nav);
    assert.equal(large.overflow, false);
    assert.notEqual(large.wrapping, 'nowrap');
    window.setSize(900, 700);
    await new Promise(r => setTimeout(r, 350));
    assert.equal((await measure()).overflow, false);
    console.log(JSON.stringify({ evidence: 'COMPONENT_CAPABILITY', small, large, narrowOverflow: false }));
  } finally { window.destroy(); await rm(temp, { recursive: true, force: true }).catch(() => {}); }
})().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
