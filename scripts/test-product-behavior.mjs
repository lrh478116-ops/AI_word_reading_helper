process.env.AI_TIP_EMBEDDED = "1";

const { normalizeLanguage, translate } = await import("../src/i18n.ts");
const { assessQuestionProfessionalism, isLegacyTransformerSeedDocument } = await import("../dist-electron/server.cjs");

if (normalizeLanguage("invalid") !== "zh-CN") throw new Error("非法语言没有回退为简体中文");
if (translate("zh-CN", "auth.localUse") !== "仅本地使用") throw new Error("中文本地入口文案错误");
if (translate("en", "auth.localUse") !== "Local use only") throw new Error("英文本地入口文案错误");
if (translate("zh-CN", "auth.localUse") === translate("en", "auth.localUse")) throw new Error("语言输出没有因语言状态改变");
if (translate("zh-CN", "nav.logout") !== "退出登录" || translate("en", "nav.logout") !== "Sign out") throw new Error("退出登录文案未接入语言表");

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

console.log(JSON.stringify({ languageCausal: true, logoutLabel: true, seedSignature: true, professionalAssessment: true, policyReviewRequired: true }));
