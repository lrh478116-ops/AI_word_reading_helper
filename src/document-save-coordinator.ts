import type { DocumentBlock, DocumentItem } from "./types";

export type DocumentSaveStatus = "saved" | "pending" | "saving" | "error";

export interface DocumentSaveState {
  status: DocumentSaveStatus;
  error: string;
}

export interface VersionedDocumentSaveBatch {
  documentId: string;
  baseRevision: number;
  clientEditId: string;
  editVersion: number;
  title?: string;
  titleVersion: number | null;
  blocks: DocumentBlock[];
  blockVersions: Record<string, number>;
  newBlockIds: string[];
}

export interface VersionedDocumentSaveReceipt {
  document: DocumentItem;
  save: { clientEditId: string; baseRevision: number; revision: number; savedBlockCount: number; durationMs: number };
}

export interface VersionedDocumentDirtyState {
  titleVersion: number | null;
  blockVersions: Map<string, number>;
  newBlockIds: Set<string>;
}

export function applyVersionedDocumentSaveReceipt(current: DocumentItem, batch: VersionedDocumentSaveBatch, receipt: VersionedDocumentSaveReceipt, dirty: VersionedDocumentDirtyState) {
  if (receipt.document.id !== batch.documentId || current.id !== batch.documentId || receipt.save.clientEditId !== batch.clientEditId || receipt.save.baseRevision !== batch.baseRevision || receipt.save.revision !== receipt.document.revision || receipt.document.revision !== batch.baseRevision + 1 || receipt.save.savedBlockCount !== batch.blocks.length) {
    throw new Error("保存回执与当前文档版本不匹配");
  }
  const receiptBlocks = new Map(receipt.document.blocks.map((block) => [block.id, block]));
  for (const blockId of Object.keys(batch.blockVersions)) if (!receiptBlocks.has(blockId)) throw new Error(`保存回执缺少文档块 ${blockId}`);
  // A successful receipt proves that every submitted new block now exists on
  // the server. Later edits to the same block remain dirty, but must no longer
  // be sent as a creation in the next revision.
  for (const blockId of batch.newBlockIds) dirty.newBlockIds.delete(blockId);
  const confirmedBlocks = new Set<string>();
  for (const [blockId, version] of Object.entries(batch.blockVersions)) {
    if (dirty.blockVersions.get(blockId) !== version) continue;
    dirty.blockVersions.delete(blockId);
    confirmedBlocks.add(blockId);
  }
  const titleConfirmed = batch.titleVersion !== null && dirty.titleVersion === batch.titleVersion;
  return {
    document: {
      ...current,
      title: titleConfirmed ? receipt.document.title : current.title,
      blocks: current.blocks.map((block) => confirmedBlocks.has(block.id) ? receiptBlocks.get(block.id)! : block),
      revision: receipt.document.revision,
      updatedAt: current.updatedAt > receipt.document.updatedAt ? current.updatedAt : receipt.document.updatedAt,
      cloudState: receipt.document.cloudState ?? current.cloudState
    },
    titleConfirmed
  };
}

interface DocumentSaveCoordinatorOptions<TSnapshot, TReceipt> {
  capture: () => TSnapshot | null;
  persist: (snapshot: TSnapshot) => Promise<TReceipt>;
  commit: (snapshot: TSnapshot, receipt: TReceipt) => void;
  onStateChange?: (state: DocumentSaveState) => void;
  idleDelayMs?: number;
  maximumDelayMs?: number;
  setTimer?: (callback: () => void, delay: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "Document save failed");
}

export class DocumentSaveCoordinator<TSnapshot, TReceipt> {
  private readonly capture: () => TSnapshot | null;
  private readonly persist: (snapshot: TSnapshot) => Promise<TReceipt>;
  private readonly commit: (snapshot: TSnapshot, receipt: TReceipt) => void;
  private readonly onStateChange?: (state: DocumentSaveState) => void;
  private readonly idleDelayMs: number;
  private readonly maximumDelayMs: number;
  private readonly setTimer: (callback: () => void, delay: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private idleTimer: unknown | null = null;
  private maximumTimer: unknown | null = null;
  private flushPromise: Promise<void> | null = null;
  private disposed = false;
  state: DocumentSaveState = { status: "saved", error: "" };

  constructor(options: DocumentSaveCoordinatorOptions<TSnapshot, TReceipt>) {
    this.capture = options.capture;
    this.persist = options.persist;
    this.commit = options.commit;
    this.onStateChange = options.onStateChange;
    this.idleDelayMs = Math.max(0, options.idleDelayMs ?? 350);
    this.maximumDelayMs = Math.max(this.idleDelayMs, options.maximumDelayMs ?? 2_000);
    this.setTimer = options.setTimer ?? ((callback, delay) => globalThis.setTimeout(callback, delay));
    this.clearTimer = options.clearTimer ?? ((handle) => globalThis.clearTimeout(handle as number));
  }

  private publish(status: DocumentSaveStatus, error = "") {
    if (this.disposed) return;
    this.state = { status, error };
    this.onStateChange?.(this.state);
  }

  private clearIdleTimer() {
    if (this.idleTimer === null) return;
    this.clearTimer(this.idleTimer);
    this.idleTimer = null;
  }

  private clearMaximumTimer() {
    if (this.maximumTimer === null) return;
    this.clearTimer(this.maximumTimer);
    this.maximumTimer = null;
  }

  private clearTimers() {
    this.clearIdleTimer();
    this.clearMaximumTimer();
  }

  private timerFlush() {
    void this.flush().catch(() => undefined);
  }

  markDirty() {
    if (this.disposed) throw new Error("Document save coordinator is disposed");
    this.publish("pending");
    this.clearIdleTimer();
    this.idleTimer = this.setTimer(() => {
      this.idleTimer = null;
      this.timerFlush();
    }, this.idleDelayMs);
    if (this.maximumTimer === null) {
      this.maximumTimer = this.setTimer(() => {
        this.maximumTimer = null;
        this.timerFlush();
      }, this.maximumDelayMs);
    }
  }

  private async run() {
    try {
      while (!this.disposed) {
        this.clearTimers();
        const snapshot = this.capture();
        if (!snapshot) {
          this.publish("saved");
          return;
        }
        this.publish("saving");
        const receipt = await this.persist(snapshot);
        if (this.disposed) return;
        this.commit(snapshot, receipt);
      }
    } catch (error) {
      this.clearTimers();
      this.publish("error", errorMessage(error));
      throw error;
    }
  }

  flush() {
    if (this.disposed) return Promise.reject(new Error("Document save coordinator is disposed"));
    this.clearTimers();
    if (this.flushPromise) return this.flushPromise;
    const pending = this.run();
    this.flushPromise = pending;
    const clear = () => { if (this.flushPromise === pending) this.flushPromise = null; };
    void pending.then(clear, clear);
    return pending;
  }

  dispose() {
    this.disposed = true;
    this.clearTimers();
  }
}
