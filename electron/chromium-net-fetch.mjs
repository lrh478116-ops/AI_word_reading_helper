import { net, session } from 'electron';
import { Readable } from 'node:stream';

// Preserve Request bodies, HEAD/204 and cancellation on Chromium's network stack.
// Callers validate manual redirects
// before forwarding API keys, user tokens, or file contents.
export async function chromiumNetFetch(input, init = {}) {
  const url = input instanceof Request ? input.url : String(input);
  if (!/^https?:\/\//i.test(url)) return Promise.reject(new TypeError('Only HTTP(S) network requests are supported'));
  const normalized = new Request(input, { ...init, duplex: 'half' });
  const payload = normalized.body ? Buffer.from(await normalized.arrayBuffer()) : undefined;
  normalized.signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    // Electron's Fetch manual mode cancels redirects without returning Location.
    // Handle the event ourselves; never invoke followRedirect (including POST).
    const request = net.request({ url: normalized.url, method: normalized.method, session: session.defaultSession, cache: normalized.cache, redirect: 'follow' });
    let settled = false;
    const fail = error => { normalized.signal.removeEventListener('abort', abort); if (!settled) { settled = true; reject(error); } };
    const done = response => { if (!settled) { settled = true; resolve(response); } };
    const headersFor = values => {
      const headers = new Headers();
      for (const [name, raw] of Object.entries(values || {})) for (const value of Array.isArray(raw) ? raw : [raw]) if (value != null) headers.append(name, String(value));
      return headers;
    };
    const abort = () => { fail(normalized.signal.reason || new DOMException('Aborted', 'AbortError')); request.abort(); };
    normalized.signal.addEventListener('abort', abort, { once: true });
    for (const [name, value] of normalized.headers) if (!['host', 'content-length', 'transfer-encoding', 'connection'].includes(name)) request.setHeader(name, value);
    request.on('redirect', (status, _method, location, headers) => {
      if (init.redirect === 'error') fail(new TypeError('Unexpected redirect'));
      else done(new Response(null, { status, headers: headersFor({ ...headers, location }) }));
      normalized.signal.removeEventListener('abort', abort);
      request.abort();
    });
    request.on('response', response => {
      try {
        const noBody = normalized.method === 'HEAD' || [204, 205, 304].includes(response.statusCode);
        done(new Response(noBody ? null : Readable.toWeb(response), { status: response.statusCode, headers: headersFor(response.headers) }));
        if (noBody) response.resume();
      } catch (error) { fail(error); request.abort(); }
    });
    request.on('error', fail);
    request.on('response', response => response.on('end', () => normalized.signal.removeEventListener('abort', abort)));
    if (normalized.signal.aborted) abort(); else { if (payload) request.write(payload); request.end(); }
  });
}

export async function chromiumProxyDescription(url, timeoutMs = 3000) {
  let timeout;
  try {
    return await Promise.race([
      session.defaultSession.resolveProxy(String(url)),
      new Promise((resolve) => { timeout = setTimeout(() => resolve("UNKNOWN"), timeoutMs); })
    ]);
  } catch { return "UNKNOWN"; }
  finally { if (timeout) clearTimeout(timeout); }
}
