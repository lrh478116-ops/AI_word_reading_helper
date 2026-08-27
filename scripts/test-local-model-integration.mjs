import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tempData = await mkdtemp(path.join(os.tmpdir(), "ai-tip-local-model-"));
const selectedModelDirectory = path.join(tempData, "selected-models");
await mkdir(selectedModelDirectory, { recursive: true });
const fixtureBytes = Buffer.concat([Buffer.from("GGUF"), Buffer.from("DIRECT_MODEL_ARTIFACT_WITH_FIXED_DIGEST")]);
const fixtureSha256 = createHash("sha256").update(fixtureBytes).digest("hex");
let installedModels = [];
let localChatRequests = 0;
let activatedModelPath = "";
let pulledOllamaModel = "";
const artifactRequests = [];
const localReferenceRequests = [];

const localRuntimeServer = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  res.setHeader("Content-Type", "application/json");
  if (req.url?.startsWith("/reference/")) {
    const url = new URL(req.url, "http://127.0.0.1");
    const site = url.pathname.split("/").at(-1);
    const query = url.searchParams.get("q") || "";
    localReferenceRequests.push({ site, query });
    if (site === "baidu") {
      res.statusCode = 503;
      return res.end(JSON.stringify({ error: "simulated unavailable domestic site" }));
    }
    const sourceBySite = {
      baike360: ["GPT 中文参考", "https://baike.so.com/doc/gpt-test.html", "GPT 是基于 Transformer 的生成式预训练语言模型，架构说明涉及解码器。"],
      zhwiki: ["GPT（语言模型）", "https://zh.wikipedia.org/wiki/GPT_(%E8%AF%AD%E8%A8%80%E6%A8%A1%E5%9E%8B)", "GPT 属于生成式预训练 Transformer 模型。"],
      enwiki: ["Generative pre-trained transformer", "https://en.wikipedia.org/wiki/Generative_pre-trained_transformer", "LOCAL_REFERENCE_EVIDENCE: GPT models use a decoder-only Transformer architecture."],
      britannica: ["Generative AI reference", "https://www.britannica.com/technology/generative-AI", "Generative pretrained models produce text autoregressively."]
    };
    const [title, urlValue, content] = sourceBySite[site] || ["Reference", "https://example.com/reference", "Reference content"];
    return res.end(JSON.stringify({ items: [{ title, url: urlValue, content: `${query} ${content}` }] }));
  }
  if (req.url === "/v1/models") return res.end(JSON.stringify({ object: "list", data: installedModels.map((id) => ({ id, object: "model", owned_by: "ai-tip" })) }));
  if (req.url === "/v1/chat/completions") {
    localChatRequests += 1;
    const system = String(body.messages?.[0]?.content || "");
    const assessmentInput = String(body.messages?.at(-1)?.content || "");
    const hasReferenceEvidence = body.messages?.some((message) => String(message.content || "").includes("LOCAL_REFERENCE_EVIDENCE"));
    const content = system.includes("问题专业程度分类器")
      ? assessmentInput.includes("encode-only")
        ? JSON.stringify({ level: "general", professional: false, domain: "通用", confidence: 0, requiresWebReview: false, reason: "本地小模型无法判断专业程度" })
        : JSON.stringify({ level: "general", professional: false, domain: "通用", confidence: 96, requiresWebReview: false, reason: "普通解释问题" })
      : system.includes("WEB_SEARCH_DECISION_V1")
        ? /(?:hyzg|SEARCH_DECISION_TOTAL_FAILURE)/i.test(assessmentInput)
          ? "{\"required\":false,\"confidence\":88,\"reason\":\"broken JSON\""
          : assessmentInput.includes("encode-only")
          ? JSON.stringify({ required: true, confidence: 91, reason: "需要核对模型架构这一外部事实", queryZh: "GPT 模型架构 编码器 解码器", queryEn: "GPT model architecture encoder decoder" })
          : JSON.stringify({ required: false, confidence: 96, reason: "只需解释给定原文", queryZh: "", queryEn: "" })
      : system.includes("WEB_SEARCH_DECISION_BINARY_V1")
        ? assessmentInput.includes("SEARCH_DECISION_TOTAL_FAILURE") ? "UNKNOWN" : "NO_SEARCH"
      : hasReferenceEvidence
        ? "BUNDLED_GGUF_SEARCH_EVIDENCE_ANSWER：GPT 采用 decoder-only Transformer 架构。[S1]"
        : "BUNDLED_GGUF_CAUSAL_ANSWER";
    return res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }] }));
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: "not found" }));
});

await new Promise((resolve) => localRuntimeServer.listen(0, "127.0.0.1", resolve));
const runtimeOrigin = `http://127.0.0.1:${localRuntimeServer.address().port}`;
process.env.AI_TIP_REFERENCE_SEARCH_BASE_URL = `${runtimeOrigin}/reference`;
process.env.AI_TIP_ALLOW_INSECURE_REFERENCE_SEARCH = "1";
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (/modelscope\.cn|huggingface\.co|\.hf\.co/i.test(url)) throw new Error("SERVER_FETCH_MUST_NOT_DOWNLOAD_MODEL_BYTES");
  return originalFetch(input, init);
};

process.env.AI_TIP_EMBEDDED = "1";
process.env.AI_TIP_SUPABASE_ENABLED = "0";
process.env.AI_TIP_DESKTOP = "1";
process.env.AI_TIP_DATA_DIR = tempData;
process.env.OPENAI_API_KEY = "publisher-key-must-not-be-used";

const serverModule = await import("../dist-electron/server.cjs");
const catalogModel = serverModule.LOCAL_MODEL_CATALOG.find((item) => item.id === "minicpm5-1b");
const catalogSource = catalogModel.sources.find((item) => item.id === "modelscope");
catalogSource.artifact = { ...catalogSource.artifact, size: fixtureBytes.length, sha256: fixtureSha256, filename: "fixture.gguf", revision: "test-revision" };
catalogModel.approxBytes = fixtureBytes.length;
const runtimeController = {
  info: () => ({ reachable: installedModels.length > 0, origin: installedModels.length ? runtimeOrigin : "", version: "llama.cpp-test", runtime: "llama.cpp", storagePath: selectedModelDirectory, storagePathSource: "user-selected", installedModels: [...installedModels], totalRamBytes: os.totalmem(), modelId: installedModels[0], modelPath: activatedModelPath }),
  downloadArtifact: async ({ url, artifact, destinationPath, sourceId }, _signal, onProgress) => {
    artifactRequests.push({ url, sourceId, destinationPath, filename: artifact.filename });
    const finalPath = path.join(destinationPath, artifact.filename);
    await writeFile(finalPath, fixtureBytes);
    onProgress({ type: "start", total: fixtureBytes.length, completed: 0, networkStack: "chromium", initialHost: "www.modelscope.cn", finalHost: "cdn-lfs-cn-1.modelscope.cn" });
    onProgress({ type: "progress", status: "downloading", total: fixtureBytes.length, completed: fixtureBytes.length, networkStack: "chromium", initialHost: "www.modelscope.cn", finalHost: "cdn-lfs-cn-1.modelscope.cn" });
    return { finalPath, networkStack: "chromium", initialHost: "www.modelscope.cn", finalHost: "cdn-lfs-cn-1.modelscope.cn", redirectChain: [url, "https://cdn-lfs-cn-1.modelscope.cn/fixture.gguf"], proxyDescription: "DIRECT" };
  },
  activateModel: async (modelPath, modelId) => {
    const bytes = await readFile(modelPath);
    if (!bytes.subarray(0, 4).equals(Buffer.from("GGUF"))) throw new Error("fixture is not GGUF");
    activatedModelPath = modelPath;
    installedModels = [modelId];
    return { reachable: true, origin: runtimeOrigin, version: "llama.cpp-test", runtime: "llama.cpp", storagePath: selectedModelDirectory, storagePathSource: "user-selected", installedModels: [modelId], totalRamBytes: os.totalmem(), modelId, modelPath };
  },
  ollamaInfo: async () => ({ reachable: true, origin: runtimeOrigin, version: "ollama-test", runtime: "ollama", storagePath: selectedModelDirectory, storagePathSource: "user-selected", installedModels: pulledOllamaModel ? [pulledOllamaModel] : [], totalRamBytes: os.totalmem() }),
  pullOllamaModel: async (modelRef, _signal, onProgress) => {
    pulledOllamaModel = modelRef;
    installedModels = [modelRef];
    onProgress({ type: "progress", status: "pulling manifest", completed: 10, total: 100, networkStack: "ollama-client" });
    onProgress({ type: "progress", status: "success", completed: 100, total: 100, networkStack: "ollama-client" });
    return { runtime: { reachable: true, origin: runtimeOrigin, version: "ollama-test", runtime: "ollama", storagePath: selectedModelDirectory, storagePathSource: "user-selected", installedModels: [modelRef], totalRamBytes: os.totalmem() } };
  }
};
serverModule.configureLocalModelRuntime(runtimeController);

const appServer = await serverModule.startServer(0, "127.0.0.1");
const base = `http://127.0.0.1:${appServer.address().port}/api`;

async function request(route, init = {}, token = "") {
  const headers = new Headers(init.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const response = await originalFetch(base + route, { ...init, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${route} ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

async function readNdjson(response) { return (await response.text()).split("\n").filter(Boolean).map((line) => JSON.parse(line)); }

try {
  const login = await request("/auth/login", { method: "POST", body: JSON.stringify({ email: "demo@aitip.local", password: "demo1234" }) });
  const token = login.token;
  const authHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  const form = new FormData();
  form.append("file", new Blob(["本地模型门禁测试文档"], { type: "text/plain" }), "local-model-gate.txt");
  const imported = await request("/documents/import", { method: "POST", body: form }, token);
  const block = imported.document.blocks.find((item) => item.content.includes("本地模型门禁"));
  const tip = await request(`/documents/${imported.document.id}/tips`, { method: "POST", body: JSON.stringify({ blockId: block.id, selectedText: "本地模型门禁", startOffset: 0, endOffset: 6, prefixText: "", suffixText: "测试文档" }) }, token);

  const beforeBlocked = await request(`/documents/${imported.document.id}`, {}, token);
  const blocked = await originalFetch(`${base}/tips/${tip.tip.id}/chat`, { method: "POST", headers: authHeaders, body: JSON.stringify({ question: "解释这段文字", language: "zh-CN" }) });
  const blockedBody = await blocked.json();
  const afterBlocked = await request(`/documents/${imported.document.id}`, {}, token);
  if (blocked.status !== 409 || blockedBody.code !== "MODEL_NOT_CONFIGURED" || beforeBlocked.tips[0].messages.length !== afterBlocked.tips[0].messages.length) throw new Error("无模型门禁被绕过或污染 Tip 历史");

  const catalog = await request("/local-models", {}, token);
  if (catalog.models?.length !== 11 || catalog.runtime?.runtime !== "llama.cpp" || catalog.runtime?.reachable) throw new Error("内置运行时状态没有进入正式 API");
  for (const [payload, expectedCode] of [
    [{ modelId: "fabricated", sourceId: "modelscope", confirmed: true, destinationPath: selectedModelDirectory }, "INVALID_LOCAL_MODEL"],
    [{ modelId: "minicpm5-1b", sourceId: "fabricated", confirmed: true, destinationPath: selectedModelDirectory }, "INVALID_MODEL_SOURCE"],
    [{ modelId: "minicpm5-1b", sourceId: "modelscope", confirmed: false, destinationPath: selectedModelDirectory }, "DOWNLOAD_CONFIRMATION_REQUIRED"],
    [{ modelId: "minicpm5-1b", sourceId: "modelscope", confirmed: true, destinationPath: path.join(tempData, "forged") }, "MODEL_DESTINATION_NOT_ACTIVE"]
  ]) {
    const response = await originalFetch(`${base}/local-models/download`, { method: "POST", headers: authHeaders, body: JSON.stringify(payload) });
    const body = await response.json();
    if (response.status < 400 || body.code !== expectedCode) throw new Error(`非法下载参数未拒绝：${JSON.stringify({ payload, expectedCode, status: response.status, body })}`);
  }
  if (artifactRequests.length) throw new Error("无效请求仍触发了模型下载");

  const ollamaDownload = await originalFetch(`${base}/local-models/download`, { method: "POST", headers: authHeaders, body: JSON.stringify({ modelId: "llama-3.2-1b", sourceId: "ollama", confirmed: true, destinationPath: selectedModelDirectory }) });
  const ollamaEvents = await readNdjson(ollamaDownload);
  const ollamaDone = ollamaEvents.find((event) => event.type === "done");
  if (!ollamaDownload.ok || ollamaDone?.settings?.provider !== "ollama" || ollamaDone?.settings?.model !== "llama3.2:1b-instruct-q4_K_M" || pulledOllamaModel !== "llama3.2:1b-instruct-q4_K_M") throw new Error(`Ollama 正式下载链没有自动接入设置：${JSON.stringify(ollamaEvents)}`);
  installedModels = [];

  serverModule.configureLocalModelRuntime(null);
  const unavailable = await originalFetch(`${base}/local-models/download`, { method: "POST", headers: authHeaders, body: JSON.stringify({ modelId: "minicpm5-1b", sourceId: "modelscope", confirmed: true, destinationPath: selectedModelDirectory }) });
  const unavailableBody = await unavailable.json();
  if (unavailable.status !== 503 || unavailableBody.code !== "LOCAL_RUNTIME_UNAVAILABLE" || artifactRequests.length) throw new Error("无 Electron 下载控制器时仍触发了模型网络请求");
  serverModule.configureLocalModelRuntime(runtimeController);

  const download = await originalFetch(`${base}/local-models/download`, { method: "POST", headers: authHeaders, body: JSON.stringify({ modelId: "minicpm5-1b", sourceId: "modelscope", confirmed: true, destinationPath: selectedModelDirectory }) });
  const events = await readNdjson(download);
  const done = events.find((event) => event.type === "done");
  if (!download.ok || !done || artifactRequests.length !== 1 || !artifactRequests[0].url.includes("www.modelscope.cn/models/OpenBMB/MiniCPM5-1B-GGUF/resolve/test-revision/fixture.gguf") || done.download?.networkStack !== "chromium") throw new Error(`正式入口没有把固定 artifact 交给 Chromium 下载控制器：${JSON.stringify({ events, artifactRequests })}`);
  if (done.settings?.provider !== "local" || done.settings?.model !== "aitip:minicpm5-1b" || done.runtime?.modelPath !== activatedModelPath || (await stat(activatedModelPath)).size !== fixtureBytes.length) throw new Error("下载、校验、加载和设置 lineage 不一致");

  const status = await request("/ai/status", {}, token);
  if (!status.status?.configured || status.status?.provider !== "local") throw new Error("内置 GGUF 没有成为 Tip 可用模型");
  const answered = await originalFetch(`${base}/tips/${tip.tip.id}/chat`, { method: "POST", headers: authHeaders, body: JSON.stringify({ question: "请解释", language: "zh-CN" }) });
  const answerEvents = await readNdjson(answered);
  const answer = answerEvents.find((event) => event.type === "done")?.tip?.messages?.at(-1);
  if (!answered.ok || answer?.content !== "BUNDLED_GGUF_CAUSAL_ANSWER" || answer?.model !== "aitip:minicpm5-1b" || localChatRequests < 2) throw new Error("Tip 最终回答没有由内置 GGUF 运行时产生");

  const localSettings = (await request("/settings", {}, token)).settings;
  await request("/settings", { method: "PUT", body: JSON.stringify({ provider: localSettings.provider, baseURL: localSettings.baseURL, model: localSettings.model, systemPrompt: localSettings.systemPrompt, webSearchEnabled: true, searchBudgetMode: "free", pythonEnabled: localSettings.pythonEnabled, reliabilityEnabled: localSettings.reliabilityEnabled }) }, token);
  const referenceStart = localReferenceRequests.length;
  const searched = await originalFetch(`${base}/tips/${tip.tip.id}/chat`, { method: "POST", headers: authHeaders, body: JSON.stringify({ question: "GPT 用的是 encode-only 还是 decoder-only？", language: "zh-CN" }) });
  const searchedEvents = await readNdjson(searched);
  const searchedAnswer = searchedEvents.find((event) => event.type === "done")?.tip?.messages?.at(-1);
  const searchedAssessment = searchedEvents.find((event) => event.type === "skill" && event.skill?.name === "web_search_assessment")?.skill;
  const searchedTrace = searchedEvents.find((event) => event.type === "skill" && event.skill?.name === "web_search")?.skill;
  const referenceDelta = localReferenceRequests.slice(referenceStart);
  const englishQuery = referenceDelta.find((item) => item.site === "enwiki")?.query || "";
  const chineseQuery = referenceDelta.find((item) => item.site === "zhwiki")?.query || "";
  if (!searched.ok || referenceDelta.length < 4 || !searchedTrace?.sources?.length || !searchedAnswer?.content.includes("BUNDLED_GGUF_SEARCH_EVIDENCE_ANSWER") || !searchedAnswer.content.includes("[S1]") || !searchedAnswer.content.includes("数据可能不够精细或最新") || !String(searchedAssessment?.detail).includes("AI 判断需要联网") || !String(searchedAssessment?.detail).includes("91/100")) throw new Error(`本地模型无 Tavily 的 AI 联网判断没有进入正式回答链：${JSON.stringify({ referenceDelta, searchedTrace, searchedAssessment, answer: searchedAnswer?.content })}`);
  if (/[㐀-鿿]/u.test(englishQuery) || !/gpt/i.test(englishQuery) || !/(?:encode|decoder)/i.test(englishQuery)) throw new Error(`英文参考站点没有获得规范化技术查询：${englishQuery}`);
  if (!/GPT/i.test(chineseQuery) || !/(?:编码器|解码器)/.test(chineseQuery)) throw new Error(`中文参考站点没有获得规范化技术查询：${chineseQuery}`);
  const localizedCacheStart = localReferenceRequests.length;
  await serverModule.searchReferenceWeb("localized cache lineage", { zh: "中文缓存变体甲", en: "cache variant alpha" });
  const localizedCacheMidpoint = localReferenceRequests.length;
  await serverModule.searchReferenceWeb("localized cache lineage", { zh: "中文缓存变体乙", en: "cache variant beta" });
  const localizedCacheSecondRun = localReferenceRequests.slice(localizedCacheMidpoint);
  if (localizedCacheMidpoint - localizedCacheStart < 4 || localizedCacheSecondRun.length < 4 || !localizedCacheSecondRun.some((item) => /变体乙/.test(item.query)) || !localizedCacheSecondRun.some((item) => /variant beta/i.test(item.query))) throw new Error(`AI 改变双语查询后被旧搜索缓存绕过：${JSON.stringify({ firstDelta: localizedCacheMidpoint - localizedCacheStart, secondRun: localizedCacheSecondRun })}`);
  const skippedReferenceStart = localReferenceRequests.length;
  const skipped = await originalFetch(`${base}/tips/${tip.tip.id}/chat`, { method: "POST", headers: authHeaders, body: JSON.stringify({ question: "只解释所选原文，不需要外部资料。", language: "zh-CN" }) });
  const skippedEvents = await readNdjson(skipped);
  const skippedDecision = skippedEvents.find((event) => event.type === "skill" && event.skill?.name === "web_search_assessment")?.skill;
  if (!skipped.ok || localReferenceRequests.length !== skippedReferenceStart || !String(skippedDecision?.detail).includes("AI 判断无需联网")) throw new Error(`AI 高置信度无需联网判断没有阻止备用请求：${JSON.stringify({ delta: localReferenceRequests.length - skippedReferenceStart, decision: skippedDecision })}`);
  const binaryStart = localReferenceRequests.length;
  const binaryResponse = await originalFetch(`${base}/tips/${tip.tip.id}/chat`, { method: "POST", headers: authHeaders, body: JSON.stringify({ question: "hyzg", language: "zh-CN" }) });
  const binaryEvents = await readNdjson(binaryResponse);
  const binaryDecision = binaryEvents.find((event) => event.type === "skill" && event.skill?.name === "web_search_assessment")?.skill;
  const binaryAnswer = binaryEvents.find((event) => event.type === "done")?.tip?.messages?.at(-1)?.content || "";
  if (!binaryResponse.ok || localReferenceRequests.length !== binaryStart || !binaryAnswer || !String(binaryDecision?.detail).includes("AI 二元重判无需联网")) throw new Error(`本地模型损坏 JSON 后的二元重判没有阻止无关搜索：${JSON.stringify({ delta: localReferenceRequests.length - binaryStart, decision: binaryDecision, answer: binaryAnswer })}`);
  const totalFailureStart = localReferenceRequests.length;
  const totalFailureResponse = await originalFetch(`${base}/tips/${tip.tip.id}/chat`, { method: "POST", headers: authHeaders, body: JSON.stringify({ question: "SEARCH_DECISION_TOTAL_FAILURE：普通问题", language: "zh-CN" }) });
  const totalFailureEvents = await readNdjson(totalFailureResponse);
  const totalFailureDecision = totalFailureEvents.find((event) => event.type === "skill" && event.skill?.name === "web_search_assessment")?.skill;
  const totalFailureAnswer = totalFailureEvents.find((event) => event.type === "done")?.tip?.messages?.at(-1)?.content || "";
  if (!totalFailureResponse.ok || localReferenceRequests.length !== totalFailureStart || !totalFailureAnswer || !String(totalFailureDecision?.label).includes("未盲目搜索")) throw new Error(`普通问题的两次 AI 判断都失败后仍盲目联网或阻断回答：${JSON.stringify({ delta: localReferenceRequests.length - totalFailureStart, decision: totalFailureDecision, answer: totalFailureAnswer })}`);

  installedModels = [];
  const missingStatus = await request("/ai/status", {}, token);
  const beforeMissing = (await request(`/documents/${imported.document.id}`, {}, token)).tips[0].messages.length;
  const missingChat = await originalFetch(`${base}/tips/${tip.tip.id}/chat`, { method: "POST", headers: authHeaders, body: JSON.stringify({ question: "不能绕过", language: "zh-CN" }) });
  const missingBody = await missingChat.json();
  const afterMissing = (await request(`/documents/${imported.document.id}`, {}, token)).tips[0].messages.length;
  if (missingStatus.status?.configured || missingBody.code !== "LOCAL_RUNTIME_UNAVAILABLE" || beforeMissing !== afterMissing) throw new Error("停止内置运行时后旧路径仍能回答或污染历史");
  const store = await readFile(path.join(tempData, "store.json"), "utf8");
  if (store.includes("publisher-key-must-not-be-used") || store.includes('"model": "demo"')) throw new Error("本地路径泄漏开发者 Key 或仍使用 demo 模型");
  console.log(JSON.stringify({ ollamaPredictionBearing: true, officialModelScopeArtifact: true, publisherServerFetchBlocked: true, electronControllerRequired: true, settingsAutoConnected: true, localPredictionBearing: true, localReferenceSearchPredictionBearing: true, aiSearchDecisionCausal: true, aiSearchSkipCausal: true, aiBinaryRecoveryCausal: true, totalAssessmentFailureNoBlindSearch: true, bilingualReferenceQuery: true, localizedQueryCacheLineage: true, runtimeRemovalCounterfactual: true }));
} finally {
  globalThis.fetch = originalFetch;
  serverModule.configureLocalModelRuntime(null);
  await new Promise((resolve) => appServer.close(resolve));
  await new Promise((resolve) => localRuntimeServer.close(resolve));
  await rm(tempData, { recursive: true, force: true });
}
