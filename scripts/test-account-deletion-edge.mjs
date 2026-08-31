import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { createDeleteAccountHandler } from "../supabase/functions/delete-account/core.mjs";

const schema = await readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8");
assert.match(schema, /private\.ai_tip_active_auth_user\s*\(\s*\)/, "Storage policies must verify the auth user still exists");
for (const policy of ["select", "insert", "update", "delete"]) {
  assert.match(schema, new RegExp(`ai_document_files_${policy}_own[\\s\\S]{0,900}ai_tip_active_auth_user\\s*\\(\\s*\\)`, "i"), `${policy} policy can be used by a deleted user's stale JWT`);
}

const userId = "11111111-1111-4111-8111-111111111111";
const userToken = "verified-user-jwt";
const config = {
  supabaseUrl: "https://project.supabase.co",
  publishableKey: "sb_publishable_test",
  serviceRoleKey: "service-role-test-only",
  bucket: "ai-document-files",
  listPageSize: 2
};

function response(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

function successfulFetch(calls) {
  const objects = [
    { name: `${userId}/one.pdf.gz` },
    { name: `${userId}/two.docx.gz` },
    { name: `${userId}/three.txt.gz` }
  ];
  return async (input, init = {}) => {
    const url = new URL(String(input));
    const method = String(init.method || "GET").toUpperCase();
    const headers = new Headers(init.headers);
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method, path: url.pathname, headers, body });
    if (url.pathname === "/auth/v1/user" && method === "GET") return response({ id: userId, email: "review@example.test" });
    if (url.pathname === "/storage/v1/object/list/ai-document-files" && method === "POST") {
      return response(objects.slice(body.offset, body.offset + body.limit));
    }
    if (url.pathname === "/storage/v1/object/ai-document-files" && method === "DELETE") return response({ message: "Deleted" });
    if (url.pathname === `/auth/v1/admin/users/${userId}` && method === "DELETE") return response({ id: userId });
    return response({ message: "unexpected request" }, 500);
  };
}

{
  let called = false;
  const handler = createDeleteAccountHandler(config, async () => { called = true; return response({}, 500); });
  const result = await handler(new Request("https://function.example/delete-account", { method: "DELETE" }));
  assert.equal(result.status, 401, "missing JWT must be rejected before upstream calls");
  assert.equal(called, false, "missing JWT reached Supabase");
}

{
  const calls = [];
  const handler = createDeleteAccountHandler(config, successfulFetch(calls));
  const result = await handler(new Request("https://function.example/delete-account", { method: "DELETE", headers: { Authorization: `Bearer ${userToken}` } }));
  const body = await result.json();
  assert.equal(result.status, 200);
  assert.deepEqual(body, { deleted: true, userId, storageObjectsDeleted: 3 });
  assert.equal(calls[0].path, "/auth/v1/user", "user identity must be verified before deletion");
  assert.equal(calls[0].headers.get("authorization"), `Bearer ${userToken}`);
  assert.equal(calls[0].headers.get("apikey"), config.publishableKey);
  const storageDelete = calls.find((call) => call.method === "DELETE" && call.path.includes("/storage/v1/object/"));
  const adminDelete = calls.find((call) => call.method === "DELETE" && call.path.includes("/auth/v1/admin/users/"));
  assert.ok(storageDelete, "storage objects were not deleted");
  assert.ok(adminDelete, "Auth user was not deleted");
  assert.ok(calls.indexOf(storageDelete) < calls.indexOf(adminDelete), "Auth user was deleted before owned Storage objects");
  assert.deepEqual(storageDelete.body.prefixes, [`${userId}/one.pdf.gz`, `${userId}/two.docx.gz`, `${userId}/three.txt.gz`]);
  assert.equal(adminDelete.headers.get("authorization"), `Bearer ${config.serviceRoleKey}`);
  assert.ok(calls.filter((call) => call.path.includes("/storage/v1/object/list/")).length >= 2, "Storage pagination was not consumed");
}

{
  const calls = [];
  const base = successfulFetch(calls);
  const handler = createDeleteAccountHandler(config, async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/storage/v1/object/ai-document-files" && String(init?.method).toUpperCase() === "DELETE") {
      calls.push({ method: "DELETE", path: url.pathname, headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
      return response({ message: "storage unavailable" }, 503);
    }
    return base(input, init);
  });
  const result = await handler(new Request("https://function.example/delete-account", { method: "DELETE", headers: { Authorization: `Bearer ${userToken}` } }));
  assert.equal(result.status, 502, "Storage failure must be surfaced");
  assert.equal(calls.some((call) => call.path.includes("/auth/v1/admin/users/")), false, "Auth user was deleted after Storage cleanup failed");
}

console.log(JSON.stringify({ edgeAccountDeletion: true, unauthenticatedBlocked: true, storageBeforeAuth: true, paginationConsumed: true, cleanupFailureBlocked: true }));
