import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { validateMetadata, validateCapture } from './store-metadata-validation.mjs';
const metadata = JSON.parse(readFileSync('store-assets/metadata.json', 'utf8'));
assert.deepEqual(validateMetadata(metadata), []);
for (const [field, value] of [['name', 'a'.repeat(31)], ['subtitle', 'a'.repeat(31)], ['description', 'a'.repeat(4001)], ['keywords', '文'.repeat(34)], ['description', '<b>fake</b>'], ['promotionalText', 'a'.repeat(171)]]) {
  const changed = structuredClone(metadata); changed.locales['zh-CN'][field] = value;
  assert.ok(validateMetadata(changed).length, `Failed to reject invalid ${field}`);
}
assert.ok(validateCapture({ platform: 'win32', submissionReady: false }, true).length, 'Windows draft must not pass Mac submission');
assert.ok(validateCapture({ platform: 'darwin', submissionReady: false }, true).length, 'Mac draft must not pass submission');
assert.ok(validateCapture({ platform: 'darwin', submissionReady: true }, true).length, 'Missing provenance must not pass submission');
for (const [locale, data] of Object.entries(metadata.locales)) {
  for (const field of ['name', 'subtitle', 'description', 'keywords', 'promotionalText']) assert.equal(readFileSync(`store-assets/text/${locale}/${field}.txt`, 'utf8').trim(), data[field].trim(), 'Stale exported field');
}
console.log(JSON.stringify({ evidence: 'COMPONENT_CAPABILITY', fieldLimits: true, utf8ByteLimit: true, staleTextChecked: true, nonMacDraftBlocked: true }));
