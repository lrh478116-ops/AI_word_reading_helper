import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises'; import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const localRequire = createRequire(typeof __filename !== 'undefined' ? __filename : import.meta.url);
export const pythonRoot = path.dirname(localRequire.resolve('pyodide/package.json'));
export function pythonPackagesRoot() {
  const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  return resources && existsSync(path.join(resources, 'app.asar'))
    ? path.join(resources, 'pyodide-packages') : path.resolve('runtime/pyodide-packages');
}
export async function pythonPackagePlan() {
  const raw = await readFile(path.join(pythonRoot, 'pyodide-lock.json'));
  const lock = JSON.parse(raw.toString());
  const version = JSON.parse(await readFile(path.join(pythonRoot, 'package.json'), 'utf8')).version as string;
  const visited = new Set<string>();
  const collect = (name: string) => {
    if (visited.has(name)) return;
    const entry = lock.packages[name];
    if (!entry || path.basename(entry.file_name) !== entry.file_name) throw new Error(`Invalid Python dependency: ${name}`);
    visited.add(name);
    entry.depends.forEach(collect);
  };
  ['sympy', 'pandas'].forEach(collect);
  return { version, lockSha256: createHash('sha256').update(raw).digest('hex'), packages: [...visited].sort().map(name => ({ name, file: lock.packages[name].file_name as string, sha256: lock.packages[name].sha256 as string })) };
}
export async function verifyPythonPackages(root = pythonPackagesRoot()) {
  const expected = await pythonPackagePlan();
  for (const entry of expected.packages) {
    const data = await readFile(path.join(root, entry.file)).catch(() => { throw new Error(`Offline calculation resource missing: ${entry.name}. Please reinstall the full app; no automatic download will occur.`); });
    if (createHash('sha256').update(data).digest('hex') !== entry.sha256) throw new Error(`Offline calculation resource integrity failure: ${entry.name}. Please reinstall the full app.`);
  }
  return expected;
}
export async function loadOfflinePython(packages: string[] = [], directory?: string) {
  const root = directory || pythonPackagesRoot();
  await verifyPythonPackages(root);
  const { loadPyodide } = await import('pyodide');
  // A local base URL prevents a CDN fallback if a resource disappears later.
  return loadPyodide({ packageCacheDir: root, packageBaseUrl: root + path.sep, packages, stdout: () => {}, stderr: () => {} });
}
