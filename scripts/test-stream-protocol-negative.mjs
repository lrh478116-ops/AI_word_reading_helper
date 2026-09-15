import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import OpenAI from 'openai';
import { collectCompletion, ModelStreamError, validateToolBindings } from '../server/model-stream.ts';
let mode = 'split', release, completed = false, count = 0;
const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
const server = createServer(async (req, res) => {
  for await (const bytes of req) {} count++;
  if (mode === 'json') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: 'one response' }, finish_reason: 'stop' }] })); return; }
  res.setHeader('content-type', 'text/event-stream');
  if (mode === 'gate') {
    res.write(chunk({ content: 'early' })); await new Promise(r => { release = r; });
    completed = true; res.end(chunk({ content: 'late' }, 'stop') + 'data: [DONE]\n\n'); return;
  }
  let wire;
  if (mode === 'split') wire = chunk({ content: 'planning' })
    + chunk({ tool_calls: [{ index: 0, id: 'a', type: 'function', function: { name: 'calculate', arguments: '{"code":' } }, { index: 1, id: 'b', type: 'function', function: { name: 'calculate', arguments: '{"code":' } }] })
    + chunk({ tool_calls: [{ index: 1, function: { arguments: '"中文"}' } }, { index: 0, function: { arguments: '"1+1"}' } }] }, 'tool_calls');
  else if (mode === 'truncated') wire = chunk({ content: 'unfinished' });
  else if (mode === 'bad-json') wire = chunk({ tool_calls: [{ index: 0, id: 'a', type: 'function', function: { name: 'calculate', arguments: '{"code":' } }] }, 'tool_calls');
  else if (mode === 'missing-id') wire = chunk({ tool_calls: [{ index: 0, type: 'function', function: { name: 'calculate', arguments: '{}' } }] }, 'tool_calls');
  else if (mode === 'late') wire = chunk({}, 'stop') + chunk({ content: 'after end' });
  else wire = chunk({ tool_calls: [{ index: -1, function: { arguments: '{}' } }] }, 'tool_calls');
  const bytes = Buffer.from(wire + 'data: [DONE]\n\n');
  // Deliberately split multibyte UTF-8, JSON and SSE boundaries.
  for (let i = 0; i < bytes.length; i += 3) res.write(bytes.subarray(i, i + 3));
  res.end();
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
try {
  const client = new OpenAI({ apiKey: 'fixture', baseURL: `http://127.0.0.1:${server.address().port}`, maxRetries: 0 });
  const args = { model: 'fixture', messages: [] };
  let reset = 0;
  const first = await collectCompletion(client, args, { onText: () => {}, onReset: () => reset++ });
  assert.equal(reset, 1); assert.equal(first.choices[0].message.tool_calls[1].function.arguments, '{"code":"中文"}');
  const offered = [{ function: { name: 'calculate', parameters: { type: 'object', required: ['code'], properties: { code: { type: 'string' } }, additionalProperties: false } } }];
  validateToolBindings(first.choices[0].message.tool_calls, offered);
  assert.throws(() => validateToolBindings(first.choices[0].message.tool_calls, []), ModelStreamError);
  assert.throws(() => validateToolBindings([{ function: { name: 'calculate', arguments: '{}' } }], offered), ModelStreamError);
  assert.throws(() => validateToolBindings([{ function: { name: 'calculate', arguments: '{"code":42}' } }], offered), ModelStreamError);
  for (mode of ['truncated', 'bad-json', 'missing-id', 'late', 'bad-index']) {
    await assert.rejects(collectCompletion(client, args), ModelStreamError);
  }
  mode = 'json'; const before = count; let buffered = 0;
  await collectCompletion(client, args, { onBuffered: () => buffered++ });
  assert.equal(buffered, 1); assert.equal(count - before, 1, 'Non-streaming provider must not be replayed');
  mode = 'gate'; let early = false;
  const timeout = setTimeout(() => { release?.(); }, 3000);
  await collectCompletion(client, args, { onText: text => { if (text === 'early') { early = !completed; release(); } } });
  clearTimeout(timeout); assert.ok(early, 'No first-byte claim if the provider finished first');
  console.log(JSON.stringify({ evidence: 'COMPONENT_CAPABILITY', interleavedArguments: true, incompleteCallsRejected: true, resetConsumed: true, trueFirstByteGate: true, jsonNotReplayed: true }));
} finally { release?.(); server.closeAllConnections(); await new Promise(r => server.close(r)); }
