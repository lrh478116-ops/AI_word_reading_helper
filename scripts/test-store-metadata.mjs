import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { validateMetadata, validateCapture } from './store-metadata-validation.mjs';
const normalizeText = value => value.replace(/\r\n?/g, '\n').trim();
const assertExportMatches = (actual, expected) => assert.equal(normalizeText(actual), normalizeText(expected), 'Stale exported field');
const metadata = JSON.parse(readFileSync('store-assets/metadata.json', 'utf8'));
assert.equal(metadata.edition,'local','Mac App Store metadata must describe the local-only edition');
assert.doesNotMatch(metadata.locales['zh-CN'].description,/可接入自己的兼容大模型 API|可用的在线接口|使用在线 API/);
assert.doesNotMatch(metadata.locales.en.description,/Connect your own compatible AI API|working online provider|Online providers receive/);
assert.deepEqual(validateMetadata(metadata), []);
for (const [field, value] of [['name', 'a'.repeat(31)], ['subtitle', 'a'.repeat(31)], ['description', 'a'.repeat(4001)], ['keywords', '文'.repeat(34)], ['description', '<b>fake</b>'], ['promotionalText', 'a'.repeat(171)]]) {
  const changed = structuredClone(metadata); changed.locales['zh-CN'][field] = value;
  assert.ok(validateMetadata(changed).length, `Failed to reject invalid ${field}`);
}
assert.ok(validateCapture({ platform: 'win32', submissionReady: false }, true).length, 'Windows draft must not pass Mac submission');
assert.ok(validateCapture({ platform: 'darwin', submissionReady: false }, true).length, 'Mac draft must not pass submission');
assert.ok(validateCapture({ platform: 'darwin', submissionReady: true }, true).length, 'Missing provenance must not pass submission');
for (const [locale, data] of Object.entries(metadata.locales)) {
  for (const field of ['name', 'subtitle', 'description', 'keywords', 'promotionalText']) {
    const exported = readFileSync(`store-assets/text/${locale}/${field}.txt`, 'utf8');
    assertExportMatches(exported, data[field]);
    assert.throws(() => assertExportMatches(`${exported}\nchanged`, data[field]), /Stale exported field/, 'Real text drift must still fail');
  }
}
console.log(JSON.stringify({ evidence: 'COMPONENT_CAPABILITY', fieldLimits: true, utf8ByteLimit: true, crossPlatformLineEndings: true, realTextDriftRejected: true, staleTextChecked: true, nonMacDraftBlocked: true }));
