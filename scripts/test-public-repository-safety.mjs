import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const history = execFileSync("git", ["log", "--all", "--format=", "--patch", "--no-ext-diff", "--", "."], { cwd: root, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
const rules = new Map([
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i],
  ["GitHub token", /(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}/i],
  ["OpenAI-style secret", /\bsk-[A-Za-z0-9_-]{20,}\b/i],
  ["Tavily secret", /\btvly-[A-Za-z0-9_-]{20,}\b/i],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{30,}\b/],
  ["Supabase service-role literal", /SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*["']?(?!Deno|process|\[|<|\$|只在|is)[A-Za-z0-9._-]{20,}/i]
]);
for (const [name, pattern] of rules) assert.doesNotMatch(history, pattern, `Git history contains a possible ${name}`);

const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).trim().split(/\r?\n/).filter(Boolean);
const suspiciousNames = tracked.filter((file) => /(^|\/)(\.env$|[^/]*(?:secret|private[-_]?key|service[-_]?role)[^/]*)$/i.test(file));
assert.deepEqual(suspiciousNames, [], `Tracked filenames look secret-bearing: ${suspiciousNames.join(", ")}`);

console.log(JSON.stringify({ historySecretRules: rules.size, trackedFiles: tracked.length, suspiciousNames: 0 }));
