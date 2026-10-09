import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
const runId=randomUUID(),startedAt=new Date().toISOString();
async function sourceManifest(){
  const files=['package.json','pnpm-lock.yaml','vite.config.ts','tsconfig.app.json','tsconfig.node.json'];
  const walk=async dir=>{for(const entry of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())await walk(file);else if(entry.isFile())files.push(file);}};
  for(const directory of ['src','server','electron','scripts'])await walk(directory);
  return Object.fromEntries(await Promise.all(files.sort().map(async file=>[file.replaceAll('\\','/'),createHash('sha256').update(await readFile(file)).digest('hex')])));
}
const before=await sourceManifest();const results=[];
const tests=[['scripts/test-edition-policy.mjs'],
  ...['local-direct','api-direct','local-mas'].map(variant=>['scripts/build-edition.mjs','--edition',variant.split('-')[0],'--distribution',variant.split('-')[1]]),
  ['scripts/test-editions-integration.mjs'],['scripts/test-editions-integration.mjs','--api'],
  ...['local-direct','local-mas','api-direct'].map(variant=>['node_modules/electron/cli.js','scripts/test-editions-electron.mjs','--variant',variant]),
  ...['local-direct','local-mas','api-direct'].map(variant=>['node_modules/electron/cli.js',`.edition-build/${variant}/electron/main.mjs`,'--startup-test']),
  ['node_modules/electron/cli.js','scripts/test-main-window-menu.mjs']];
for(const args of tests){
  const result=await new Promise(resolve=>{const child=spawn(process.execPath,args,{cwd:process.cwd(),env:process.env,windowsHide:true});let stdout='',stderr='';const timer=setTimeout(()=>child.kill(),120000);child.stdout.on('data',c=>{stdout+=c;process.stdout.write(c);});child.stderr.on('data',c=>{stderr+=c;process.stderr.write(c);});child.on('error',error=>{clearTimeout(timer);resolve({args,exitCode:null,stdout,stderr:String(error)});});child.on('close',exitCode=>{clearTimeout(timer);resolve({args,exitCode,stdout,stderr});});});
  results.push(result);if(result.exitCode!==0)break;
  for(const line of result.stdout.split(/\r?\n/)){try{const {temporaryProfile}=JSON.parse(line);if(temporaryProfile){const resolved=path.resolve(temporaryProfile);if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!path.basename(resolved).startsWith('aitip-edition-ui-'))throw Error('Unexpected temporary profile target');await rm(resolved,{recursive:true,force:true,maxRetries:3,retryDelay:100});}}catch(error){if(error.message==='Unexpected temporary profile target')throw error;}}
}
const after=await sourceManifest();const sourceUnchanged=JSON.stringify(before)===JSON.stringify(after);
const outputs={};for(const variant of ['local-direct','api-direct','local-mas']){
  for(const name of ['package.json','build-policy.json','dist-electron/server.cjs','dist-electron/python-worker.cjs','dist/index.html']){
    const file=`.edition-build/${variant}/${name}`;outputs[file]=createHash('sha256').update(await readFile(file)).digest('hex');
  }
  const assets=await readdir(`.edition-build/${variant}/dist/assets`);for(const name of assets){const file=`.edition-build/${variant}/dist/assets/${name}`;outputs[file]=createHash('sha256').update(await readFile(file)).digest('hex');}
  for(const [source,hash] of Object.entries(after).filter(([file])=>file.startsWith('electron/'))){const file=`.edition-build/${variant}/${source}`;const stagedHash=createHash('sha256').update(await readFile(file)).digest('hex');if(stagedHash!==hash)throw Error(`Stale desktop source in ${variant}: ${source}`);outputs[file]=stagedHash;}
}
const report={runId,startedAt,completedAt:new Date().toISOString(),platform:process.platform,node:process.version,sourceManifest:after,buildManifest:outputs,sourceUnchanged,passed:sourceUnchanged&&results.length===tests.length&&results.every(r=>r.exitCode===0),evidence:'COMPONENT_CAPABILITY',realModelEvaluation:'NOT_CAUSALLY_VERIFIED',macOSRuntime:'NOT_CAUSALLY_VERIFIED',publishedDownload:'NOT_VERIFIED',results};
await mkdir('docs/changes/verification',{recursive:true});await writeFile('docs/changes/verification/editions-latest.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({runId,passed:report.passed,sourceUnchanged,report:'docs/changes/verification/editions-latest.json'}));if(!report.passed)process.exitCode=1;
