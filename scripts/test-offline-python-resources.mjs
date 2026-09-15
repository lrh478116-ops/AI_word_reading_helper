import { strict as assert } from 'node:assert';
import { mkdtemp, rm, writeFile, readFile, cp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { verifyPythonPackages } from '../server/python-resources.ts';

const root = path.resolve('runtime/pyodide-packages');
const manifest = await verifyPythonPackages(root);
assert.ok(manifest.packages.some(p => p.name === 'sympy'));
assert.ok(manifest.packages.some(p => p.name === 'numpy'));
assert.ok(manifest.packages.some(p => p.name === 'six'));
const temp = await mkdtemp(path.join(os.tmpdir(), 'ai-tip-offline-packages-'));
try {
  await cp(root, temp, { recursive: true });
  const target = path.join(temp, manifest.packages[0].file);
  await writeFile(target, 'corrupted');
  await assert.rejects(verifyPythonPackages(temp), /损坏|integrity/);
  await rm(target);
  await assert.rejects(verifyPythonPackages(temp), /缺失|missing/);
  const configuration = JSON.parse(await readFile('package.json', 'utf8'));
  for (const platform of ['win', 'mac']) assert.ok(configuration.build[platform].extraResources.some(r => r.to === 'pyodide-packages'));
} finally { await rm(temp, { recursive: true, force: true }); }
console.log(JSON.stringify({ evidence: 'COMPONENT_CAPABILITY', dependencyClosure: true, tamperBlocked: true, missingBlocked: true }));
