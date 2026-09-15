import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pythonPackagesRoot } from './python-resources.ts';
import { chatSignal, checkCancelled } from './chat-cancellation.ts';
type Warm = { worker: Worker; ready: Promise<void>; timer?: ReturnType<typeof setTimeout> };
let warm: Warm | undefined;
const stats = { spawned: 0, terminated: 0, reusedWarm: 0, active: 0 };
export const pythonTaskStatus = () => ({ ...stats, prepared: Boolean(warm) });
function spawn() {
  stats.spawned++;
  const worker = new Worker(typeof __dirname !== 'undefined' ? path.join(__dirname, 'python-worker.cjs') : path.resolve('server/python-worker.mjs'), {
    workerData: { pythonPackagesRoot: pythonPackagesRoot() }, resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 64, stackSizeMb: 8 }
  });
  // A prepared idle worker can still crash; never leave an unhandled error or a stale slot.
  worker.on('error', () => {});
  worker.once('exit', () => { if (warm?.worker === worker) { clearTimeout(warm.timer); warm = undefined; } });
  return worker;
}
const terminating = new WeakMap<Worker, Promise<number>>();
function terminate(worker: Worker) {
  let task = terminating.get(worker);
  if (!task) { task = worker.terminate().finally(() => { stats.terminated++; }); terminating.set(worker, task); }
  return task;
}
export function warmPython() {
  if (warm) return warm.ready;
  const worker = spawn(); const id = randomUUID();
  const slot: Warm = { worker, ready: Promise.resolve() }; warm = slot;
  slot.ready = new Promise<void>((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => finish(new Error('离线计算预加载超时')), 25_000);
    const error = (reason: Error) => finish(reason);
    const exit = () => finish(new Error('离线计算预加载被终止'));
    const message = (value: any) => { if (value.id === id) finish(value.ok ? undefined : new Error(value.error)); };
    const finish = (reason?: Error) => {
      if (done) return; done = true;
      clearTimeout(timer); worker.off('error', error); worker.off('exit', exit); worker.off('message', message);
      if (reason) { if (warm === slot) warm = undefined; void terminate(worker); reject(reason); } else resolve();
    };
    worker.once('error', error); worker.once('exit', exit); worker.on('message', message);
    worker.postMessage({ id, mode: 'prepare', payload: {} });
  });
  // A warm worker contains no user data and expires to avoid retaining memory indefinitely.
  slot.timer = setTimeout(() => { if (warm === slot) { warm = undefined; void terminate(worker); } }, 60_000);
  slot.timer.unref(); worker.unref();
  void slot.ready.catch(() => {});
  return slot.ready;
}
export async function runPythonTask(mode: string, payload: unknown, timeoutMs = 20_000) {
  checkCancelled();
  const slot = warm; warm = undefined;
  if (slot) { clearTimeout(slot.timer); stats.reusedWarm++; }
  const worker = slot?.worker || spawn(); worker.ref(); stats.active++;
  const signal = chatSignal();
  return new Promise<string>((resolve, reject) => {
    let done = false; const id = randomUUID();
    const finish = (error?: Error, result = '') => {
      if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener('abort', aborted);
      worker.off('error', failed); worker.off('exit', exited); worker.off('message', message);
      void terminate(worker).then(() => { stats.active--; if (error) reject(error); else resolve(result); });
    };
    const aborted = () => finish(new DOMException('Generation stopped', 'AbortError'));
    const timer = setTimeout(() => finish(new Error(`Python ${mode} 执行超时`)), timeoutMs);
    signal?.addEventListener('abort', aborted, { once: true });
    const failed = (error: Error) => finish(error);
    const exited = () => finish(new Error('Python 工作线程意外退出'));
    const message = (value: any) => { if (value.id === id) finish(value.ok ? undefined : new Error(value.error || 'Python 执行失败'), value.result || ''); };
    worker.once('error', failed); worker.once('exit', exited); worker.on('message', message);
    void (slot?.ready || Promise.resolve()).then(() => { if (!done) worker.postMessage({ id, mode, payload }); }, error => finish(error));
    if (signal?.aborted) aborted();
  });
}
