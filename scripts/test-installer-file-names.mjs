import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const report=JSON.parse(readFileSync('release/latest-installers.json','utf8'));
const version=JSON.parse(readFileSync('package.json','utf8')).version;
assert.equal(report.version,version);
assert.deepEqual(report.installers.map(item=>path.basename(item.path)).sort(),[`AI Tip API Setup ${version}.exe`,`AI Tip Local Setup ${version}.exe`].sort(),'Default installer filenames must use English edition names');
for(const item of report.installers){assert.doesNotMatch(path.basename(item.path),/[^\x20-\x7e]/);assert.equal(createHash('sha256').update(readFileSync(item.path)).digest('hex'),item.sha256);}
const source=readFileSync('scripts/verify-edition-installers.mjs','utf8');
assert.match(source,/const label=edition==='local'\?'Local':'API'/,'Delivery generator must use English, not just rename current files');
console.log(JSON.stringify({englishDefaultNames:true,currentArtifactsMatchReport:true,evidence:'COMPONENT_CAPABILITY'}));
