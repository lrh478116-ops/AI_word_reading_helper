import { strict as assert } from 'node:assert';
import { prepareDocument, retrieveDocument } from '../server/document-rag.ts';
const doc = { id: 'document', userId: 'owner', title: 'Reference', sourceBytes: 11 * 1024 * 1024, blocks: [
  { id: 'intro', type: 'paragraph', content: 'This is an introduction.' },
  { id: 'remote', type: 'paragraph', content: 'Battery thermal recovery uses a cooling loop. 电池热回收使用冷却回路。' }
] };
const first = await prepareDocument(doc);
assert.ok(first.enabled);
assert.equal((await retrieveDocument(doc, '电池热回收', 'introduction')).hits[0]?.blockId, 'remote');
doc.blocks[1].content = 'Completely unrelated replacement.';
assert.equal((await retrieveDocument(doc, '电池热回收', '')).hits.length, 0);
assert.notEqual((await prepareDocument(doc)).signature, first.signature);
assert.equal((await retrieveDocument({ ...doc, userId: 'another-owner' }, 'cooling', '')).hits.length, 0);
const short = { ...doc, id: 'short', sourceBytes: 100 };
assert.equal((await prepareDocument(short)).enabled, false);
assert.equal((await retrieveDocument(short, 'introduction', '')).hits.length, 0);
const formula = { ...doc, id: 'formula', blocks: [{ id: 'inequality', type: 'code', content: 'if a < b and c > d: record()' }] };
assert.match((await retrieveDocument(formula, 'record', '')).hits[0].text, /a < b and c > d/);
const scan = { ...doc, id: 'scanned', blocks: [{ id: 'image', type: 'image', content: 'data:image/png;base64,xxxx' }], pdfStructure: { pages: [{ pageNumber: 1, text: '', source: 'ocr' }] } };
assert.equal((await retrieveDocument(scan, 'content', '')).hits.length, 0);
const ocr = { ...scan, pdfStructure: { pages: [{ pageNumber: 1, text: 'Recognized cotton textile', source: 'ocr' }] } };
assert.equal((await retrieveDocument(ocr, 'cotton', '')).hits[0]?.page, 1);
assert.notEqual((await prepareDocument(scan)).signature, (await prepareDocument(ocr)).signature);
console.log(JSON.stringify({ evidence: 'COMPONENT_CAPABILITY', retrieval: true, staleContentRejected: true, ownerIsolation: true }));
