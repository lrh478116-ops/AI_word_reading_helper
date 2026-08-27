import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import bcrypt from "bcryptjs";
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from "pdf-lib";
import os from "node:os";
import path from "node:path";

const tempData = await mkdtemp(path.join(os.tmpdir(), "ai-tip-skills-"));
const semanticPdfBytes = Buffer.from((await readFile(new URL("./fixtures/semantic-pdf.pdf.base64", import.meta.url), "utf8")).replace(/\s+/g, ""), "base64");
process.env.AI_TIP_EMBEDDED = "1";
process.env.AI_TIP_SUPABASE_ENABLED = "0";
process.env.AI_TIP_DESKTOP = "1";
process.env.AI_TIP_DATA_DIR = tempData;
process.env.OPENAI_API_KEY = "publisher-key-must-not-be-used";
let searchRequests = 0;
const referenceSearchRequests = [];
let modelAssessmentRequests = 0;
let searchAssessmentRequests = 0;
let configuredExternalFetchRequests = 0;
const answerSystemPrompts = [];
const answerToolNames = [];
const chineseDefaultPrompt = "你是文档内的局部阅读助手。围绕用户选中的原文准确回答，先给结论，再解释机制，必要时举例。不要声称看到未提供的全文。使用清晰、专业的中文。";

const legacyUserId = "legacy-demo-user";
const legacyDocumentId = "legacy-transformer-document";
const deepTips = Array.from({ length: 32 }, (_, index) => ({
  id: `deep-tip-${index + 1}`, userId: legacyUserId, documentId: "migration-document", blockId: "migration-block",
  ...(index === 0 ? { anchorType: "document", depth: 1, selectedText: "legacy", startOffset: 0, endOffset: 6, prefixText: "", suffixText: " anchor" }
    : { anchorType: "message", parentTipId: `deep-tip-${index}`, anchorMessageId: `deep-source-${index}`, depth: index + 1, selectedText: "deep", startOffset: 0, endOffset: 4, prefixText: "", suffixText: " anchor" }),
  selectedTextHash: "old", title: `深度 ${index + 1}`, summary: "", status: "open", anchorStatus: "valid", memoryEnabled: true,
  messages: [{ id: `deep-source-${index + 1}`, tipId: `deep-tip-${index + 1}`, role: "assistant", content: "deep anchor", createdAt: new Date().toISOString() }],
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
}));
await writeFile(path.join(tempData, "store.json"), JSON.stringify({
  users: [{ id: legacyUserId, name: "林同学", email: "demo@aitip.local", passwordHash: await bcrypt.hash("demo1234", 4) }],
  documents: [{
    id: legacyDocumentId, userId: legacyUserId, title: "理解 Transformer 的注意力机制", sourceType: "blank", favorite: true, status: "active",
    blocks: [
      { id: "legacy-heading", documentId: legacyDocumentId, type: "heading", content: "Transformer：从注意力到理解", level: 1, order: 0, contentHash: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: "legacy-paragraph", documentId: legacyDocumentId, type: "paragraph", content: "Transformer 的核心洞见，是让模型在处理一个词时，能够直接观察序列中的其他位置，并动态判断哪些信息最值得关注。", order: 1, contentHash: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: "legacy-heading-2", documentId: legacyDocumentId, type: "heading", content: "自注意力在做什么？", level: 2, order: 2, contentHash: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: "legacy-paragraph-2", documentId: legacyDocumentId, type: "paragraph", content: "自注意力机制允许序列中的每个 Token 根据相关性聚合其他 Token 的信息。它把每个输入映射成 Query、Key 和 Value，再用相似度决定信息汇集的权重。", order: 3, contentHash: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: "legacy-quote", documentId: legacyDocumentId, type: "quote", content: "注意力并不是记忆本身，而是一种按当前问题检索和组合信息的机制。", order: 4, contentHash: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: "legacy-heading-3", documentId: legacyDocumentId, type: "heading", content: "缩放点积注意力", level: 2, order: 5, contentHash: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: "legacy-paragraph-3", documentId: legacyDocumentId, type: "paragraph", content: "计算过程可以概括为 Attention(Q, K, V) = softmax(QKᵀ / √dₖ)V。除以 √dₖ 可以避免维度较高时点积过大，进而缓解 softmax 梯度过小的问题。", order: 6, contentHash: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: "legacy-code", documentId: legacyDocumentId, type: "code", content: "scores = (Q @ K.transpose(-2, -1)) / sqrt(d_k)\nweights = softmax(scores, dim=-1)\noutput = weights @ V", order: 7, contentHash: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: "legacy-heading-4", documentId: legacyDocumentId, type: "heading", content: "为什么需要多头？", level: 2, order: 8, contentHash: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: "legacy-paragraph-4", documentId: legacyDocumentId, type: "paragraph", content: "多头注意力让模型在不同表示子空间中同时寻找关系：一个头可能关注指代，一个头可能关注句法距离，另一个头则关注主题一致性。", order: 9, contentHash: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    ], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastOpenedAt: new Date().toISOString(), tipCount: 0
  }, {
    id: "migration-document", userId: legacyUserId, title: "旧 Tip 迁移验证", sourceType: "blank", favorite: false, status: "deleted",
    blocks: [{ id: "migration-block", documentId: "migration-document", type: "paragraph", content: "legacy anchor text", order: 0, contentHash: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastOpenedAt: new Date().toISOString(), tipCount: 2
  }, {
    id: "mojibake-document", userId: legacyUserId, title: "å®ä¹ è¿åº¦1", sourceType: "markdown", originalName: "å®ä¹ è¿åº¦1.md", favorite: false, status: "active",
    blocks: [{ id: "mojibake-block", documentId: "mojibake-document", type: "paragraph", content: "旧文件名迁移内容", order: 0, contentHash: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastOpenedAt: new Date().toISOString(), tipCount: 0
  }, {
    id: "legacy-pdf-document", userId: legacyUserId, title: "Legacy PDF", sourceType: "pdf", originalName: "legacy-structured.pdf", favorite: false, status: "active",
    blocks: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastOpenedAt: new Date().toISOString(), tipCount: 0
  }],
  tips: [
    { id: "legacy-tip", userId: legacyUserId, documentId: legacyDocumentId, blockId: "legacy-paragraph", messages: [] },
    { id: "migration-root-tip", userId: legacyUserId, documentId: "migration-document", blockId: "migration-block", selectedText: "legacy", startOffset: 0, endOffset: 6, prefixText: "", suffixText: " anchor", selectedTextHash: "old", title: "旧根 Tip", summary: "", status: "open", anchorStatus: "valid", memoryEnabled: true, messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: "migration-orphan-tip", userId: legacyUserId, documentId: "migration-document", blockId: "migration-block", anchorType: "message", parentTipId: "missing-parent", anchorMessageId: "missing-message", depth: 2, selectedText: "missing", startOffset: 0, endOffset: 7, prefixText: "", suffixText: "", selectedTextHash: "old", title: "孤儿 Tip", summary: "", status: "open", anchorStatus: "valid", memoryEnabled: true, messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ...deepTips
  ],
  settings: []
}, null, 2), "utf8");
await mkdir(path.join(tempData, "uploads", "mojibake-document"), { recursive: true });
await writeFile(path.join(tempData, "uploads", "mojibake-document", "å®ä¹ è¿åº¦1.md"), "旧文件名迁移内容", "utf8");

await mkdir(path.join(tempData, "uploads", "legacy-pdf-document"), { recursive: true });
await writeFile(path.join(tempData, "uploads", "legacy-pdf-document", "legacy-structured.pdf"), semanticPdfBytes);

const mock = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/empty/models") {
    res.end(JSON.stringify({ object: "list", data: [] }));
    return;
  }
  if (req.url === "/v1/models") {
    res.end(JSON.stringify({ object: "list", data: [{ id: "mock-model", object: "model", owned_by: "integration" }, { id: "mock-model-pro", object: "model", owned_by: "integration" }] }));
    return;
  }
  if (req.url === "/usage") {
    res.end(JSON.stringify({ key: { usage: 12, limit: 1000 } }));
    return;
  }
  if (req.url === "/search") {
    searchRequests += 1;
    const query = String(JSON.parse(raw || "{}").query || "");
    if (/TAVILY_FAIL/i.test(query)) {
      res.statusCode = 500;
      res.end(JSON.stringify({ detail: "simulated Tavily failure" }));
      return;
    }
    const policy = /双碳|政策工具|公共治理/i.test(query);
    const professional = /rcu|控制器|控制理论/i.test(query);
    res.end(JSON.stringify({ results: policy ? [
      { title: "中国政府网政策文件", url: "https://www.gov.cn/zhengce/example.htm", content: "政策评估需要核对正式政策目标、实施主体、政策工具与执行效果。" },
      { title: "国家发展改革委政策说明", url: "https://www.ndrc.gov.cn/xxgk/example.html", content: "双碳相关政策实施需要结合地区差异、时间范围和正式统计口径。" }
    ] : professional ? [
      { title: "Linux Kernel RCU documentation", url: "https://kernel.org/doc/html/latest/RCU/", content: "RCU ordering depends on the memory model and grace-period guarantees。" },
      { title: "IETF technical standard", url: "https://ietf.org/archive/id/example", content: "Technical claims require explicit assumptions and evidence。" }
    ] : [
      { title: "官方版本说明", url: "https://example.com/releases", content: "最新稳定版是 2.0。" },
      { title: "官方文档", url: "https://example.com/docs", content: "版本 2.0 的文档。" }
    ] }));
    return;
  }
  if (req.url?.startsWith("/reference/")) {
    const url = new URL(req.url, "http://127.0.0.1");
    const site = url.pathname.split("/").at(-1);
    const query = url.searchParams.get("q") || "";
    referenceSearchRequests.push({ site, query });
    if (site === "baidu" || /REFERENCE_ALL_FAIL/i.test(query)) {
      res.statusCode = site === "baidu" ? 503 : 504;
      res.end(JSON.stringify({ error: "simulated reference site failure" }));
      return;
    }
    const sources = {
      baike360: ["360 百科参考条目", "https://baike.so.com/doc/example.html", "国内百科 REFERENCE_EVIDENCE"],
      zhwiki: ["中文维基参考条目", "https://zh.wikipedia.org/wiki/Reference_test", "中文参考 REFERENCE_EVIDENCE"],
      enwiki: ["English Wikipedia reference", "https://en.wikipedia.org/wiki/Reference_test", "International REFERENCE_EVIDENCE"],
      britannica: ["Britannica reference", "https://www.britannica.com/topic/reference-test", "Encyclopaedia REFERENCE_EVIDENCE"]
    };
    const [title, urlValue, content] = sources[site] || ["reference", "https://example.com/reference", "REFERENCE_EVIDENCE"];
    res.end(JSON.stringify({ items: [{ title, url: urlValue, content: `${query} ${content}` }] }));
    return;
  }
  const body = JSON.parse(raw || "{}");
  const messages = body.messages || [];
  const last = messages[messages.length - 1] || {};
  const toolResult = last.role === "tool" ? String(last.content || "") : "";
  const isProfessionalClassifier = messages.some((item) => item.role === "system" && String(item.content || "").includes("PROFESSIONALISM_CLASSIFIER_V1"));
  const isSearchClassifier = messages.some((item) => item.role === "system" && String(item.content || "").includes("WEB_SEARCH_DECISION_V1"));
  const isBinarySearchClassifier = messages.some((item) => item.role === "system" && String(item.content || "").includes("WEB_SEARCH_DECISION_BINARY_V1"));
  const isSearchFailureRecovery = messages.some((item) => item.role === "system" && String(item.content || "").includes("SEARCH_FAILURE_DOCUMENT_RECOVERY_V1"));
  const injectedSearchEvidence = messages.find((item) => item.role === "system" && /(?:强制联网证据|应用搜索计划取得的联网证据|本轮要求的联网搜索|Mandatory web evidence|Web evidence required by the application search plan|required web search returned)/i.test(String(item.content || "")))?.content || "";
  const suppliedDocumentContext = String(messages.find((item) => item.role === "user" && /(?:选中原文|Selected source text)/i.test(String(item.content || "")))?.content || "");
  const documentFallbackRequired = /(?:仍必须根据上方|must still answer the user's question from the document)/i.test(String(injectedSearchEvidence));
  const hasLengthPrefix = last.role === "user" && /(?:Continue exactly where|请严格从上一段回答被截断的位置继续)/i.test(String(last.content || "")) && String(messages.at(-2)?.content || "").includes("LONG_ANSWER_START");
  if (!isProfessionalClassifier && body.tools) answerSystemPrompts.push(String(messages.find((item) => item.role === "system")?.content || ""));
  if (body.tools) answerToolNames.push(body.tools.map((tool) => String(tool?.function?.name || "")));
  let message;
  let finishReason = "stop";
  if (isProfessionalClassifier) {
    modelAssessmentRequests += 1;
    const assessmentInput = String(last.content || "");
    if (assessmentInput.includes("ASSESSMENT_FAILURE")) {
      message = { role: "assistant", content: "这不是合法的结构化评估" };
    } else if (assessmentInput.includes("双碳目标")) {
      message = { role: "assistant", content: JSON.stringify({ professional: true, level: "professional", domain: "政策与公共治理", confidence: 94, requiresWebReview: true, reason: "涉及政策工具、执行偏差与政策效果评估方法" }) };
    } else {
      message = { role: "assistant", content: JSON.stringify({ professional: false, level: "general", domain: "通用", confidence: 88, requiresWebReview: false, reason: "未发现需要专业证据审查的复杂问题" }) };
    }
  } else if (isSearchClassifier) {
    searchAssessmentRequests += 1;
    const assessmentInput = String(last.content || "");
    if (assessmentInput.includes("WEB_SEARCH_DECISION_FAILURE")) {
      message = { role: "assistant", content: "这不是合法的联网判断 JSON" };
    } else if (assessmentInput.includes("WEB_SEARCH_DECISION_LOW")) {
      message = { role: "assistant", content: JSON.stringify({ required: false, confidence: 0, reason: "无法可靠判断是否依赖外部事实", queryZh: "低置信度联网判断反事实", queryEn: "low confidence web decision counterfactual" }) };
    } else {
      const required = /(?:联网|最新|REFERENCE_|TAVILY_FAIL|双碳|RCU grace period|控制理论|药物剂量)/i.test(assessmentInput);
      const counterfactualMarker = assessmentInput.match(/(?:REFERENCE_[A-Z_]+|TAVILY_FAIL)/i)?.[0] || "";
      message = { role: "assistant", content: JSON.stringify({ required, confidence: 93, reason: required ? "可靠回答需要外部事实或专业证据" : "问题只需使用已给上下文", queryZh: required ? counterfactualMarker || assessmentInput.slice(0, 100) : "", queryEn: required ? counterfactualMarker || `external evidence ${assessmentInput.slice(0, 80)}` : "" }) };
    }
  } else if (isBinarySearchClassifier) {
    message = { role: "assistant", content: String(last.content || "").includes("WEB_SEARCH_DECISION_FAILURE") ? "UNKNOWN" : "NO_SEARCH" };
  } else if (hasLengthPrefix) {
    message = { role: "assistant", content: `LONG_ANSWER_END：${"后半段内容".repeat(180)}` };
  } else if (isSearchFailureRecovery) {
    message = { role: "assistant", content: suppliedDocumentContext.includes("自注意力机制允许") ? "根据文档原文，自注意力机制允许序列中的 Token 按相关性聚合信息；这是对当前文档内容的解释，外部事实尚未通过本轮联网核验。" : "仍然无法回答。" };
  } else if (!body.tools) {
    const auditInput = String(last.content || "");
    message = { role: "assistant", content: auditInput.includes("UNSUPPORTED_CLAIM") ? "UNSUPPORTED: 该主张没有被提供的联网证据支持。" : "SUPPORTED: 回答中的结论与工具证据一致，并展示了来源。" };
  } else if (toolResult) {
    message = { role: "assistant", content: toolResult.includes("REFERENCE_EVIDENCE") ? "根据备用参考检索，可以获得概览性信息。[S1]" : toolResult.includes("没有取得可用的联网证据") || toolResult.includes("未取得可用联网证据") ? "本次没有取得可用联网证据，但仍可基于已有上下文给出一般性解释，并明确保留不确定性。" : toolResult.includes("官方版本说明") ? "根据搜索来源，最新稳定版是 2.0。[S1]" : "Python 精确计算结果为 0.3。" };
  } else {
    const question = [...messages].reverse().find((item) => item.role === "user")?.content || "";
    if (String(question).includes("LONG_ANSWER_TEST")) {
      message = { role: "assistant", content: `LONG_ANSWER_START：${"前半段内容".repeat(180)}` };
      finishReason = "length";
    } else if (String(question).includes("RCU grace period")) {
      message = { role: "assistant", content: "根据联网证据，RCU 与 acquire-release 的可见性需要结合具体内存模型解释。[S1]" };
    } else if (String(question).includes("双碳目标")) {
      message = { role: "assistant", content: "政策评估应同时核对正式目标、政策工具、执行主体与地区实施数据。[S1][S2]" };
    } else if (String(question).includes("专业错误审查")) {
      message = { role: "assistant", content: "UNSUPPORTED_CLAIM：该控制器在所有条件下都绝对稳定。[S1]" };
    } else if (injectedSearchEvidence) {
      message = { role: "assistant", content: String(injectedSearchEvidence).includes("REFERENCE_EVIDENCE") ? "根据备用参考检索，可以获得概览性信息。[S1]" : /没有取得可用的联网证据|未取得可用联网证据/.test(String(injectedSearchEvidence)) ? documentFallbackRequired ? "联网证据缺失，因此无法回答。" : "搜索失败，无法回答。" : "根据搜索来源，最新稳定版是 2.0。[S1]" };
    } else {
      const search = body.tool_choice?.function?.name === "web_search" || String(question).includes("最新");
      const searchQuery = String(question).includes("REFERENCE_") || String(question).includes("TAVILY_FAIL") ? String(question) : "产品最新稳定版本";
      message = { role: "assistant", content: null, tool_calls: [{ id: search ? "call_search" : "call_python", type: "function", function: search ? { name: "web_search", arguments: JSON.stringify({ query: searchQuery }) } : { name: "python_calculate", arguments: JSON.stringify({ code: "decimal.Decimal('0.1') + decimal.Decimal('0.2')" }) } }] };
    }
  }
  res.end(JSON.stringify({ id: "chatcmpl-test", object: "chat.completion", created: 0, model: "mock-model", choices: [{ index: 0, message, finish_reason: message.tool_calls ? "tool_calls" : finishReason }] }));
});

const listen = (server) => new Promise((resolve, reject) => { server.listen(0, "127.0.0.1", () => resolve(server.address().port)); server.once("error", reject); });
const mockPort = await listen(mock);
process.env.TAVILY_API_URL = `http://127.0.0.1:${mockPort}/search`;
process.env.TAVILY_USAGE_URL = `http://127.0.0.1:${mockPort}/usage`;
process.env.AI_TIP_REFERENCE_SEARCH_BASE_URL = `http://127.0.0.1:${mockPort}/reference`;
process.env.AI_TIP_ALLOW_INSECURE_REFERENCE_SEARCH = "1";
const { configureExternalNetworkFetch, configureSecretProtection, startServer } = await import("../dist-electron/server.cjs");
configureExternalNetworkFetch(async (input, init) => {
  const url = String(input);
  if (url.includes(`/reference/`) || url.endsWith(`/search`) || url.endsWith(`/usage`)) configuredExternalFetchRequests += 1;
  return fetch(input, init);
});
configureSecretProtection(
  (value) => Buffer.from(value, "utf8").toString("base64"),
  (value) => Buffer.from(value, "base64").toString("utf8")
);
const appServer = await startServer(0, "127.0.0.1");
const appPort = appServer.address().port;
const base = `http://127.0.0.1:${appPort}/api`;

async function request(route, init = {}, token = "") {
  const response = await fetch(`${base}${route}`, { ...init, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers || {}) } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

async function chat(tipId, question, token, language) {
  const response = await fetch(`${base}/tips/${tipId}/chat`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ question, ...(language ? { language } : {}) }) });
  const lines = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
  const error = lines.find((item) => item.type === "error");
  if (error) throw new Error(error.error);
  return lines;
}

try {
  const login = await request("/auth/login", { method: "POST", body: JSON.stringify({ email: "demo@aitip.local", password: "demo1234" }) });
  const token = login.token;
  const defaultSearchSettings = await request("/settings", {}, token);
  if (defaultSearchSettings.settings.webSearchEnabled !== false) throw new Error(`没有历史设置的用户未默认关闭联网搜索：${JSON.stringify(defaultSearchSettings.settings)}`);
  const migratedNames = await request("/documents", {}, token);
  const migratedNameDocument = migratedNames.documents.find((item) => item.id === "mojibake-document");
  const migratedPdfDocument = migratedNames.documents.find((item) => item.id === "legacy-pdf-document");
  const migratedPdfTypes = new Set((migratedPdfDocument?.blocks || []).map((item) => item.type));
  if (migratedPdfDocument?.pdfStructure?.status !== "complete" || !migratedPdfTypes.has("paragraph") || !migratedPdfTypes.has("table") || !migratedPdfTypes.has("image")) throw new Error(`旧 PDF 没有通过正式启动迁移获得语义结构：${JSON.stringify({ structure: migratedPdfDocument?.pdfStructure, types: [...migratedPdfTypes] })}`);
  if (migratedNameDocument?.title !== "实习进度1" || migratedNameDocument.originalName !== "实习进度1.md") throw new Error(`正式启动没有修复旧乱码标题：${JSON.stringify(migratedNameDocument)}`);
  if ((await readFile(path.join(tempData, "uploads", "mojibake-document", "实习进度1.md"), "utf8")) !== "旧文件名迁移内容") throw new Error("旧乱码磁盘文件没有与 originalName 同步迁移");
  await request("/documents/mojibake-document?permanent=true", { method: "DELETE" }, token);
  await request("/documents/legacy-pdf-document?permanent=true", { method: "DELETE" }, token);
  const migrated = await request("/documents/migration-document", {}, token);
  const migratedRoot = migrated.tips.find((item) => item.id === "migration-root-tip");
  const migratedOrphan = migrated.tips.find((item) => item.id === "migration-orphan-tip");
  if (migratedRoot?.anchorType !== "document" || migratedRoot.depth !== 1 || migratedRoot.anchorStatus !== "valid") throw new Error("旧 Tip 没有迁移为合法根文档 Tip");
  if (migratedOrphan?.anchorStatus !== "orphaned") throw new Error("损坏的消息父链没有被标记为孤儿");
  const orphanChat = await fetch(`${base}/tips/migration-orphan-tip/chat`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ question: "不应继续回答" }) });
  if (orphanChat.status !== 409) throw new Error("孤儿消息 Tip 绕过父链验证进入了聊天入口");
  const depthOverflow = await fetch(`${base}/tips/deep-tip-32/children`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ messageId: "deep-source-32", selectedText: "deep", startOffset: 0, endOffset: 4, prefixText: "", suffixText: " anchor" }) });
  if (depthOverflow.status !== 409) throw new Error("正式子 Tip 创建接口没有拒绝第 33 层");
  await request("/settings", { method: "PUT", body: JSON.stringify({ provider: "custom", baseURL: `http://127.0.0.1:${mockPort}/v1`, model: "mock-model", apiKey: "test-key", systemPrompt: chineseDefaultPrompt, webSearchEnabled: true, searchApiKey: "tvly-test", pythonEnabled: true }) }, token);
  const chatToggleDisabled = await request("/settings", { method: "PUT", body: JSON.stringify({ webSearchEnabled: false, language: "zh-CN" }) }, token);
  if (chatToggleDisabled.settings.webSearchEnabled !== false || chatToggleDisabled.settings.provider !== "custom" || chatToggleDisabled.settings.model !== "mock-model" || !chatToggleDisabled.settings.apiKeyConfigured || !chatToggleDisabled.settings.searchApiKeyConfigured || chatToggleDisabled.settings.systemPrompt !== chineseDefaultPrompt) throw new Error(`对话联网开关的部分设置更新覆盖了模型、Prompt 或密钥：${JSON.stringify(chatToggleDisabled.settings)}`);
  const chatToggleEnabled = await request("/settings", { method: "PUT", body: JSON.stringify({ webSearchEnabled: true, language: "zh-CN" }) }, token);
  if (chatToggleEnabled.settings.webSearchEnabled !== true) throw new Error("对话联网开关没有写入正式用户设置");
  const connectionTest = await request("/settings/test", { method: "POST", body: JSON.stringify({ provider: "custom", baseURL: `http://127.0.0.1:${mockPort}/v1`, model: "mock-model", systemPrompt: chineseDefaultPrompt, webSearchEnabled: true, searchBudgetMode: "free", pythonEnabled: false }) }, token);
  if (!connectionTest.message.includes("988/1000") || searchRequests !== 0) throw new Error("额度查询不应消耗搜索请求");
  const modelList = await request("/settings/models", { method: "POST", body: JSON.stringify({ provider: "custom", baseURL: `http://127.0.0.1:${mockPort}/v1`, model: "mock-model", systemPrompt: chineseDefaultPrompt, webSearchEnabled: false, searchBudgetMode: "free", pythonEnabled: false, language: "en" }) }, token);
  if (modelList.models.join(",") !== "mock-model,mock-model-pro") throw new Error(`模型刷新没有消费真实 /models 响应：${JSON.stringify(modelList)}`);
  const emptyModelsResponse = await fetch(`${base}/settings/models`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ provider: "custom", baseURL: `http://127.0.0.1:${mockPort}/empty`, model: "mock-model", apiKey: "test-key", language: "en" }) });
  const emptyModelsBody = await emptyModelsResponse.json();
  if (emptyModelsResponse.status !== 502 || emptyModelsBody.error !== "The provider returned an empty model list") throw new Error(`空模型列表没有以英文明确失败：${JSON.stringify(emptyModelsBody)}`);
  const invalidSettingsResponse = await fetch(`${base}/settings`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ provider: "custom", baseURL: "not-a-url", model: "mock-model", language: "en" }) });
  const invalidSettingsBody = await invalidSettingsResponse.json();
  if (invalidSettingsResponse.status !== 400 || invalidSettingsBody.error !== "The API URL must be a valid HTTP(S) URL") throw new Error(`英文接口校验仍返回中文：${JSON.stringify(invalidSettingsBody)}`);
  const persistedSettings = await readFile(path.join(tempData, "store.json"), "utf8");
  if (persistedSettings.includes("test-key") || persistedSettings.includes("tvly-test") || !persistedSettings.includes("safe:v1:")) throw new Error("API Key 未加密保存");
  const documents = await request("/documents", {}, token);
  if (documents.documents.length !== 0) throw new Error("旧 Transformer 种子文档没有从正式启动路径移除");
  const registered = await request("/auth/register", { method: "POST", body: JSON.stringify({ name: "新用户", email: "fresh@example.com", password: "123456" }) });
  const registeredDocuments = await request("/documents", {}, registered.token);
  if (registeredDocuments.documents.length !== 0) throw new Error("注册路径仍然创建示例文档");

  const pdfBytes = semanticPdfBytes;
  const pdfForm = new FormData();
  pdfForm.append("file", new Blob([pdfBytes], { type: "application/pdf" }), "中文图片资料.pdf");
  const importedPdfResponse = await fetch(`${base}/documents/import`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: pdfForm });
  const importedPdfBody = await importedPdfResponse.json();
  if (!importedPdfResponse.ok || importedPdfBody.document?.title !== "中文图片资料" || importedPdfBody.document?.originalName !== "中文图片资料.pdf" || importedPdfBody.document?.sourceType !== "pdf") throw new Error(`PDF 没有通过正式上传入口持久化正确标题：${JSON.stringify(importedPdfBody)}`);
  const pdfTypes = new Set(importedPdfBody.document.blocks.map((item) => item.type));
  if (importedPdfBody.document.pdfStructure?.status !== "complete" || !pdfTypes.has("paragraph") || !pdfTypes.has("table") || !pdfTypes.has("image")) throw new Error(`正式上传没有持久化 PDF 文本、表格和图片结构：${JSON.stringify({ structure: importedPdfBody.document.pdfStructure, types: [...pdfTypes] })}`);
  const pdfPage = importedPdfBody.document.pdfStructure?.pages?.[0];
  const originalSelectedText = "可选择"; const originalTextStart = pdfPage?.text?.indexOf(originalSelectedText) ?? -1;
  if (!/^[a-f0-9]{64}$/.test(importedPdfBody.document.pdfStructure?.fingerprint || "") || originalTextStart < 0) throw new Error("正式 PDF 上传没有持久化指纹和权威页文本");
  const originalPdfTip = await request(`/documents/${importedPdfBody.document.id}/tips`, { method: "POST", body: JSON.stringify({ anchorType: "pdf", selectedText: originalSelectedText, prefixText: pdfPage.text.slice(Math.max(0, originalTextStart - 32), originalTextStart), suffixText: pdfPage.text.slice(originalTextStart + originalSelectedText.length, originalTextStart + originalSelectedText.length + 32), pdfAnchor: { version: 1, pdfFingerprint: importedPdfBody.document.pdfStructure.fingerprint, pageNumber: 1, source: "native", textStart: originalTextStart, textEnd: originalTextStart + originalSelectedText.length, rects: [{ x: 0.1, y: 0.75, width: 0.08, height: 0.03 }], rotation: pdfPage.rotation, confidence: 1 } }) }, token);
  if (originalPdfTip.tip.anchorType !== "pdf" || originalPdfTip.tip.pdfAnchor?.pageNumber !== 1 || originalPdfTip.tip.blockId !== "pdf:page:1") throw new Error("PDF 原版式 Tip 没有通过正式创建接口形成独立锚点类型");
  const pdfChatEvents = await chat(originalPdfTip.tip.id, "LONG_ANSWER_TEST: export the complete first PDF Tip answer.", token, "en");
  const answeredPdfTip = pdfChatEvents.find((event) => event.type === "done")?.tip;
  const pdfAssistantMessage = answeredPdfTip?.messages?.find((message) => message.role === "assistant");
  if (!pdfAssistantMessage?.content.includes("LONG_ANSWER_START") || !pdfAssistantMessage.content.includes("LONG_ANSWER_END") || pdfAssistantMessage.content.length <= 500) throw new Error("PDF 根 Tip 没有持久化超过旧导出上限的完整第一条回答");
  const secondPdfChatEvents = await chat(originalPdfTip.tip.id, "Explain this PDF selection briefly.", token, "en");
  const secondPdfAssistantMessage = secondPdfChatEvents.find((event) => event.type === "done")?.tip?.messages?.filter((message) => message.role === "assistant").at(-1);
  const pdfChildSelected = pdfAssistantMessage?.content?.slice(0, 4) || "";
  if (!secondPdfAssistantMessage || secondPdfAssistantMessage.id === pdfAssistantMessage.id || pdfChildSelected.length !== 4) throw new Error("PDF 根 Tip 没有通过正式聊天入口产生两轮可区分的实际回复");
  const pdfChildTip = await request(`/tips/${originalPdfTip.tip.id}/children`, { method: "POST", body: JSON.stringify({ messageId: pdfAssistantMessage.id, selectedText: pdfChildSelected, startOffset: 0, endOffset: 4, prefixText: "", suffixText: pdfAssistantMessage.content.slice(4, 20) }) }, token);
  if (pdfChildTip.tip.anchorType !== "message" || pdfChildTip.tip.parentTipId !== originalPdfTip.tip.id || pdfChildTip.tip.depth !== 2) throw new Error("PDF 根 Tip 没有进入现有递归聊天树主链");
  const duplicatePdfTip = await fetch(`${base}/documents/${importedPdfBody.document.id}/tips`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ anchorType: "pdf", selectedText: originalSelectedText, prefixText: "", suffixText: "", pdfAnchor: originalPdfTip.tip.pdfAnchor }) });
  if (duplicatePdfTip.status !== 409) throw new Error("重叠 PDF 原版式锚点没有被正式创建入口拒绝");
  const exportedPdfResponse = await fetch(`${base}/documents/${importedPdfBody.document.id}/export-annotations`, { headers: { Authorization: `Bearer ${token}` } });
  const exportedPdfBytes = Buffer.from(await exportedPdfResponse.arrayBuffer());
  if (!exportedPdfResponse.ok || exportedPdfResponse.headers.get("content-type") !== "application/pdf" || !decodeURIComponent(exportedPdfResponse.headers.get("content-disposition") || "").includes("中文图片资料-AI-Tip-annotations.pdf") || !exportedPdfBytes.includes(Buffer.from(`aitip:${originalPdfTip.tip.id}`))) throw new Error("PDF Tip 没有通过正式导出接口形成可追踪的批注副本");
  const reopenedExport = await PDFDocument.load(exportedPdfBytes);
  const exportedTipContents = (reopenedExport.getPages()[0].node.Annots()?.asArray() || []).map((reference) => {
    const annotation = reopenedExport.context.lookup(reference, PDFDict);
    const name = annotation.lookup(PDFName.of("NM"));
    if (!(name instanceof PDFString) || !name.decodeText().startsWith(`aitip:${originalPdfTip.tip.id}:`)) return null;
    const contents = annotation.lookup(PDFName.of("Contents"));
    return contents instanceof PDFString || contents instanceof PDFHexString ? contents.decodeText() : null;
  }).filter((contents) => typeof contents === "string");
  if (!exportedTipContents.length || exportedTipContents.some((contents) => !contents.includes(pdfAssistantMessage.content) || !contents.includes("LONG_ANSWER_END") || contents.includes(secondPdfAssistantMessage.content))) throw new Error("正式 HTTP 导出的 PDF 批注没有完整使用第一条回答，或被第二轮回答替换");
  if (createHash("sha256").update(exportedPdfBytes).digest("hex") === createHash("sha256").update(pdfBytes).digest("hex")) throw new Error("PDF 批注导出错误地复用了未修改的原文件");
  const crossUserExport = await fetch(`${base}/documents/${importedPdfBody.document.id}/export-annotations`, { headers: { Authorization: `Bearer ${registered.token}` } });
  if (crossUserExport.status !== 404) throw new Error("其他用户能够导出当前用户的 PDF Tip 批注");
  const beforePdfCorruption = await readFile(path.join(tempData, "store.json"), "utf8");
  const corruptedPdfDatabase = JSON.parse(beforePdfCorruption);
  const corruptedPdfDocument = corruptedPdfDatabase.documents.find((item) => item.id === importedPdfBody.document.id);
  const corruptedPageText = corruptedPdfDocument.pdfStructure.pages[0].text;
  corruptedPdfDocument.pdfStructure.pages[0].text = `${corruptedPageText.slice(0, originalTextStart)}错${corruptedPageText.slice(originalTextStart + 1)}`;
  await writeFile(path.join(tempData, "store.json"), JSON.stringify(corruptedPdfDatabase, null, 2), "utf8");
  const orphanedPdf = await request(`/documents/${importedPdfBody.document.id}`, {}, token);
  if (orphanedPdf.tips.find((tip) => tip.id === originalPdfTip.tip.id)?.anchorStatus !== "orphaned") throw new Error("权威 PDF 页文本变化后，PDF Tip 没有被正式恢复路径标记为失效");
  const orphanedPdfChat = await fetch(`${base}/tips/${originalPdfTip.tip.id}/chat`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ question: "This must be blocked.", language: "en" }) });
  if (orphanedPdfChat.status !== 409) throw new Error("失效 PDF Tip 绕过权威锚点验证进入了正式聊天入口");
  await writeFile(path.join(tempData, "store.json"), beforePdfCorruption, "utf8");
  const restoredPdf = await request(`/documents/${importedPdfBody.document.id}`, {}, token);
  if (restoredPdf.tips.find((tip) => tip.id === originalPdfTip.tip.id)?.anchorStatus !== "valid") throw new Error("恢复未修改的 PDF 权威页文本后，合法锚点没有重新验证");
  const pdfParagraph = importedPdfBody.document.blocks.find((item) => item.type === "paragraph" && item.content.includes("可选择"));
  const selectedPdfText = "可选择"; const selectedPdfStart = pdfParagraph?.content.indexOf(selectedPdfText) ?? -1;
  if (!pdfParagraph || selectedPdfStart < 0) throw new Error("PDF 文本块没有进入可创建 Tip 的正式文档结构");
  const pdfTip = await request(`/documents/${importedPdfBody.document.id}/tips`, { method: "POST", body: JSON.stringify({ blockId: pdfParagraph.id, selectedText: selectedPdfText, startOffset: selectedPdfStart, endOffset: selectedPdfStart + selectedPdfText.length, prefixText: pdfParagraph.content.slice(0, selectedPdfStart), suffixText: pdfParagraph.content.slice(selectedPdfStart + selectedPdfText.length) }) }, token);
  if (pdfTip.tip.blockId !== pdfParagraph.id || pdfTip.tip.selectedText !== selectedPdfText) throw new Error("PDF DOM 文字没有通过正式 Tip API 形成可追溯锚点");
  const pdfSourceResponse = await fetch(`${base}/documents/${importedPdfBody.document.id}/source`, { headers: { Authorization: `Bearer ${token}` } });
  const returnedPdf = Buffer.from(await pdfSourceResponse.arrayBuffer());
  if (!pdfSourceResponse.ok || pdfSourceResponse.headers.get("content-type") !== "application/pdf" || createHash("sha256").update(returnedPdf).digest("hex") !== createHash("sha256").update(pdfBytes).digest("hex")) throw new Error("PDF 原始字节没有经过鉴权源接口无损返回");
  const crossUserSource = await fetch(`${base}/documents/${importedPdfBody.document.id}/source`, { headers: { Authorization: `Bearer ${registered.token}` } });
  if (crossUserSource.status !== 404) throw new Error("其他用户读取到了 PDF 原始文件");
  const fakePdfForm = new FormData();
  fakePdfForm.append("file", new Blob([Buffer.from("not a pdf")], { type: "application/pdf" }), "伪装文件.pdf");
  const fakePdfResponse = await fetch(`${base}/documents/import`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fakePdfForm });
  if (fakePdfResponse.status !== 422) throw new Error("伪造 PDF 文件头没有被正式上传入口拒绝");
  const startXrefIndex = pdfBytes.lastIndexOf(Buffer.from("startxref", "ascii"));
  if (startXrefIndex < 0) throw new Error("PDF 测试文件缺少 startxref");
  const oversizedPdfBytes = Buffer.concat([pdfBytes.subarray(0, startXrefIndex), Buffer.alloc(10 * 1024 * 1024 + 64 * 1024, 0x20), pdfBytes.subarray(startXrefIndex)]);
  const oversizedForm = new FormData(); oversizedForm.append("file", new Blob([oversizedPdfBytes], { type: "application/pdf" }), "超过十兆.pdf");
  const oversizedResponse = await fetch(`${base}/documents/import`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: oversizedForm });
  const oversizedBody = await oversizedResponse.json();
  if (!oversizedResponse.ok || oversizedBody.document?.sourceType !== "pdf") throw new Error(`超过 10MB 的真实 PDF 仍被上传入口拒绝：${JSON.stringify(oversizedBody)}`);
  if ((await readdir(path.join(tempData, "upload-temp"))).length !== 0) throw new Error("超过 10MB 的上传完成后仍残留临时文件");
  await request(`/documents/${oversizedBody.document.id}?permanent=true`, { method: "DELETE" }, token);
  await request(`/documents/${importedPdfBody.document.id}?permanent=true`, { method: "DELETE" }, token);
  const deletedPdfSource = await fetch(`${base}/documents/${importedPdfBody.document.id}/source`, { headers: { Authorization: `Bearer ${token}` } });
  if (deletedPdfSource.status !== 404) throw new Error("永久删除后 PDF 原始文件仍可读取");

  const createdDocument = await request("/documents", { method: "POST", body: "{}" }, token);
  const seedText = "自注意力机制允许序列中的每个 Token 根据相关性聚合其他 Token 的信息。";
  await request(`/documents/${createdDocument.document.id}`, { method: "PATCH", body: JSON.stringify({ title: "集成测试文档", blocks: [{ ...createdDocument.document.blocks[0], content: seedText }] }) }, token);
  const loaded = await request(`/documents/${createdDocument.document.id}`, {}, token);
  const block = loaded.document.blocks[0];
  const created = await request(`/documents/${loaded.document.id}/tips`, { method: "POST", body: JSON.stringify({ blockId: block.id, selectedText: block.content.slice(0, 12), startOffset: 0, endOffset: 12, prefixText: "", suffixText: block.content.slice(12, 24) }) }, token);

  await request("/settings", { method: "PUT", body: JSON.stringify({ provider: "custom", baseURL: `http://127.0.0.1:${mockPort}/v1`, model: "mock-model", apiKey: "test-key", systemPrompt: chineseDefaultPrompt, webSearchEnabled: false, searchApiKey: "tvly-test", pythonEnabled: true, reliabilityEnabled: true }) }, token);
  const disabledTavilyBefore = searchRequests;
  const disabledReferenceBefore = referenceSearchRequests.length;
  const disabledExternalFetchBefore = configuredExternalFetchRequests;
  const disabledSearchAssessmentBefore = searchAssessmentRequests;
  const disabledAnswerToolStart = answerToolNames.length;
  const disabledPolicyEvents = await chat(created.tip.id, "如何从政策工具组合与执行偏差角度评估双碳目标的地方落实效果？", token);
  const disabledPolicyAnswer = disabledPolicyEvents.find((item) => item.type === "done")?.tip?.messages?.at(-1)?.content || "";
  const disabledSearchTrace = disabledPolicyEvents.find((item) => item.type === "skill" && item.skill?.name === "web_search_assessment");
  const disabledAnswerTools = answerToolNames.slice(disabledAnswerToolStart).flat();
  if (searchRequests !== disabledTavilyBefore || referenceSearchRequests.length !== disabledReferenceBefore || configuredExternalFetchRequests !== disabledExternalFetchBefore) throw new Error(`联网总开关关闭后仍产生 Tavily、百科或网页读取：${JSON.stringify({ tavilyDelta: searchRequests - disabledTavilyBefore, referenceDelta: referenceSearchRequests.length - disabledReferenceBefore, fetchDelta: configuredExternalFetchRequests - disabledExternalFetchBefore })}`);
  if (searchAssessmentRequests !== disabledSearchAssessmentBefore || disabledAnswerTools.includes("web_search")) throw new Error(`联网总开关关闭后仍调用联网判断模型或向回答模型暴露 web_search：${JSON.stringify({ assessmentDelta: searchAssessmentRequests - disabledSearchAssessmentBefore, tools: disabledAnswerTools })}`);
  if (!disabledPolicyAnswer || disabledPolicyEvents.some((item) => item.type === "skill" && ["web_search", "web_fetch", "manual_lookup", "citation_audit"].includes(item.skill?.name)) || !String(disabledSearchTrace?.skill?.label).includes("联网搜索已关闭")) throw new Error(`联网关闭状态没有形成非联网正式回答链：${JSON.stringify({ answer: disabledPolicyAnswer, trace: disabledSearchTrace?.skill, skills: disabledPolicyEvents.filter((item) => item.type === "skill").map((item) => item.skill?.name) })}`);
  if (/https?:\/\/|Tavily API|联网审查未通过/.test(disabledPolicyAnswer) || !disabledPolicyAnswer.includes("未联网核验")) throw new Error(`联网关闭回答包含搜索入口、错误审查结论或缺少未核验标识：${disabledPolicyAnswer}`);

  await request("/settings", { method: "PUT", body: JSON.stringify({ provider: "custom", baseURL: `http://127.0.0.1:${mockPort}/v1`, model: "mock-model", apiKey: "test-key", systemPrompt: chineseDefaultPrompt, webSearchEnabled: true, searchApiKey: "tvly-test", pythonEnabled: true, reliabilityEnabled: true }) }, token);

  await chat(created.tip.id, "Please explain the selected text briefly.", token, "en");
  const englishAnswerPrompt = answerSystemPrompts.findLast((prompt) => prompt.startsWith("You are"));
  if (!englishAnswerPrompt || englishAnswerPrompt.includes("你是文档内的局部阅读助手") || /正确性规则/u.test(englishAnswerPrompt)) throw new Error(`英文请求的模型 system message 仍消费中文内置 Prompt：${englishAnswerPrompt}`);

  const pythonEvents = await chat(created.tip.id, "请计算 0.1 + 0.2", token);
  const searchEvents = await chat(created.tip.id, "请联网搜索最新稳定版本", token);
  const cachedSearchEvents = await chat(created.tip.id, "请联网搜索最新稳定版本", token);
  const searchRequestsAfterCachedQuery = searchRequests;
  const professionalEvents = await chat(created.tip.id, "在弱内存模型下，RCU grace period 与 acquire-release 屏障如何保证 reader 可见性？", token);
  const unsupportedProfessionalEvents = await chat(created.tip.id, "请做专业错误审查：从控制理论角度证明该控制器在所有条件下绝对稳定。", token);
  const policySearchesBefore = searchRequests;
  const policyEvents = await chat(created.tip.id, "如何从多层级治理、政策工具组合与执行偏差角度评估双碳目标的地方落实效果？", token);
  const policySearchesAfter = searchRequests;
  const assessmentFailureEvents = await chat(created.tip.id, "ASSESSMENT_FAILURE：验证专业程度评估失败时不能绕过。", token);
  const ordinarySearchesBefore = searchRequests;
  const ordinaryEvents = await chat(created.tip.id, "周末怎样泡一杯清淡的茶？", token);
  const ordinarySearchesAfter = searchRequests;
  const lowSearchesBefore = searchRequests;
  const lowSearchDecisionEvents = await chat(created.tip.id, "WEB_SEARCH_DECISION_LOW：只改变 AI 联网判断的置信度。", token);
  const lowSearchesAfter = searchRequests;
  const failedSearchesBefore = searchRequests;
  const failedSearchDecisionEvents = await chat(created.tip.id, "WEB_SEARCH_DECISION_FAILURE：验证非法联网判断不会阻断回答。", token);
  const failedSearchesAfter = searchRequests;
  const safetyFailureSearchesBefore = searchRequests;
  const safetyFailureEvents = await chat(created.tip.id, "RCU grace period WEB_SEARCH_DECISION_FAILURE：验证专业安全下限。", token);
  const safetyFailureSearchesAfter = searchRequests;
  const highRiskEvents = await chat(created.tip.id, "这个药物剂量是否适合我？", token);
  const longAnswerEvents = await chat(created.tip.id, "LONG_ANSWER_TEST：请生成需要自动续写的完整回答。", token);
  await Promise.all([
    chat(created.tip.id, "请计算 2 + 2", token),
    request(`/documents/${loaded.document.id}`, { method: "PATCH", body: JSON.stringify({ title: "并发写入已保留" }) }, token)
  ]);
  const concurrentlyLoaded = await request(`/documents/${loaded.document.id}`, {}, token);
  if (concurrentlyLoaded.document.title !== "并发写入已保留" || concurrentlyLoaded.tips[0].messages.length < 8) throw new Error("数据库并发写入发生数据丢失");
  const pythonSkill = pythonEvents.find((item) => item.type === "skill" && item.skill?.name === "python");
  const searchSkill = searchEvents.find((item) => item.type === "skill" && item.skill?.name === "web_search");
  const crossCheck = searchEvents.find((item) => item.type === "skill" && item.skill?.name === "cross_check");
  const originalFetch = searchEvents.find((item) => item.type === "skill" && item.skill?.name === "web_fetch");
  const conflictCheck = searchEvents.find((item) => item.type === "skill" && item.skill?.name === "conflict_check");
  const freshnessCheck = searchEvents.find((item) => item.type === "skill" && item.skill?.name === "freshness_check");
  const securityCheck = searchEvents.find((item) => item.type === "skill" && item.skill?.name === "security_check");
  const finalTip = searchEvents.find((item) => item.type === "done")?.tip;
  const citationAudit = searchEvents.find((item) => item.type === "skill" && item.skill?.name === "citation_audit");
  const cachedSearch = cachedSearchEvents.find((item) => item.type === "skill" && item.skill?.name === "web_search");
  const humanReview = highRiskEvents.find((item) => item.type === "skill" && item.skill?.name === "human_review");
  const highRiskAnswer = highRiskEvents.find((item) => item.type === "done")?.tip?.messages?.at(-1)?.content || "";
  const professionalAssessment = professionalEvents.find((item) => item.type === "skill" && item.skill?.name === "professional_assessment");
  const professionalSearch = professionalEvents.find((item) => item.type === "skill" && item.skill?.name === "web_search");
  const professionalReview = professionalEvents.find((item) => item.type === "skill" && item.skill?.name === "professional_review");
  const professionalAnswer = professionalEvents.find((item) => item.type === "done")?.tip?.messages?.at(-1)?.content || "";
  const unsupportedReview = unsupportedProfessionalEvents.find((item) => item.type === "skill" && item.skill?.name === "professional_review");
  const unsupportedAnswer = unsupportedProfessionalEvents.find((item) => item.type === "done")?.tip?.messages?.at(-1)?.content || "";
  const policyAssessment = policyEvents.find((item) => item.type === "skill" && item.skill?.name === "professional_assessment");
  const policyReview = policyEvents.find((item) => item.type === "skill" && item.skill?.name === "professional_review");
  const policyAnswer = policyEvents.find((item) => item.type === "done")?.tip?.messages?.at(-1)?.content || "";
  const assessmentFailure = assessmentFailureEvents.find((item) => item.type === "skill" && item.skill?.name === "professional_assessment");
  const assessmentFailureAnswer = assessmentFailureEvents.find((item) => item.type === "done")?.tip?.messages?.at(-1)?.content || "";
  const ordinaryAssessment = ordinaryEvents.find((item) => item.type === "skill" && item.skill?.name === "professional_assessment");
  const lowSearchDecision = lowSearchDecisionEvents.find((item) => item.type === "skill" && item.skill?.name === "web_search_assessment");
  const lowSearchAnswer = lowSearchDecisionEvents.find((item) => item.type === "done")?.tip?.messages?.at(-1)?.content || "";
  const failedSearchDecision = failedSearchDecisionEvents.find((item) => item.type === "skill" && item.skill?.name === "web_search_assessment");
  const failedSearchAnswer = failedSearchDecisionEvents.find((item) => item.type === "done")?.tip?.messages?.at(-1)?.content || "";
  const safetyFailureDecision = safetyFailureEvents.find((item) => item.type === "skill" && item.skill?.name === "web_search_assessment");
  const longAnswer = longAnswerEvents.find((item) => item.type === "done")?.tip?.messages?.at(-1)?.content || "";
  if (!pythonSkill || !String(pythonSkill.skill.detail).includes("0.3")) throw new Error("Python 工具调用链测试失败");
  if (!searchSkill || searchSkill.skill.sources?.length !== 2) throw new Error("联网搜索工具调用链测试失败");
  if (!crossCheck || !originalFetch || !conflictCheck || !freshnessCheck || !securityCheck) throw new Error("研究可靠性流水线测试失败");
  if (crossCheck.skill.status !== "warning") throw new Error("同域名来源不应通过交叉验证");
  if (freshnessCheck.skill.status !== "warning") throw new Error("无发布日期来源不应通过时效检查");
  if (!citationAudit || citationAudit.skill.status !== "success") throw new Error("引用审计测试失败");
  if (!cachedSearch || !cachedSearch.skill.label.includes("缓存") || !cachedSearch.skill.detail.includes("0 额度") || searchRequestsAfterCachedQuery !== 1) throw new Error("搜索缓存或额度保护测试失败");
  if (!professionalAssessment || professionalAssessment.skill.status !== "success" || !String(professionalAssessment.skill.detail).includes("模型评估 · 一般") || !String(professionalAssessment.skill.detail).includes("规则安全下限") || !String(professionalAssessment.skill.label).includes("专业")) throw new Error("模型将规则专业问题降级后，规则安全下限没有保持专业判断");
  if (!professionalSearch || !professionalReview || professionalReview.skill.status !== "success" || !professionalAnswer.includes("[S1]") || searchRequests < 3) throw new Error(`专业问题没有强制联网并通过最终审查：${JSON.stringify({ professionalSearch: professionalSearch?.skill, professionalReview: professionalReview?.skill, professionalAnswer, searchRequests })}`);
  if (!unsupportedReview || unsupportedReview.skill.status !== "warning" || !unsupportedAnswer.includes("UNSUPPORTED_CLAIM") || !unsupportedAnswer.includes("审查未通过") || !unsupportedAnswer.includes("请勿把未被证据支持的主张当作已证实事实")) throw new Error(`未被证据支持的专业回答没有保留原文并附加警告：${JSON.stringify({ unsupportedReview: unsupportedReview?.skill, unsupportedAnswer })}`);
  if (!policyAssessment || !String(policyAssessment.skill.detail).includes("模型评估") || !String(policyAssessment.skill.detail).includes("政策与公共治理") || policySearchesAfter - policySearchesBefore !== 1 || policyReview?.skill?.status !== "success" || !policyAnswer.includes("[S1]")) throw new Error(`模型识别的政策专业问题没有进入强制联网正式路径：${JSON.stringify({ assessment: policyAssessment?.skill, searches: policySearchesAfter - policySearchesBefore, review: policyReview?.skill, answer: policyAnswer })}`);
  if (!assessmentFailure || assessmentFailure.skill.status !== "warning" || !assessmentFailureAnswer || assessmentFailureAnswer.includes("本次不会继续生成回答") || assessmentFailureEvents.some((item) => item.type === "skill" && item.skill?.name === "web_search")) throw new Error(`模型专业度评估失败后没有以规则结果继续回答：${JSON.stringify({ assessment: assessmentFailure?.skill, answer: assessmentFailureAnswer })}`);
  if (!ordinaryAssessment || !String(ordinaryAssessment.skill.detail).includes("模型评估") || ordinarySearchesAfter !== ordinarySearchesBefore) throw new Error("普通生活问题不应消耗 Tavily 搜索额度");
  if (lowSearchesAfter - lowSearchesBefore !== 1 || lowSearchDecision?.skill?.status !== "warning" || !String(lowSearchDecision.skill.label).includes("置信度不足") || !lowSearchAnswer) throw new Error(`AI 低置信度判断没有保守搜索并继续回答：${JSON.stringify({ searchDelta: lowSearchesAfter - lowSearchesBefore, decision: lowSearchDecision?.skill, answer: lowSearchAnswer })}`);
  if (failedSearchesAfter !== failedSearchesBefore || failedSearchDecision?.skill?.status !== "warning" || !String(failedSearchDecision.skill.label).includes("未盲目搜索") || !failedSearchAnswer) throw new Error(`普通问题的 AI 判断完全失败后仍盲目搜索或没有继续回答：${JSON.stringify({ searchDelta: failedSearchesAfter - failedSearchesBefore, decision: failedSearchDecision?.skill, answer: failedSearchAnswer })}`);
  if (safetyFailureSearchesAfter - safetyFailureSearchesBefore !== 1 || safetyFailureDecision?.skill?.status !== "warning" || !String(safetyFailureDecision?.skill?.label).includes("必须联网")) throw new Error(`专业安全下限被损坏的 AI 联网判断绕过或被错误标成成功：${JSON.stringify({ searchDelta: safetyFailureSearchesAfter - safetyFailureSearchesBefore, decision: safetyFailureDecision?.skill })}`);
  if (!humanReview || humanReview.skill.status !== "warning" || !highRiskAnswer.includes("重要提示") || highRiskAnswer.startsWith("这是医疗健康高风险问题，但")) throw new Error("高风险证据不足没有保留回答并附加人工复核提示");
  if (!longAnswer.includes("LONG_ANSWER_START") || !longAnswer.includes("LONG_ANSWER_END") || longAnswer.indexOf("LONG_ANSWER_END") <= longAnswer.indexOf("LONG_ANSWER_START") || (longAnswer.match(/LONG_ANSWER_START/g) || []).length !== 1 || (longAnswer.match(/LONG_ANSWER_END/g) || []).length !== 1) throw new Error(`finish_reason=length 没有形成无重复的完整续写：${JSON.stringify({ length: longAnswer.length, start: longAnswer.slice(0, 40), end: longAnswer.slice(-40) })}`);
  if (!finalTip?.messages?.some((item) => item.skills?.some((skill) => skill.name === "web_search"))) throw new Error("技能记录未持久化");

  await request("/settings", { method: "PUT", body: JSON.stringify({ provider: "custom", baseURL: `http://127.0.0.1:${mockPort}/v1`, model: "mock-model", apiKey: "test-key", systemPrompt: chineseDefaultPrompt, webSearchEnabled: true, clearSearchApiKey: true, pythonEnabled: true }) }, token);
  const tavilyRequestsBeforeFallback = searchRequests;
  const fallbackRequestStart = referenceSearchRequests.length;
  const fallbackEvents = await chat(created.tip.id, "请联网搜索 REFERENCE_FALLBACK_TEST", token);
  const fallbackAnswer = fallbackEvents.find((item) => item.type === "done")?.tip?.messages?.at(-1)?.content || "";
  const fallbackTrace = fallbackEvents.find((item) => item.type === "skill" && item.skill?.name === "web_search");
  const fallbackCalls = referenceSearchRequests.slice(fallbackRequestStart);
  if (searchRequests !== tavilyRequestsBeforeFallback || fallbackCalls.length < 4 || !fallbackCalls.some((item) => item.site === "baidu") || fallbackTrace?.skill?.status !== "success" || !String(fallbackTrace.skill.detail).includes("备用") || !fallbackAnswer.includes("[S1]") || !fallbackAnswer.includes("数据可能不够精细或最新") || !fallbackAnswer.includes("Tavily API")) throw new Error(`无 Tavily Key 的备用中外参考检索没有进入正式回答链：${JSON.stringify({ tavilyDelta: searchRequests - tavilyRequestsBeforeFallback, fallbackCalls, trace: fallbackTrace?.skill, answer: fallbackAnswer })}`);
  const persistedFallback = (await request(`/documents/${loaded.document.id}`, {}, token)).tips.find((item) => item.id === created.tip.id)?.messages?.at(-1);
  if (!persistedFallback?.skills?.some((skill) => skill.name === "web_search" && skill.sources?.length >= 2) || persistedFallback.content !== fallbackAnswer) throw new Error("备用检索来源、降级提示或回答没有持久化");

  const allFailEvents = await chat(created.tip.id, "请联网搜索 REFERENCE_ALL_FAIL", token);
  const allFailAnswer = allFailEvents.find((item) => item.type === "done")?.tip?.messages?.at(-1)?.content || "";
  const allFailTrace = allFailEvents.find((item) => item.type === "skill" && item.skill?.name === "web_search");
  const allFailRecovery = allFailEvents.find((item) => item.type === "skill" && item.skill?.name === "search_failure_recovery");
  const allFailLookup = allFailEvents.find((item) => item.type === "skill" && item.skill?.name === "manual_lookup");
  if (!allFailAnswer || allFailAnswer.includes("[S1]") || allFailTrace?.skill?.status !== "warning" || allFailTrace?.skill?.sources?.length || allFailRecovery?.skill?.status !== "warning" || allFailLookup?.skill?.sources?.length !== 5 || !allFailAnswer.includes("没有取得可用联网证据") || !allFailAnswer.includes("Tavily API") || !allFailAnswer.includes("自注意力机制允许") || /(?:拒绝回答|无法回答|不会回答|不提供回答)/.test(allFailAnswer) || !allFailAnswer.includes("https://zh.wikipedia.org/w/index.php?search=REFERENCE_ALL_FAIL") || !allFailAnswer.includes("https://en.wikipedia.org/w/index.php?search=REFERENCE_ALL_FAIL")) throw new Error(`备用站点全部失败后没有基于文档回答并提供中英文百科检索入口：${JSON.stringify({ trace: allFailTrace?.skill, recovery: allFailRecovery?.skill, lookup: allFailLookup?.skill, answer: allFailAnswer })}`);

  await request("/settings", { method: "PUT", body: JSON.stringify({ provider: "custom", baseURL: `http://127.0.0.1:${mockPort}/v1`, model: "mock-model", apiKey: "test-key", systemPrompt: chineseDefaultPrompt, webSearchEnabled: true, searchApiKey: "tvly-test", pythonEnabled: true }) }, token);
  const referenceBeforeTavilyFailure = referenceSearchRequests.length;
  const tavilyFailEvents = await chat(created.tip.id, "请联网搜索 TAVILY_FAIL", token);
  const tavilyFailAnswer = tavilyFailEvents.find((item) => item.type === "done")?.tip?.messages?.at(-1)?.content || "";
  const tavilyFailTrace = tavilyFailEvents.find((item) => item.type === "skill" && item.skill?.name === "web_search");
  if (!tavilyFailAnswer || tavilyFailTrace?.skill?.status !== "warning" || referenceSearchRequests.length !== referenceBeforeTavilyFailure || tavilyFailAnswer.includes("Tavily API Key，以获得") || !tavilyFailAnswer.includes("自注意力机制允许") || !tavilyFailAnswer.includes("https://zh.wikipedia.org/w/index.php?search=") || !tavilyFailAnswer.includes("https://en.wikipedia.org/w/index.php?search=")) throw new Error(`Tavily 搜索失败后没有在不伪装备用检索的情况下基于文档回答并提供百科入口：${JSON.stringify({ trace: tavilyFailTrace?.skill, answer: tavilyFailAnswer, referenceDelta: referenceSearchRequests.length - referenceBeforeTavilyFailure })}`);

  const nestedSourceTip = (await request(`/documents/${loaded.document.id}`, {}, token)).tips.find((item) => item.id === created.tip.id);
  const nestedSourceMessage = [...nestedSourceTip.messages].reverse().find((item) => item.role === "assistant" && item.content.includes("政策评估"));
  if (!nestedSourceMessage) throw new Error("缺少用于聊天内 Tip 的持久化消息 fixture");
  const nestedSelectedText = "政策工具";
  const nestedStart = nestedSourceMessage.content.indexOf(nestedSelectedText);
  const nested = await request(`/tips/${created.tip.id}/children`, { method: "POST", body: JSON.stringify({ messageId: nestedSourceMessage.id, selectedText: nestedSelectedText, startOffset: nestedStart, endOffset: nestedStart + nestedSelectedText.length, prefixText: nestedSourceMessage.content.slice(Math.max(0, nestedStart - 16), nestedStart), suffixText: nestedSourceMessage.content.slice(nestedStart + nestedSelectedText.length, nestedStart + nestedSelectedText.length + 16) }) }, token);
  if (nested.tip.anchorType !== "message" || nested.tip.parentTipId !== created.tip.id || nested.tip.anchorMessageId !== nestedSourceMessage.id) throw new Error("聊天选区没有产生可追溯的父子 Tip");
  const nestedChatEvents = await chat(nested.tip.id, "请解释这个术语", token);
  const nestedDone = nestedChatEvents.find((item) => item.type === "done")?.tip;
  const grandSourceMessage = nestedDone?.messages.find((item) => item.role === "assistant");
  if (!grandSourceMessage) throw new Error("子 Tip 没有生成可继续创建 Tip 的消息");
  const grandSelectedText = grandSourceMessage.content.slice(0, Math.min(8, grandSourceMessage.content.length));
  const grand = await request(`/tips/${nested.tip.id}/children`, { method: "POST", body: JSON.stringify({ messageId: grandSourceMessage.id, selectedText: grandSelectedText, startOffset: 0, endOffset: grandSelectedText.length, prefixText: "", suffixText: grandSourceMessage.content.slice(grandSelectedText.length, grandSelectedText.length + 16) }) }, token);
  if (grand.tip.parentTipId !== nested.tip.id || grand.tip.depth !== 3) throw new Error("递归孙 Tip 的 lineage 或深度错误");
  const renamed = await request(`/tips/${nested.tip.id}`, { method: "PATCH", body: JSON.stringify({ title: "可修改的子对话名称" }) }, token);
  if (renamed.tip.title !== "可修改的子对话名称") throw new Error("树节点名称没有通过正式 PATCH 持久化");
  const crossUserCreate = await fetch(`${base}/tips/${created.tip.id}/children`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${registered.token}` }, body: JSON.stringify({ messageId: nestedSourceMessage.id, selectedText: nestedSelectedText, startOffset: nestedStart, endOffset: nestedStart + nestedSelectedText.length }) });
  if (crossUserCreate.status !== 404) throw new Error("其他用户能够在当前用户的聊天中创建子 Tip");
  const invalidMessageCreate = await fetch(`${base}/tips/${created.tip.id}/children`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ messageId: "missing-message", selectedText: nestedSelectedText, startOffset: nestedStart, endOffset: nestedStart + nestedSelectedText.length }) });
  if (invalidMessageCreate.status !== 400) throw new Error("不存在的来源消息没有被拒绝");
  const mismatchedCreate = await fetch(`${base}/tips/${created.tip.id}/children`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ messageId: nestedSourceMessage.id, selectedText: "错误文字", startOffset: nestedStart, endOffset: nestedStart + nestedSelectedText.length }) });
  if (mismatchedCreate.status !== 400) throw new Error("不匹配的聊天选区偏移没有被拒绝");
  const duplicateCreate = await fetch(`${base}/tips/${created.tip.id}/children`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ messageId: nestedSourceMessage.id, selectedText: nestedSelectedText, startOffset: nestedStart, endOffset: nestedStart + nestedSelectedText.length }) });
  if (duplicateCreate.status !== 409) throw new Error("重复聊天 Tip 锚点没有被拒绝");
  const reloadedNestedTips = (await request(`/documents/${loaded.document.id}`, {}, token)).tips;
  if (!reloadedNestedTips.some((item) => item.id === grand.tip.id && item.parentTipId === nested.tip.id && item.anchorStatus === "valid")) throw new Error("递归 Tip 关系未持久化或被文档锚点恢复错误破坏");
  const deletedNested = await request(`/tips/${nested.tip.id}`, { method: "DELETE" }, token);
  if (deletedNested.deletedIds?.length !== 2 || !deletedNested.deletedIds.includes(grand.tip.id)) throw new Error("删除父 Tip 没有返回真实级联删除子树");
  const afterCascade = (await request(`/documents/${loaded.document.id}`, {}, token)).tips;
  if (afterCascade.some((item) => item.id === nested.tip.id || item.id === grand.tip.id)) throw new Error("级联删除后仍存在孤儿 Tip");

  const freshDocument = await request("/documents", { method: "POST", body: "{}" }, registered.token);
  const freshBlock = freshDocument.document.blocks[0];
  await request(`/documents/${freshDocument.document.id}`, { method: "PATCH", body: JSON.stringify({ blocks: [{ ...freshBlock, content: "并发程序的内存一致性" }] }) }, registered.token);
  const freshTip = await request(`/documents/${freshDocument.document.id}/tips`, { method: "POST", body: JSON.stringify({ blockId: freshBlock.id, selectedText: "并发程序", startOffset: 0, endOffset: 4, prefixText: "", suffixText: "的内存一致性" }) }, registered.token);
  const blockedBefore = (await request(`/documents/${freshDocument.document.id}`, {}, registered.token)).tips.find((item) => item.id === freshTip.tip.id).messages.length;
  const blockedProfessional = await fetch(`${base}/tips/${freshTip.tip.id}/chat`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${registered.token}` }, body: JSON.stringify({ question: "请从弱内存模型和线性一致性角度进行专业分析。" }) });
  const blockedProfessionalBody = await blockedProfessional.json();
  const blockedAfter = (await request(`/documents/${freshDocument.document.id}`, {}, registered.token)).tips.find((item) => item.id === freshTip.tip.id).messages.length;
  if (blockedProfessional.status !== 409 || blockedProfessionalBody.code !== "MODEL_NOT_CONFIGURED" || !String(blockedProfessionalBody.error).includes("下载本地模型") || blockedBefore !== blockedAfter) throw new Error(`未配置模型时聊天没有在写入历史前被阻断，或错误使用了发布者环境 API Key：${JSON.stringify({ status: blockedProfessional.status, body: blockedProfessionalBody, blockedBefore, blockedAfter })}`);

  const removedFeedback = await fetch(`${base}/feedback`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ category: "feature", message: "该旧入口不应继续存在" }) });
  const removedFeedbackWithoutAuth = await fetch(`${base}/feedback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category: "feature", message: "该旧入口不应继续存在" }) });
  if (removedFeedback.status !== 404 || removedFeedbackWithoutAuth.status !== 404) throw new Error(`建议功能移除后旧 HTTP 路由仍可调用：${JSON.stringify({ authenticated: removedFeedback.status, anonymous: removedFeedbackWithoutAuth.status })}`);
  if (configuredExternalFetchRequests < 1) throw new Error("正式联网路径没有消费可注入的桌面系统网络 fetch");
  console.log(JSON.stringify({ python: pythonSkill.skill.detail, searchSources: searchSkill.skill.sources.length, modelAssessmentRequests, searchAssessmentRequests, aiSearchLowConfidenceFallback: true, aiSearchInvalidOutputNoBlindSearch: true, aiSearchSafetyFailureStillSearches: true, webSearchDisabledNoNetwork: true, webSearchToolHiddenWhenDisabled: true, feedbackRemoved: true, configuredExternalFetchRequests, policyProfessionalReview: true, professionalReview: true, noModelChatBlockedBeforeMutation: true, fallbackReferenceSearch: true, fallbackSiteSkip: true, fallbackAllFailedAnswered: true, tavilyFailedAnswered: true, unsupportedAnswerPreserved: true, assessmentFailureAnswered: true, outputLengthContinued: true, nestedTips: true, recursiveLineage: true, legacyMigration: true, filenameMigration: true, pdfImport: true, pdfOriginalTip: true, pdfRecursiveTip: true, pdfOrphanChatBlocked: true, pdfAnnotationExport: true, pdfExportedFirstAnswerComplete: true, pdfBytePreservation: true, uploadOver10Mb: true, uploadTempCleanup: true, englishPromptCausal: true, orphanChatBlocked: true, depthOverflowBlocked: true, cascadeDelete: true, citationAudit: true, humanReview: true, persisted: true }));
} finally {
  configureExternalNetworkFetch(null);
  await new Promise((resolve) => appServer.close(resolve));
  await new Promise((resolve) => mock.close(resolve));
  await rm(tempData, { recursive: true, force: true });
}
