import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pythonPackagePlan, pythonRoot, verifyPythonPackages } from '../server/python-resources.ts';

const plan = await pythonPackagePlan();
const output = path.resolve('runtime/pyodide-packages');
await mkdir(output, { recursive: true });
for (const item of plan.packages) {
  const valid = data => data && createHash('sha256').update(data).digest('hex') === item.sha256;
  let bytes = await readFile(path.join(output, item.file)).catch(() => null);
  if (valid(bytes)) continue;
  bytes = await readFile(path.join(pythonRoot, item.file)).catch(() => null);
  if (!valid(bytes)) {
    const url = `https://cdn.jsdelivr.net/pyodide/v${plan.version}/full/${item.file}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000), redirect: 'error' });
    if (!response.ok) throw new Error(`Build-time Python resource download failed: ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (!valid(bytes)) throw new Error(`Python resource SHA-256 mismatch: ${item.name}`);
  await writeFile(path.join(output, item.file), bytes);
}
await verifyPythonPackages(output);
await writeFile(path.join(output, 'manifest.json'), JSON.stringify(plan, null, 2) + '\n');
console.log(JSON.stringify({ bundledPythonDependencies: plan.packages.length, version: plan.version, runtimeDownloads: false }));
