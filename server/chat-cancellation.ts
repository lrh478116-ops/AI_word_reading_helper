import { AsyncLocalStorage } from 'node:async_hooks';
import type { Response } from 'express';
const scope = new AsyncLocalStorage<AbortSignal>();
export const chatSignal = () => scope.getStore();
export function checkCancelled() { chatSignal()?.throwIfAborted(); }
export function cancellableWait<T>(task: Promise<T>): Promise<T> {
  checkCancelled(); const signal = chatSignal(); if (!signal) return task;
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener('abort', aborted, { once: true });
    task.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}
export async function withChatCancellation(res: Response, operation: () => Promise<unknown>) {
  const controller = new AbortController();
  const closed = () => { if (!res.writableFinished) controller.abort(new DOMException('Generation stopped', 'AbortError')); };
  res.once('close', closed);
  try { return await scope.run(controller.signal, operation); }
  catch (error) { if (!controller.signal.aborted) throw error; }
  finally { res.off('close', closed); }
}
export function cancellableFetch(fetcher: typeof fetch, input: Parameters<typeof fetch>[0], init?: RequestInit) {
  checkCancelled();
  const signal = chatSignal();
  const inherited = init?.signal || (input instanceof Request ? input.signal : undefined);
  return fetcher(input, { ...init, ...(signal ? { signal: inherited ? AbortSignal.any([signal, inherited]) : signal } : {}) });
}
