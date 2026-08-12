import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import bcrypt from "bcryptjs";
import os from "node:os";
import path from "node:path";

const tempData = await mkdtemp(path.join(os.tmpdir(), "ai-tip-skills-"));
process.env.AI_TIP_EMBEDDED = "1";
process.env.AI_TIP_DESKTOP = "1";
process.env.AI_TIP_DATA_DIR = tempData;
process.env.OPENAI_API_KEY = "publisher-key-must-not-be-used";
let searchRequests = 0;
let modelAssessmentRequests = 0;
const feedbackPayloads = [];

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
  }],
  tips: [
    { id: "legacy-tip", userId: legacyUserId, documentId: legacyDocumentId, blockId: "legacy-paragraph", messages: [] },
    { id: "migration-root-tip", userId: legacyUserId, documentId: "migration-document", blockId: "migration-block", selectedText: "legacy", startOffset: 0, endOffset: 6, prefixText: "", suffixText: " anchor", selectedTextHash: "old", title: "旧根 Tip", summary: "", status: "open", anchorStatus: "valid", memoryEnabled: true, messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: "migration-orphan-tip", userId: legacyUserId, documentId: "migration-document", blockId: "migration-block", anchorType: "message", parentTipId: "missing-parent", anchorMessageId: "missing-message", depth: 2, selectedText: "missing", startOffset: 0, endOffset: 7, prefixText: "", suffixText: "", selectedTextHash: "old", title: "孤儿 Tip", summary: "", status: "open", anchorStatus: "valid", memoryEnabled: true, messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ...deepTips
  ],
  settings: []
}, null, 2), "utf8");

const mock = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/usage") {
    res.end(JSON.stringify({ key: { usage: 12, limit: 1000 } }));
    return;
  }
  if (req.url === "/search") {
    searchRequests += 1;
    const query = String(JSON.parse(raw || "{}").query || "");
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
  if (req.url === "/feedback-relay") {
    feedbackPayloads.push(JSON.parse(raw || "{}"));
    res.statusCode = 202;
    res.end(JSON.stringify({ accepted: true }));
    return;
  }
  const body = JSON.parse(raw || "{}");
  const messages = body.messages || [];
  const last = messages[messages.length - 1] || {};
  const toolResult = last.role === "tool" ? String(last.content || "") : "";
  const isProfessionalClassifier = messages.some((item) => item.role === "system" && String(item.content || "").includes("PROFESSIONALISM_CLASSIFIER_V1"));
  let message;
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
  } else if (!body.tools) {
    const auditInput = String(last.content || "");
    message = { role: "assistant", content: auditInput.includes("UNSUPPORTED_CLAIM") ? "UNSUPPORTED: 该主张没有被提供的联网证据支持。" : "SUPPORTED: 回答中的结论与工具证据一致，并展示了来源。" };
  } else if (toolResult) {
    message = { role: "assistant", content: toolResult.includes("官方版本说明") ? "根据搜索来源，最新稳定版是 2.0。[S1]" : "Python 精确计算结果为 0.3。" };
  } else {
    const question = [...messages].reverse().find((item) => item.role === "user")?.content || "";
    if (String(question).includes("RCU grace period")) {
      message = { role: "assistant", content: "根据联网证据，RCU 与 acquire-release 的可见性需要结合具体内存模型解释。[S1]" };
    } else if (String(question).includes("双碳目标")) {
      message = { role: "assistant", content: "政策评估应同时核对正式目标、政策工具、执行主体与地区实施数据。[S1][S2]" };
    } else if (String(question).includes("专业错误审查")) {
      message = { role: "assistant", content: "UNSUPPORTED_CLAIM：该控制器在所有条件下都绝对稳定。[S1]" };
    } else {
      const search = body.tool_choice?.function?.name === "web_search" || String(question).includes("最新");
      message = { role: "assistant", content: null, tool_calls: [{ id: search ? "call_search" : "call_python", type: "function", function: search ? { name: "web_search", arguments: JSON.stringify({ query: "产品最新稳定版本" }) } : { name: "python_calculate", arguments: JSON.stringify({ code: "decimal.Decimal('0.1') + decimal.Decimal('0.2')" }) } }] };
    }
  }
  res.end(JSON.stringify({ id: "chatcmpl-test", object: "chat.completion", created: 0, model: "mock-model", choices: [{ index: 0, message, finish_reason: message.tool_calls ? "tool_calls" : "stop" }] }));
});

const listen = (server) => new Promise((resolve, reject) => { server.listen(0, "127.0.0.1", () => resolve(server.address().port)); server.once("error", reject); });
const mockPort = await listen(mock);
process.env.TAVILY_API_URL = `http://127.0.0.1:${mockPort}/search`;
process.env.TAVILY_USAGE_URL = `http://127.0.0.1:${mockPort}/usage`;
process.env.AI_TIP_FEEDBACK_RELAY_URL = `http://127.0.0.1:${mockPort}/feedback-relay`;
process.env.AI_TIP_ALLOW_INSECURE_FEEDBACK_RELAY = "1";
const { configureSecretProtection, startServer } = await import("../dist-electron/server.cjs");
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

async function chat(tipId, question, token) {
  const response = await fetch(`${base}/tips/${tipId}/chat`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ question }) });
  const lines = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
  const error = lines.find((item) => item.type === "error");
  if (error) throw new Error(error.error);
  return lines;
}

try {
  const login = await request("/auth/login", { method: "POST", body: JSON.stringify({ email: "demo@aitip.local", password: "demo1234" }) });
  const token = login.token;
  const migrated = await request("/documents/migration-document", {}, token);
  const migratedRoot = migrated.tips.find((item) => item.id === "migration-root-tip");
  const migratedOrphan = migrated.tips.find((item) => item.id === "migration-orphan-tip");
  if (migratedRoot?.anchorType !== "document" || migratedRoot.depth !== 1 || migratedRoot.anchorStatus !== "valid") throw new Error("旧 Tip 没有迁移为合法根文档 Tip");
  if (migratedOrphan?.anchorStatus !== "orphaned") throw new Error("损坏的消息父链没有被标记为孤儿");
  const orphanChat = await fetch(`${base}/tips/migration-orphan-tip/chat`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ question: "不应继续回答" }) });
  if (orphanChat.status !== 409) throw new Error("孤儿消息 Tip 绕过父链验证进入了聊天入口");
  const depthOverflow = await fetch(`${base}/tips/deep-tip-32/children`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ messageId: "deep-source-32", selectedText: "deep", startOffset: 0, endOffset: 4, prefixText: "", suffixText: " anchor" }) });
  if (depthOverflow.status !== 409) throw new Error("正式子 Tip 创建接口没有拒绝第 33 层");
  await request("/settings", { method: "PUT", body: JSON.stringify({ provider: "custom", baseURL: `http://127.0.0.1:${mockPort}/v1`, model: "mock-model", apiKey: "test-key", systemPrompt: "准确回答", webSearchEnabled: true, searchApiKey: "tvly-test", pythonEnabled: true }) }, token);
  const connectionTest = await request("/settings/test", { method: "POST", body: JSON.stringify({ provider: "custom", baseURL: `http://127.0.0.1:${mockPort}/v1`, model: "mock-model", systemPrompt: "准确回答", webSearchEnabled: true, searchBudgetMode: "free", pythonEnabled: false }) }, token);
  if (!connectionTest.message.includes("988/1000") || searchRequests !== 0) throw new Error("额度查询不应消耗搜索请求");
  const persistedSettings = await readFile(path.join(tempData, "store.json"), "utf8");
  if (persistedSettings.includes("test-key") || persistedSettings.includes("tvly-test") || !persistedSettings.includes("safe:v1:")) throw new Error("API Key 未加密保存");
  const documents = await request("/documents", {}, token);
  if (documents.documents.length !== 0) throw new Error("旧 Transformer 种子文档没有从正式启动路径移除");
  const registered = await request("/auth/register", { method: "POST", body: JSON.stringify({ name: "新用户", email: "fresh@example.com", password: "123456" }) });
  const registeredDocuments = await request("/documents", {}, registered.token);
  if (registeredDocuments.documents.length !== 0) throw new Error("注册路径仍然创建示例文档");
  const createdDocument = await request("/documents", { method: "POST", body: "{}" }, token);
  const seedText = "自注意力机制允许序列中的每个 Token 根据相关性聚合其他 Token 的信息。";
  await request(`/documents/${createdDocument.document.id}`, { method: "PATCH", body: JSON.stringify({ title: "集成测试文档", blocks: [{ ...createdDocument.document.blocks[0], content: seedText }] }) }, token);
  const loaded = await request(`/documents/${createdDocument.document.id}`, {}, token);
  const block = loaded.document.blocks[0];
  const created = await request(`/documents/${loaded.document.id}/tips`, { method: "POST", body: JSON.stringify({ blockId: block.id, selectedText: block.content.slice(0, 12), startOffset: 0, endOffset: 12, prefixText: "", suffixText: block.content.slice(12, 24) }) }, token);

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
  const highRiskEvents = await chat(created.tip.id, "这个药物剂量是否适合我？", token);
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
  if (!pythonSkill || !String(pythonSkill.skill.detail).includes("0.3")) throw new Error("Python 工具调用链测试失败");
  if (!searchSkill || searchSkill.skill.sources?.length !== 2) throw new Error("联网搜索工具调用链测试失败");
  if (!crossCheck || !originalFetch || !conflictCheck || !freshnessCheck || !securityCheck) throw new Error("研究可靠性流水线测试失败");
  if (crossCheck.skill.status !== "warning") throw new Error("同域名来源不应通过交叉验证");
  if (freshnessCheck.skill.status !== "warning") throw new Error("无发布日期来源不应通过时效检查");
  if (!citationAudit || citationAudit.skill.status !== "success") throw new Error("引用审计测试失败");
  if (!cachedSearch || !cachedSearch.skill.label.includes("缓存") || !cachedSearch.skill.detail.includes("0 额度") || searchRequestsAfterCachedQuery !== 1) throw new Error("搜索缓存或额度保护测试失败");
  if (!professionalAssessment || professionalAssessment.skill.status !== "success" || !String(professionalAssessment.skill.detail).includes("模型评估 · 一般") || !String(professionalAssessment.skill.detail).includes("规则安全下限") || !String(professionalAssessment.skill.label).includes("专业")) throw new Error("模型将规则专业问题降级后，规则安全下限没有保持专业判断");
  if (!professionalSearch || !professionalReview || professionalReview.skill.status !== "success" || !professionalAnswer.includes("[S1]") || searchRequests < 3) throw new Error(`专业问题没有强制联网并通过最终审查：${JSON.stringify({ professionalSearch: professionalSearch?.skill, professionalReview: professionalReview?.skill, professionalAnswer, searchRequests })}`);
  if (!unsupportedReview || unsupportedReview.skill.status !== "error" || unsupportedAnswer.includes("UNSUPPORTED_CLAIM") || !unsupportedAnswer.includes("审查未通过")) throw new Error(`未被证据支持的专业回答没有被阻断：${JSON.stringify({ unsupportedReview: unsupportedReview?.skill, unsupportedAnswer })}`);
  if (!policyAssessment || !String(policyAssessment.skill.detail).includes("模型评估") || !String(policyAssessment.skill.detail).includes("政策与公共治理") || policySearchesAfter - policySearchesBefore !== 1 || policyReview?.skill?.status !== "success" || !policyAnswer.includes("[S1]")) throw new Error(`模型识别的政策专业问题没有进入强制联网正式路径：${JSON.stringify({ assessment: policyAssessment?.skill, searches: policySearchesAfter - policySearchesBefore, review: policyReview?.skill, answer: policyAnswer })}`);
  if (!assessmentFailure || assessmentFailure.skill.status !== "error" || !assessmentFailureAnswer.includes("专业程度评估失败") || assessmentFailureEvents.some((item) => item.type === "skill" && item.skill?.name === "web_search")) throw new Error(`模型专业度评估失败后仍被旧路径绕过：${JSON.stringify({ assessment: assessmentFailure?.skill, answer: assessmentFailureAnswer })}`);
  if (!ordinaryAssessment || !String(ordinaryAssessment.skill.detail).includes("模型评估") || ordinarySearchesAfter !== ordinarySearchesBefore) throw new Error("普通生活问题不应消耗 Tavily 搜索额度");
  if (!humanReview || humanReview.skill.status !== "error" || !highRiskAnswer.includes("不会给出个性化结论")) throw new Error("高风险证据不足阻断测试失败");
  if (!finalTip?.messages?.some((item) => item.skills?.some((skill) => skill.name === "web_search"))) throw new Error("技能记录未持久化");

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
  const blockedProfessionalEvents = await chat(freshTip.tip.id, "请从弱内存模型和线性一致性角度进行专业分析。", registered.token);
  const blockedProfessionalAnswer = blockedProfessionalEvents.find((item) => item.type === "done")?.tip?.messages?.at(-1)?.content || "";
  const blockedProfessionalReview = blockedProfessionalEvents.find((item) => item.type === "skill" && item.skill?.name === "professional_review");
  if (!blockedProfessionalEvents.some((item) => item.type === "skill" && item.skill?.name === "professional_assessment") || blockedProfessionalReview?.skill?.status !== "error" || !String(blockedProfessionalReview.skill.detail).includes("模型 API 未配置") || !blockedProfessionalAnswer.includes("联网审查")) throw new Error(`专业问题在联网未配置时没有阻断，或错误使用了发布者环境 API Key：${JSON.stringify({ events: blockedProfessionalEvents.filter((item) => item.type === "skill"), answer: blockedProfessionalAnswer })}`);

  const feedback = await request("/feedback", { method: "POST", body: JSON.stringify({ category: "feature", message: "希望增加专业问题联网审查的状态说明。" }) }, token);
  if (!feedback.ok || feedbackPayloads.length !== 1 || JSON.stringify(feedbackPayloads[0]).includes("@qq.com") || "recipient" in feedbackPayloads[0] || "to" in feedbackPayloads[0]) throw new Error("建议中继或隐藏收件人测试失败");
  const repeatedFeedback = await fetch(`${base}/feedback`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ category: "feature", message: "这是第二条过于频繁提交的有效建议。" }) });
  if (repeatedFeedback.status !== 429) throw new Error("建议接口没有限制提交频率");
  process.env.AI_TIP_FEEDBACK_RELAY_URL = "";
  const unconfiguredFeedback = await fetch(`${base}/feedback`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${registered.token}` }, body: JSON.stringify({ category: "other", message: "中继未配置时，这段建议必须明确返回失败。" }) });
  if (unconfiguredFeedback.status !== 503) throw new Error("建议中继未配置时没有明确失败");
  console.log(JSON.stringify({ python: pythonSkill.skill.detail, searchSources: searchSkill.skill.sources.length, modelAssessmentRequests, policyProfessionalReview: true, professionalReview: true, unsupportedBlocked: true, assessmentFailureBlocked: true, nestedTips: true, recursiveLineage: true, legacyMigration: true, orphanChatBlocked: true, depthOverflowBlocked: true, cascadeDelete: true, feedbackRelay: true, citationAudit: true, humanReview: true, persisted: true }));
} finally {
  await new Promise((resolve) => appServer.close(resolve));
  await new Promise((resolve) => mock.close(resolve));
  await rm(tempData, { recursive: true, force: true });
}
