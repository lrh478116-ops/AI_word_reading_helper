import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, writeFile, symlink, realpath } from 'node:fs/promises';
import { createBuildPolicy } from '../src/edition.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const option = (flag, fallback) => { const index = process.argv.indexOf(flag); return index < 0 ? fallback : process.argv[index + 1]; };
const edition = option('--edition', 'api');
const distribution = option('--distribution', 'direct');
const downloadURL = option('--api-download-url', process.env.AI_TIP_API_DOWNLOAD_URL || '');
const policy = createBuildPolicy(edition, distribution, downloadURL);
const stage = path.join(root, '.edition-build', `${edition}-${distribution}`);
const requestedTarget = option('--target', process.platform === 'win32' ? 'win' : 'dmg');
if (process.argv.includes('--pack') && !['win', 'dmg', 'mas', 'mas-dev'].includes(requestedTarget)) throw new Error('Unsupported package target');
if (process.argv.includes('--pack') && (distribution === 'mas') !== ['mas', 'mas-dev'].includes(requestedTarget)) throw new Error('MAS packages must use the local MAS distribution, and direct packages must use a direct target');
if (process.argv.includes('--pack') && option('--target', process.platform === 'win32' ? 'win' : 'dmg') !== 'win' && process.platform !== 'darwin') throw new Error('macOS packages require a macOS build host');
process.chdir(root);
process.env.AI_TIP_BUILD_POLICY = JSON.stringify(policy);
execFileSync(process.execPath, [path.join(path.dirname(require.resolve('typescript/package.json')), 'bin/tsc'), '-b', '--pretty', 'false'], { cwd: root, stdio: 'inherit' });
await import('./prepare-python-resources.mjs');
const { build: viteBuild } = await import('vite');
await viteBuild();
await mkdir(path.join(stage, 'dist-electron'), { recursive: true });
const { build: bundle } = await import('esbuild');
await bundle({ entryPoints: [path.join(root, 'server/index.ts')], bundle: true, platform: 'node', format: 'cjs', target: 'node20', external: ['pyodide', 'pdfjs-dist/*'], outfile: path.join(stage, 'dist-electron/server.cjs'), define: { __AI_TIP_BUILD_POLICY__: JSON.stringify(policy) } });
await bundle({ entryPoints: [path.join(root, 'server/python-worker.mjs')], bundle: true, platform: 'node', format: 'cjs', target: 'node20', external: ['pyodide'], outfile: path.join(stage, 'dist-electron/python-worker.cjs') });
for (const directory of ['electron', 'website/privacy', 'scripts/fixtures']) await cp(path.join(root, directory), path.join(stage, directory), { recursive: true });
const source = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const appName = edition === 'local' && distribution === 'direct' ? 'AI Tip Local' : 'AI Tip';
const build = { ...source.build, npmRebuild: false, productName: appName, appId: edition === 'local' && distribution === 'direct' ? `${source.build.appId}.local` : source.build.appId, directories: { output: path.join(root, 'release', `${edition}-${distribution}`) } };
for (const platform of ['win', 'mac']) build[platform] = { ...build[platform], extraResources: build[platform].extraResources.map(resource => ({ ...resource, from: path.resolve(root, resource.from) })) };
if (distribution === 'direct') {
  build.artifactName = edition === 'api' ? 'AI-Tip-API-${version}-${arch}.${ext}' : 'AI-Tip-Local-${version}-${arch}.${ext}';
  build.win = { ...build.win, artifactName: edition === 'api' ? 'AI-Tip-API-Setup.exe' : 'AI-Tip-Local-Setup.exe' };
}
build.win.icon = path.join(root, source.build.win.icon);
build.mac.icon = path.join(root, source.build.mac.icon);
for (const section of ['mac', 'mas']) for (const key of ['entitlements', 'entitlementsInherit']) if (build[section][key]) build[section] = { ...build[section], [key]: path.join(root, build[section][key]) };
const metadata = { ...source, name: edition === 'local' && distribution === 'direct' ? 'ai-tip-local-app' : source.name, productName: appName, aiTipBuildPolicy: policy, build };
await writeFile(path.join(stage, 'package.json'), JSON.stringify(metadata, null, 2) + '\n');
const modules = path.join(stage, 'node_modules');
try { const actual = await realpath(modules); if (actual !== await realpath(path.join(root, 'node_modules'))) throw new Error('Unexpected staged dependency path'); }
catch (error) { if (error.code !== 'ENOENT') throw error; await symlink(path.join(root, 'node_modules'), modules, 'junction'); }
const runtime = path.join(stage, 'runtime');
try { const actual = await realpath(runtime); if (actual !== await realpath(path.join(root, 'runtime'))) throw new Error('Unexpected staged runtime path'); }
catch (error) { if (error.code !== 'ENOENT') throw error; await symlink(path.join(root, 'runtime'), runtime, 'junction'); }
await writeFile(path.join(stage, 'build-policy.json'), JSON.stringify(policy, null, 2) + '\n');
console.log(JSON.stringify({ stage, policy, packaged: false, downloadPublished: false }));
if (process.argv.includes('--pack')) {
  const { build: packageApp } = await import('electron-builder');
  const target = option('--target', process.platform === 'win32' ? 'win' : 'dmg');
  const { Platform } = await import('electron-builder');
  const { Arch } = await import('electron-builder');
  // The staged package already contains the complete build config. Passing it again
  // makes electron-builder concatenate extraResources and copy/sign every resource twice.
  await packageApp({ projectDir: stage, targets: target === 'win' ? Platform.WINDOWS.createTarget('nsis', Arch.x64) : Platform.MAC.createTarget(target, Arch.universal), publish: 'never' });
}
if (process.argv.includes('--start')) {
  const child = spawn(require('electron'), [path.join(stage, 'electron/main.mjs')], { cwd: stage, stdio: 'inherit' });
  child.once('error', error => { console.error(error); process.exitCode = 1; });
  child.once('exit', code => { process.exitCode = code ?? 1; });
}
