import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
const edition=process.argv.includes('--api')?'api':'local';
const serverArg=process.argv.indexOf('--server');
const bundle=path.resolve(serverArg>=0?process.argv[serverArg+1]:`.edition-build/${edition}-direct/dist-electron/server.cjs`);
const temp=await mkdtemp(path.join(os.tmpdir(),'aitip-edition-'));
Object.assign(process.env,{AI_TIP_EMBEDDED:'1',AI_TIP_SUPABASE_ENABLED:'0',AI_TIP_DATA_DIR:temp,OPENAI_API_KEY:'unusable-environment-key',AI_TIP_EDITION:'api'});
let model,server;let searches=0,tavily=0,modelCalls=[],redirect=false,failSearch=false;
try{
  model=createServer(async(req,res)=>{
    res.setHeader('content-type','application/json');
    if(req.url==='/api/tags')return res.end(JSON.stringify({models:[{name:'fixture-model'}]}));
    if(req.url==='/api/version')return res.end(JSON.stringify({version:'controlled'}));
    if(req.url==='/v1/models')return res.end(JSON.stringify({data:[{id:'fixture-model'},{id:'aitip:local-gguf'}]}));
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw||'{}');modelCalls.push({path:req.url,body});
    if(redirect){res.writeHead(307,{location:'https://api.deepseek.com/v1/chat/completions'});return res.end();}
    const system=body.messages?.filter(m=>m.role==='system').map(m=>m.content).join('\n')||'';
    const all=JSON.stringify(body.messages);
    const content=system.includes('PROFESSIONALISM_CLASSIFIER_V1')||system.includes('问题专业程度分类器')?JSON.stringify({professional:false,level:'general',score:0,domain:'general',requiresWebReview:false,confidence:99,reason:'Controlled document task'})
      :system.includes('WEB_SEARCH_DECISION_V1')?JSON.stringify({required:true,confidence:99,reason:'Check external evidence',queryZh:failSearch?'未匹配的独立参考主题':'本地参考事实',queryEn:failSearch?'new unmatched reference topic':'local reference fact'})
      :system.includes('引用审查')||system.includes('citation auditor')?'SUPPORTED'
      :`LOCAL_DOCUMENT_ANSWER${all.includes('BLUE-LANTERN')?' BLUE-LANTERN':''}${all.includes('REFERENCE_EVIDENCE')?' REFERENCE_EVIDENCE [S1]':''}`;
    res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{role:'assistant',content},finish_reason:'stop'}]}));
  });await new Promise(r=>model.listen(0,'127.0.0.1',r));
  const origin=`http://127.0.0.1:${model.address().port}`;
  process.env.AI_TIP_REFERENCE_SEARCH_BASE_URL=origin+'/reference';process.env.AI_TIP_ALLOW_INSECURE_REFERENCE_SEARCH='1';
  const module=await import(pathToFileURL(bundle));
  module.configureExternalNetworkFetch(async(input)=>{
    const url=String(input);if(url.includes('tavily'))tavily++;else searches++;
    if(failSearch)return new Response('unavailable',{status:503});
    if(url.includes('tavily'))return Response.json({results:[{title:'Evidence',url:'https://en.wikipedia.org/wiki/Transformer',content:'REFERENCE_EVIDENCE: transformers use attention.'}],usage:{credits:1}});
    if(url.includes('/reference/'))return Response.json({items:[{title:'Reference evidence',url:'https://en.wikipedia.org/wiki/Transformer',content:`${new URL(url).searchParams.get('q')} REFERENCE_EVIDENCE: transformers use attention.`}]});
    return new Response('<title>Reference</title><article>REFERENCE_EVIDENCE: transformers use attention.</article>',{headers:{'content-type':'text/html'}});
  });
  let runtimeOrigin=origin;
  module.configureLocalModelRuntime({info:()=>({reachable:true,origin:runtimeOrigin,version:'controlled',runtime:'llama.cpp',installedModels:['fixture-model','aitip:local-gguf'],modelId:'fixture-model',storagePath:temp,storagePathSource:'user-selected',totalRamBytes:16e9})});
  server=await module.startServer(0);const api=`http://127.0.0.1:${server.address().port}/api`;
  let token;
  const request=async(route,body,method='GET')=>{const response=await fetch(api+route,{method,headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});return{status:response.status,body:await response.json()};};
  token=(await request('/auth/register',{name:'Edition reader',email:'edition@example.test',password:'Password12345'},'POST')).body.token;assert.ok(token);
  if(edition==='local'){
    // This assertion fails on the pre-split bundle: remote settings are accepted (200).
    for(const route of ['/settings','/settings/test','/settings/models']){
      const count=modelCalls.length;
      const invalid=await request(route,{provider:'deepseek',baseURL:'https://api.deepseek.com',model:'deepseek-chat',apiKey:'controlled-key',searchApiKey:'controlled-search'},route==='/settings'?'PUT':'POST');
      assert.ok([400,502].includes(invalid.status),route+': '+JSON.stringify(invalid));assert.equal(modelCalls.length,count);assert.match(invalid.body.error,/本地模型版/);
    }
    for(const body of [{provider:'ollama',baseURL:'https://example.com/v1',model:'fixture-model'},{provider:'ollama',baseURL:'http://127.0.0.1.evil.test/v1',model:'fixture-model'},{apiKey:'stale'},{searchApiKey:'stale'}])assert.equal((await request('/settings',body,'PUT')).status,400);
    const defaults=(await request('/settings')).body.settings;assert.equal(defaults.provider,'local');assert.equal(defaults.apiKeyConfigured,false);assert.equal(defaults.searchApiKeyConfigured,false);
  }
  const policy=(await request('/edition')).body.policy;assert.equal(policy.edition,edition);
  const settings={provider:edition==='local'?'local':'custom',baseURL:origin+'/v1',model:'fixture-model',systemPrompt:'Explain given text',webSearchEnabled:false,pythonEnabled:false,reliabilityEnabled:false,...(edition==='api'?{apiKey:'controlled-key'}:{})};
  assert.equal((await request('/settings',settings,'PUT')).status,200);
  const listed=await request('/settings/models',settings,'POST');assert.equal(listed.status,200,JSON.stringify(listed));
  const form=new FormData();form.append('file',new Blob(['# Passage\nDocument evidence about attention mechanisms.']),'reading.md');
  const imported=await fetch(api+'/documents/import',{method:'POST',headers:{authorization:`Bearer ${token}`},body:form});assert.equal(imported.status,201);const {document}=await imported.json();
  const block=document.blocks.find(b=>b.type==='paragraph');
  const {tip}=(await request(`/documents/${document.id}/tips`,{blockId:block.id,selectedText:block.content,startOffset:0,endOffset:block.content.length},'POST')).body;
  const chat=async()=>{const response=await fetch(api+`/tips/${tip.id}/chat`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({question:'Explain this passage',language:'en'})});const text=await response.text();const events=text.trim().split('\n').map(JSON.parse);return{status:response.status,events,text};};
  let result=await chat();assert.ok(result.events.some(e=>e.type==='done'),result.text);assert.equal(searches,0);assert.equal(tavily,0);
  const raw='# Instructions\nUse BLUE-LANTERN when explaining.';const upload=new FormData();upload.append('file',new Blob([raw]),'reading.md');
  const previewResponse=await fetch(api+'/skills/preview',{method:'POST',headers:{authorization:`Bearer ${token}`},body:upload});assert.ok(previewResponse.ok);const {preview}=await previewResponse.json();
  let skill=(await request('/skills',preview,'POST')).body.skill;skill=(await request(`/skills/${skill.id}`,{signature:skill.signature,enabled:true},'PATCH')).body.skill;
  result=await chat();assert.match(result.text,/BLUE-LANTERN/);assert.ok(modelCalls.at(-1).body.messages.some(m=>String(m.content).includes('BLUE-LANTERN')));assert.match(result.text,new RegExp(skill.id));
  skill=(await request(`/skills/${skill.id}`,{signature:skill.signature,enabled:false},'PATCH')).body.skill;
  result=await chat();assert.ok(result.events.some(e=>e.type==='done'));assert.ok(!modelCalls.at(-1).body.messages[0].content.includes('Use BLUE-LANTERN'));
  await request('/settings',{...settings,webSearchEnabled:true,...(edition==='api'?{searchApiKey:'controlled-tavily'}:{})},'PUT');
  result=await chat();assert.ok(result.events.some(e=>e.type==='done'),result.text);assert.match(result.text,/REFERENCE_EVIDENCE/);
  if(edition==='local'){assert.equal(tavily,0);assert.ok(searches>0);assert.doesNotMatch(result.events.find(e=>e.type==='done').tip.messages.at(-1).content,/Add.*Tavily|录入.*Tavily/);}else assert.ok(tavily>0);
  failSearch=true;result=await chat();assert.ok(result.events.some(e=>e.type==='done'),result.text);assert.match(result.events.find(e=>e.type==='done').tip.messages.at(-1).content,/LOCAL_DOCUMENT_ANSWER/);
  assert.ok(result.events.some(e=>e.type==='skill'&&e.skill.name==='web_search'&&e.skill.status==='warning'));failSearch=false;
  await request('/settings',{...settings,webSearchEnabled:false},'PUT');const beforeSearches=searches,beforeTavily=tavily;result=await chat();assert.ok(result.events.some(e=>e.type==='done'));assert.equal(searches,beforeSearches);assert.equal(tavily,beforeTavily);
  if(edition==='local'){
    const before=modelCalls.length;
    runtimeOrigin='https://api.deepseek.com';const status=(await request('/ai/status')).body.status;assert.equal(status.configured,false);assert.equal(modelCalls.length,before);
    runtimeOrigin=origin;redirect=true;result=await chat();assert.ok(result.events.some(e=>e.type==='error'));assert.ok(!result.events.some(e=>e.type==='done'));redirect=false;
    const store=JSON.parse(await readFile(path.join(temp,'store.json'),'utf8'));store.settings[0]={...store.settings[0],provider:'deepseek',baseURL:'https://api.deepseek.com',apiKey:'safe:v1:unreadable-old-key',searchApiKey:'old-tavily'};await writeFile(path.join(temp,'store.json'),JSON.stringify(store));
    const migrated=(await request('/settings')).body.settings;assert.equal(migrated.provider,'local');assert.equal(migrated.apiKeyConfigured,false);assert.equal(migrated.searchApiKeyConfigured,false);
    const callsBeforeStale=modelCalls.length;const staleChat=await chat();assert.equal(staleChat.status,409,'Old cloud settings must not silently switch to a default local model');assert.match(staleChat.text,/EDITION_SETTINGS_RESTRICTED/);assert.equal(modelCalls.length,callsBeforeStale);
    assert.equal((await request('/settings',{webSearchEnabled:false},'PUT')).status,400,'An unrelated search toggle must not confirm a replacement model');
    assert.equal((await request('/settings',{...settings,confirmLocalConfiguration:true},'PUT')).status,200);
    module.configureLocalModelRuntime(null);const rejected=await chat();assert.equal(rejected.status,409);assert.match(rejected.text,/LOCAL_RUNTIME_UNAVAILABLE/);assert.equal(tavily,0);
  }
  const report={edition,policy,cloudBypassBlocked:edition==='local',environmentCannotUnlock:edition==='local',referenceOrTavilyConsumed:true,searchFailureStillAnswered:true,disabledSearchZeroRequests:true,skillsConsumed:true,redirectRejected:edition==='local',modelRequestLineage:modelCalls,evidence:'COMPONENT_CAPABILITY',macOS:'NOT_CAUSALLY_VERIFIED'};
  await writeFile(path.join(path.dirname(bundle),'edition-integration-report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({...report,modelRequestLineage:undefined,actualModelRequests:modelCalls.length}));
}finally{model?.closeAllConnections();server?.closeAllConnections();await Promise.all([model?new Promise(r=>model.close(r)):undefined,server?new Promise(r=>server.close(r)):undefined]);await rm(temp,{recursive:true,force:true});}
