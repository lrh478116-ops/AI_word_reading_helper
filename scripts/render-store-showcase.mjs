// Code-native caption layout around unmodified real client captures; no generated or retouched UI.
const { chromium } = await import(process.env.AI_TIP_PLAYWRIGHT_MODULE || 'playwright');
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
const metadata=JSON.parse(readFileSync('store-assets/metadata.json','utf8'));
const capture=JSON.parse(readFileSync('store-assets/capture-manifest.json','utf8'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const manifest={schema:1,generatedAt:new Date().toISOString(),platform:capture.platform,sourceCommit:capture.sourceCommit,capturedAt:capture.capturedAt,submissionReady:false,demonstrationResponses:true,sourceHashes:{...capture.sourceHashes,'store-assets/metadata.json':sha(readFileSync('store-assets/metadata.json')),'scripts/render-store-showcase.mjs':sha(readFileSync('scripts/render-store-showcase.mjs'))},artifacts:[]};
const browser = await chromium.launch({headless:true,executablePath:process.env.AI_TIP_BROWSER_EXECUTABLE || undefined});
try {
  const page=await browser.newPage({viewport:{width:2880,height:1800},deviceScaleFactor:1});
  for(const locale of ['zh-CN','en']) for(const [index,item] of metadata.screenshots.entries()) {
    const raw=`store-assets/raw/${locale}/${item.id}.png`,bytes=readFileSync(raw);
    if(capture.artifacts.find(a=>a.file===raw)?.sha256!==sha(bytes))throw new Error('Stale raw capture: '+raw);
    const title=locale==='en'?item.enTitle:item.zhTitle,subtitle=locale==='en'?item.enSubtitle:item.zhSubtitle;
    const draft=locale==='en'?'LAYOUT PREVIEW · MAC RECAPTURE REQUIRED':'构图预览 · 待 Mac 实机复拍';
    const html=`<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><style>
      *{box-sizing:border-box}body{margin:0;width:2880px;height:1800px;overflow:hidden;color:#26392f;background:#eef1e8;font-family:'Segoe UI','Microsoft YaHei',sans-serif}.top{position:absolute;left:160px;right:160px;top:64px;display:flex;justify-content:space-between;align-items:center;font-size:27px;letter-spacing:3px;color:#5b7257}.brand{font-weight:750}.draft{font-size:23px;letter-spacing:1px}h1{position:absolute;left:160px;right:120px;top:104px;font-size:78px;line-height:1.2;margin:0;font-weight:650;letter-spacing:-2px}p{position:absolute;left:160px;top:216px;font-size:32px;line-height:1.5;color:#61705d;margin:0}.frame{position:absolute;left:320px;top:330px;width:2240px;height:1400px;border-radius:20px;box-shadow:0 24px 65px #29392724;overflow:hidden;border:1px solid #c9d0c1;background:#fff}.frame img{display:block;width:100%;height:100%;object-fit:contain}.number{color:#77916c;padding-right:20px}
      </style></head><body><div class="top"><span class="brand">AI TIP / ${locale==='en'?'READ WITH CONTEXT':'围绕原文，深入理解'}</span><span class="draft">${draft}</span></div><h1><span class="number">0${index+1}</span>${esc(title)}</h1><p>${esc(subtitle)}</p><div class="frame"><img alt="Actual app demonstration" src="data:image/png;base64,${bytes.toString('base64')}"></div></body></html>`;
    await page.setContent(html);
    await page.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));
    const overflow=await page.evaluate(()=>document.querySelector('h1').getBoundingClientRect().bottom>document.querySelector('p').getBoundingClientRect().top);if(overflow)throw new Error('Caption overlap');
    const file=`store-assets/showcase/${locale}/${item.id}.png`;mkdirSync(path.dirname(file),{recursive:true});
    const png=await page.screenshot({type:'png'});
    if(png.readUInt32BE(16)!==2880||png.readUInt32BE(20)!==1800)throw new Error('Wrong output size: '+png.readUInt32BE(16)+'x'+png.readUInt32BE(20));
    writeFileSync(file,png);manifest.artifacts.push({file,sha256:sha(png),raw,rawSha256:sha(bytes),locale,id:item.id,width:2880,height:1800,title,subtitle});
  }
  writeFileSync('store-assets/showcase-manifest.json',JSON.stringify(manifest,null,2)+'\n');
  console.log(JSON.stringify({artworks:manifest.artifacts.length,size:'2880x1800',submissionReady:false}));
} finally { await browser.close(); }
