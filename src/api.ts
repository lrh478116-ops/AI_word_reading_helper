import type { AiRuntimeStatus, AiSettings, AiSettingsInput, CloudUsage, DocumentBlock, DocumentItem, PdfPageSource, PdfTipAnchor, SkillTrace, TipThread, User } from "./types";
import type { PromptLanguage } from "./prompts";
import type { LocalModelCatalogItem, OllamaRuntimeInfo } from "./local-models";

const TOKEN_KEY = "ai-tip-token";
const REFRESH_TOKEN_KEY = "ai-tip-refresh-token";

export interface AuthResult {
  token?: string;
  refreshToken?: string;
  confirmationRequired?: boolean;
  verificationRequired?: boolean;
  user?: User;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code = "") { super(message); }
}

let refreshPromise: Promise<string> | null = null;

function tokenExpiresSoon(token: string) {
  try {
    const encoded = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "="))) as { exp?: number };
    return typeof payload.exp === "number" && payload.exp * 1000 <= Date.now() + 60_000;
  } catch { return false; }
}

async function refreshCloudToken() {
  const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
  if (!refreshToken) throw new Error("云端会话已过期，请重新登录");
  if (!refreshPromise) {
    refreshPromise = fetch("/api/auth/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken }) })
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as AuthResult & { error?: string };
        if (!response.ok || !body.token) throw new Error(body.error || "云端会话已过期，请重新登录");
        session.set(body.token, body.refreshToken || refreshToken);
        return body.token;
      })
      .catch((error) => { session.clear(); throw error; })
      .finally(() => { refreshPromise = null; });
  }
  return await refreshPromise;
}

export const session = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token: string, refreshToken?: string) => {
    localStorage.setItem(TOKEN_KEY, token);
    if (refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
    else localStorage.removeItem(REFRESH_TOKEN_KEY);
  },
  clear: () => { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(REFRESH_TOKEN_KEY); },
  ensureFresh: async () => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token && localStorage.getItem(REFRESH_TOKEN_KEY) && tokenExpiresSoon(token)) return await refreshCloudToken();
    return token;
  }
};

async function authorizedFetch(path: string, init: RequestInit = {}, retry = true) {
  await session.ensureFresh();
  const headers = new Headers(init.headers);
  const token = session.get();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let response = await fetch(path, { ...init, headers });
  if (response.status === 401 && retry && localStorage.getItem(REFRESH_TOKEN_KEY)) {
    const refreshed = await refreshCloudToken();
    headers.set("Authorization", `Bearer ${refreshed}`);
    response = await fetch(path, { ...init, headers });
  }
  return response;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const response = await authorizedFetch(`/api${path}`, { ...init, headers });
  if (response.status === 401) session.clear();
  const body = await response.json().catch(() => ({})) as { error?: string; code?: string };
  if (!response.ok) throw new ApiError(body.error || "请求失败，请稍后重试", response.status, body.code || "");
  return body as T;
}

export const api = {
  register: (name: string, email: string, password: string) =>
    request<AuthResult>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ name, email, password })
    }),
  login: (email: string, password: string) =>
    request<AuthResult>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    }),
  verifyRegistration: (email: string, code: string) =>
    request<AuthResult>("/auth/verify-registration", { method: "POST", body: JSON.stringify({ email, code }) }),
  requestPasswordRecovery: (email: string) =>
    request<{ verificationRequired: boolean }>("/auth/password/recover", { method: "POST", body: JSON.stringify({ email }) }),
  resetPassword: (email: string, code: string, password: string) =>
    request<AuthResult>("/auth/password/reset", { method: "POST", body: JSON.stringify({ email, code, password }) }),
  me: () => request<{ user: User }>("/auth/me"),
  deleteAccount: (confirmation: string) => request<{ deleted: boolean; localDataCleared: boolean; storageObjectsDeleted?: number; documentsDeleted: number }>("/auth/account", { method: "DELETE", body: JSON.stringify({ confirmation }) }),
  settings: () => request<{ settings: AiSettings }>("/settings"),
  updateWebSearchEnabled: (webSearchEnabled: boolean, language: PromptLanguage) =>
    request<{ settings: AiSettings }>("/settings", { method: "PUT", body: JSON.stringify({ webSearchEnabled, language }) }),
  updateSettings: (settings: AiSettingsInput, language: PromptLanguage) =>
    request<{ settings: AiSettings }>("/settings", { method: "PUT", body: JSON.stringify({ ...settings, language }) }),
  testSettings: (settings: AiSettingsInput, language: PromptLanguage) =>
    request<{ ok: boolean; message: string }>("/settings/test", { method: "POST", body: JSON.stringify({ ...settings, language }) }),
  listModels: (settings: AiSettingsInput, language: PromptLanguage) =>
    request<{ models: string[]; fetchedAt: string; provider: string }>("/settings/models", { method: "POST", body: JSON.stringify({ ...settings, language }) }),
  aiStatus: () => request<{ status: AiRuntimeStatus }>("/ai/status"),
  localModels: () => request<{ models: LocalModelCatalogItem[]; verifiedAt: string; runtime: OllamaRuntimeInfo }>("/local-models"),
  connectLocalModel: (modelId: string) => request<{ settings: AiSettings; runtime: OllamaRuntimeInfo & { installed: boolean } }>("/local-models/connect", { method: "POST", body: JSON.stringify({ modelId }) }),
  downloadLocalModel: async (modelId: string, sourceId: string, destinationPath: string, signal: AbortSignal, onEvent: (event: { type: string; status?: string; completed?: number; total?: number; error?: string; modelRef?: string; destinationPath?: string; networkStack?: string; initialHost?: string; finalHost?: string; proxyDescription?: string }) => void) => {
    const response = await authorizedFetch("/api/local-models/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelId, sourceId, destinationPath, confirmed: true }),
      signal
    });
    if (!response.ok || !response.body) {
      const body = await response.json().catch(() => ({})) as { error?: string; code?: string };
      throw new ApiError(body.error || "本地模型下载失败", response.status, body.code || "");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let completed: { settings: AiSettings; runtime: OllamaRuntimeInfo & { installed: boolean }; modelRef: string; destinationPath: string } | null = null;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as { type: string; status?: string; completed?: number; total?: number; error?: string; code?: string; modelRef?: string; destinationPath?: string; networkStack?: string; initialHost?: string; finalHost?: string; proxyDescription?: string; settings?: AiSettings; runtime?: OllamaRuntimeInfo & { installed: boolean } };
        onEvent(event);
        if (event.type === "error") throw new ApiError(event.error || "本地模型下载失败", 502, event.code || "LOCAL_MODEL_DOWNLOAD_FAILED");
        if (event.type === "done" && event.settings && event.runtime && event.modelRef && event.destinationPath) completed = { settings: event.settings, runtime: event.runtime, modelRef: event.modelRef, destinationPath: event.destinationPath };
      }
    }
    if (!completed) throw new Error("本地模型下载响应意外中断");
    return completed;
  },
  documents: (status = "active") => request<{ documents: DocumentItem[] }>(`/documents?status=${status}`),
  document: (id: string) => request<{ document: DocumentItem; tips: TipThread[] }>(`/documents/${id}`),
  documentSource: async (id: string) => {
    const response = await authorizedFetch(`/api/documents/${id}/source`);
    if (response.status === 401) session.clear();
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || "PDF 原文件读取失败");
    }
    if (!String(response.headers.get("content-type") || "").toLowerCase().startsWith("application/pdf")) throw new Error("服务器没有返回有效的 PDF 内容");
    return new Uint8Array(await response.arrayBuffer());
  },
  createDocument: () => request<{ document: DocumentItem }>("/documents", { method: "POST", body: "{}" }),
  updateDocument: (id: string, patch: Partial<Pick<DocumentItem, "title" | "favorite" | "status">> & { blocks?: DocumentBlock[] }) =>
    request<{ document: DocumentItem }>(`/documents/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteDocument: (id: string, permanent = false) =>
    request<{ ok: boolean }>(`/documents/${id}?permanent=${permanent}`, { method: "DELETE" }),
  cloudUsage: () => request<{ usage: CloudUsage }>("/cloud/usage"),
  uploadDocumentToCloud: (id: string) => request<{ document: DocumentItem; usage: CloudUsage }>(`/documents/${id}/cloud`, { method: "POST", body: "{}" }),
  removeDocumentFromCloud: (id: string) => request<{ document: DocumentItem; usage: CloudUsage | null }>(`/documents/${id}/cloud`, { method: "DELETE" }),
  upload: (file: File) => {
    const data = new FormData();
    data.append("file", file);
    return request<{ document: DocumentItem }>("/documents/import", { method: "POST", body: data });
  },
  createTip: (documentId: string, payload: { blockId: string; selectedText: string; startOffset: number; endOffset: number; prefixText: string; suffixText: string }) =>
    request<{ tip: TipThread }>(`/documents/${documentId}/tips`, { method: "POST", body: JSON.stringify(payload) }),
  createPdfTip: (documentId: string, payload: { selectedText: string; prefixText: string; suffixText: string; pdfAnchor: PdfTipAnchor }) =>
    request<{ tip: TipThread }>(`/documents/${documentId}/tips`, { method: "POST", body: JSON.stringify({ anchorType: "pdf", ...payload }) }),
  exportPdfAnnotations: async (documentId: string) => {
    const response = await authorizedFetch(`/api/documents/${documentId}/export-annotations`);
    if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || "PDF 批注副本导出失败"); }
    const disposition = response.headers.get("content-disposition") || ""; const match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    return { blob: await response.blob(), filename: match ? decodeURIComponent(match[1]) : "AI-Tip-annotations.pdf" };
  },
  savePdfOcrPage: (documentId: string, pdfFingerprint: string, page: PdfPageSource) =>
    request<{ page: PdfPageSource }>(`/documents/${documentId}/pdf-ocr`, { method: "POST", body: JSON.stringify({ pdfFingerprint, page }) }),
  createChildTip: (parentTipId: string, payload: { messageId: string; selectedText: string; startOffset: number; endOffset: number; prefixText: string; suffixText: string }) =>
    request<{ tip: TipThread }>(`/tips/${parentTipId}/children`, { method: "POST", body: JSON.stringify(payload) }),
  updateTip: (tipId: string, patch: Partial<Pick<TipThread, "status" | "title" | "memoryEnabled">>) =>
    request<{ tip: TipThread }>(`/tips/${tipId}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteTip: (tipId: string) => request<{ ok: boolean; deletedIds: string[] }>(`/tips/${tipId}`, { method: "DELETE" }),
  streamTip: async (tipId: string, question: string, language: PromptLanguage, signal: AbortSignal, onChunk: (chunk: string) => void, onSkill?: (skill: SkillTrace) => void) => {
    const response = await authorizedFetch(`/api/tips/${tipId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, language }),
      signal
    });
    if (!response.ok || !response.body) {
      const body = await response.json().catch(() => ({}));
      throw new ApiError(body.error || "AI 暂时无法回答", response.status, body.code || "");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let finalTip: TipThread | null = null;
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as { type: string; delta?: string; tip?: TipThread; error?: string; skill?: SkillTrace };
        if (event.type === "delta" && event.delta) onChunk(event.delta);
        if (event.type === "skill" && event.skill) onSkill?.(event.skill);
        if (event.type === "done" && event.tip) finalTip = event.tip;
        if (event.type === "error") throw new Error(event.error || "生成失败");
      }
    }
    if (!finalTip) throw new Error("响应意外中断，请重试");
    return finalTip;
  }
};
