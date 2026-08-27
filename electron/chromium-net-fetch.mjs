import { net, session } from "electron";
import { Readable } from "node:stream";

function responseHeaders(value = {}) {
  const headers = new Headers();
  for (const [name, raw] of Object.entries(value)) {
    for (const item of Array.isArray(raw) ? raw : [raw]) if (item != null) headers.append(name, String(item));
  }
  return headers;
}

export function chromiumNetFetch(url, init = {}) {
  return new Promise((resolve, reject) => {
    const request = net.request({
      url: String(url),
      method: String(init.method || "GET"),
      session: session.defaultSession,
      redirect: "manual"
    });
    let settled = false;
    const finishResolve = (response) => { if (!settled) { settled = true; resolve(response); } };
    const finishReject = (error) => { if (!settled) { settled = true; reject(error); } };
    const abort = () => {
      request.abort();
      finishReject(new DOMException("Aborted", "AbortError"));
    };
    if (init.signal?.aborted) return abort();
    init.signal?.addEventListener("abort", abort, { once: true });
    for (const [name, value] of new Headers(init.headers || {})) request.setHeader(name, value);
    request.on("redirect", (statusCode, _method, redirectUrl, headers) => {
      finishResolve(new Response(null, { status: statusCode, headers: responseHeaders({ ...headers, location: redirectUrl }) }));
      request.abort();
    });
    request.on("response", (response) => {
      const body = Readable.toWeb(response);
      finishResolve(new Response(body, { status: response.statusCode, statusText: response.statusMessage || "", headers: responseHeaders(response.headers) }));
    });
    request.on("error", finishReject);
    request.on("close", () => init.signal?.removeEventListener("abort", abort));
    request.end();
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
