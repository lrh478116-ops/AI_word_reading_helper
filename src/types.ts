export type BlockType = "heading" | "paragraph" | "list_item" | "quote" | "code" | "table" | "image";

export interface PdfBlockSource {
  page: number;
  bbox: [number, number, number, number];
  textItemIndices?: number[];
  operationIndex?: number;
  objectId?: string;
  detection: "tagged" | "heuristic" | "native-image" | "text";
  confidence: number;
}

export interface DocumentTableCell {
  content: string;
  header?: boolean;
  colSpan?: number;
  rowSpan?: number;
}

export interface PdfTableData {
  rows: string[][];
  headerRows: number;
  cells?: DocumentTableCell[][];
  source?: "pdf" | "docx";
}

export interface PdfPageTextItem {
  index: number;
  text: string;
  startOffset: number;
  endOffset: number;
  bbox: [number, number, number, number];
}

export interface PdfPageSource {
  pageNumber: number;
  width: number;
  height: number;
  viewBox: [number, number, number, number];
  rotation: number;
  text: string;
  items: PdfPageTextItem[];
  source: "native" | "ocr" | "none";
  confidence: number;
  ocr?: {
    engine: "tesseract.js";
    version: string;
    languages: string[];
    recognizedAt: string;
  };
}

export interface PdfNormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfTipAnchor {
  version: number;
  pdfFingerprint: string;
  pageNumber: number;
  source: "native" | "ocr";
  textStart: number;
  textEnd: number;
  rects: PdfNormalizedRect[];
  rotation: number;
  confidence: number;
}

export interface DocumentBlock {
  id: string;
  documentId: string;
  type: BlockType;
  content: string;
  level?: number;
  order: number;
  contentHash: string;
  pdf?: PdfBlockSource;
  table?: PdfTableData;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentItem {
  id: string;
  userId: string;
  title: string;
  sourceType: "blank" | "txt" | "markdown" | "docx" | "pdf";
  originalName?: string;
  favorite: boolean;
  status: "active" | "deleted";
  blocks: DocumentBlock[];
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
  tipCount: number;
  pdfStructure?: {
    version: number;
    status: "complete" | "visual-only" | "failed";
    pageCount: number;
    extractedAt: string;
    error?: string;
    fingerprint: string;
    pages: PdfPageSource[];
  };
}

export interface TipMessage {
  id: string;
  tipId: string;
  role: "user" | "assistant";
  content: string;
  model?: string;
  skills?: SkillTrace[];
  createdAt: string;
}

export interface SkillTrace {
  name: "professional_assessment" | "professional_review" | "authority_check" | "web_search" | "web_fetch" | "cross_check" | "citation_audit" | "python" | "unit_check" | "uncertainty" | "symbolic_math" | "code_test" | "data_analysis" | "conflict_check" | "freshness_check" | "security_check" | "human_review" | "output_continuation";
  label: string;
  detail: string;
  sources?: Array<{ title: string; url: string }>;
  status?: "success" | "warning" | "error";
}

export interface TipThread {
  id: string;
  userId: string;
  documentId: string;
  blockId: string;
  anchorType: "document" | "message" | "pdf";
  parentTipId?: string;
  anchorMessageId?: string;
  pdfAnchor?: PdfTipAnchor;
  depth: number;
  selectedText: string;
  startOffset: number;
  endOffset: number;
  prefixText: string;
  suffixText: string;
  selectedTextHash: string;
  title: string;
  summary: string;
  status: "open" | "collapsed" | "resolved" | "archived";
  anchorStatus: "valid" | "recovered" | "orphaned";
  memoryEnabled: boolean;
  messages: TipMessage[];
  createdAt: string;
  updatedAt: string;
}

export type ApiProvider = "openai" | "deepseek" | "siliconflow" | "moonshot" | "zhipu" | "gemini" | "ollama" | "custom";

export interface AiSettings {
  provider: ApiProvider;
  baseURL: string;
  model: string;
  apiKeyConfigured: boolean;
  apiKeyMasked: string;
  systemPrompt: string;
  webSearchEnabled: boolean;
  searchBudgetMode: "free" | "quality";
  searchApiKeyConfigured: boolean;
  searchApiKeyMasked: string;
  pythonEnabled: boolean;
  reliabilityEnabled: boolean;
}

export interface AiSettingsInput {
  provider: ApiProvider;
  baseURL: string;
  model: string;
  apiKey?: string;
  clearApiKey?: boolean;
  systemPrompt: string;
  webSearchEnabled: boolean;
  searchBudgetMode: "free" | "quality";
  searchApiKey?: string;
  clearSearchApiKey?: boolean;
  pythonEnabled: boolean;
  reliabilityEnabled: boolean;
}

export interface User {
  id: string;
  name: string;
  email: string;
}

export interface SelectionInfo {
  source: "document";
  blockId: string;
  text: string;
  startOffset: number;
  endOffset: number;
  rect: { left: number; top: number; width: number; height: number };
}

export interface PdfSelectionInfo {
  source: "pdf";
  text: string;
  prefixText: string;
  suffixText: string;
  pdfAnchor: PdfTipAnchor;
  rect: { left: number; top: number; width: number; height: number };
}

export interface ChatSelectionInfo {
  source: "message";
  parentTipId: string;
  messageId: string;
  text: string;
  startOffset: number;
  endOffset: number;
  rect: { left: number; top: number; width: number; height: number };
}
