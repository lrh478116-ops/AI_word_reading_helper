import { strict as assert } from 'node:assert';
import { EventEmitter } from 'node:events';
import { withChatCancellation } from '../server/chat-cancellation.ts';
import { runPythonTask, warmPython, pythonTaskStatus } from '../server/python-tasks.ts';
const before = pythonTaskStatus();
await warmPython();
assert.ok(pythonTaskStatus().prepared);
const result = await runPythonTask('calculate', { code: "decimal.Decimal('0.1') + decimal.Decimal('0.2')" });
assert.match(result, /0\.3/);
assert.equal(pythonTaskStatus().reusedWarm, before.reusedWarm + 1);
assert.equal(pythonTaskStatus().active, 0);
assert.equal(pythonTaskStatus().prepared, false, 'A user-code worker must never return to the warm pool');
const spawned = pythonTaskStatus().spawned;
await runPythonTask('calculate', { code: '1 + 1' });
assert.equal(pythonTaskStatus().spawned, spawned + 1, 'No stale user interpreter may be reused');
await warmPython();
const res = new EventEmitter(); res.writableFinished = false;
let rejected = false;
await withChatCancellation(res, async () => {
  const task = runPythonTask('code_test', { code: 'total = 0\nfor i in range(1000000):\n    for j in range(1000):\n        total += j', tests: 'assert total >= 0' }, 20000);
  const timer = setTimeout(() => res.emit('close'), 100);
  try { await task; assert.fail('CPU task completed instead of being stopped'); }
  catch (error) { assert.equal(error.name, 'AbortError'); rejected = true; }
  finally { clearTimeout(timer); }
});
assert.ok(rejected); assert.equal(pythonTaskStatus().active, 0);
// Cancel while the clean worker is still preparing; no orphaned ready promise/listeners.
const warming = warmPython();
const res2 = new EventEmitter(); res2.writableFinished = false;
await withChatCancellation(res2, async () => {
  const task = runPythonTask('calculate', { code: '2+2' }); res2.emit('close');
  await assert.rejects(task, error => error.name === 'AbortError');
});
await assert.rejects(warming);
assert.equal(pythonTaskStatus().active, 0);
assert.match(await runPythonTask('calculate', { code: '2+2' }), /4/);
console.log(JSON.stringify({ evidence: 'COMPONENT_CAPABILITY', warmActuallyConsumed: true, singleUseIsolation: true, cpuWorkerTerminated: true, abortDuringPreload: true, status: pythonTaskStatus() }));
