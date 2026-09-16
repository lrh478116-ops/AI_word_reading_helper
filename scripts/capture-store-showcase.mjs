// Real client and API, isolated data, authored demonstration responses. NOT a model evaluation or Mac submission capture.
import { app, BrowserWindow } from 'electron';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root = process.cwd();
const temp = mkdtempSync(path.join(tmpdir(), 'ai-tip-store-capture-'));
app.setPath('userData', path.join(temp, 'profile'));
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.on('window-all-closed', () => {});
Object.assign(process.env, { AI_TIP_EMBEDDED: '1', AI_TIP_DESKTOP: '1', AI_TIP_SUPABASE_ENABLED: '0', AI_TIP_DATA_DIR: path.join(temp, 'data'), AI_TIP_DIST_DIR: path.join(root, 'dist') });
let reply = '', server, model, window;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = { schema: 1, platform: process.platform, capturedAt: new Date().toISOString(), sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim(), submissionReady: false, demonstrationResponses: true, sourceHashes: {}, artifacts: [] };
for (const file of ['dist-electron/server.cjs', 'dist/index.html', 'src/App.tsx', 'scripts/capture-store-showcase.mjs']) manifest.sourceHashes[file] = sha(readFileSync(file));
const helpers = `
window.until = async (fn, label) => { for(let i=0;i<400;i++){ const value=fn(); if(value)return value; await new Promise(r=>setTimeout(r,50)); } throw new Error('Timed out: '+label); };
window.chooseText = (element,start,length) => { const w=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);let pos=0,a,b,ao,bo;while(w.nextNode()){const n=w.currentNode,next=pos+n.data.length;if(!a&&start<next){a=n;ao=start-pos;}if(a&&start+length<=next){b=n;bo=start+length-pos;break;}pos=next;}if(!a||!b)throw new Error('Selection unavailable');const range=document.createRange();range.setStart(a,ao);range.setEnd(b,bo);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);element.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));}; true;`;
const js = async code => { try { return await window.webContents.executeJavaScript(code); } catch(error) { throw new Error(`Capture step: ${code.slice(0,250)}; ${error.message}`); } };
const wait = selector => js(`until(()=>document.querySelector(${JSON.stringify(selector)}),${JSON.stringify(selector)}).then(()=>true)`);
const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
const pause = ms => new Promise(r => setTimeout(r,ms));
async function capture(locale,id) {
  await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  await pause(800);
  const visible = await js('document.body.innerText');
  if (/SMOKE|SMOK\b|fixture|desktop-smoke-secret/.test(visible)) throw new Error('Test text leaked into screenshot');
  const file = `store-assets/raw/${locale}/${id}.png`;
  mkdirSync(path.dirname(file),{recursive:true});
  const png=(await window.webContents.capturePage()).toPNG();writeFileSync(file,png);
  manifest.artifacts.push({file,sha256:sha(png),locale,width:1440,height:900,id,visibleTextHash:sha(visible)});
}
void (async()=>{
  await app.whenReady();
  model=createServer(async(req,res)=>{
    if(req.url==='/v1/models'){res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{id:'reading-demonstration'}]}));return;}
    let raw='';for await(const b of req)raw+=b;const body=JSON.parse(raw||'{}');
    const content=body.stream?reply:JSON.stringify({professional:false,level:'general',domain:'general',confidence:95,requiresWebReview:false,reason:'Authored reading demonstration',required:false,queryZh:'',queryEn:''});
    if(body.stream){res.setHeader('content-type','text/event-stream');res.end('data: '+JSON.stringify({choices:[{index:0,delta:{content},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');}
    else{res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{role:'assistant',content},finish_reason:'stop'}]}));}
  });
  await new Promise(r=>model.listen(0,'127.0.0.1',r));
  const runtime=await import('../dist-electron/server.cjs');server=await runtime.startServer(0);
  const origin=`http://127.0.0.1:${server.address().port}`;let token;
  async function api(url,body,method='POST') { const res=await fetch(origin+'/api'+url,{method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});if(!res.ok)throw new Error(url+': '+await res.text());return res.json(); }
  token=(await api('/auth/login',{email:'demo@aitip.local',password:'demo1234'})).token;
  await api('/settings',{provider:'custom',model:'reading-demonstration',baseURL:`http://127.0.0.1:${model.address().port}/v1`,apiKey:'demonstration-only',webSearchEnabled:false,pythonEnabled:false,reliabilityEnabled:false},'PUT');
  window=new BrowserWindow({width:1440,height:900,useContentSize:true,show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
  const open = async(locale, title) => {
    await window.loadURL(origin);await js(`localStorage.setItem('ai-tip-token',${JSON.stringify(token)});localStorage.setItem('ai-tip-language',${JSON.stringify(locale)});true`);await window.loadURL(origin);await js(helpers);await wait('.document-card');
    await js(`until(()=>[...document.querySelectorAll('.document-card')].find(e=>e.innerText.includes(${JSON.stringify(title)})),'document card').then(e=>e.click())`);await wait('[data-block-id]');
  };
  for(const locale of ['zh-CN','en']) {
    const zh=locale==='zh-CN', title=zh?'研究阅读示例':'Study reading notes';
    // Show the working editable-document anchor route. PDF resize-anchor failures remain explicitly documented, not retouched or concealed.
    const sample=zh?'# 怎样理解一项研究\n\n原创阅读示例 · 非真实研究结论\n\n## 从结果追问条件\n\n看到更高的分数，并不等于证明方法一定更好。\n\n阅读时需要区分观测结果、实验条件与解释。把不理解的概念标出来，再沿着证据继续追问。\n\n## 把问题拆成可以核对的部分\n\n观察：作者实际报告了什么？\n\n条件：数据、对照与评价方法是否可比？\n\n不确定性：结果在重复实验中是否稳定？\n\n边界：结论可以适用于什么情形？\n\n## 留下可以回访的理解路径\n\n原文疑问 → 概念解释 → 条件与边界':'# Understanding a study\n\nOriginal reading example - not empirical findings\n\n## Read beyond the headline result\n\nA higher score alone does not prove a better method.\n\nSeparate the observation, the conditions and the explanation. Mark an unfamiliar idea, then follow the evidence behind it.\n\n## Questions you can check\n\nObservation: what was actually reported?\n\nConditions: are the data and comparisons appropriate?\n\nUncertainty: is the result stable across repeated runs?\n\nScope: where would the conclusion apply?\n\n## Keep a route back\n\nSource question → Explanation → Conditions and limits';
    const pdf=Buffer.from(sample,'utf8');
    await window.loadURL(origin);await js(`localStorage.setItem('ai-tip-token',${JSON.stringify(token)});localStorage.setItem('ai-tip-language',${JSON.stringify(locale)});true`);await window.loadURL(origin);await js(helpers);await wait('[data-global-document-input]');
    await js(`(()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(pdf.toString('base64'))}),c=>c.charCodeAt(0));const t=new DataTransfer();t.items.add(new File([bytes],${JSON.stringify(title+'.md')},{type:'text/markdown'}));const i=document.querySelector('[data-global-document-input]');i.files=t.files;i.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await wait('[data-block-id]');
    await js('document.fonts.ready.then(()=>true)');await pause(1500);
    const phrase=zh?'看到更高的分数':'A higher score';
    await js(`(async()=>{const el=await until(()=>[...document.querySelectorAll('[data-block-id]')].find(e=>e.textContent.includes(${JSON.stringify(phrase)})),'source phrase');el.scrollIntoView({block:'center'});chooseText(el,el.textContent.indexOf(${JSON.stringify(phrase)}),${phrase.length});await until(()=>document.querySelector('.selection-toolbar button'),'Tip option');document.querySelector('.selection-toolbar button').click();})()`);
    await wait('[data-tip-panel]');
    const ids=await js(`({tip:document.querySelector('[data-tip-panel]').dataset.tipPanel,doc:document.querySelector('[data-editor-document]').dataset.editorDocument})`);
    const rootTitle=zh?'更高的分数，说明了什么？':'What does a higher score tell us?';
    const childTitle=zh?'怎样理解不确定性？':'What does uncertainty mean?';
    const grandTitle=zh?'为什么需要重复实验？':'Why repeat the experiment?';
    const responses=zh?[
      '这句话提醒我们：先区分“观察到的结果”和“能够支持的结论”。\n\n更高的分数是一项观察，还需要看数据是否可比、评价方式是否一致，以及结果的不确定性。\n\n可以沿着原文继续问：\n1. 作者实际比较了什么？\n2. 结果在不同条件下是否稳定？\n3. 结论的适用范围是什么？\n\n这是阅读示例中的解释，不是对某项真实研究的评判。',
      '不确定性可以理解为：当前结果还有多大的波动或未知空间。\n\n在这个阅读示例中，可以关注样本差异、测量误差与实验设置。重复实验有助于观察结果是否稳定，但不能自动排除所有系统性偏差。\n\n回到论文时，要核对作者实际采用的统计方法和实验条件。',
      '重复实验让我们观察同一流程下结果的变化。\n\n阅读时可以检查：重复次数、随机因素、是否独立，以及汇总结果的方式。仅仅重复同一种有偏设计，并不会消除这种偏差。\n\n这个分支对应原文中“结果是否稳定”的问题。'
    ]:[
      'Separate the observation from the conclusion it can support.\n\nA higher score is an observation. We still need to examine comparable data, consistent evaluation and uncertainty.\n\nUseful follow-up questions:\n1. What was actually compared?\n2. Is the result stable under different conditions?\n3. Where would the conclusion apply?\n\nThis is an explanation of the reading example, not a verdict on a real study.',
      'Uncertainty describes the variation or missing information around a result.\n\nIn this example, consider differences in samples, measurement and experimental conditions. Repeated experiments can reveal variability, but do not automatically remove systematic bias.\n\nReturn to the paper to check the actual statistical method and conditions.',
      'Repeated experiments help us observe how a result varies.\n\nCheck the number of runs, random factors, independence and how the results were summarized. Repeating the same biased design does not remove its bias.\n\nThis branch leads back to the source question about stability.'
    ];
    async function answer(id,q,content){reply=content;const r=await fetch(origin+'/api/tips/'+id+'/chat',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify({question:q,language:locale})});const events=(await r.text()).trim().split('\n').map(JSON.parse);const done=events.find(e=>e.type==='done');if(!done)throw new Error(JSON.stringify(events));return done.tip;}
    await api('/tips/'+ids.tip,{title:rootTitle},'PATCH');const rootTip=await answer(ids.tip,rootTitle,responses[0]);
    const makeChild=async(parent,phrase,title,content)=>{const message=parent.messages.filter(m=>m.role==='assistant').at(-1),start=message.content.indexOf(phrase);if(start<0)throw new Error('Missing child anchor');const child=(await api('/tips/'+parent.id+'/children',{messageId:message.id,selectedText:phrase,startOffset:start,endOffset:start+phrase.length,prefixText:message.content.slice(Math.max(0,start-32),start),suffixText:message.content.slice(start+phrase.length,start+phrase.length+32)})).tip;await api('/tips/'+child.id,{title},'PATCH');return answer(child.id,title,content);};
    const child=await makeChild(rootTip,zh?'不确定性':'uncertainty',childTitle,responses[1]);
    const grand=await makeChild(child,zh?'重复实验':'Repeated experiments',grandTitle,responses[2]);
    const savedTitle=(await api('/documents/'+ids.doc,undefined,'GET')).document.title;
    await open(locale,savedTitle);await click('.tip-marker');await wait('.message.assistant');await pause(1000);await capture(locale,'01-source');
    await click('.tip-tree-button');await wait('.tip-tree-dialog');await click(`[data-tip-tree-id="${child.id}"] .tip-tree-locate`);await wait('.tip-panel-context');await js(`document.querySelector('.tip-tree-dialog header .icon-button')?.click();true`);await js(`until(()=>!document.querySelector('.tip-tree-dialog'),'tree closed').then(()=>true)`);await capture(locale,'02-follow-up');
    await click('.tip-tree-button');await wait('.tip-tree-dialog');await click(`[data-tip-tree-id="${grand.id}"] .tip-tree-locate`);await click('.tip-tree-button');await wait('.tip-tree-dialog');await capture(locale,'03-tree');
    await click('.tip-tree-dialog header .icon-button');
    // Return to the library and open the actual model catalogue; do not fake an installed runtime.
    await window.loadURL(origin);await js(helpers);await wait('.app-nav');
    await js(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>/^(设置|Settings)$/.test(e.innerText.trim()));if(!b)throw new Error('Settings button missing');b.click();})()`);await wait('.model-refresh-row');
    await js(`document.querySelectorAll('.model-refresh-row button')[1].click()`);await wait('[data-local-models-screen]');await wait('.local-model-row');await capture(locale,'04-models');
  }
  writeFileSync('store-assets/capture-manifest.json',JSON.stringify(manifest,null,2)+'\n');
  console.log(JSON.stringify({realClientCapture:true,images:manifest.artifacts.length,platform:process.platform,submissionReady:false,demonstrationResponses:true}));
})().then(()=>app.exit(0),error=>{console.error(error);app.exit(1);}).finally(()=>{
  window?.destroy();server?.close();model?.close();try{rmSync(temp,{recursive:true,force:true});}catch{}
});
