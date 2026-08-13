import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tempData = await mkdtemp(path.join(os.tmpdir(), "ai-tip-live-reference-"));
process.env.AI_TIP_EMBEDDED = "1";
process.env.AI_TIP_DESKTOP = "1";
process.env.AI_TIP_DATA_DIR = tempData;
delete process.env.OPENAI_API_KEY;
delete process.env.AI_TIP_PUBLISHER_API_KEY;
delete process.env.AI_TIP_REFERENCE_SEARCH_BASE_URL;
delete process.env.AI_TIP_ALLOW_INSECURE_REFERENCE_SEARCH;

const { startServer } = await import("../dist-electron/server.cjs");
const server = await startServer(0, "127.0.0.1");
const port = server.address().port;
const base = `http://127.0.0.1:${port}/api`;

async function request(route, init = {}, token = "") {
  const response = await fetch(`${base}${route}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {})
    }
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

try {
  const account = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({ name: "公网检索验收", email: "live-search@example.test", password: "test-pass-123" })
  });
  const created = await request("/documents", { method: "POST", body: "{}" }, account.token);
  const block = created.document.blocks[0];
  const selectedText = "人工智能是研究智能系统的领域";
  await request(`/documents/${created.document.id}`, {
    method: "PATCH",
    body: JSON.stringify({ blocks: [{ ...block, content: selectedText }] })
  }, account.token);
  const createdTip = await request(`/documents/${created.document.id}/tips`, {
    method: "POST",
    body: JSON.stringify({
      blockId: block.id,
      selectedText,
      startOffset: 0,
      endOffset: selectedText.length,
      prefixText: "",
      suffixText: ""
    })
  }, account.token);

  const response = await fetch(`${base}/tips/${createdTip.tip.id}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${account.token}` },
    body: JSON.stringify({ question: "请联网搜索人工智能的基本概念，并说明检索结果。", language: "zh" })
  });
  const events = (await response.text()).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const error = events.find((event) => event.type === "error");
  if (error) throw new Error(error.error);
  const done = events.findLast((event) => event.type === "done");
  if (!done?.tip) throw new Error("聊天没有返回完成事件");
  const assistant = [...done.tip.messages].reverse().find((message) => message.role === "assistant");
  const searchTrace = assistant?.skills?.find((skill) => skill.name === "web_search");
  if (!assistant?.content?.trim()) throw new Error("联网搜索后没有有效回答");
  if (!searchTrace || searchTrace.status !== "success" || (searchTrace.sources?.length || 0) < 1) {
    throw new Error(`真实公网检索没有取得相关来源：${JSON.stringify(searchTrace)}`);
  }
  if (searchTrace.sources.some((source) => /Compulsory education/i.test(source.title))) {
    throw new Error("备用检索接受了与人工智能无关的英文维基条目");
  }
  if (!assistant.content.includes("[S1]") || !assistant.content.includes("Tavily API Key") || !assistant.content.includes("数据可能不够精细或最新")) {
    throw new Error("最终回答没有包含来源与无 Tavily 的质量说明");
  }
  const persisted = await request(`/documents/${created.document.id}`, {}, account.token);
  const persistedTip = persisted.tips.find((tip) => tip.id === createdTip.tip.id);
  const persistedAnswer = [...persistedTip.messages].reverse().find((message) => message.role === "assistant");
  if (persistedAnswer?.content !== assistant.content) throw new Error("公网检索回答未被原样持久化");

  console.log(JSON.stringify({
    ok: true,
    sourceCount: searchTrace.sources.length,
    sources: searchTrace.sources.map((source) => ({ title: source.title, domain: new URL(source.url).hostname })),
    skippedSitesReported: /跳过/.test(searchTrace.detail),
    finalAnswerPersisted: true,
    fallbackQualityNotice: true
  }, null, 2));
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(tempData, { recursive: true, force: true });
}
