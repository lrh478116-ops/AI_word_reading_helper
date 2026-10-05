import { app, BrowserWindow } from 'electron';
import { strict as assert } from 'node:assert';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { isAllowedAppNavigation } from '../electron/navigation-policy.mjs';
async function main() {
const temp = await mkdtemp(path.join(os.tmpdir(), 'aitip-skill-ui-'));
app.setPath('userData', path.join(temp, 'profile')); app.on('window-all-closed', () => {});
Object.assign(process.env, { AI_TIP_EMBEDDED: '1', AI_TIP_DESKTOP: '1', AI_TIP_SUPABASE_ENABLED: '0', AI_TIP_DATA_DIR: path.join(temp, 'data') });
let server, window, failure, model;
try {
  await app.whenReady();
  model = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); const system = body.messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
    const names = system.split('\n').filter(line => line.startsWith('{"id":')).map(JSON.parse).map(s => s.name);
    const content = system.includes('PROFESSIONALISM_CLASSIFIER_V1') ? JSON.stringify({ professional: false, level: 'general', score: 0, domain: 'general', requiresWebReview: false, confidence: 99, reason: 'Controlled reading case.' }) : names.length ? `Active Skills: ${names.join(', ')}` : 'No active Skills.';
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] }));
  });
  await new Promise(r => model.listen(0, '127.0.0.1', r));
  const { startServer } = await import('../dist-electron/server.cjs'); server = await startServer(0);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const register = await fetch(origin + '/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '阅读者', email: 'skill-ui@example.test', password: 'Password12345' }) });
  const { token } = await register.json(); assert.ok(token);
  const api = async (route, body, method = 'GET') => {
    const response = await fetch(origin + '/api' + route, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.ok(response.ok, route + ': ' + response.status); return response.json();
  };
  window = new BrowserWindow({ width: 1280, height: 880, useContentSize: true, show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, offscreen: true } });
  window.webContents.on('console-message', event => { if (event.level === 'error') console.error('[renderer]', event.message); });
  window.removeMenu();
  window.webContents.on('will-navigate', (event, url) => { if (!isAllowedAppNavigation(url, origin)) event.preventDefault(); });
  const js = async source => { try { return await window.webContents.executeJavaScript(source); } catch (error) { console.error('[script]', source.slice(0, 350)); throw error; } };
  await window.loadURL(origin);
  await js(`localStorage.setItem('ai-tip-token', ${JSON.stringify(token)}); localStorage.setItem('ai-tip-language','zh-CN'); localStorage.setItem('ai-tip-privacy-consent-v1','accepted'); true`);
  await window.loadURL(origin);
  await js(`window.skillWait = async (test) => { for(let i=0;i<250;i++) {if(test())return; await new Promise(r=>setTimeout(r,20));} throw Error('UI timeout: '+document.body.innerText.slice(-1000)); }; window.fillSkillField = (selector,value) => { const input=document.querySelector(selector); const setter=Object.getOwnPropertyDescriptor(input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set; setter.call(input,value); input.dispatchEvent(new Event('input',{bubbles:true})); }; true`);
  await js(`(async()=>{await skillWait(()=>document.querySelector('.app-nav')); document.querySelector('.app-nav [data-open-skills]').click(); await skillWait(()=>document.querySelector('[data-skill-manager]'));})()`);
  assert.equal((await api('/skills')).skills.length, 0);
  const importedText = '---\nname: reading-guide\ndescription: 区分证据、假设与结论，帮助深入阅读。\n---\n先解释选中原文，再分别列出依据、假设与可继续追问的问题。';
  await js(`(()=>{const transfer=new DataTransfer(); transfer.items.add(new File([${JSON.stringify(importedText)}], 'SKILL.md',{type:'text/markdown'})); const input=document.querySelector('[data-skill-file]'); input.files=transfer.files; input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await js(`(async()=>{await skillWait(()=>document.querySelector('[data-skill-name]')?.value==='reading-guide');})()`);
  assert.equal((await api('/skills')).skills.length, 0);
  await js(`document.querySelector('[data-skill-save]').click(); true`);
  await js(`(async()=>{await skillWait(()=>document.querySelector('[data-skill-id]')); document.querySelector('[data-skill-toggle]').click(); await skillWait(()=>document.querySelector('[data-skill-toggle]').getAttribute('aria-checked')==='true');})()`);
  let skill = (await api('/skills')).skills[0]; assert.ok(skill.enabled);
  const toggleStyle = await js(`(()=>{const b=document.querySelector('[data-skill-toggle]'); return {checked:b.getAttribute('aria-checked'),background:getComputedStyle(b).backgroundColor,transform:getComputedStyle(b.querySelector('i')).transform};})()`);
  assert.equal(toggleStyle.background, 'rgb(97, 114, 90)', 'Enabled switch must visibly match its state immediately');
  assert.match(toggleStyle.transform, /15, 0\)$/);
  await js(`fillSkillField('[data-skill-instructions]','先解释原文，然后给出一个贴近文档内容的例子。'); true`);
  await js(`window.confirm=()=>false; document.querySelector('[aria-label="关闭 Skill 管理"]').click(); true`);
  assert.ok(await js(`!!document.querySelector('[data-skill-manager]')`), 'Unsaved changes must not be silently lost');
  await js(`window.confirm=()=>true; document.querySelector('[data-skill-save]').click(); true`);
  await js(`(async()=>{await skillWait(()=>document.querySelector('[data-skill-save]').disabled && document.querySelector('[data-skill-notice]')?.textContent.includes('已保存'));})()`);
  assert.match((await api('/skills')).skills[0].instructions, /一个贴近/);
  await js(`document.querySelector('[data-skill-new]').click(); true`);
  await js(`fillSkillField('[data-skill-name]','论文论证检查'); fillSkillField('[data-skill-description]','关注研究问题、实验设计和结论的适用范围。'); fillSkillField('[data-skill-instructions]','阅读论文时，区分实验观察与因果结论，指出作者明示的局限。'); true`);
  await js(`document.querySelector('[data-skill-save]').click(); true`);
  await js(`(async()=>{await skillWait(()=>document.querySelectorAll('[data-skill-id]').length===2);})()`);
  const exportedPath = path.join(temp, 'exported-skill.zip');
  const actualDownload = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Skill export did not download')), 10_000);
    window.webContents.session.once('will-download', (_event, item) => {
      item.setSavePath(exportedPath); item.once('done', (_event, state) => { clearTimeout(timer); state === 'completed' ? resolve() : reject(new Error('Download state: ' + state)); });
    });
  });
  await js(`[...document.querySelectorAll('.skill-detail-actions button')].find(b=>b.textContent.includes('导出 ZIP')).click(); true`);
  await actualDownload;
  const exportedForm = new FormData(); exportedForm.append('file', new Blob([await readFile(exportedPath)]), 'export.zip');
  const exportedPreview = await (await fetch(origin + '/api/skills/preview', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: exportedForm })).json();
  assert.equal(exportedPreview.preview.name, '论文论证检查');
  assert.match(exportedPreview.preview.instructions, /区分实验观察与因果结论/);
  await js(`document.querySelector('[data-skill-id] .skill-card-content').click(); true`);
  const screenshotDir = path.resolve('docs/changes/assets'); await mkdir(screenshotDir, { recursive: true });
  if (process.env.AI_TIP_CAPTURE_SKILL_UI === '1') { await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); await new Promise(r=>setTimeout(r,150)); await writeFile(path.join(screenshotDir, 'skill-manager-zh-CN.png'), (await window.webContents.capturePage()).toPNG()); }
  // A drop inside the manager goes to Skill import, never to the document importer.
  await js(`(()=>{const transfer=new DataTransfer(); transfer.items.add(new File([${JSON.stringify('# 比较研究\n比较共同点、差异和各自边界。')}],'comparison.md',{type:'text/markdown'})); document.querySelector('[data-skill-manager-backdrop]').dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));})()`);
  await js(`(async()=>{await skillWait(()=>document.querySelector('[data-skill-name]')?.value==='comparison');})()`);
  assert.equal(await js(`!!document.querySelector('[data-import-phase]')`), false);
  assert.equal((await api('/documents')).documents.length, 0);
  await js(`document.querySelector('[data-skill-save]').click(); true`);
  await js(`(async()=>{await skillWait(()=>document.querySelectorAll('[data-skill-id]').length===3); fillSkillField('.skills-search input','没有这个名称');})()`);
  await js(`(async()=>{await skillWait(()=>document.querySelectorAll('[data-skill-id]').length===0); fillSkillField('.skills-search input','');})()`);
  await js(`(async()=>{await skillWait(()=>document.querySelectorAll('[data-skill-id]').length===3);})()`);
  await js(`(()=>{const s=document.querySelector('.skills-list select'); s.value='enabled'; s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await js(`(async()=>{await skillWait(()=>document.querySelectorAll('[data-skill-id]').length===1); const s=document.querySelector('.skills-list select'); s.value='all'; s.dispatchEvent(new Event('change',{bubbles:true})); await skillWait(()=>document.querySelectorAll('[data-skill-id]').length===3);})()`);
  const folderFiles = [{ path: 'guided-study/SKILL.md', content: '---\nname: guided-study\ndescription: Follow a reading guide.\n---\nUse [guide](references/guide.md).' }, { path: 'guided-study/references/guide.md', content: 'Separate claims and evidence.' }];
  await js(`(()=>{const transfer=new DataTransfer(); for(const f of ${JSON.stringify(folderFiles)}) {const file=new File([f.content],f.path.split('/').at(-1)); Object.defineProperty(file,'webkitRelativePath',{value:f.path}); transfer.items.add(file);} const input=document.querySelector('[data-skill-folder]'); input.files=transfer.files; input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await js(`(async()=>{await skillWait(()=>document.querySelector('[data-skill-name]')?.value==='guided-study');})()`);
  assert.ok(await js(`!!document.querySelector('.skill-references')`));
  assert.equal((await api('/skills')).skills.length, 3, 'Folder preview must not save');
  const geometry = [];
  for (const [width, height] of [[1280, 880], [900, 700], [560, 760]]) {
    window.setContentSize(width, height); await new Promise(r => setTimeout(r, 150));
    // Windows display scaling may round a DIP viewport by one CSS pixel.
    await js(`skillWait(()=>Math.abs(innerWidth-${width})<=1 && Math.abs(innerHeight-${height})<=1)`);
    const result = await js(`(()=>{const rect=document.querySelector('[data-skill-manager]').getBoundingClientRect(); return {width:innerWidth, right:rect.right, bottom:rect.bottom, height:innerHeight, overflow:document.documentElement.scrollWidth>innerWidth, detailOverflow:document.querySelector('.skill-detail').scrollWidth>document.querySelector('.skill-detail').clientWidth};})()`);
    assert.ok(result.right <= result.width && result.bottom <= result.height && !result.overflow && !result.detailOverflow, JSON.stringify(result)); geometry.push(result);
  }
  await js(`document.querySelector('[aria-label="关闭 Skill 管理"]').click(); true`);
  await js(`(async()=>{await skillWait(()=>!document.querySelector('[data-skill-manager]'));})()`);
  window.setContentSize(1280, 880);
  const { document } = await api('/documents', {}, 'POST');
  const updated = await api(`/documents/${document.id}`, { blocks: document.blocks.map(b => b.type === 'paragraph' ? { ...b, content: '阅读时区分观察和结论。' } : b) }, 'PATCH');
  const source = updated.document.blocks.find(b => b.type === 'paragraph');
  const { tip } = await api(`/documents/${document.id}/tips`, { blockId: source.id, selectedText: source.content, startOffset: 0, endOffset: source.content.length, prefixText: '', suffixText: '' }, 'POST');
  await api('/settings', { provider: 'custom', baseURL: `http://127.0.0.1:${model.address().port}/v1`, apiKey: 'controlled-ui-provider', model: 'fixture-model', pythonEnabled: false, reliabilityEnabled: false, webSearchEnabled: false }, 'PUT');
  await window.loadURL(origin); await js(`localStorage.setItem('ai-tip-language','en'); true`); await window.loadURL(origin);
  await js(`window.skillWait = async test => {for(let i=0;i<250;i++){if(test())return;await new Promise(r=>setTimeout(r,20));}throw Error('UI timeout');}; true`);
  await js(`(async()=>{await skillWait(()=>document.querySelector('.document-card')); document.querySelector('.document-card').click(); await skillWait(()=>document.querySelector('[data-editor-document]')); window.originalEditor=document.querySelector('[data-editor-document]'); document.querySelector('.editor-controls button[title="AI settings"]').click(); await skillWait(()=>document.querySelector('.settings-modal')); document.querySelector('.settings-modal [data-open-skills]').click(); await skillWait(()=>document.querySelector('[data-skill-manager]'));})()`);
  assert.match(await js(`document.querySelector('#skills-title').textContent`), /Manage Skills/);
  if (process.env.AI_TIP_CAPTURE_SKILL_UI === '1') { await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); await new Promise(r=>setTimeout(r,150)); await writeFile(path.join(screenshotDir, 'skill-manager-en.png'), (await window.webContents.capturePage()).toPNG()); }
  await js(`document.querySelector('[data-skill-id] .skill-card-content').click(); true`);
  await js(`window.confirm=()=>true; document.querySelector('[data-skill-delete]').click(); true`);
  await js(`(async()=>{await skillWait(()=>document.querySelectorAll('[data-skill-id]').length===2); document.querySelector('[aria-label="Close Skill manager"]').click();})()`);
  assert.ok(await js(`window.originalEditor===document.querySelector('[data-editor-document]')`), 'Skill manager must not remount or replace the editor');
  assert.equal(await js(`document.querySelector('[data-editor-document]').getAttribute('data-editor-document')`), document.id);
  await js(`document.querySelector('.settings-modal > header .icon-button').click(); document.querySelector('.tip-summary button').click(); true`);
  await js(`(async()=>{await skillWait(()=>document.querySelector('[data-open-skill-picker]')); document.querySelector('[data-open-skill-picker]').click(); await skillWait(()=>document.querySelectorAll('[data-chat-skill-toggle]').length===2);})()`);
  const remaining = (await api('/skills')).skills;
  assert.ok(remaining.every(s => !s.enabled));
  await js(`document.querySelector('[data-chat-skill-toggle]').click(); true`);
  await js(`(async()=>{await skillWait(()=>document.querySelector('[data-chat-skill-toggle]')?.getAttribute('aria-checked')==='true');})()`);
  const chosen = (await api('/skills')).skills[0]; assert.equal(chosen.enabled, true); assert.equal((await api('/skills')).skills[1].enabled, false);
  const pickerGeometry = [];
  for (const [width, height] of [[560, 760], [1280, 880]]) {
    window.setContentSize(width, height); await js(`skillWait(()=>Math.abs(innerWidth-${width})<=1 && Math.abs(innerHeight-${height})<=1)`);
    await js(`(async()=>{if(!document.querySelector('[data-skill-picker]'))document.querySelector('[data-open-skill-picker]').click();await skillWait(()=>document.querySelectorAll('[data-chat-skill-toggle]').length===2);})()`);
    await js(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
    const measured = await js(`(()=>{const r=document.querySelector('[data-skill-picker]').getBoundingClientRect(),b=document.querySelector('[data-open-skill-picker]').getBoundingClientRect(),c=document.querySelector('.tip-composer');return {width:innerWidth,height:innerHeight,left:r.left,right:r.right,top:r.top,bottom:r.bottom,anchorTop:b.top,anchorRight:b.right,composerOverflow:c.scrollWidth>c.clientWidth};})()`);
    assert.ok(measured.left >= 0 && measured.right <= measured.width && measured.top >= 0 && measured.bottom <= measured.height && !measured.composerOverflow, JSON.stringify(measured)); pickerGeometry.push(measured);
    assert.ok(Math.abs(measured.bottom - measured.anchorTop + 8) <= 2 && Math.abs(measured.right - measured.anchorRight) <= 2, 'Picker must stay attached to its actual composer button after resizing');
  }
  await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); true`);
  await js(`skillWait(()=>!document.querySelector('[data-skill-picker]'))`);
  assert.equal(await js(`document.activeElement===document.querySelector('[data-open-skill-picker]')`), true);
  await js(`document.querySelector('[data-open-skill-picker]').click(); true`);
  await js(`skillWait(()=>document.querySelectorAll('[data-chat-skill-toggle]').length===2)`);
  if (process.env.AI_TIP_CAPTURE_SKILL_UI === '1') { await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); await writeFile(path.join(screenshotDir, 'skill-picker-en.png'), (await window.webContents.capturePage()).toPNG()); }
  await js(`(()=>{document.querySelector('[aria-label="Close Skill selector"]').click(); const input=document.querySelector('.tip-composer textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Explain the passage.'); input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await js(`document.querySelector('.send-button').click(); true`);
  await js(`(async()=>{await skillWait(()=>[...document.querySelectorAll('.message.assistant')].some(m=>m.textContent.includes('Active Skills:')));})()`);
  const answered = (await api(`/documents/${document.id}`)).tips.find(t => t.id === tip.id).messages.at(-1);
  assert.match(answered.content, /Active Skills/); assert.equal(answered.skills.find(s => s.name === 'user_skill').userSkill.id, chosen.id);
  await js(`document.querySelector('[data-open-skill-picker]').click(); true`);
  await js(`(async()=>{await skillWait(()=>document.querySelector('[data-picker-manage]')); document.querySelector('[data-picker-manage]').click(); await skillWait(()=>document.querySelectorAll('[data-skill-toggle]').length===2);})()`);
  assert.equal(await js(`document.querySelector('[data-skill-toggle="${chosen.id}"]').getAttribute('aria-checked')`), 'true');
  await js(`document.querySelector('[data-skill-toggle="${chosen.id}"]').click(); true`);
  await js(`(async()=>{await skillWait(()=>document.querySelector('[data-skill-toggle="${chosen.id}"]').getAttribute('aria-checked')==='false'); document.querySelector('[aria-label="Close Skill manager"]').click(); document.querySelector('[data-open-skill-picker]').click(); await skillWait(()=>document.querySelector('[data-chat-skill-toggle="${chosen.id}"]')?.getAttribute('aria-checked')==='false');})()`);
  await js(`(()=>{document.querySelector('[aria-label="Close Skill selector"]').click(); const input=document.querySelector('.tip-composer textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Explain again.'); input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await js(`document.querySelector('.send-button').click(); true`);
  await js(`(async()=>{await skillWait(()=>[...document.querySelectorAll('.message.assistant')].some(m=>m.textContent.includes('No active Skills.')));})()`);
  const unchosen = (await api(`/documents/${document.id}`)).tips.find(t => t.id === tip.id).messages.at(-1); assert.ok(!unchosen.skills.some(s => s.name === 'user_skill'));
  await js(`(()=>{const input=document.querySelector('.tip-composer textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Next question'); input.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('[data-open-skill-picker]').click(); window.originalSkillFetch=window.fetch; window.fetch=async(...args)=>{const url=String(args[0]); if(url.includes('/api/skills/') && args[1]?.method==='PATCH') return new Promise(r=>window.releaseSkillFailure=()=>r(new Response(JSON.stringify({error:'Controlled failure',code:'SKILL_STORAGE'}),{status:500,headers:{'content-type':'application/json'}}))); return window.originalSkillFetch(...args);};})()`);
  await js(`(async()=>{await skillWait(()=>document.querySelector('[data-chat-skill-toggle="${chosen.id}"]')); document.querySelector('[data-chat-skill-toggle="${chosen.id}"]').click(); await skillWait(()=>window.releaseSkillFailure && document.querySelector('.send-button').disabled);})()`);
  assert.equal((await api('/skills')).skills.find(s => s.id === chosen.id).enabled, false);
  await js(`window.releaseSkillFailure(); true`);
  await js(`(async()=>{await skillWait(()=>document.querySelector('.skill-picker-error') && !document.querySelector('.send-button').disabled);})()`);
  assert.equal(await js(`document.querySelector('[data-chat-skill-toggle="${chosen.id}"]').getAttribute('aria-checked')`), 'false');
  await js(`window.fetch=async(...args)=>{const url=String(args[0]); if(url.includes('/api/skills/') && args[1]?.method==='PATCH'){const result=await window.originalSkillFetch(...args);window.failSkillReload=true;return result;} if(url.startsWith('/api/skills?') && window.failSkillReload){window.failSkillReload=false;window.skillReloadFailed=true;return new Response(JSON.stringify({error:'Controlled refresh failure',code:'SKILL_STORAGE'}),{status:500,headers:{'content-type':'application/json'}});}return window.originalSkillFetch(...args);}; document.querySelector('[data-chat-skill-toggle="${chosen.id}"]').click(); true`);
  await js(`(async()=>{await skillWait(()=>window.skillReloadFailed && document.querySelector('.skill-picker-error') && !document.querySelector('.send-button').disabled);})()`);
  assert.equal((await api('/skills')).skills.find(s => s.id === chosen.id).enabled, true);
  assert.equal(await js(`document.querySelector('[data-chat-skill-toggle="${chosen.id}"]').getAttribute('aria-checked')`), 'true', 'Successful PATCH must update the switch even when subsequent metadata refresh fails');
  await js(`window.fetch=window.originalSkillFetch; true`);
  if (process.env.AI_TIP_CAPTURE_SKILL_UI === '1') {
    await js(`document.querySelector('[aria-label="Close Skill selector"]').click(); document.querySelector('.editor-controls button[title="AI settings"]').click(); true`);
    await js(`(async()=>{await skillWait(()=>document.querySelector('.settings-modal .language-select select'));const s=document.querySelector('.settings-modal .language-select select');s.value='zh-CN';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await js(`document.querySelector('.settings-modal > header .icon-button').click(); document.querySelector('[data-open-skill-picker]').click(); true`);
    await js(`(async()=>{await skillWait(()=>document.querySelectorAll('[data-chat-skill-toggle]').length===2);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));})()`);
    await writeFile(path.join(screenshotDir, 'skill-picker-zh-CN.png'), (await window.webContents.capturePage()).toPNG());
  }
  console.log(JSON.stringify({ evidence: 'COMPONENT_CAPABILITY', renderer: 'built-app-in-Electron', backend: 'real-local-API', importPreview: true, folderReferences: true, enabledFilter: true, actualExportDownloadedAndReimported: true, enableEditDelete: true, dirtyCloseBlocked: true, managerDropIsolation: true, bilingual: true, editorPreserved: true, perSkillChatSwitch: true, independentSwitches: true, managerAndPickerSynchronized: true, chosenIdInActualAnswer: chosen.id, disablingRemovesAnswerSkill: true, sendBlockedUntilSwitchSaved: true, failedSaveDoesNotFakeState: true, successfulReplyConsumedDespiteRefreshFailure: true, geometry, pickerGeometry }));
} catch (error) { failure = error; console.error(error); if (window && !window.isDestroyed()) console.error('[viewport]', window.getContentSize(), await window.webContents.executeJavaScript('({w:innerWidth,h:innerHeight,text:document.body.innerText.slice(-1800)})')); }
finally { window?.destroy(); if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); } if (model) { model.closeAllConnections(); await new Promise(r => model.close(r)); } await rm(temp, { recursive: true, force: true }).catch(() => {}); }
app.exit(failure ? 1 : 0);
}
void main().catch(error => { console.error(error); app.exit(1); });
