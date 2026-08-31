import type { CloudUsage, DocumentItem, TipThread, User } from "../src/types.js";
import { promisify } from "node:util";
import { gzip, gunzip, constants as zlibConstants } from "node:zlib";

const DEFAULT_SUPABASE_URL = "https://kaqonqxygajosgddhmaq.supabase.co";
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_L7ahQAOHGZ3qa1isqPqphQ_35-EzgIa";
const STORAGE_BUCKET = "ai-document-files";
const TUS_CHUNK_SIZE = 6 * 1024 * 1024;
export const CLOUD_USER_QUOTA_BYTES = 5 * 1024 * 1024;
const CLOUD_SOURCE_ARCHIVE_TYPE = "application/gzip";
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export interface SupabaseAuthUser {
  id: string;
  email: string;
  user_metadata?: Record<string, unknown>;
  identities?: unknown[];
}

export interface SupabaseSession {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  expires_at?: number;
  token_type?: string;
  user: SupabaseAuthUser;
}

export interface SupabaseSignUpResult {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  expires_at?: number;
  token_type?: string;
  user: SupabaseAuthUser;
}

interface CloudDocumentRow { id: string; user_id: string; payload: DocumentItem; source_path?: string | null; updated_at: string }
interface CloudTipRow { id: string; user_id: string; document_id: string; payload: TipThread; updated_at: string }

export class SupabaseRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

function configuration() {
  if (process.env.AI_TIP_SUPABASE_ENABLED === "0") return null;
  const url = String(process.env.AI_TIP_SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/$/, "");
  const publishableKey = String(process.env.AI_TIP_SUPABASE_PUBLISHABLE_KEY || DEFAULT_SUPABASE_PUBLISHABLE_KEY);
  const parsed = new URL(url);
  const allowedLocal = process.env.AI_TIP_ALLOW_INSECURE_SUPABASE === "1" && parsed.protocol === "http:" && ["127.0.0.1", "localhost"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !allowedLocal) throw new Error("Supabase 必须使用 HTTPS");
  const storageUrl = parsed.hostname.endsWith(".supabase.co")
    ? `${parsed.protocol}//${parsed.hostname.slice(0, -".supabase.co".length)}.storage.supabase.co`
    : url;
  return { url, storageUrl, publishableKey };
}

export function supabaseEnabled() { return Boolean(configuration()); }

async function request(path: string, init: RequestInit = {}, token = "", timeoutMs = 20_000) {
  const config = configuration();
  if (!config) throw new SupabaseRequestError("Supabase 云同步未启用", 503);
  const headers = new Headers(init.headers);
  headers.set("apikey", config.publishableKey);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const target = /^https?:\/\//i.test(path) ? path : `${config.url}${path}`;
  const response = await fetch(target, { ...init, headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { message?: string; msg?: string; error_description?: string; error?: string };
    throw new SupabaseRequestError(body.message || body.msg || body.error_description || body.error || `Supabase 返回 ${response.status}`, response.status);
  }
  return response;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function authUser(value: unknown): SupabaseAuthUser | null {
  const candidate = objectValue(value);
  if (!candidate || typeof candidate.id !== "string" || !candidate.id || typeof candidate.email !== "string" || !candidate.email) return null;
  return candidate as unknown as SupabaseAuthUser;
}

function sessionFromPayload(value: unknown, operation: string): SupabaseSession {
  const payload = objectValue(value);
  const user = authUser(payload?.user);
  if (!payload || typeof payload.access_token !== "string" || !payload.access_token || typeof payload.refresh_token !== "string" || !payload.refresh_token || !user) {
    throw new SupabaseRequestError(`Supabase ${operation}响应不是有效会话`, 502);
  }
  return { ...payload, access_token: payload.access_token, refresh_token: payload.refresh_token, user } as SupabaseSession;
}

async function authPayload(path: string, body: Record<string, unknown>) {
  const response = await request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return await response.json() as unknown;
}

export async function supabaseSignUp(name: string, email: string, password: string): Promise<SupabaseSignUpResult> {
  const value = await authPayload("/auth/v1/signup", { email, password, data: { name } });
  const payload = objectValue(value);
  const hasTokenField = typeof payload?.access_token === "string" || typeof payload?.refresh_token === "string";
  if (hasTokenField) return sessionFromPayload(value, "注册");
  const user = authUser(value) || authUser(payload?.user);
  if (!user) throw new SupabaseRequestError("Supabase 注册响应缺少有效用户信息", 502);
  return { user };
}

export async function supabaseSignIn(email: string, password: string) {
  return sessionFromPayload(await authPayload("/auth/v1/token?grant_type=password", { email, password }), "登录");
}

export async function supabaseRefresh(refreshToken: string) {
  return sessionFromPayload(await authPayload("/auth/v1/token?grant_type=refresh_token", { refresh_token: refreshToken }), "刷新会话");
}

export async function supabaseVerifyOtp(email: string, code: string, type: "signup" | "recovery") {
  return sessionFromPayload(await authPayload("/auth/v1/verify", { email, token: code, type }), "验证码验证");
}

export async function supabaseRequestPasswordRecovery(email: string) {
  await authPayload("/auth/v1/recover", { email });
}

export async function supabaseUpdatePassword(token: string, password: string) {
  const response = await request("/auth/v1/user", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password })
  }, token);
  const user = authUser(await response.json());
  if (!user) throw new SupabaseRequestError("Supabase 更新密码响应缺少有效用户信息", 502);
  return user;
}

export async function supabaseGetUser(token: string) {
  const response = await request("/auth/v1/user", { method: "GET" }, token);
  const user = authUser(await response.json());
  if (!user) throw new SupabaseRequestError("Supabase 用户响应缺少有效用户信息", 502);
  return user;
}

export async function supabaseDeleteAccount(token: string) {
  const response = await request("/functions/v1/delete-account", { method: "DELETE" }, token, 60_000);
  const value = objectValue(await response.json().catch(() => null));
  if (!value || value.deleted !== true || typeof value.userId !== "string") throw new SupabaseRequestError("Supabase 注销响应无效", 502);
  return { deleted: true as const, userId: value.userId, storageObjectsDeleted: Number(value.storageObjectsDeleted) || 0 };
}

export function publicSupabaseUser(user: SupabaseAuthUser): User {
  if (!user || typeof user.id !== "string" || typeof user.email !== "string") throw new SupabaseRequestError("Supabase 用户信息无效", 502);
  const metadataName = typeof user.user_metadata?.name === "string" ? user.user_metadata.name.trim() : "";
  return { id: user.id, name: metadataName || user.email.split("@")[0] || "云端用户", email: user.email, authMode: "supabase" };
}

export async function fetchCloudSnapshot(token: string, userId: string) {
  const suffix = `?select=*&user_id=eq.${encodeURIComponent(userId)}`;
  const [documentResponse, tipResponse] = await Promise.all([
    request(`/rest/v1/ai_documents${suffix}`, { headers: { Accept: "application/json" } }, token),
    request(`/rest/v1/ai_tips${suffix}`, { headers: { Accept: "application/json" } }, token)
  ]);
  return {
    documents: await documentResponse.json() as CloudDocumentRow[],
    tips: await tipResponse.json() as CloudTipRow[]
  };
}

function rawCloudSourcePath(userId: string, document: Pick<DocumentItem, "id" | "originalName" | "sourceType">) {
  if (!document.originalName) return null;
  const extensionByType: Partial<Record<DocumentItem["sourceType"], string>> = {
    pdf: ".pdf",
    docx: ".docx",
    markdown: ".md",
    txt: ".txt"
  };
  const extension = extensionByType[document.sourceType] || "";
  // Supabase Storage rejects Unicode and several punctuation characters in
  // object names. The user's original filename remains in DocumentItem; the
  // private storage key is an implementation detail and must stay ASCII-only.
  return `${userId}/${document.id}/source${extension}`;
}

export function legacyCloudSourcePath(userId: string, document: Pick<DocumentItem, "id" | "originalName" | "sourceType">) {
  return rawCloudSourcePath(userId, document);
}

export function cloudSourcePath(userId: string, document: Pick<DocumentItem, "id" | "originalName" | "sourceType">) {
  const rawPath = rawCloudSourcePath(userId, document);
  return rawPath ? `${rawPath}.gz` : null;
}

export function cloudSourcePaths(userId: string, document: Pick<DocumentItem, "id" | "originalName" | "sourceType">) {
  return [cloudSourcePath(userId, document), legacyCloudSourcePath(userId, document)].filter((value): value is string => Boolean(value));
}

async function upsert(table: "ai_documents" | "ai_tips", rows: unknown[], token: string) {
  if (!rows.length) return;
  await request(`/rest/v1/${table}?on_conflict=id`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows)
  }, token, 60_000);
}

export async function upsertCloudChanges(token: string, userId: string, documents: DocumentItem[], tips: TipThread[], sourcePaths = new Map<string, string | null>()) {
  await upsert("ai_documents", documents.map((document) => ({
    id: document.id,
    user_id: userId,
    payload: cloudDocumentPayload(document, userId),
    source_path: sourcePaths.has(document.id) ? sourcePaths.get(document.id) : cloudSourcePath(userId, document),
    updated_at: document.updatedAt
  })), token);
  await upsert("ai_tips", tips.map((tip) => ({
    id: tip.id,
    user_id: userId,
    document_id: tip.documentId,
    payload: { ...tip, userId },
    updated_at: tip.updatedAt
  })), token);
}

function cloudDocumentPayload(document: DocumentItem, userId: string) {
  const { cloudSyncedAt: _cloudSyncedAt, cloudState: _cloudState, ...payload } = document;
  return { ...payload, userId };
}

export async function fetchCloudUsage(token: string): Promise<CloudUsage> {
  const response = await request("/rest/v1/rpc/ai_tip_cloud_usage", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}"
  }, token);
  const raw = await response.json() as Array<Record<string, unknown>> | Record<string, unknown>;
  const row = Array.isArray(raw) ? raw[0] || {} : raw;
  return {
    usedBytes: Number(row.used_bytes) || 0,
    limitBytes: Number(row.limit_bytes) || CLOUD_USER_QUOTA_BYTES,
    storageBytes: Number(row.storage_bytes) || 0,
    databaseBytes: Number(row.database_bytes) || 0,
    objectCount: Number(row.object_count) || 0
  };
}

async function deleteRows(table: "ai_documents" | "ai_tips", ids: string[], token: string) {
  if (!ids.length) return;
  await request(`/rest/v1/${table}?id=in.(${ids.join(",")})`, { method: "DELETE", headers: { Prefer: "return=minimal" } }, token);
}

export const deleteCloudDocuments = (token: string, ids: string[]) => deleteRows("ai_documents", ids, token);
export const deleteCloudTips = (token: string, ids: string[]) => deleteRows("ai_tips", ids, token);

function encodedObjectPath(objectPath: string) {
  return objectPath.split("/").map(encodeURIComponent).join("/");
}

export async function uploadCloudSource(token: string, objectPath: string, bytes: Uint8Array, contentType: string) {
  if (!objectPath.endsWith(".gz")) throw new SupabaseRequestError("云端源文件路径必须使用 .gz 压缩包", 500);
  const archive = await gzipAsync(bytes, { level: zlibConstants.Z_BEST_COMPRESSION });
  if (archive.byteLength > CLOUD_USER_QUOTA_BYTES) throw new SupabaseRequestError("单个压缩包已超过 5 MB 用户云空间上限", 413);
  if (archive.byteLength > TUS_CHUNK_SIZE) {
    await uploadCloudSourceResumable(token, objectPath, archive, contentType);
  } else {
    await request(`/storage/v1/object/${STORAGE_BUCKET}/${encodedObjectPath(objectPath)}`, {
      method: "POST",
      headers: { "Content-Type": CLOUD_SOURCE_ARCHIVE_TYPE, "x-upsert": "true" },
      body: archive
    }, token, 180_000);
  }
  return { originalBytes: bytes.byteLength, storedBytes: archive.byteLength, resumable: archive.byteLength > TUS_CHUNK_SIZE };
}

export async function cloudSourceExists(token: string, objectPath: string) {
  try {
    await request(`/storage/v1/object/${STORAGE_BUCKET}/${encodedObjectPath(objectPath)}`, { method: "HEAD" }, token, 30_000);
    return true;
  } catch (error) {
    if (error instanceof SupabaseRequestError && error.status === 404) return false;
    throw error;
  }
}

function tusMetadata(values: Record<string, string>) {
  return Object.entries(values).map(([key, value]) => `${key} ${Buffer.from(value, "utf8").toString("base64")}`).join(",");
}

async function uploadCloudSourceResumable(token: string, objectPath: string, bytes: Uint8Array, contentType: string) {
  const config = configuration();
  if (!config) throw new SupabaseRequestError("Supabase 云同步未启用", 503);
  const endpoint = `${config.storageUrl}/storage/v1/upload/resumable`;
  const created = await request(endpoint, {
    method: "POST",
    headers: {
      "Tus-Resumable": "1.0.0",
      "Upload-Length": String(bytes.byteLength),
      "Upload-Metadata": tusMetadata({ bucketName: STORAGE_BUCKET, objectName: objectPath, contentType: CLOUD_SOURCE_ARCHIVE_TYPE, originalContentType: contentType || "application/octet-stream", cacheControl: "3600" }),
      "x-upsert": "true"
    }
  }, token, 60_000);
  const location = created.headers.get("location");
  if (!location) throw new SupabaseRequestError("Supabase 可续传上传没有返回 Location", 502);
  const uploadUrl = new URL(location, `${endpoint}/`).toString();
  let offset = 0;
  while (offset < bytes.byteLength) {
    const end = Math.min(bytes.byteLength, offset + TUS_CHUNK_SIZE);
    let attempts = 0;
    while (true) {
      try {
        const response = await request(uploadUrl, {
          method: "PATCH",
          headers: {
            "Tus-Resumable": "1.0.0",
            "Upload-Offset": String(offset),
            "Content-Type": "application/offset+octet-stream"
          },
          body: bytes.subarray(offset, end)
        }, token, 180_000);
        const serverOffset = Number(response.headers.get("upload-offset"));
        offset = Number.isFinite(serverOffset) && serverOffset >= end ? serverOffset : end;
        break;
      } catch (error) {
        attempts += 1;
        if (attempts >= 3) throw error;
        const status = await request(uploadUrl, { method: "HEAD", headers: { "Tus-Resumable": "1.0.0" } }, token, 30_000);
        const serverOffset = Number(status.headers.get("upload-offset"));
        if (Number.isFinite(serverOffset) && serverOffset >= offset && serverOffset <= bytes.byteLength) {
          offset = serverOffset;
          if (offset >= end) break;
        }
      }
    }
  }
}

export async function downloadCloudSource(token: string, objectPath: string) {
  const response = await request(`/storage/v1/object/${STORAGE_BUCKET}/${encodedObjectPath(objectPath)}`, { method: "GET" }, token, 180_000);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!objectPath.endsWith(".gz")) return bytes;
  try {
    return new Uint8Array(await gunzipAsync(bytes));
  } catch {
    throw new SupabaseRequestError("云端源文件压缩包损坏，无法安全解压", 502);
  }
}

export async function deleteCloudSource(token: string, objectPath: string) {
  return deleteCloudSources(token, [objectPath]);
}

export async function deleteCloudSources(token: string, objectPaths: string[]) {
  const prefixes = [...new Set(objectPaths.filter(Boolean))];
  if (!prefixes.length) return;
  await request(`/storage/v1/object/${STORAGE_BUCKET}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes })
  }, token, 60_000);
}
