import assert from "node:assert/strict";
import { applyVersionedDocumentSaveReceipt, DocumentSaveCoordinator } from "../src/document-save-coordinator.ts";
import type { DocumentBlock, DocumentItem } from "../src/types.ts";

class FakeClock {
  now = 0;
  nextId = 1;
  timers = new Map<number, { at: number; callback: () => void }>();

  setTimeout = (callback: () => void, delay: number) => {
    const id = this.nextId++;
    this.timers.set(id, { at: this.now + delay, callback });
    return id;
  };

  clearTimeout = (id: number) => { this.timers.delete(id); };

  async advance(milliseconds: number) {
    const target = this.now + milliseconds;
    while (true) {
      const next = [...this.timers.entries()].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next || next[1].at > target) break;
      this.now = next[1].at;
      this.timers.delete(next[0]);
      next[1].callback();
      await settle();
    }
    this.now = target;
    await settle();
  }
}

const settle = async () => {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
};

function basicCoordinator(clock: FakeClock, calls: number[], states: string[]) {
  let editedVersion = 0;
  let savedVersion = 0;
  const coordinator = new DocumentSaveCoordinator({
    capture: () => editedVersion > savedVersion ? { version: editedVersion } : null,
    persist: async (snapshot) => { calls.push(snapshot.version); return { version: snapshot.version }; },
    commit: (snapshot) => { savedVersion = Math.max(savedVersion, snapshot.version); },
    onStateChange: (state) => states.push(state.status),
    idleDelayMs: 350,
    maximumDelayMs: 2_000,
    setTimer: clock.setTimeout,
    clearTimer: clock.clearTimeout
  });
  return { coordinator, edit: () => { editedVersion += 1; coordinator.markDirty(); }, saved: () => savedVersion };
}

{
  const clock = new FakeClock(); const calls: number[] = []; const states: string[] = [];
  const { coordinator, edit, saved } = basicCoordinator(clock, calls, states);
  edit();
  assert.equal(coordinator.state.status, "pending");
  await clock.advance(349); assert.deepEqual(calls, []);
  await clock.advance(1); assert.deepEqual(calls, [1]); assert.equal(saved(), 1); assert.equal(coordinator.state.status, "saved");
  assert.deepEqual(states.slice(-3), ["pending", "saving", "saved"]);
  coordinator.dispose();
}

{
  const clock = new FakeClock(); const calls: number[] = []; const states: string[] = [];
  const { coordinator, edit } = basicCoordinator(clock, calls, states);
  edit();
  for (let index = 0; index < 9; index += 1) { await clock.advance(200); edit(); }
  assert.deepEqual(calls, [], "continuous input must not trigger the idle timer early");
  await clock.advance(200);
  assert.deepEqual(calls, [10], "the maximum dirty interval must force a save despite continuous input");
  coordinator.dispose();
}

{
  let editedVersion = 1; let savedVersion = 0; let releaseFirst!: () => void;
  const calls: number[] = [];
  const coordinator = new DocumentSaveCoordinator({
    capture: () => editedVersion > savedVersion ? { version: editedVersion } : null,
    persist: async (snapshot) => {
      calls.push(snapshot.version);
      if (calls.length === 1) await new Promise<void>((resolve) => { releaseFirst = resolve; });
      return snapshot;
    },
    commit: (snapshot) => { savedVersion = Math.max(savedVersion, snapshot.version); }
  });
  coordinator.markDirty();
  const flush = coordinator.flush(); await settle();
  editedVersion = 2; coordinator.markDirty();
  releaseFirst(); await flush;
  assert.deepEqual(calls, [1, 2], "an in-flight receipt must not clear edits created after its snapshot");
  assert.equal(savedVersion, 2); assert.equal(coordinator.state.status, "saved");
  coordinator.dispose();
}

{
  let pending = true; let fail = true; const states: string[] = [];
  const coordinator = new DocumentSaveCoordinator({
    capture: () => pending ? { version: 1 } : null,
    persist: async () => { if (fail) throw new Error("controlled disk failure"); return { version: 1 }; },
    commit: () => { pending = false; },
    onStateChange: (state) => states.push(`${state.status}:${state.error || ""}`)
  });
  coordinator.markDirty();
  await assert.rejects(coordinator.flush(), /controlled disk failure/);
  assert.equal(pending, true, "failed persistence must keep the dirty snapshot");
  assert.equal(coordinator.state.status, "error");
  assert.match(coordinator.state.error, /controlled disk failure/);
  fail = false; await coordinator.flush();
  assert.equal(pending, false); assert.equal(coordinator.state.status, "saved");
  assert.ok(states.some((state) => state.startsWith("error:")));
  coordinator.dispose();
}

{
  const clock = new FakeClock(); const calls: number[] = []; const states: string[] = [];
  const { coordinator, edit } = basicCoordinator(clock, calls, states);
  edit(); coordinator.dispose(); await clock.advance(3_000);
  assert.deepEqual(calls, [], "disposed editors must not save through stale timers");
  await assert.rejects(coordinator.flush(), /disposed/i);
}

{
  const stamp = "2026-10-09T00:00:00.000Z";
  const original: DocumentBlock = { id: "block-original", documentId: "document-1", type: "paragraph", content: "original", order: 0, contentHash: "original-hash", createdAt: stamp, updatedAt: stamp };
  const newerNewBlock: DocumentBlock = { id: "block-new", documentId: "document-1", type: "quote", content: "edited while creation was saving", order: 1, contentHash: "client-newer", createdAt: stamp, updatedAt: stamp };
  const current: DocumentItem = { id: "document-1", userId: "user-1", revision: 1, title: "Document", sourceType: "blank", favorite: true, status: "active", blocks: [original, newerNewBlock], createdAt: stamp, updatedAt: "2026-10-09T00:00:02.000Z", lastOpenedAt: stamp, tipCount: 0, cloudState: "synced" };
  const serverCreatedBlock = { ...newerNewBlock, content: "first creation snapshot", contentHash: "server-hash", updatedAt: "2026-10-09T00:00:01.000Z" };
  const dirty = { titleVersion: null, blockVersions: new Map([[newerNewBlock.id, 2]]), newBlockIds: new Set([newerNewBlock.id]) };
  const batch = { documentId: current.id, baseRevision: 1, clientEditId: "edit-request-1", editVersion: 1, titleVersion: null, blocks: [{ ...newerNewBlock, content: "first creation snapshot" }], blockVersions: { [newerNewBlock.id]: 1 }, newBlockIds: [newerNewBlock.id] };
  const receipt = { document: { ...current, favorite: false, cloudState: "modified" as const, revision: 2, updatedAt: "2026-10-09T00:00:01.000Z", blocks: [original, serverCreatedBlock] }, save: { clientEditId: batch.clientEditId, baseRevision: 1, revision: 2, savedBlockCount: 1, durationMs: 1 } };
  const forgedDirty = { titleVersion: null, blockVersions: new Map(dirty.blockVersions), newBlockIds: new Set(dirty.newBlockIds) };
  assert.throws(() => applyVersionedDocumentSaveReceipt(current, batch, { ...receipt, save: { ...receipt.save, savedBlockCount: 0 } }, forgedDirty), /回执/);
  assert.equal(forgedDirty.blockVersions.get(newerNewBlock.id), 2, "a rejected receipt must not clear dirty block lineage");
  assert.equal(forgedDirty.newBlockIds.has(newerNewBlock.id), true, "a rejected receipt must not convert a new block into an existing block");
  const applied = applyVersionedDocumentSaveReceipt(current, batch, receipt, dirty);
  assert.equal(applied.document.blocks[1].content, "edited while creation was saving", "a creation receipt must not overwrite a later edit");
  assert.equal(dirty.blockVersions.get(newerNewBlock.id), 2, "the later edit must remain dirty");
  assert.equal(dirty.newBlockIds.has(newerNewBlock.id), false, "a successfully created block must become an existing block for the next revision");
  assert.equal(applied.document.favorite, true, "an unrelated metadata change made while content was saving must not be rolled back by the older content receipt");
  assert.equal(applied.document.updatedAt, current.updatedAt, "an older content receipt must not move metadata time backwards");
  assert.equal(applied.document.cloudState, "modified", "the save receipt must still make the server-derived cloud modification state authoritative");
}

console.log(JSON.stringify({ idleAutosave: true, maximumDirtyInterval: true, inFlightEditPreserved: true, failureRetainsDirty: true, disposedTimerBlocked: true, inFlightNewBlockEditPreservedWithoutDuplicateCreate: true, unrelatedMetadataPreserved: true, forgedReceiptRejectedWithoutClearingDirtyState: true, evidence: "COMPONENT_CAPABILITY" }));
