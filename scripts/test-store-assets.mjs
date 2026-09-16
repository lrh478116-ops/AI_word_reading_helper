import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { validateCapture } from './store-metadata-validation.mjs';
const manifest=JSON.parse(readFileSync('store-assets/showcase-manifest.json','utf8'));
const metadata=JSON.parse(readFileSync('store-assets/metadata.json','utf8'));
assert.deepEqual(validateCapture(manifest,process.argv.includes('--submission')),[]);
const sha=b=>createHash('sha256').update(b).digest('hex');
for(const [file,hash] of Object.entries(manifest.sourceHashes))assert.equal(sha(readFileSync(file)),hash,'Stale source: '+file);
assert.equal(manifest.artifacts.length,8);
for(const locale of ['zh-CN','en'])for(const card of metadata.screenshots){
  const a=manifest.artifacts.find(a=>a.locale===locale&&a.id===card.id);assert.ok(a,'Missing localized image');
  const bytes=readFileSync(a.file);assert.equal(sha(bytes),a.sha256);assert.equal(sha(readFileSync(a.raw)),a.rawSha256);
  assert.equal(bytes.subarray(1,4).toString(),'PNG');assert.equal(bytes.readUInt32BE(16),2880);assert.equal(bytes.readUInt32BE(20),1800);
  assert.equal(a.title,locale==='en'?card.enTitle:card.zhTitle,'Stale caption');assert.equal(a.subtitle,locale==='en'?card.enSubtitle:card.zhSubtitle);
}
console.log(JSON.stringify({evidence:'COMPONENT_CAPABILITY',localizedDraftImages:8,sourceHashesVerified:true,platform:manifest.platform,macSubmission:process.argv.includes('--submission')}));
