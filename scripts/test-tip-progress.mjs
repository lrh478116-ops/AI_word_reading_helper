import { strict as assert } from 'node:assert';
import { build } from 'esbuild';
const bundled = await build({ entryPoints: ['src/api.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { api } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.fetch = async () => new Response([
  { type: 'progress', stage: 'assessing' }, { type: 'progress', stage: 'not-a-stage' },
  { type: 'delta', delta: 'planning preface' }, { type: 'reset' },
  { type: 'progress', stage: 'answering' }, { type: 'delta', delta: 'real answer' },
  { type: 'done', tip: { id: 'test-tip' } }
].map(v => JSON.stringify(v)).join('\n') + '\n');
const stages = []; const chunks = [];
let reset = 0;
const result = await api.streamTip('test-tip', 'question', 'en', new AbortController().signal, text => chunks.push(text), undefined, stage => stages.push(stage), () => { reset++; chunks.length = 0; });
assert.equal(reset, 1, 'A late tool call must clear the provisional answer');
assert.deepEqual(stages, ['assessing', 'answering'], 'Progress events must be consumed; unknown stages must be ignored');
assert.deepEqual(chunks, ['real answer']);
assert.equal(result.id, 'test-tip');
console.log(JSON.stringify({ evidence: 'COMPONENT_CAPABILITY', stagesConsumed: true, unknownStageRejected: true, answerUnchanged: true }));
