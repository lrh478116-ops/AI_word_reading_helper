import { strict as assert } from "node:assert";

const base = String(process.env.AI_TIP_PUBLIC_SITE_URL || "https://lrh478116-ops.github.io/ai-tip-support-site").replace(/\/$/, "");
const results = [];
for (const route of ["/", "/privacy/", "/account-deletion/"]) {
  const response = await fetch(`${base}${route}`, { redirect: "follow", signal: AbortSignal.timeout(20_000) });
  const body = await response.text();
  assert.ok(response.ok, `${route} returned ${response.status}`);
  assert.match(response.headers.get("content-type") || "", /text\/html/i, `${route} is not HTML`);
  assert.match(body, /AI Tip/i, `${route} is not the AI Tip support site`);
  results.push({ route, status: response.status, finalUrl: response.url });
}
console.log(JSON.stringify({ base, results }));
