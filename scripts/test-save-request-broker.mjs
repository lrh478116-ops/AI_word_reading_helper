import assert from "node:assert/strict";
import { createSaveRequestBroker } from "../electron/save-request-broker.mjs";

{
  const sent = [];
  const broker = createSaveRequestBroker({ send: (payload) => { sent.push(payload); return true; }, timeoutMs: 1000, createRequestId: () => "request-1" });
  const pending = broker.request("window-close");
  assert.deepEqual(sent, [{ requestId: "request-1", reason: "window-close" }]);
  assert.equal(broker.accept("forged-id", { ok: true }), false);
  assert.equal(broker.accept("request-1", { ok: true }), true);
  assert.deepEqual(await pending, { ok: true });
  assert.equal(broker.accept("request-1", { ok: true }), false, "a reply must be consumed exactly once");
}

{
  const broker = createSaveRequestBroker({ send: () => true, timeoutMs: 1000, createRequestId: () => "request-error" });
  const pending = broker.request("app-quit");
  broker.accept("request-error", { ok: false, error: "controlled save failure" });
  await assert.rejects(pending, /controlled save failure/);
}

{
  const broker = createSaveRequestBroker({ send: () => true, timeoutMs: 20, createRequestId: () => "request-timeout" });
  await assert.rejects(broker.request("app-quit"), /timed out/i);
}

{
  const broker = createSaveRequestBroker({ send: () => false, timeoutMs: 1000, createRequestId: () => "request-no-renderer" });
  await assert.rejects(broker.request("window-close"), /renderer is unavailable/i);
}

{
  const broker = createSaveRequestBroker({ send: () => true, timeoutMs: 1000, createRequestId: () => "request-cancel" });
  const pending = broker.request("app-quit"); broker.cancelAll("window destroyed");
  await assert.rejects(pending, /window destroyed/); assert.equal(broker.pendingCount, 0);
}

console.log(JSON.stringify({ requestCorrelation: true, oneShotReply: true, rendererFailure: true, timeoutFailure: true, unavailableRendererFailure: true, cancellation: true, evidence: "COMPONENT_CAPABILITY" }));
