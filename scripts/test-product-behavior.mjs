process.env.AI_TIP_EMBEDDED = "1";

const { normalizeLanguage, translate } = await import("../src/i18n.ts");
const { DEFAULT_SYSTEM_PROMPTS, LOCAL_MODEL_CATALOG, PROVIDER_REGISTRY, assessQuestionProfessionalism, resolveWebSearchNeed, isLegacyTransformerSeedDocument, isProxyVirtualResolution, looksLikeSearchFailureRefusal, manualReferenceSearchLinks, migrateProviderPreset } = await import("../dist-electron/server.cjs");

if (normalizeLanguage("invalid") !== "zh-CN") throw new Error("非法语言没有回退为简体中文");
if (translate("zh-CN", "language.label") !== "language" || translate("en", "language.label") !== "Language") throw new Error("语言标签没有按要求区分中文界面的小写 language 与英文界面的 Language");
if (translate("zh-CN", "auth.localUse") !== "仅本地使用") throw new Error("中文本地入口文案错误");
if (translate("en", "auth.localUse") !== "Local use only") throw new Error("英文本地入口文案错误");
if (translate("zh-CN", "auth.localUse") === translate("en", "auth.localUse")) throw new Error("语言输出没有因语言状态改变");
if (!translate("zh-CN", "auth.rememberLogin").includes("密码") || !translate("en", "auth.rememberLogin").toLowerCase().includes("password")) throw new Error("登录凭据记忆文案未双语接入");
if (translate("zh-CN", "nav.logout") !== "退出登录" || translate("en", "nav.logout") !== "Sign out") throw new Error("退出登录文案未接入语言表");
if (translate("zh-CN", "cloud.upload") !== "上传云端" || translate("en", "cloud.upload") !== "Upload to cloud") throw new Error("显式云上传按钮未双语接入");
if (!translate("zh-CN", "cloud.localOnlyHint").includes("默认只保存在本地") || !translate("en", "cloud.localOnlyHint").includes("local by default")) throw new Error("本地优先云同步说明未双语接入");
if (!translate("zh-CN", "cloud.quota").includes("5 MB") || !translate("en", "cloud.quota").includes("5 MB")) throw new Error("5 MB 用户云空间文案缺失");
if (translate("zh-CN", "tip.webSearchOn") !== "联网开" || translate("en", "tip.webSearchOn") !== "Web on" || translate("zh-CN", "tip.webSearchOff") !== "联网关" || translate("en", "tip.webSearchOff") !== "Web off") throw new Error("对话纸飞机旁的联网开关未双语接入");
if (!translate("zh-CN", "nav.contact").includes("2280810215@qq.com") || !translate("en", "nav.contact").includes("2280810215@qq.com") || !translate("zh-CN", "nav.contactCopied").includes("已复制") || !translate("en", "nav.contactCopied").includes("Copied")) throw new Error("主页面联系邮箱或复制反馈未双语接入");
if (!translate("zh-CN", "localModels.downloadHint").includes("不经过开发者服务器") || !translate("en", "localModels.downloadHint").includes("never through the developer's server")) throw new Error("模型下载界面没有明确披露官方客户端直连与零开发者服务器带宽");
if (!DEFAULT_SYSTEM_PROMPTS.en.startsWith("You are") || /[\u3400-\u9fff]/u.test(DEFAULT_SYSTEM_PROMPTS.en)) throw new Error("英文内置 Prompt 仍包含中文默认内容");
if (!looksLikeSearchFailureRefusal("联网证据缺失，因此无法回答。") || !looksLikeSearchFailureRefusal("Sorry, I cannot answer because the search failed.") || looksLikeSearchFailureRefusal("联网没有结果，但我会依据文档回答。")) throw new Error("联网失败拒答检测的正向或负向边界错误");
const lookupAlpha = manualReferenceSearchLinks("fallback", { zh: "量子纠缠机制", en: "quantum entanglement mechanism" });
const lookupBeta = manualReferenceSearchLinks("fallback", { zh: "神经网络训练", en: "neural network training" });
if (lookupAlpha.length !== 5 || !lookupAlpha.some((item) => item.url.includes("zh.wikipedia.org/w/index.php?search=%E9%87%8F%E5%AD%90%E7%BA%A0%E7%BC%A0%E6%9C%BA%E5%88%B6")) || !lookupAlpha.some((item) => item.url.includes("en.wikipedia.org/w/index.php?search=quantum%20entanglement%20mechanism")) || JSON.stringify(lookupAlpha) === JSON.stringify(lookupBeta) || lookupAlpha.some((item) => /127\.0\.0\.1|localhost/.test(item.url))) throw new Error(`人工百科入口没有消费本轮双语查询或仍经过应用服务器：${JSON.stringify({ lookupAlpha, lookupBeta })}`);
const providerValues = Object.values(PROVIDER_REGISTRY || {});
if (providerValues.length !== 9 || providerValues.some((provider) => !provider.labelKey || (provider.id !== "custom" && (!provider.baseURL || !provider.defaultModel)))) throw new Error("共享接口注册表不完整");
const retiredDefaults = new Set(providerValues.flatMap((provider) => provider.retiredModels || []));
if (providerValues.some((provider) => retiredDefaults.has(provider.defaultModel))) throw new Error("接口默认型号仍命中已知停用型号");
if (PROVIDER_REGISTRY.deepseek.defaultModel !== "deepseek-v4-flash" || PROVIDER_REGISTRY.moonshot.defaultModel !== "kimi-k2.6" || PROVIDER_REGISTRY.zhipu.defaultModel !== "glm-5.2" || PROVIDER_REGISTRY.gemini.defaultModel !== "gemini-3.6-flash") throw new Error("接口注册表没有更新为已核对的当前型号");
for (const provider of providerValues) {
  const englishLabel = translate("en", provider.labelKey);
  if (englishLabel === provider.labelKey || /[\u3400-\u9fff]/u.test(englishLabel)) throw new Error(`英文接口服务商仍显示中文或缺少翻译：${provider.id}=${englishLabel}`);
}
const migratedDeepSeek = migrateProviderPreset({ provider: "deepseek", baseURL: "https://api.deepseek.com", model: "deepseek-chat" });
if (migratedDeepSeek.model !== "deepseek-v4-flash" || !migratedDeepSeek.changed) throw new Error("已停用 DeepSeek 内置默认值没有迁移");
const customModel = migrateProviderPreset({ provider: "custom", baseURL: "https://example.com/v1", model: "deepseek-chat" });
if (customModel.model !== "deepseek-chat" || customModel.changed) throw new Error("自定义接口模型被错误迁移");
const ollamaModel = migrateProviderPreset({ provider: "ollama", baseURL: "http://127.0.0.1:11434/v1", model: "qwen3:8b" });
if (ollamaModel.model !== "qwen3:8b" || ollamaModel.changed) throw new Error("用户本机 Ollama 模型被错误替换");
if (!Array.isArray(LOCAL_MODEL_CATALOG) || LOCAL_MODEL_CATALOG.length !== 11) throw new Error("轻量化本地模型目录不是要求的 11 项");
if (new Set(LOCAL_MODEL_CATALOG.map((item) => item.id)).size !== 11) throw new Error("本地模型目录含重复 ID");
if (LOCAL_MODEL_CATALOG.some((item) => !item.name || !item.tier || !item.quantization || !item.approxBytes || !item.ram || !item.gpu || !item.featuresZh || !item.featuresEn || !item.sources?.length)) throw new Error("本地模型目录字段或下载来源不完整");
const llamaOne = LOCAL_MODEL_CATALOG.find((item) => item.id === "llama-3.2-1b");
if (llamaOne?.quantization !== "Q4_K_M" || llamaOne.approxBytes !== 808_000_000) throw new Error("Llama 3.2 1B 仍把 1.3GB Q8 错标为 Q4");
const gemmaE2b = LOCAL_MODEL_CATALOG.find((item) => item.id === "gemma-4-e2b");
const gemmaE4b = LOCAL_MODEL_CATALOG.find((item) => item.id === "gemma-4-e4b");
if (gemmaE2b?.approxBytes !== 7_200_000_000 || gemmaE4b?.approxBytes !== 9_600_000_000) throw new Error("Gemma 4 有效参数量仍被错误当作实际 Q4 下载量");
if (LOCAL_MODEL_CATALOG.flatMap((item) => item.sources).some((source) => /tuna|tsinghua/i.test(`${source.id} ${source.modelRef}`))) throw new Error("目录冒用了不可验证的清华 Hugging Face 权重镜像地址");

const legacy = {
  title: "理解 Transformer 的注意力机制",
  sourceType: "blank",
  favorite: true,
  blocks: [
    { type: "heading", content: "Transformer：从注意力到理解", level: 1 },
    { type: "paragraph", content: "Transformer 的核心洞见，是让模型在处理一个词时，能够直接观察序列中的其他位置，并动态判断哪些信息最值得关注。" },
    { type: "heading", content: "自注意力在做什么？", level: 2 },
    { type: "paragraph", content: "自注意力机制允许序列中的每个 Token 根据相关性聚合其他 Token 的信息。它把每个输入映射成 Query、Key 和 Value，再用相似度决定信息汇集的权重。" },
    { type: "quote", content: "注意力并不是记忆本身，而是一种按当前问题检索和组合信息的机制。" },
    { type: "heading", content: "缩放点积注意力", level: 2 },
    { type: "paragraph", content: "计算过程可以概括为 Attention(Q, K, V) = softmax(QKᵀ / √dₖ)V。除以 √dₖ 可以避免维度较高时点积过大，进而缓解 softmax 梯度过小的问题。" },
    { type: "code", content: "scores = (Q @ K.transpose(-2, -1)) / sqrt(d_k)\nweights = softmax(scores, dim=-1)\noutput = weights @ V" },
    { type: "heading", content: "为什么需要多头？", level: 2 },
    { type: "paragraph", content: "多头注意力让模型在不同表示子空间中同时寻找关系：一个头可能关注指代，一个头可能关注句法距离，另一个头则关注主题一致性。" }
  ]
};
if (!isLegacyTransformerSeedDocument(legacy)) throw new Error("无法识别旧 Transformer 种子文档");
if (!isLegacyTransformerSeedDocument({ ...legacy, blocks: [...legacy.blocks, { type: "code", content: "" }] })) throw new Error("带空尾块的旧种子文档没有被识别");
if (isLegacyTransformerSeedDocument({ ...legacy, blocks: [...legacy.blocks, { type: "paragraph", content: "用户的非空补充" }] })) throw new Error("带用户补充的文档被错误识别为种子文档");
if (isLegacyTransformerSeedDocument({ ...legacy, blocks: legacy.blocks.map((block, index) => index === 9 ? { ...block, content: `${block.content} 用户补充` } : block) })) throw new Error("修改过的用户文档被错误识别为种子文档");
if (isLegacyTransformerSeedDocument({ ...legacy, title: "我的 Transformer 笔记" })) throw new Error("同结构用户文档被错误识别为种子文档");

const ordinary = assessQuestionProfessionalism("这个词是什么意思？", "今天阳光很好，适合散步。");
if (ordinary.professional || ordinary.level !== "general") throw new Error("普通问题被错误判定为专业问题");
const systems = assessQuestionProfessionalism("在弱内存模型下，RCU grace period 与 acquire-release 屏障如何保证 reader 可见性？", "并发内存回收");
if (!systems.professional || systems.level !== "professional" || systems.score < 60 || systems.domain !== "计算机与人工智能") throw new Error("系统专业问题没有被识别");
const contextual = assessQuestionProfessionalism("这里为什么成立？", "双重差分估计依赖平行趋势假设，并需要检验处理前趋势与聚类稳健标准误。");
if (!contextual.professional || contextual.domain !== "统计与研究方法") throw new Error("依赖选中文本的专业问题没有被识别");
const unrelated = assessQuestionProfessionalism("怎么做一杯茶？", "这是一段普通生活记录，没有技术、研究或高风险内容。");
if (unrelated.professional) throw new Error("改变无关上下文错误触发专业判断");
const policy = assessQuestionProfessionalism("如何评估双碳政策工具在地方执行中的效果与偏差？", "多层级公共治理案例");
if (!policy.professional || !policy.requiresWebReview || policy.domain !== "政策与公共治理") throw new Error("政策与公共治理专业问题没有被规则安全下限识别");
const currentPolicy = assessQuestionProfessionalism("这个政策现在如何执行？", "");
if (!currentPolicy.requiresWebReview || currentPolicy.domain !== "政策与公共治理") throw new Error("现行政策问题没有强制要求联网审查");
const gptArchitectureQuestion = "GPT 用的是 encode-only 还是 decoder-only？";
const gptArchitecture = assessQuestionProfessionalism(gptArchitectureQuestion, "一段与 AI 无关的普通文档内容");
if (gptArchitecture.professional || gptArchitecture.requiresWebReview || gptArchitecture.domain !== "通用") throw new Error(`GPT/encoder/decoder 仍被新增关键词硬编码为专业问题：${JSON.stringify(gptArchitecture)}`);
const aiRequiresSearch = { required: true, confidence: 91, reason: "需要核对模型架构这一外部事实", queryZh: "GPT 模型架构 编码器 解码器", queryEn: "GPT model architecture encoder decoder" };
const gptSearchPlan = resolveWebSearchNeed(gptArchitecture, aiRequiresSearch);
if (!gptSearchPlan.required || gptSearchPlan.reasonCode !== "model" || gptSearchPlan.queryZh !== aiRequiresSearch.queryZh || gptSearchPlan.queryEn !== aiRequiresSearch.queryEn) throw new Error(`AI 联网判断没有成为搜索计划真实输入：${JSON.stringify(gptSearchPlan)}`);
const aiSkipsSearch = resolveWebSearchNeed(ordinary, { required: false, confidence: 92, reason: "只需解释给定原文", queryZh: "", queryEn: "" });
if (aiSkipsSearch.required || aiSkipsSearch.reasonCode !== "none") throw new Error(`AI 高置信度判断无需联网后仍被关键词强制搜索：${JSON.stringify(aiSkipsSearch)}`);
const lowConfidenceSearch = resolveWebSearchNeed(ordinary, { required: false, confidence: 0, reason: "无法判断", queryZh: "测试主题", queryEn: "test topic" });
if (!lowConfidenceSearch.required || lowConfidenceSearch.reasonCode !== "model-low-confidence") throw new Error(`AI 低置信度判断没有保守搜索：${JSON.stringify(lowConfidenceSearch)}`);
const binaryNoSearch = resolveWebSearchNeed(ordinary, { required: false, confidence: 0, reason: "AI 二元重判无需联网", queryZh: "", queryEn: "", source: "binary" });
if (binaryNoSearch.required || binaryNoSearch.reasonCode !== "model-binary") throw new Error(`AI 二元重判无需联网仍触发搜索：${JSON.stringify(binaryNoSearch)}`);
const failedAssessmentSearch = resolveWebSearchNeed(ordinary, undefined, "模型没有返回合法 JSON");
if (failedAssessmentSearch.required || failedAssessmentSearch.reasonCode !== "model-error-no-search") throw new Error(`普通问题的 AI 联网判断彻底失败后仍盲目搜索：${JSON.stringify(failedAssessmentSearch)}`);
const failedProfessionalSearch = resolveWebSearchNeed(systems, undefined, "模型没有返回合法 JSON");
if (!failedProfessionalSearch.required || failedProfessionalSearch.reasonCode !== "mandatory-safety") throw new Error(`专业问题的 AI 联网判断失败后绕过安全搜索：${JSON.stringify(failedProfessionalSearch)}`);
const disabledProfessionalSearch = resolveWebSearchNeed(systems, aiRequiresSearch, "", false);
if (disabledProfessionalSearch.required || disabledProfessionalSearch.reasonCode !== "disabled" || disabledProfessionalSearch.queryZh || disabledProfessionalSearch.queryEn) throw new Error(`联网总开关关闭后，专业问题仍可进入搜索计划：${JSON.stringify(disabledProfessionalSearch)}`);
if (!translate("zh-CN", "settings.webSearchHint").includes("关闭时") || !translate("en", "settings.webSearchHint").includes("When off")) throw new Error("联网总开关文案没有明确关闭时禁止 Tavily、百科和专业审查搜索");
if (!isProxyVirtualResolution("en.wikipedia.org", [{ address: "198.18.1.56" }, { address: "fdfe:dcba:9876::137" }])) throw new Error("桌面系统代理的成对虚拟 DNS 地址没有被识别");
if (isProxyVirtualResolution("198.18.1.56", [{ address: "198.18.1.56" }]) || isProxyVirtualResolution("attacker.example", [{ address: "10.0.0.8" }, { address: "fdfe:dcba:9876::1" }])) throw new Error("直接 IP 或普通内网解析被错误当成可信系统代理虚拟地址");

console.log(JSON.stringify({ languageCausal: true, logoutLabel: true, explicitCloudUploadCopy: true, localFirstCloudCopy: true, cloudQuotaCopy: true, officialClientDownloadDisclosure: true, seedSignature: true, professionalAssessment: true, policyReviewRequired: true, aiSearchDecision: true, webSearchMasterSwitchPlan: true, noArchitectureKeywordPatch: true, proxyVirtualAddressGuard: true }));
