import { strict as assert } from 'node:assert';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, readdir, writeFile, copyFile, rm } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';import os from 'node:os';
import { getWindowsAuthenticodeStatus } from './windows-authenticode.mjs';

assert.equal(process.platform,'win32','Installer verification needs a Windows host');
const root=process.cwd(),require=createRequire(import.meta.url);
const builderRequire=createRequire(require.resolve('electron-builder'));
const asar=createRequire(builderRequire.resolve('app-builder-lib'))('@electron/asar');
const sourcePackage=JSON.parse(await readFile('package.json','utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceFiles=['package.json','pnpm-lock.yaml','vite.config.ts'];
const walk=async(dir,files)=>{for(const entry of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())await walk(file,files);else if(entry.isFile())files.push(file);}};
for(const dir of ['src','server','electron','scripts'])await walk(dir,sourceFiles);
const sourceManifest=Object.fromEntries(await Promise.all(sourceFiles.sort().map(async file=>[file.replaceAll('\\','/'),hash(await readFile(file))])));
const report={runId:randomUUID(),startedAt:new Date().toISOString(),version:sourcePackage.version,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceDirty:Boolean(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim()),sourceManifest,evidence:'COMPONENT_CAPABILITY',macOS:'NOT_CAUSALLY_VERIFIED',publicRelease:false,installers:[]};
for(const edition of ['api','local']){
  const stage=path.join(root,'.edition-build',`${edition}-direct`),out=path.join(root,'release',`${edition}-direct`);
  const archive=path.join(out,'win-unpacked/resources/app.asar');
  const metadata=JSON.parse(asar.extractFile(archive,'package.json'));
  const staged=JSON.parse(await readFile(path.join(stage,'package.json'),'utf8'));
  assert.equal(metadata.version,sourcePackage.version,'Old installer cannot count as updated');
  assert.equal(metadata.aiTipBuildPolicy.edition,edition);
  assert.equal(metadata.aiTipBuildPolicy.cloudModels,edition==='api');
  assert.equal(metadata.aiTipBuildPolicy.tavily,edition==='api');
  assert.equal(staged.build.appId,edition==='local'?`${sourcePackage.build.appId}.local`:sourcePackage.build.appId);
  for(const key of ['name','version','main','productName','dependencies','aiTipBuildPolicy'])assert.deepEqual(metadata[key],staged[key],`Stale packaged metadata: ${key}`);
  const files=['dist-electron/server.cjs','dist-electron/python-worker.cjs'];
  for(const dir of ['electron','dist','website/privacy']){const paths=[];await walk(path.join(stage,dir),paths);files.push(...paths.map(file=>path.relative(stage,file)));}
  for(const file of files)assert.ok(asar.extractFile(archive,path.normalize(file)).equals(await readFile(path.join(stage,file))),`Stale packaged file: ${file}`);
  for(const [file,digest] of Object.entries(sourceManifest).filter(([file])=>file.startsWith('electron/')))assert.equal(hash(asar.extractFile(archive,path.normalize(file))),digest,`Packaged desktop source is stale: ${file}`);
  const executable=path.join(out,'win-unpacked',`${metadata.productName}.exe`);
  const result=await new Promise(resolve=>{
    const child=spawn(executable,['--startup-test'],{cwd:path.dirname(executable),windowsHide:true});let stdout='',stderr='';
    const timer=setTimeout(()=>child.kill(),60000);
    child.stdout.on('data',c=>{stdout+=c;process.stdout.write(c);});child.stderr.on('data',c=>{stderr+=c;process.stderr.write(c);});
    child.on('error',error=>{clearTimeout(timer);resolve({exitCode:null,stdout,stderr:String(error)});});
    child.on('close',exitCode=>{clearTimeout(timer);resolve({exitCode,stdout,stderr});});
  });
  assert.equal(result.exitCode,0,JSON.stringify(result));
  const actual=result.stdout.split(/\r?\n/).flatMap(line=>{try{return[JSON.parse(line)];}catch{return[];}}).find(item=>item.actualDesktopEntrypoint);
  assert.ok(actual?.nativePrivacyAccepted&&actual?.actualMainMenuRestored,'Actual startup result is required, not just exit 0');
  assert.deepEqual(actual.policy,metadata.aiTipBuildPolicy);assert.equal(actual.providers.length,edition==='local'?2:9);
  if(actual.temporaryProfile){const target=path.resolve(actual.temporaryProfile);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert.ok(path.basename(target).startsWith('aitip-edition-ui-startup-'));await rm(target,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
  const installer=path.join(out,edition==='local'?'AI-Tip-Local-Setup.exe':'AI-Tip-API-Setup.exe');
  const bytes=await readFile(installer);assert.equal(bytes.subarray(0,2).toString(),'MZ');
  const label=edition==='local'?'Local':'API';
  const destination=path.join(root,'release',`AI Tip ${label} Setup ${sourcePackage.version}.exe`);
  await copyFile(installer,destination);assert.equal(hash(await readFile(destination)),hash(bytes));
  report.installers.push({edition,path:path.relative(root,destination).replaceAll('\\','/'),bytes:bytes.length,sha256:hash(bytes),signature:getWindowsAuthenticodeStatus(installer),packagedFilesCompared:files.length,policy:actual.policy,startup:result,executableSha256:hash(await readFile(executable)),asarSha256:hash(await readFile(archive))});
}
for(const [file,digest] of Object.entries(sourceManifest))assert.equal(hash(await readFile(file)),digest,'Source changed during package verification');
report.completedAt=new Date().toISOString();report.passed=true;
await writeFile('release/latest-installers.json',JSON.stringify(report,null,2)+'\n');
await writeFile('release/LATEST-INSTALLERS.md',`# Latest Windows Installers ${report.version}\n\n${report.installers.map(item=>`- ${item.edition==='local'?'Local Model Edition':'API Edition'}: ${path.basename(item.path)}\n  SHA-256: ${item.sha256}`).join('\n')}\n\nThese candidate installers are not publicly released. See latest-installers.json for signature status. Historical installers for 1.12.16 and earlier are retained and are not the current version.\n`);
console.log(JSON.stringify({runId:report.runId,passed:true,version:report.version,files:report.installers.map(x=>x.path),report:'release/latest-installers.json'}));
