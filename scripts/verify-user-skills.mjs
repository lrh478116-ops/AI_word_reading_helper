import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
const files = ['server/index.ts', 'server/user-skills.ts', 'server/user-skill-routes.ts', 'src/SkillManager.tsx', 'src/user-skills.ts', 'src/skill-i18n.ts', 'src/App.tsx', 'src/api.ts', 'src/i18n.ts', 'src/types.ts', 'src/styles.css', 'package.json', 'pnpm-lock.yaml', 'scripts/test-user-skills.mjs', 'scripts/test-user-skills-integration.mjs', 'scripts/test-user-skills-electron.mjs', 'scripts/verify-user-skills.mjs', 'dist-electron/server.cjs', 'dist/index.html'];
const manifest = async () => Object.fromEntries(await Promise.all(files.map(async file => [file, createHash('sha256').update(await readFile(file)).digest('hex')])));
async function collectBuild(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await collectBuild(file); else if (!files.includes(file)) files.push(file);
  }
}
await collectBuild('dist'); files.push('dist-electron/python-worker.cjs'); files.sort();
files.push('tsconfig.app.json', 'tsconfig.node.json'); files.sort();
files.push('scripts/test-cloud-file-client-electron.mjs'); files.sort();
files.push('src/SkillPicker.tsx', 'src/skill-events.ts'); files.sort();
const before = await manifest();
const runId = randomUUID(), startedAt = new Date().toISOString();
const tests = [['scripts/test-user-skills.mjs'], ['scripts/test-user-skills-integration.mjs'], ['node_modules/electron/cli.js', 'scripts/test-user-skills-electron.mjs'], ['node_modules/electron/cli.js', 'scripts/test-cloud-file-client-electron.mjs']];
const results = [];
for (const args of tests) {
  const result = await new Promise(resolve => {
    const failureControl = args.includes('scripts/test-cloud-file-client-electron.mjs');
    const expectedExitCode = failureControl ? 1 : 0;
    const child = spawn(process.execPath, args, { cwd: process.cwd(), env: { ...process.env, ...(failureControl ? { AI_TIP_FORCE_CLOUD_UI_TEST_FAILURE: '1' } : {}) }, windowsHide: true }); let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; process.stdout.write(chunk); }); child.stderr.on('data', chunk => { stderr += chunk; process.stderr.write(chunk); });
    const timer = setTimeout(() => child.kill(), 120_000);
    child.on('error', error => { clearTimeout(timer); resolve({ args, exitCode: null, expectedExitCode, stdout, stderr: String(error) }); });
    child.on('close', code => { clearTimeout(timer); resolve({ args, exitCode: code, expectedExitCode, stdout, stderr, expectedErrorObserved: !failureControl || stderr.includes('Forced cloud client test failure') }); });
  });
  results.push(result); if (result.exitCode !== result.expectedExitCode || !result.expectedErrorObserved) break;
}
const after = await manifest(); const fresh = JSON.stringify(before) === JSON.stringify(after);
const passed = fresh && results.length === tests.length && results.every(r => r.exitCode === r.expectedExitCode && r.expectedErrorObserved);
const report = { runId, startedAt, completedAt: new Date().toISOString(), configuration: { platform: process.platform, node: process.version, seed: null, modelProvider: 'controlled-local-HTTP', checkpoint: null, database: 'isolated-temporary-local-store' }, sourceAndBuildManifest: after, evidence: 'COMPONENT_CAPABILITY', officialEntryExercised: '/api/skills -> /api/tips/:id/chat -> HTTP model request -> persisted Tip answer', realModelEvaluation: 'NOT_CAUSALLY_VERIFIED', macOSRuntime: 'NOT_CAUSALLY_VERIFIED', sourceUnchangedDuringVerification: fresh, focusedChecksPassed: passed, results };
const directory = path.resolve('docs/changes/verification'); await mkdir(directory, { recursive: true }); await writeFile(path.join(directory, 'user-skills-latest.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ runId, focusedChecksPassed: passed, evidence: report.evidence, report: 'docs/changes/verification/user-skills-latest.json' }));
if (!passed) process.exitCode = 1;
