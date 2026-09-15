import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const dir = await mkdtemp(path.join(os.tmpdir(), 'aitip-stream-rag-'));
Object.assign(process.env, { AI_TIP_EMBEDDED: '1', AI_TIP_SUPABASE_ENABLED: '0', AI_TIP_DESKTOP: '1', AI_TIP_DATA_DIR: dir });
let mode = 'rag', requests = 0, upstreamClosed = false, searchClosed = false, searchStarted = false, releaseTail, answerInputs = [];
const mock = createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw); requests++;
  if (req.url === '/search') {
    searchStarted = true; res.setHeader('content-type', 'application/json'); res.write('{');
    res.on('close', () => { searchClosed = true; }); return;
  }
  const json = (content) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] })); };
  if (!body.stream) {
    if (!body.messages[0].content.includes('PROFESSIONALISM_CLASSIFIER_V1')) { json(JSON.stringify({ required: false, confidence: 99, reason: 'Supplied text is enough.', queryZh: '', queryEn: '' })); return; }
    json(JSON.stringify({ professional: false, level: 'general', score: 0, domain: 'general', requiresWebReview: false, confidence: 99, reason: 'The user asks about supplied prose.' })); return;
  }
  answerInputs.push(body);
  res.setHeader('content-type', 'text/event-stream');
  const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
  if (['cpu', 'search', 'invalid-tool'].includes(mode)) {
    const name = mode === 'search' ? 'web_search' : 'code_test';
    const args = mode === 'invalid-tool' ? {} : mode === 'search' ? { query: 'enclosure material' } : { code: 'total = 0\nfor i in range(1000000):\n    for j in range(1000):\n        total += j', tests: 'assert total >= 0' };
    send({ tool_calls: [{ index: 0, id: 'execution', type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, 'tool_calls');
    res.end('data: [DONE]\n\n'); return;
  }
  if (mode === 'hold') {
    res.on('close', () => { upstreamClosed = true; releaseTail?.(); });
    send({ content: 'first-visible' });
    await new Promise(resolve => { releaseTail = resolve; });
    if (!res.destroyed) { send({ content: '-tail' }, 'stop'); res.end('data: [DONE]\n\n'); }
    return;
  }
  const context = body.messages.find(m => m.role === 'user')?.content || '';
  send({ content: context.includes('copper enclosure') ? 'The enclosure is copper [D1].' : 'The supplied extracts do not specify the enclosure.' }, 'stop');
  res.end('data: [DONE]\n\n');
});
await new Promise(r => mock.listen(0, '127.0.0.1', r));
process.env.TAVILY_API_URL = `http://127.0.0.1:${mock.address().port}/search`;
const { startServer, pythonTaskStatus } = await import('../dist-electron/server.cjs');
const server = await startServer(0);
const origin = `http://127.0.0.1:${server.address().port}/api`;
let token;
const request = async (url, init = {}, auth = token) => {
  const response = await fetch(origin + url, { ...init, headers: { ...(init.body instanceof FormData ? {} : { 'content-type': 'application/json' }), ...(auth ? { authorization: `Bearer ${auth}` } : {}), ...init.headers } });
  assert.ok(response.ok, `${url}: ${response.status} ${response.ok ? '' : await response.text()}`); return response.json();
};
try {
  token = (await request('/auth/login', { method: 'POST', body: JSON.stringify({ email: 'demo@aitip.local', password: 'demo1234' }) })).token;
  await request('/settings', { method: 'PUT', body: JSON.stringify({ provider: 'custom', baseURL: `http://127.0.0.1:${mock.address().port}/v1`, apiKey: 'fixture-only', model: 'fixture', webSearchEnabled: false, pythonEnabled: false, reliabilityEnabled: true }) });
  const form = new FormData();
  form.append('file', new Blob(['Introduction\n\n', 'Unrelated preface.\n\n'.repeat(12), 'Irrelevant prose about trees. '.repeat(400000), '\n\nThe enclosure has a copper enclosure.']), 'long.txt');
  const { document } = await request('/documents/import', { method: 'POST', body: form });
  assert.ok(document.sourceBytes > 10 * 1024 * 1024);
  const before = requests;
  const preparation = await request(`/documents/${document.id}/prepare`, { method: 'POST', body: '{}' });
  assert.ok(preparation.enabled && preparation.chunks > 0);
  assert.equal(requests, before, 'Preprocessing must not invoke a model');
  assert.equal(pythonTaskStatus().prepared, false, 'Disabled Python must not be prewarmed');
  const { tip } = await request(`/documents/${document.id}/tips`, { method: 'POST', body: JSON.stringify({ blockId: document.blocks[0].id, selectedText: 'Introduction', startOffset: 0, endOffset: 12, prefixText: '', suffixText: '' }) });
  const chat = async () => {
    const response = await fetch(`${origin}/tips/${tip.id}/chat`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ question: 'What is the enclosure made from?', language: 'en' }) });
    const events = (await response.text()).trim().split('\n').map(JSON.parse);
    const done = events.find(e => e.type === 'done'); assert.ok(done, JSON.stringify(events)); return done.tip.messages.at(-1);
  };
  const first = await chat();
  assert.match(first.content, /copper/);
  const retrieval = first.skills.find(s => s.name === 'document_retrieval');
  assert.equal(retrieval.retrieval.signature, preparation.signature);
  assert.ok(retrieval.retrieval.chunks.some(c => c.blockId === document.blocks.at(-1).id));
  assert.ok(answerInputs.at(-1).messages.some(m => m.content?.includes('copper enclosure')));
  const hugeBlock = document.blocks.find(block => block.content.length > 1000000);
  const hugeSelection = hugeBlock.content.slice(0, 16);
  const bigTip = (await request(`/documents/${document.id}/tips`, { method: 'POST', body: JSON.stringify({ blockId: hugeBlock.id, selectedText: hugeSelection, startOffset: 0, endOffset: 16, prefixText: '', suffixText: hugeBlock.content.slice(16, 48) }) })).tip;
  const bigReply = await fetch(`${origin}/tips/${bigTip.id}/chat`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ question: 'What is the enclosure made from?', language: 'en' }) });
  assert.ok((await bigReply.text()).includes('"type":"done"'));
  const actualContextCharacters = answerInputs.at(-1).messages.find(m => m.role === 'user').content.length;
  assert.ok(actualContextCharacters < 20000, 'RAG must not be bypassed by a multi-megabyte anchor block');
  // Delete the retrieved passage through the real editor API; never mutate a fixture cache directly.
  const changed = document.blocks.slice(0, 8); // Keep original source size, but remove the distant answer.
  await request(`/documents/${document.id}`, { method: 'PATCH', body: JSON.stringify({ blocks: changed }) });
  const second = await chat();
  assert.doesNotMatch(answerInputs.at(-1).messages.find(m => m.role === 'user').content, /copper enclosure/);
  assert.doesNotMatch(second.content, /is copper/);
  assert.notEqual(second.skills.find(s => s.name === 'document_retrieval').retrieval.signature, preparation.signature);
  // Different user cannot preprocess another user's document.
  const other = await request('/auth/register', { method: 'POST', body: JSON.stringify({ name: 'Other', email: 'other@example.com', password: 'Password12345' }) });
  const forbidden = await fetch(`${origin}/documents/${document.id}/prepare`, { method: 'POST', headers: { authorization: `Bearer ${other.token}` } });
  assert.equal(forbidden.status, 404);
  mode = 'hold'; const controller = new AbortController();
  const response = await fetch(`${origin}/tips/${tip.id}/chat`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ question: 'Explain this introduction.', language: 'en' }), signal: controller.signal });
  const reader = response.body.getReader(); let observed = '';
  const deadline = setTimeout(() => controller.abort(), 8000);
  while (!observed.includes('first-visible')) { const { value, done } = await reader.read(); assert.ok(!done); observed += new TextDecoder().decode(value); }
  assert.equal(upstreamClosed, false, 'First text must precede completion of upstream generation');
  const firstByteBeforeEnd = !upstreamClosed && observed.includes('first-visible');
  const count = requests; controller.abort(); clearTimeout(deadline);
  for (let i = 0; i < 100 && !upstreamClosed; i++) await new Promise(r => setTimeout(r, 20));
  assert.ok(upstreamClosed, 'Stop must close the upstream response');
  const persisted = await request(`/documents/${document.id}`);
  assert.equal(persisted.tips[0].messages.filter(m => m.role === 'assistant').length, 2);
  assert.equal(requests, count, 'Cancellation must not trigger recovery or retries');
  const settings = async patch => request('/settings', { method: 'PUT', body: JSON.stringify(patch) });
  const openChat = async signal => fetch(`${origin}/tips/${tip.id}/chat`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ question: 'Explain this introduction.', language: 'en' }), signal });
  const waitUntil = async predicate => { for (let i = 0; i < 200 && !predicate(); i++) await new Promise(r => setTimeout(r, 20)); assert.ok(predicate()); };
  await settings({ pythonEnabled: true });
  const preloadRequests = requests;
  const preparedTools = await request(`/documents/${document.id}/prepare`, { method: 'POST', body: '{}' });
  assert.ok(preparedTools.python.ready); assert.equal(requests, preloadRequests);
  mode = 'cpu'; const cpu = new AbortController(); const reused = pythonTaskStatus().reusedWarm;
  await openChat(cpu.signal); await waitUntil(() => pythonTaskStatus().active > 0);
  assert.equal(pythonTaskStatus().reusedWarm, reused + 1, 'Formal chat must consume the preloaded worker');
  await new Promise(r => setTimeout(r, 100)); const cpuRequests = requests; cpu.abort();
  await waitUntil(() => pythonTaskStatus().active === 0);
  assert.equal(requests, cpuRequests, 'Stopped computation must not start another model round');
  mode = 'invalid-tool'; const beforeInvalid = pythonTaskStatus().spawned;
  const invalidEvents = (await (await openChat()).text()).trim().split('\n').map(JSON.parse);
  assert.ok(invalidEvents.some(e => e.type === 'error')); assert.ok(!invalidEvents.some(e => e.type === 'done'));
  assert.equal(pythonTaskStatus().spawned, beforeInvalid, 'Missing arguments cannot create an executed action');
  mode = 'search'; await settings({ pythonEnabled: false, webSearchEnabled: true, searchApiKey: 'fixture-search' });
  const search = new AbortController(); await openChat(search.signal); await waitUntil(() => searchStarted);
  const searchRequests = requests; search.abort(); await waitUntil(() => searchClosed);
  assert.equal(requests, searchRequests, 'Search cancellation must not generate a fallback answer');
  const finalDocument = await request(`/documents/${document.id}`);
  assert.equal(finalDocument.tips.find(t => t.id === tip.id).messages.filter(m => m.role === 'assistant').length, 2);
  console.log(JSON.stringify({ evidence: 'COMPONENT_CAPABILITY', entryExercised: '/api/documents/import -> /api/documents/:id/prepare -> /api/tips/:id/chat', provider: 'controlled-local-SSE', independentEvaluation: 'NOT_CAUSALLY_VERIFIED', sourceBytes: document.sourceBytes, indexSignature: preparation.signature, retrievedChunkIds: retrieval.retrieval.chunks.map(c => c.id), firstAnswer: first.content, answerAfterDeletion: second.content, actualContextCharacters, firstByteBeforeEnd, modelConnectionClosed: upstreamClosed, searchConnectionClosed: searchClosed, workers: pythonTaskStatus(), finalAssistantMessages: finalDocument.tips.find(t => t.id === tip.id).messages.filter(m => m.role === 'assistant').length }));
} finally {
  releaseTail?.(); mock.closeAllConnections(); server.closeAllConnections();
  await Promise.all([new Promise(r => mock.close(r)), new Promise(r => server.close(r))]);
  await rm(dir, { recursive: true, force: true });
}
