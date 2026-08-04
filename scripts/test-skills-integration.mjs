import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tempData = await mkdtemp(path.join(os.tmpdir(), "ai-tip-skills-"));
process.env.AI_TIP_EMBEDDED = "1";
process.env.AI_TIP_DATA_DIR = tempData;
let searchRequests = 0;

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
    res.end(JSON.stringify({ results: [
      { title: "官方版本说明", url: "https://example.com/releases", content: "最新稳定版是 2.0。" },
      { title: "官方文档", url: "https://example.com/docs", content: "版本 2.0 的文档。" }
    ] }));
    return;
  }
  const body = JSON.parse(raw || "{}");
  const messages = body.messages || [];
  const last = messages[messages.length - 1] || {};
  const toolResult = last.role === "tool" ? String(last.content || "") : "";
  let message;
  if (!body.tools) {
    message = { role: "assistant", content: "SUPPORTED: 回答中的结论与工具证据一致，并展示了来源。" };
  } else if (toolResult) {
    message = { role: "assistant", content: toolResult.includes("官方版本说明") ? "根据搜索来源，最新稳定版是 2.0。[S1]" : "Python 精确计算结果为 0.3。" };
  } else {
    const question = [...messages].reverse().find((item) => item.role === "user")?.content || "";
    const search = body.tool_choice?.function?.name === "web_search" || String(question).includes("最新");
    message = { role: "assistant", content: null, tool_calls: [{ id: search ? "call_search" : "call_python", type: "function", function: search ? { name: "web_search", arguments: JSON.stringify({ query: "产品最新稳定版本" }) } : { name: "python_calculate", arguments: JSON.stringify({ code: "decimal.Decimal('0.1') + decimal.Decimal('0.2')" }) } }] };
  }
  res.end(JSON.stringify({ id: "chatcmpl-test", object: "chat.completion", created: 0, model: "mock-model", choices: [{ index: 0, message, finish_reason: message.tool_calls ? "tool_calls" : "stop" }] }));
});

const listen = (server) => new Promise((resolve, reject) => { server.listen(0, "127.0.0.1", () => resolve(server.address().port)); server.once("error", reject); });
const mockPort = await listen(mock);
process.env.TAVILY_API_URL = `http://127.0.0.1:${mockPort}/search`;
process.env.TAVILY_USAGE_URL = `http://127.0.0.1:${mockPort}/usage`;
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
  await request("/settings", { method: "PUT", body: JSON.stringify({ provider: "custom", baseURL: `http://127.0.0.1:${mockPort}/v1`, model: "mock-model", apiKey: "test-key", systemPrompt: "准确回答", webSearchEnabled: true, searchApiKey: "tvly-test", pythonEnabled: true }) }, token);
  const connectionTest = await request("/settings/test", { method: "POST", body: JSON.stringify({ provider: "custom", baseURL: `http://127.0.0.1:${mockPort}/v1`, model: "mock-model", systemPrompt: "准确回答", webSearchEnabled: true, searchBudgetMode: "free", pythonEnabled: false }) }, token);
  if (!connectionTest.message.includes("988/1000") || searchRequests !== 0) throw new Error("额度查询不应消耗搜索请求");
  const persistedSettings = await readFile(path.join(tempData, "store.json"), "utf8");
  if (persistedSettings.includes("test-key") || persistedSettings.includes("tvly-test") || !persistedSettings.includes("safe:v1:")) throw new Error("API Key 未加密保存");
  const documents = await request("/documents", {}, token);
  const loaded = await request(`/documents/${documents.documents[0].id}`, {}, token);
  const block = loaded.document.blocks[1];
  const created = await request(`/documents/${loaded.document.id}/tips`, { method: "POST", body: JSON.stringify({ blockId: block.id, selectedText: block.content.slice(0, 12), startOffset: 0, endOffset: 12, prefixText: "", suffixText: block.content.slice(12, 24) }) }, token);

  const pythonEvents = await chat(created.tip.id, "请计算 0.1 + 0.2", token);
  const searchEvents = await chat(created.tip.id, "请联网搜索最新稳定版本", token);
  const cachedSearchEvents = await chat(created.tip.id, "请联网搜索最新稳定版本", token);
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
  if (!pythonSkill || !String(pythonSkill.skill.detail).includes("0.3")) throw new Error("Python 工具调用链测试失败");
  if (!searchSkill || searchSkill.skill.sources?.length !== 2) throw new Error("联网搜索工具调用链测试失败");
  if (!crossCheck || !originalFetch || !conflictCheck || !freshnessCheck || !securityCheck) throw new Error("研究可靠性流水线测试失败");
  if (crossCheck.skill.status !== "warning") throw new Error("同域名来源不应通过交叉验证");
  if (freshnessCheck.skill.status !== "warning") throw new Error("无发布日期来源不应通过时效检查");
  if (!citationAudit || citationAudit.skill.status !== "success") throw new Error("引用审计测试失败");
  if (!cachedSearch || !cachedSearch.skill.label.includes("缓存") || !cachedSearch.skill.detail.includes("0 额度") || searchRequests !== 1) throw new Error("搜索缓存或额度保护测试失败");
  if (!humanReview || humanReview.skill.status !== "error" || !highRiskAnswer.includes("不会给出个性化结论")) throw new Error("高风险证据不足阻断测试失败");
  if (!finalTip?.messages?.some((item) => item.skills?.some((skill) => skill.name === "web_search"))) throw new Error("技能记录未持久化");
  console.log(JSON.stringify({ python: pythonSkill.skill.detail, searchSources: searchSkill.skill.sources.length, citationAudit: true, humanReview: true, persisted: true }));
} finally {
  await new Promise((resolve) => appServer.close(resolve));
  await new Promise((resolve) => mock.close(resolve));
  await rm(tempData, { recursive: true, force: true });
}
