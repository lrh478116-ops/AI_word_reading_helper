import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import OpenAI from 'openai';
import { collectCompletion } from '../server/model-stream.ts';
const server = createServer(async (req, res) => {
  for await (const chunk of req) {}
  res.setHeader('content-type', 'text/event-stream');
  const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
  send({ content: 'first' });
  await new Promise(r => setTimeout(r, 200));
  send({ content: 'second' }, 'stop'); res.end('data: [DONE]\n\n');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
try {
  const client = new OpenAI({ apiKey: 'test-only', baseURL: `http://127.0.0.1:${server.address().port}`, maxRetries: 0 });
  const deltas = [];
  const result = await collectCompletion(client, { model: 'fixture', messages: [] }, { onText: text => deltas.push(text) });
  assert.equal(result.choices[0].message.content, 'firstsecond'); assert.deepEqual(deltas, ['first', 'second']);
  console.log(JSON.stringify({ evidence: 'COMPONENT_CAPABILITY', genuineSseConsumed: true }));
} finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
