import { app, session, BrowserWindow } from 'electron';
import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromiumNetFetch } from '../electron/chromium-net-fetch.mjs';

async function main() {
app.on('window-all-closed', () => {});
const temp = await mkdtemp(path.join(os.tmpdir(), 'ai-tip-cloud-network-'));
app.setPath('userData', temp);
const requests = [];
const upstream = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks);
  requests.push({ path: req.url, method: req.method, raw });
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/hang') return;
  if (req.url === '/empty' || req.method === 'HEAD') { res.statusCode = 204; res.end(); return; }
  if (req.url === '/redirect') { res.writeHead(307, { location: '/credential-sink' }); res.end(); return; }
  if (req.url === '/auth/v1/signup') {
    const data = JSON.parse(raw.toString() || '{}');
    if (!data.password || !data.email) { res.statusCode = 400; res.end(JSON.stringify({ message: 'Missing request body' })); return; }
    res.end(JSON.stringify({ id: 'pending-user', email: data.email, identities: [{ provider: 'email' }] })); return;
  }
  res.end(JSON.stringify({ raw: raw.toString('base64'), method: req.method }));
});
let localServer, window;
try {
  await app.whenReady();
  await session.defaultSession.setProxy({ mode: 'direct' });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const cloudUrl = `http://127.0.0.1:${upstream.address().port}`;
  const body = JSON.stringify({ name: '测试阅读者', email: 'fixture@example.test', password: 'fixture-password' });
  const echoed = await chromiumNetFetch(`${cloudUrl}/echo`, { method: 'POST', body, headers: { 'Content-Type': 'application/json' } }).then(r => r.json());
  console.log('[cloud-network] JSON echo received');
  assert.equal(Buffer.from(echoed.raw, 'base64').toString(), body, 'Chromium discarded the JSON request body');
  const binary = Uint8Array.from([0, 255, 128, 7, 10]);
  const binaryEcho = await chromiumNetFetch(new Request(`${cloudUrl}/echo`, { method: 'PATCH', body: binary })).then(r => r.json());
  assert.deepEqual(Buffer.from(binaryEcho.raw, 'base64'), Buffer.from(binary));
  console.log('[cloud-network] binary echo received');
  assert.equal((await chromiumNetFetch(`${cloudUrl}/empty`)).status, 204);
  assert.equal(await chromiumNetFetch(`${cloudUrl}/echo`, { method: 'HEAD' }).then(r => r.text()), '');
  console.log('[cloud-network] empty responses received');
  assert.equal((await chromiumNetFetch(`${cloudUrl}/redirect`, { method: 'POST', body })).status, 307);
  assert.equal(requests.filter(r => r.path === '/credential-sink').length, 0);
  await assert.rejects(chromiumNetFetch(`${cloudUrl}/hang`, { signal: AbortSignal.timeout(100) }), /abort|timeout/i);
  console.log('[cloud-network] abort received');

  process.env.AI_TIP_EMBEDDED = '1';
  process.env.AI_TIP_DESKTOP = '1';
  process.env.AI_TIP_DATA_DIR = path.join(temp, 'data');
  process.env.AI_TIP_SUPABASE_URL = cloudUrl;
  process.env.AI_TIP_SUPABASE_PUBLISHABLE_KEY = 'test-publishable';
  process.env.AI_TIP_ALLOW_INSECURE_SUPABASE = '1';
  const server = await import('../dist-electron/server.cjs');
  const nativeFetch = globalThis.fetch;
  let injected = 0;
  const bind = fetcher => server.configureExternalNetworkFetch(async (...args) => { injected++; return fetcher(...args); });
  bind(chromiumNetFetch);
  localServer = await server.startServer(0, '127.0.0.1');
  const base = `http://127.0.0.1:${localServer.address().port}`;
  const call = async (route, value = JSON.parse(body)) => {
    const r = await nativeFetch(`${base}/api/auth/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    return { status: r.status, body: await r.json() };
  };
  globalThis.fetch = async () => { throw new Error('NODE_FETCH_BYPASS'); };
  assert.equal((await call('register')).status, 202, 'Formal registration bypassed configured Chromium transport');
  assert.equal(injected, 1);
  server.configureExternalNetworkFetch(null);
  let failed = await call('register');
  assert.equal(failed.body.code, 'CLOUD_TRANSPORT_UNAVAILABLE');
  assert.equal((await call('login', { email: 'demo@aitip.local', password: 'demo1234' })).status, 200);
  for (const [failure, code] of [
    [Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }), 'CLOUD_DNS_FAILED'],
    [new Error('net::ERR_CERT_AUTHORITY_INVALID'), 'CLOUD_TLS_FAILED'],
    [new Error('net::ERR_CONNECTION_CLOSED'), 'CLOUD_CONNECTION_CLOSED'],
    [new DOMException('The operation timed out', 'TimeoutError'), 'CLOUD_TIMEOUT'],
  ]) {
    const before = injected;
    bind(async () => { throw failure; });
    failed = await call('register');
    assert.equal(failed.status, 503); assert.equal(failed.body.code, code);
    assert.equal(injected - before, 1, 'Registration was replayed after network failure');
    assert.equal(failed.body.token, undefined);
  }
  bind(async () => new Response('unavailable', { status: 503 }));
  assert.equal((await call('register')).body.code, 'CLOUD_SERVICE_UNAVAILABLE');
  bind(async () => new Response(JSON.stringify({ message: 'rate limited', code: 'over_request_rate_limit' }), { status: 429 }));
  const limited = await call('login', { email: 'fixture@example.test', password: 'fixture-password' });
  assert.equal(limited.status, 429); assert.equal(limited.body.code, 'CLOUD_RATE_LIMITED');
  for (const [route, code, status, value] of [
    ['login', 'email_not_confirmed', 400, JSON.parse(body)],
    ['login', 'invalid_credentials', 400, JSON.parse(body)],
    ['register', 'email_address_not_authorized', 400, JSON.parse(body)],
    ['verify-registration', 'otp_expired', 403, { email: 'fixture@example.test', code: '123456' }],
    ['password/recover', 'over_email_send_rate_limit', 429, { email: 'fixture@example.test' }],
  ]) {
    bind(async () => new Response(JSON.stringify({ message: 'opaque upstream error', code }), { status }));
    const failedAuth = await call(route, value);
    assert.equal(failedAuth.body.code, code, `Formal ${route} discarded actionable Auth code`);
    assert.equal(failedAuth.body.token, undefined);
  }
  // Exercise the shipped React form -> local API -> injected upstream -> ApiError -> alert.
  // These are controlled failures, not an independent production email evaluation.
  bind(async () => new Response('unavailable', { status: 503 }));
  window = new BrowserWindow({ show: false, width: 1100, height: 900, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  await window.loadURL(base);
  const js = source => window.webContents.executeJavaScript(source);
  const waitFor = async expression => {
    for (let i = 0; i < 100; i++) {
      if (await js(expression)) return;
      await new Promise(r => setTimeout(r, 50));
    }
    throw new Error(`UI condition timed out: ${expression}`);
  };
  await waitFor('!!document.querySelector(".auth-submit")');
  await js(`for (const [selector, value] of [['input[type=email]', 'fixture@example.test'], ['input[type=password]', 'fixture-password']]) {
    const input = document.querySelector(selector);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }`);
  await js('document.querySelector(".auth-submit").click()');
  await waitFor('document.querySelector(".form-error")?.textContent.includes("原因说明：")');
  assert.match(await js('document.querySelector(".form-error").textContent'), /云端服务暂时不可用[\s\S]*原因说明：[\s\S]*处理方法：/);
  assert.equal(await js('getComputedStyle(document.querySelector(".form-error")).whiteSpace'), 'pre-line');
  assert.equal(await js('document.querySelector("input[type=email]").value'), 'fixture@example.test', 'Error cleared user input');
  await js(`const select = document.querySelector('.auth-language select'); select.value = 'en'; select.dispatchEvent(new Event('change', { bubbles: true }));`);
  // Counterfactual: changing the upstream error must change the visible explanation.
  bind(async () => new Response(JSON.stringify({ message: 'opaque upstream error', code: 'email_not_confirmed' }), { status: 400 }));
  await js('document.querySelector(".auth-submit").click()');
  await waitFor('document.querySelector(".form-error")?.textContent.includes("Reason:")');
  const english = await js('document.querySelector(".form-error").textContent');
  assert.match(english, /email[\s\S]*Reason:[\s\S]*What to do:/i);
  assert.doesNotMatch(english, /[\u3400-\u9fff]|temporarily unavailable|opaque upstream error/);
  window.destroy(); window = undefined;
  bind(async () => new Response(null, { status: 307, headers: { location: 'https://evil.example/collect' } }));
  assert.equal((await call('register')).body.code, 'CLOUD_REDIRECT_BLOCKED');
  const db = JSON.parse(await readFile(path.join(temp, 'data', 'store.json'), 'utf8'));
  assert.equal(db.users.filter(u => u.authMode === 'supabase').length, 0, 'Failed/pending registration persisted a cloud identity');
  globalThis.fetch = nativeFetch;
  console.log(JSON.stringify({ evidence: 'FORMAL_PATH_INTEGRATION', evaluation: 'controlled upstream; not production email delivery', jsonBodyReceived: true, binaryBodyReceived: true, nullBodyStatuses: true, abort: true, redirectBlocked: true, formalApiUsesChromium: true, nodeBypassPoisoned: true, missingBindingBlocked: true, localIsolation: true, noAuthRetry: true, classifiedErrors: true, bilingualRenderedCauseAndAction: true, upstreamErrorChangesVisibleReason: true }));
} catch (error) { console.error(error); process.exitCode = 1; }
finally {
  window?.destroy();
  localServer?.closeAllConnections(); if (localServer) await new Promise(r => localServer.close(r));
  upstream.closeAllConnections(); await new Promise(r => upstream.close(r));
  // This directory was created by mkdtemp for this test only.
  await rm(temp, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  app.exit(process.exitCode || 0);
}
}
void main().catch(error => { console.error(error); app.exit(1); });
