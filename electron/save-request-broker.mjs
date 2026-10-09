import { randomUUID } from "node:crypto";

export class SaveRequestError extends Error {
  constructor(message, code = "SAVE_BEFORE_CLOSE_FAILED") {
    super(message);
    this.name = "SaveRequestError";
    this.code = code;
  }
}
export function createSaveRequestBroker({
  send,
  timeoutMs = 10_000,
  createRequestId = randomUUID,
  setTimer = setTimeout,
  clearTimer = clearTimeout
}) {
  const pending = new Map();

  const finish = (requestId, action) => {
    const entry = pending.get(requestId);
    if (!entry) return false;
    pending.delete(requestId);
    clearTimer(entry.timer);
    action(entry);
    return true;
  };

  return Object.freeze({
    request(reason) {
      const requestId = createRequestId();
      return new Promise((resolve, reject) => {
        const timer = setTimer(() => {
          finish(requestId, ({ reject: rejectPending }) => rejectPending(new SaveRequestError("Saving timed out before the application could close", "SAVE_BEFORE_CLOSE_TIMEOUT")));
        }, timeoutMs);
        pending.set(requestId, { resolve, reject, timer });
        let sent = false;
        try { sent = send({ requestId, reason }) !== false; }
        catch (error) {
          finish(requestId, ({ reject: rejectPending }) => rejectPending(error));
          return;
        }
        if (!sent) finish(requestId, ({ reject: rejectPending }) => rejectPending(new SaveRequestError("The renderer is unavailable, so the document could not be saved", "SAVE_RENDERER_UNAVAILABLE")));
      });
    },
    accept(requestId, result = {}) {
      return finish(String(requestId || ""), ({ resolve, reject }) => {
        if (result.ok === true) resolve({ ok: true });
        else reject(new SaveRequestError(String(result.error || "Document save failed"), String(result.code || "SAVE_BEFORE_CLOSE_FAILED")));
      });
    },
    cancelAll(message = "Save request was cancelled") {
      for (const requestId of [...pending.keys()]) finish(requestId, ({ reject }) => reject(new SaveRequestError(message, "SAVE_REQUEST_CANCELLED")));
    },
    get pendingCount() { return pending.size; }
  });
}
