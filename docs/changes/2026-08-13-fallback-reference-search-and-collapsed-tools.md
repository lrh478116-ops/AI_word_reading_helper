# 无 Tavily Key 的备用参考检索与工具轨迹折叠

## 审计结论

当前正式聊天入口只在 `webSearchEnabled && searchApiKey` 时注册 `web_search` 工具，也只在该条件成立时执行专业问题预搜索。因此，无 Tavily Key 时即使公开百科站点可访问，它们也不会进入模型的 `baseMessages`、`evidenceLog`、引用审计、最终消息或持久化技能记录，现状为 `LEVEL_0_DEFINED`（尚无备用组件），不是端到端联网。

当前 `SkillResults` 将每条 `SkillTrace` 的标签、详情和来源链接直接平铺在回答之前，没有折叠状态；历史消息和流式消息都走同一组件。

搜索调用失败还存在回答中断风险：专业预搜索的 `researchWeb` 异常会直接进入聊天路由外层 `catch`；模型主动调用 `web_search` 时虽然单个工具异常会进入 tool result，但如果模型之后没有产生内容，仍可能以错误结束。搜索失败不能成为拒绝回复的条件。

## 设计不变量

- 有 Tavily Key 时仍优先使用 Tavily，并继续遵守免费模式每条回答最多 1 次、质量模式最多 3 次的额度策略。
- 没有 Tavily Key 时，搜索意图、专业问题和政策问题使用无需用户密钥的受限参考检索，不消耗 Tavily 额度。
- 备用站点包括中外来源：百度百科、360 百科、中文维基百科、英文维基百科和 Encyclopaedia Britannica；每个站点独立超时，打不开、拒绝访问、解析失败或零结果时跳过该站点。
- 百科类来源是概览性参考，不自动获得政府、监管机构、标准组织或同行评审来源的权威等级；专业审查不得仅因百科结果存在而错误标记“权威审查通过”。
- 外部文本仍必须经过 HTTPS/公网限制、大小限制和 Prompt 注入隔离。
- 无 Tavily Key 的回答必须在结尾明确说明：备用联网数据可能不够精细或最新，并提示用户录入 Tavily API。
- Tavily 和备用检索无结果、超时或失败时，必须继续生成有效回答；回答应明确“未取得可用联网证据”，不得伪造来源、最新性或审查通过状态。
- 没有模型 API 时仍输出本地一般性回答，不因搜索失败失语。
- 工具调用轨迹默认折叠；用户可点击摘要展开详情和来源。warning/error 的数量与状态在折叠摘要中仍可见。
- 折叠只改变表现层，不删除 `SkillTrace`、来源链接或持久化记录。

## 非目标

- 不把备用百科检索宣传成 Tavily 等价品或通用搜索引擎。
- 不绕过付费墙、登录、验证码、robots 限制或站点访问控制。
- 不保证每个国家/网络环境中所有候选站点都可访问。
- 不因备用站点失败而静默调用发布者 API Key。
- 不降低专业与高风险问题的证据门槛。

## 先失败的测试与反事实

1. 清除用户 Tavily Key，保留模型 API；提出明确联网问题。断言 Tavily 请求增量为 0，备用站点请求大于 0，备用 `web_search` trace、来源和最终回答都进入持久化主链。
2. 让一个国内站点返回 503，其他中外站点成功。断言失败站点被跳过，成功来源仍进入模型证据，最终回答存在。
3. 让全部备用站点超时、报错或返回空结果。断言聊天仍产生非空 assistant 消息，技能状态为 warning，正文明确未取得联网证据且没有虚构 `[S#]`。
4. 配置 Tavily Key但让 Tavily 返回 500。断言不会因搜索异常结束聊天，仍产生非空回答和 warning；不得把失败标记为搜索成功。
5. 有 Tavily Key时断言仍走 Tavily，不触发备用站点，免费额度最多 1 次。
6. 无 Tavily Key时最终回答必须包含“数据可能不够精细或最新”和“录入 Tavily API”的提示；有 Tavily 成功时不得错误追加该提示。
7. 桌面 UI 中历史和流式工具轨迹默认关闭，折叠摘要可见；点击后详情和来源出现，再点击可收回。
8. 删除备用检索输出或阻止其进入 `baseMessages` 时，模型 mock 不得仍产生带备用来源的回答；用于证明正式结果确实消费备用证据，而非只记录 trace。

## 验收等级

只有“无 Tavily Key → 正式入口决定需要联网 → 实际请求至少一个可用备用站点 → 隔离外部文本 → 证据进入模型输入 → 模型回答引用对应来源 → 降级提示进入最终正文 → 消息与 trace 持久化 → UI 默认折叠但可展开来源”全链通过，才可判定备用检索达到 `LEVEL_5_PREDICTION_BEARING`。

搜索全失败路径必须单独证明“错误/零结果 → warning → 仍生成并持久化非空回答”。只证明单个抓取函数能够访问百科网站属于 `COMPONENT_CAPABILITY`，不能作为正式验收。

## 实施与新鲜证据

- 先失败证据：在实现前，清空 Tavily Key 后的正式聊天测试得到 `fallbackCalls: []`，证明旧版本没有备用联网主链。
- 反事实输入绑定：最初的真实公网正式入口测试把“领域标签 + 完整提问 + 关键原文”作为百科查询，只得到 1 条低相关结果；测试拒绝验收。修复为提取简洁主题查询，并增加结果相关性过滤后，无法再用无关条目凑来源数。
- `COMPONENT_CAPABILITY`：真实公网直接检索 `artificial intelligence` 与 `人工智能` 时，能够访问部分 360 百科、中文维基和英文维基结果；百度百科和 Britannica 在当前网络环境拒绝访问或超时，被独立跳过。
- `FORMAL_PATH_INTEGRATION`：`pnpm skills:test` 通过。受控端到端反事实覆盖无 Key 备用检索、单站 503、全部站点失败、Tavily 500、Tavily 与备用路径互斥、证据进入回答和持久化；结果字段包括 `fallbackReferenceSearch`、`fallbackSiteSkip`、`fallbackAllFailedAnswered`、`tavilyFailedAnswered`，均为 `true`。
- `INDEPENDENT_EVALUATION`：`node scripts/test-live-reference-search.mjs` 从真实注册、文档、Tip、聊天入口执行，无模型 API、无 Tavily Key、无站点 mock；本轮实际取得 360 百科与中文维基两个相关来源，失败站点被跳过，来源进入最终回答，质量提示存在，消息原样持久化。
- UI 正式桌面链：`pnpm desktop:smoke` 通过，历史与流式工具详情均默认关闭，展开后详情可见并可再次收回，结果为 `toolTracesCollapsed: true`。
- 完整回归：文档导入、PDF 原版 Tip、OCR、递归 Tip、Word 表格编辑、Python 精确计算、长回答续写和安全负向测试全部通过。
- 1.9.6 Windows 打包态：`release/win-unpacked/AI Tip.exe --smoke-test` 退出码为 0，结果再次包含 `toolTracesCollapsed: true`；安装包为 `AI Tip Setup 1.9.6.exe`，SHA-256 为 `F42C442AAD11C28CA87B0AC4F9A3E0A1D2BD1A86D2F95712AD8E1AF8183F5F87`。

备用检索的无模型正式路径已达到 `LEVEL_5_PREDICTION_BEARING`：删除搜索来源会改变最终回答的来源段，搜索质量提示和持久化记录也来自本轮真实检索。配置模型后的正式路径已经由受控反事实覆盖，但未使用用户的真实模型 API 做公网独立评估；其独立模型综合质量标记为 `NOT_CAUSALLY_VERIFIED`，不得把此项写成真实模型回答质量已获独立保证。Tavily 的真实服务同样未消耗用户额度，失败不阻断回答由受控 500 测试证明。
