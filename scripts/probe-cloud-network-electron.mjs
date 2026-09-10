import { app, session } from 'electron';
import { chromiumNetFetch, chromiumProxyDescription } from '../electron/chromium-net-fetch.mjs';
app.whenReady().then(async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../server/supabase.ts', import.meta.url), 'utf8');
  const url = `${process.env.AI_TIP_SUPABASE_URL || source.match(/DEFAULT_SUPABASE_URL = "([^"]+)"/)[1]}/auth/v1/health`;
  const key = process.env.AI_TIP_SUPABASE_PUBLISHABLE_KEY || source.match(/DEFAULT_SUPABASE_PUBLISHABLE_KEY = "([^"]+)"/)[1];
  console.log(JSON.stringify({ systemProxy: await chromiumProxyDescription(url) }));
  for (const [name, fetcher] of [['chromium-wrapper', chromiumNetFetch], ['chromium-native', (...args) => session.defaultSession.fetch(...args)], ['node', globalThis.fetch]]) {
    try {
      const r = await fetcher(url, { headers: { apikey: key }, signal: AbortSignal.timeout(10000) });
      console.log(JSON.stringify({ name, status: r.status, body: (await r.text()).slice(0, 400) }));
    } catch (error) { console.log(JSON.stringify({ name, error: error.message, code: error.code, cause: error.cause?.code })); }
  }
  app.quit();
}).catch(error => { console.error(error.message); app.exit(1); });
