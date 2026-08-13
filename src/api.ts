import type { AiSettings, AiSettingsInput, DocumentBlock, DocumentItem, PdfPageSource, PdfTipAnchor, SkillTrace, TipThread, User } from "./types";
import type { PromptLanguage } from "./prompts";

const TOKEN_KEY = "ai-tip-token";

export const session = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY)
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = session.get();
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`/api${path}`, { ...init, headers });
  if (response.status === 401) session.clear();
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "请求失败，请稍后重试");
  return body as T;
}

export const api = {
  register: (name: string, email: string, password: string) =>
    request<{ token: string; user: User }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ name, email, password })
    }),
  login: (email: string, password: string) =>
    request<{ token: string; user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    }),
  me: () => request<{ user: User }>("/auth/me"),
  settings: () => request<{ settings: AiSettings }>("/settings"),
  updateSettings: (settings: AiSettingsInput, language: PromptLanguage) =>
    request<{ settings: AiSettings }>("/settings", { method: "PUT", body: JSON.stringify({ ...settings, language }) }),
  testSettings: (settings: AiSettingsInput, language: PromptLanguage) =>
    request<{ ok: boolean; message: string }>("/settings/test", { method: "POST", body: JSON.stringify({ ...settings, language }) }),
  listModels: (settings: AiSettingsInput, language: PromptLanguage) =>
    request<{ models: string[]; fetchedAt: string; provider: string }>("/settings/models", { method: "POST", body: JSON.stringify({ ...settings, language }) }),
  submitFeedback: (category: "feature" | "accuracy" | "bug" | "usability" | "other", message: string) =>
    request<{ ok: boolean; message: string }>("/feedback", { method: "POST", body: JSON.stringify({ category, message }) }),
  documents: (status = "active") => request<{ documents: DocumentItem[] }>(`/documents?status=${status}`),
  document: (id: string) => request<{ document: DocumentItem; tips: TipThread[] }>(`/documents/${id}`),
  documentSource: async (id: string) => {
    const response = await fetch(`/api/documents/${id}/source`, { headers: { Authorization: `Bearer ${session.get()}` } });
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
    const response = await fetch(`/api/documents/${documentId}/export-annotations`, { headers: { Authorization: `Bearer ${session.get()}` } });
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
    const response = await fetch(`/api/tips/${tipId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.get()}` },
      body: JSON.stringify({ question, language }),
      signal
    });
    if (!response.ok || !response.body) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || "AI 暂时无法回答");
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
