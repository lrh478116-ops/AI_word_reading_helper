import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.AI_TIP_EMBEDDED = "1";
process.env.AI_TIP_SUPABASE_ENABLED = "0";
const dataDir = await mkdtemp(path.join(tmpdir(), "ai-tip-versioned-save-"));
process.env.AI_TIP_DATA_DIR = dataDir;

const { startServer } = await import("../server/index.ts");
let server: Awaited<ReturnType<typeof startServer>> | undefined;

try {
  server = await startServer(0, "127.0.0.1");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("versioned save test server did not bind a TCP port");
  const baseURL = `http://127.0.0.1:${address.port}/api`;
  const login = await fetch(`${baseURL}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "demo@aitip.local", password: "demo1234" }) });
  assert.equal(login.status, 200);
  const token = String((await login.json()).token || ""); assert.ok(token);
  const request = async (route: string, init: RequestInit = {}) => {
    const response = await fetch(baseURL + route, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers || {}) } });
    const body = await response.json().catch(() => ({}));
    return { response, body };
  };
  const save = (id: string, payload: Record<string, unknown>) => request(`/documents/${id}/changes`, { method: "PATCH", body: JSON.stringify({ clientEditId: randomUUID(), ...payload }) });

  const created = await request("/documents", { method: "POST", body: "{}" });
  assert.equal(created.response.status, 201);
  const original = created.body.document;
  assert.equal(original.revision, 1, "new documents must start at revision 1");
  const firstBlock = original.blocks[0];

  const unversionedLegacyWrite = await request(`/documents/${original.id}`, { method: "PATCH", body: JSON.stringify({ title: "must not bypass revision" }) });
  assert.equal(unversionedLegacyWrite.response.status, 428); assert.equal(unversionedLegacyWrite.body.code, "DOCUMENT_REVISION_REQUIRED");
  const afterUnversionedWrite = await request(`/documents/${original.id}`);
  assert.equal(afterUnversionedWrite.body.document.title, original.title); assert.equal(afterUnversionedWrite.body.document.revision, 1);

  const firstSave = await save(original.id, { baseRevision: 1, blocks: [{ ...firstBlock, content: "version two" }], newBlockIds: [] });
  assert.equal(firstSave.response.status, 200);
  assert.equal(firstSave.body.document.revision, 2);
  assert.equal(firstSave.body.save.savedBlockCount, 1);
  assert.ok(Number.isFinite(firstSave.body.save.durationMs) && firstSave.body.save.durationMs >= 0, "save diagnostics must report a finite non-negative duration without document content");
  assert.match(firstSave.body.document.blocks[0].contentHash, /^[a-f0-9]{64}$/);

  const stamp = new Date().toISOString();
  const secondId = randomUUID();
  const added = await save(original.id, { baseRevision: 2, blocks: [{ id: secondId, documentId: original.id, type: "quote", content: "keep this block", order: 1, contentHash: "fabricated", createdAt: stamp, updatedAt: stamp }], newBlockIds: [secondId] });
  assert.equal(added.response.status, 200); assert.equal(added.body.document.revision, 3);

  const changedCreatedBlock = await save(original.id, { baseRevision: 3, blocks: [{ ...added.body.document.blocks.find((block: { id: string }) => block.id === secondId), content: "edited after creation" }], newBlockIds: [] });
  assert.equal(changedCreatedBlock.response.status, 200); assert.equal(changedCreatedBlock.body.document.revision, 4);
  assert.equal(changedCreatedBlock.body.document.blocks.find((block: { id: string }) => block.id === secondId)?.content, "edited after creation", "a block created by one receipt must be editable as an existing block in the next revision");

  const changedOne = await save(original.id, { baseRevision: 4, title: "Versioned title", blocks: [{ ...changedCreatedBlock.body.document.blocks[0], content: "only this block changed" }], newBlockIds: [] });
  assert.equal(changedOne.response.status, 200); assert.equal(changedOne.body.document.revision, 5);
  assert.equal(changedOne.body.document.blocks.find((block: { id: string }) => block.id === secondId)?.content, "edited after creation", "incremental save must preserve unsubmitted blocks");
  assert.equal(changedOne.body.save.savedBlockCount, 1);

  const beforeConflict = await request(`/documents/${original.id}`);
  const stale = await save(original.id, { baseRevision: 4, title: "stale overwrite", blocks: [], newBlockIds: [] });
  assert.equal(stale.response.status, 409); assert.equal(stale.body.code, "DOCUMENT_REVISION_CONFLICT");
  const afterConflict = await request(`/documents/${original.id}`);
  assert.equal(afterConflict.body.document.title, "Versioned title");
  assert.equal(afterConflict.body.document.revision, 5);
  assert.equal(afterConflict.body.document.updatedAt, beforeConflict.body.document.updatedAt, "a rejected conflict must not mutate timestamps");

  const unknownId = randomUUID();
  const unknown = await save(original.id, { baseRevision: 5, blocks: [{ ...firstBlock, id: unknownId, content: "fabricated replacement" }], newBlockIds: [] });
  assert.equal(unknown.response.status, 400); assert.equal(unknown.body.code, "DOCUMENT_BLOCK_UNKNOWN");
  const duplicate = await save(original.id, { baseRevision: 5, blocks: [{ ...changedOne.body.document.blocks[0] }, { ...changedOne.body.document.blocks[0] }], newBlockIds: [] });
  assert.equal(duplicate.response.status, 400); assert.equal(duplicate.body.code, "DOCUMENT_BLOCK_DUPLICATE");
  const duplicateCreate = await save(original.id, { baseRevision: 5, blocks: [{ ...changedOne.body.document.blocks.find((block: { id: string }) => block.id === secondId) }], newBlockIds: [secondId] });
  assert.equal(duplicateCreate.response.status, 409); assert.equal(duplicateCreate.body.code, "DOCUMENT_BLOCK_ALREADY_EXISTS");
  const tooMany = await save(original.id, { baseRevision: 5, blocks: Array.from({ length: 2001 }, () => ({ ...changedOne.body.document.blocks[0] })), newBlockIds: [] });
  assert.equal(tooMany.response.status, 413); assert.equal(tooMany.body.code, "DOCUMENT_BLOCKS_LIMIT");
  const missingDocument = await save(randomUUID(), { baseRevision: 1, title: "must not exist", blocks: [], newBlockIds: [] });
  assert.equal(missingDocument.response.status, 404);

  const tableId = randomUUID();
  const table = await save(original.id, { baseRevision: 5, blocks: [{ id: tableId, documentId: original.id, type: "table", content: "stale content", table: { rows: [["A", "B"], ["1", "2"]], headerRows: 1, source: "docx" }, order: 2, contentHash: "fabricated", createdAt: stamp, updatedAt: stamp }], newBlockIds: [tableId] });
  assert.equal(table.response.status, 200); assert.equal(table.body.document.revision, 6);
  assert.equal(table.body.document.blocks.find((block: { id: string }) => block.id === tableId)?.content, "A\tB\n1\t2", "table rows must causally determine persisted content");
  const malformed = await save(original.id, { baseRevision: 6, blocks: [{ ...table.body.document.blocks.find((block: { id: string }) => block.id === tableId), table: { rows: "not-an-array" } }], newBlockIds: [] });
  assert.equal(malformed.response.status, 400);
  const afterMalformed = await request(`/documents/${original.id}`); assert.equal(afterMalformed.body.document.revision, 6);

  const secondLogin = await fetch(`${baseURL}/auth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Second", email: "second-save@example.test", password: "Password12345" }) });
  const secondToken = String((await secondLogin.json()).token || ""); assert.ok(secondToken);
  const crossUser = await fetch(`${baseURL}/documents/${original.id}/changes`, { method: "PATCH", headers: { authorization: `Bearer ${secondToken}`, "content-type": "application/json" }, body: JSON.stringify({ clientEditId: randomUUID(), baseRevision: 6, title: "cross user" }) });
  assert.equal(crossUser.status, 404);

  const storePath = path.join(dataDir, "store.json");
  const persisted = JSON.parse(await readFile(storePath, "utf8"));
  delete persisted.documents.find((document: { id: string }) => document.id === original.id).revision;
  await writeFile(storePath, JSON.stringify(persisted, null, 2), "utf8");
  const migrated = await request(`/documents/${original.id}`);
  assert.equal(migrated.body.document.revision, 1, "legacy documents without revision must migrate deterministically to revision 1");

  console.log(JSON.stringify({ revisionCreated: true, unversionedLegacyBypassBlocked: true, incrementalBlockUpsert: true, createdBlockReusedWithoutDuplicateCreate: true, serverReceiptConsumed: true, staleConflictRejected: true, conflictHasNoWrite: true, fabricatedUnknownBlocked: true, duplicateBlocked: true, duplicateCreateBlocked: true, blockLimitBlocked: true, missingDocumentBlocked: true, tableDerivedContent: true, malformedTableBlocked: true, crossUserBlocked: true, legacyRevisionMigrated: true, evidence: "FORMAL_PATH_INTEGRATION" }));
} finally {
  if (server) { server.closeAllConnections(); await new Promise<void>((resolve) => server!.close(() => resolve())); }
  await rm(dataDir, { recursive: true, force: true });
}
