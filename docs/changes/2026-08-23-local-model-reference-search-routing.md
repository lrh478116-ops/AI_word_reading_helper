# 本地模型备用联网检索主链修复

## 结论

本地模型并非不能联网。联网搜索由 AI Tip 服务端执行，再把隔离后的证据注入本地或云端模型的消息输入；模型运行位置不应改变检索能力。当前故障来自搜索编排，而不是 GGUF、Ollama 或模型下载方式。

现有备用参考检索组件已经存在，也能独立访问部分中外百科站点，但用户截图中的问题没有把该组件接入最终回答。对“GPT 用的是 encode-only 还是 decode-only”这类没有显式写出“联网/最新”的技术事实问题，当前正式链为：

```text
问题
→ 模型专业度自评为一般、置信度 0/100
→ 规则词表没有识别 GPT/encoder/decoder
→ reviewRequired=false 且 explicitSearchIntent=false
→ 是否调用 web_search 交给本地模型自行决定
→ 本地模型未调用工具
→ 备用检索没有执行、没有证据注入
→ 最终回答回避问题
```

这条路径中的备用检索仅达到 `LEVEL_0_DEFINED`；工具定义被传给模型最多只能证明 `LEVEL_1_INVOKED`，没有达到 `LEVEL_3_CONSUMED`、`LEVEL_4_CAUSAL` 或 `LEVEL_5_PREDICTION_BEARING`。

## 只读审计发现

| 问题 | 严重程度 | 代码位置 | 设计要求 | 当前实际行为 | 直接证据 | 潜在影响 | 错误验收风险 | 统一修复方向 | 阻止下一阶段 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 普通技术事实问题没有确定性搜索计划 | 高 | `server/index.ts` 聊天入口的 `explicitSearchIntent`、`needsSearch` | 需要外部事实核查的问题应由应用编排决定是否检索 | 只有专业/政策问题或包含“联网、最新”等字样时才强制搜索，其余交给模型 `tool_choice=auto` | 截图只出现专业度 trace；正式路径没有 `web_search` trace | 本地小模型可能完全不查资料并回避或幻觉 | 现有明确写“联网搜索”的 fixture 会通过，却掩盖自然问法的断链 | 增加可测试的搜索需求判定；自然技术事实问法也形成服务端搜索计划 | 是 |
| 搜索依赖本地模型 function calling | 高 | `server/index.ts` 工具循环 | 必需检索不能由模型能力或意愿绕过 | 非专业搜索通过强制/自动工具调用发起；不支持或不正确实现工具调用的本地模型会直接回退普通回答 | `tools` 存在不等于工具被执行；异常路径明确写有“模型暂不支持工具调用” | 不同 GGUF 模型行为不一致，无法保证本地模式联网 | 只用支持 tools 的 OpenAI-compatible mock 会产生虚假通过 | 必需检索由服务端在生成回答前执行并注入证据；模型工具只保留为可选补充 | 是 |
| 混合中英文查询直接投给所有站点 | 高 | `referenceSearchUrl`、`searchReferenceWeb`、`referenceItemMatchesQuery` | 国内与国外站点应获得适合其语言的简洁关键词 | 同一条原始中文/英文混合句子发给五个站点；中文虚词还会让相关性过滤忽略有效英文条目 | 真实请求中原问题在中、英文维基均返回零结果；以英文技术词构造查询后英文维基返回 Transformer/GPT 条目 | 已经执行搜索但仍显示零结果，用户误以为联网失效 | 只使用 `REFERENCE_FALLBACK_TEST` 固定 mock 会掩盖真实查询问题 | 按站点语言规范化查询；提取技术标识符，过滤中文虚词，并对常见架构术语做双向关键词归一化 | 是 |
| AI 专业词表漏掉常见模型架构术语 | 中高 | `professionalDomains`、`formalHits` | 专业度规则是模型自评不可降低的安全下限 | GPT、encoder-only、decoder-only、LLM 等不计入 AI 专业信号 | 截图最终显示“一般问题”；该问法需要模型架构知识 | 专业问题绕过强制联网与专业审查 | 只测试 Transformer/RCU 会误判覆盖充分 | 扩展通用 AI 架构词族，不为单文档或单任务写特例 | 是 |
| 0/100 自报置信度被当作正常评估 | 中高 | `parseProfessionalAssessment`、评估 trace | 低置信度不能成为跳过检索的依据，UI 必须说明其含义 | 0 在结构范围内，直接显示“模型置信度 0/100”，同时仍按“一般问题”继续 | 用户截图 | 最不可靠的分类反而允许绕过核查 | 只校验字段范围会把“结构合法”误称为“判断可靠” | 标记低置信度、采用规则安全下限；若问题包含外部事实信号则保守检索 | 是 |
| 设置名称与实际路由语义不完全一致 | 中 | `defaultSettings`、`researchWeb` | 是否使用 Tavily、是否允许受限备用检索应可解释 | `webSearchEnabled` 同时像总开关，但专业/显式问题即使关闭也会走备用检索；有 Key 但关闭时也改走备用站点 | 条件是 `webSearchEnabled && searchApiKey ? Tavily : reference` | 用户难以判断本地模型是否具备备用联网 | UI 开关测试不验证真实 provider 分流 | 本次保持既有产品要求：必须核查的问题始终搜索；仅在“已启用且有 Key”时用 Tavily，否则用有限备用站点，并明确质量提示 | 否（本次记录语义） |

## 架构断点

这些问题来自同一个断点：系统把“搜索工具已经提供给模型”误当成“搜索计划已经执行”。正确的因果链必须是：

```text
问题与有限上下文
→ 专业度规则 + 模型自评
→ 确定性搜索需求与原因
→ 按 Tavily/备用站点选择 provider
→ 实际检索与站点级跳过
→ 外部文本隔离
→ 证据进入本轮模型输入
→ 回答引用真实来源，或在无结果时给出一般性有效回答
→ 审计、质量提示、消息和 trace 持久化
```

## 设计不变量

- 本地 GGUF、Ollama 和云 API 共用相同的搜索编排；模型 provider 不能决定是否拥有网页检索能力。
- 专业、政策、高风险、明确搜索、时效性和可识别的外部技术事实问法，由服务端在回答前执行搜索，不能依赖模型主动发起工具调用。
- 配置且启用 Tavily 时优先使用 Tavily；否则使用有限的中外百科/参考站点，不消耗开发者服务器带宽，也不使用发布者 API Key。
- 国内与国外参考站点使用各自适合的查询；查询规范化是通用语言处理，不添加文档 ID、任务 ID 或冻结答案特例。
- 单个站点打不开就跳过；全部站点或 Tavily 失败仍必须生成并持久化非空回答，且不得虚构来源、最新性或审查通过。
- 无 Tavily 的回答必须保留“数据可能不够精细或最新、建议录入 Tavily API”的说明。
- 低置信度是分类器自报不确定性，不是答案正确率；不得让 0/100 的分类结果降低规则判断或绕过应有搜索。
- 搜索 trace 只有在真实发起搜索后才能写入；有 trace 但无证据时必须是 warning，不能伪装 success。
- 备用百科来源不能自动当作政府、标准组织、官方技术文档或同行评审来源。

## 非目标

- 不让每个寒暄、主观偏好或纯粹基于选中文本的解释都联网。
- 不把备用百科检索宣传成 Tavily 的完整替代品。
- 不通过开发者 Supabase 或应用服务器代理下载网页内容。
- 不硬编码“GPT 是 decoder-only”作为回答；最终内容必须来自本轮模型结合实际检索证据生成。
- 不保证被封锁、要求验证码或拒绝自动访问的网站一定可用。

## 先失败的回归与反事实测试

1. 对精确复现问法“GPT 用的是 encode-only 还是 decoder-only”执行规则评估：必须识别 AI 架构专业信号并要求联网审查。
2. 本地模型分类器故意返回 `general + confidence=0 + requiresWebReview=false`：规则安全下限仍必须产生真实备用搜索，trace 明确标记低置信度，不能由模型降级绕过。
3. 本地模型不发出任何 tool call：服务端仍请求备用站点，把证据写入 system message；删除证据后 mock 的最终答案必须变化，证明不是只记录 trace。
4. 同一混合语言问题发送给英文站点时，查询必须移除无意义中文虚词并保留 GPT/encoder/decoder 技术词；发送给中文站点时必须形成可检索的中文架构关键词。
5. 无 Tavily Key 时 Tavily 请求为零，备用站点请求大于零，最终消息包含真实 `[S#]` 和无 Tavily 质量提示。
6. 让单个备用站点失败：其余来源仍进入最终回答；让全部站点失败：回答非空、没有虚假 `[S#]`、trace 为 warning，并说明未取得可用联网证据。
7. 纯文档指代问法“请解释这段原文”不触发普通事实搜索，避免所有问题无差别联网；专业/政策安全下限不受该抑制。
8. 伪造 `web_search` trace 但不把证据放入模型输入时，证据敏感 mock 不得返回带来源结论。
9. Tavily 已配置且启用时不请求备用站点；免费模式仍最多一次预搜索。
10. 搜索 provider、查询、来源、证据、回答、审计与持久化消息必须属于同一聊天 run，不得复用旧回答或 stale solved 状态。

## 验收条件

- focused 规则测试、受控本地模型正式聊天测试、无 Tavily 备用检索测试、全部失败仍回答测试通过。
- `pnpm skills:test` 与 `pnpm desktop:smoke` 通过。
- 真实公网参考站点测试至少取得一个与查询相关的中外来源；不可访问站点被报告为跳过。
- Windows 安装包重新构建并通过打包态 smoke test。
- 只有当“本地问题 → 服务端搜索计划 → 真实备用请求 → 证据注入 → 本地模型答案改变 → trace/消息持久化”完成反事实验证后，才可判为 `LEVEL_5_PREDICTION_BEARING`。

## 第一轮实施记录（已由第二轮设计废弃）

> 本节保留用于说明此前关键词方案为何会得到表面通过；其中“扩展 AI 架构词族”和固定术语翻译不再代表当前代码。当前正式实现与验收结论以后文“第二轮设计纠正”和“第二轮实施结果”为准。

### 修复内容

- 增加 `assessWebSearchNeed`，把专业/政策、明确搜索/时效问题和外部技术事实问法转换为服务端确定性搜索计划。
- 必需搜索改为回答前由服务端执行并注入 system evidence；不再依赖本地模型是否支持或主动使用 function calling。
- AI 规则词族覆盖 GPT、LLM、encoder/decoder、编码器/解码器、自回归、模型架构和预训练模型等通用概念。
- 模型自报分类置信度低于 50 时，trace 明确显示“低置信度，不用于降低规则安全下限”，状态为 warning。
- `referenceQueryForSite` 为国内和国外站点分别生成关键词：英文站点移除中文虚词并保留英文技术标识，中文站点补充对应中文架构术语。
- 备用站点零结果时记录站点级失败原因；单站失败仍继续其他站点。
- Electron 将搜索、Tavily 用量/检索和原网页读取接入 Chromium 系统网络栈，以继承 Windows/macOS 的系统代理。
- SSRF 防护新增受限 Fake-IP 兼容：只有 Electron 显式声明可信系统代理、请求目标是域名而非 IP 字面量、解析结果同时包含 `198.18/15` 与 `fdfe::/16` 代理虚拟地址且不混入其他内网地址时才允许；普通 `10/8`、`172.16/12`、`192.168/16` 和直接 IP 仍被拒绝。

### 先失败证据

- 修改实现前，新增产品回归对“GPT 用的是 encode-only 还是 decoder-only？”得到：`professional=false`、`level=general`、`score=0`、`domain=通用`、`requiresWebReview=false`，测试按预期失败。
- 首次真实公网测试中，正式聊天 trace 报告五个备用站点全部跳过；增加站点级错误后确认原因均为“不允许读取内网地址”。系统 DNS 实际把这些公网域名映射为代理 Fake-IP（IPv4 `198.18.x.x`、IPv6 `fdfe:...`），证明不是百科接口不存在，而是安全校验与桌面代理网络的兼容断点。

### COMPONENT_CAPABILITY

- 产品行为测试通过：GPT encoder/decoder 问法达到计算机与人工智能专业规则下限并形成 `reason=professional` 的搜索计划；纯“解释这段原文”不被无差别联网。
- 双语查询测试通过：英文维基收到不含中文字符且保留 GPT/encode/decoder 的查询；中文维基收到 GPT 与编码器/解码器关键词。
- 代理安全负向测试通过：公网域名的成对代理虚拟地址可识别；直接访问 `198.18.x.x` 或混入 `10.x.x.x` 的解析不能伪装成可信代理地址。

### FORMAL_PATH_INTEGRATION 与反事实

- 受控本地 GGUF 正式聊天测试故意让分类器返回 `general + confidence=0 + requiresWebReview=false`，且模型不产生任何 tool call。规则安全下限仍请求五个备用站点，跳过模拟失败站点，把 `LOCAL_REFERENCE_EVIDENCE` 注入本地模型输入；只有存在该证据时 mock 才返回 `BUNDLED_GGUF_SEARCH_EVIDENCE_ANSWER ... [S1]`。最终消息包含来源引用、无 Tavily 质量说明并持久化，达到 `LEVEL_5_PREDICTION_BEARING`。
- 外部网络 fetch 注入在正式 Tavily/备用搜索链中被实际调用 18 次，证明 Electron Chromium 网络适配器不是仅定义或记录。
- 既有反事实仍通过：无 Tavily 不触发 Tavily；有 Tavily 不触发备用站点；搜索缓存不重复消耗额度；单站失败可继续；全部备用失败和 Tavily 500 都保留非空回答；虚假来源编号不能通过引用审计。

### INDEPENDENT_EVALUATION

- `pnpm search:live` 通过 Electron Chromium 的真实系统网络执行，不使用站点 mock 或 Tavily Key。本轮对 GPT/encoder/decoder 架构查询实际取得 2 个来源：中文维基“Transformer架构”和英文维基“Transformer (deep learning)”；百度百科、360 百科和 Britannica 当前不可用并被跳过。
- 该结果证明当前 Windows 网络与系统代理下的真实备用检索可用；它不保证三个被跳过站点在其他时间或地区一定可访问，也不把百科来源误称为专业权威原文。

### 回归、桌面与发布态

- `pnpm skills:test` 全量通过，覆盖文档导入、Word 表格、PDF/OCR Tip、递归 Tip、Python、长回答、登录凭据、本地运行时、Ollama、Tavily/备用检索、Supabase 同步与安全负向测试。
- `pnpm desktop:smoke` 通过。
- Windows 1.12.1 解包应用通过完整桌面 smoke；同一解包应用以 `--live-reference-search-test` 再次通过真实 Chromium 联网并取得上述 2 个来源。
- 安装包：`release/AI Tip Setup 1.12.1.exe`，SHA-256：`BCDF6CBCC7EFD8F53171043DFCC284904938173DE8576F342F20155A879A7771`。
- 旧 1.12.0 发布产物已可恢复地移至 `.release-archive/1.12.0`；测试结果文件已移至 `.release-archive/test-results/1.12.1`，`release` 只保留 1.12.1 发布产物和构建目录。
- macOS/Mac App Store 构建不能在本轮 Windows 主机上真实签名与运行，标记为 `INDEPENDENT_EVALUATION: NOT_CAUSALLY_VERIFIED`；代码仍使用 Electron Chromium 跨平台系统网络接口，没有加入 Windows 专属搜索实现。

## 最终接入等级

- 本地模型无 Tavily 的必需检索：`LEVEL_5_PREDICTION_BEARING`（受控模型正式链 + 真实桌面网络组合证据）。
- Windows 打包态真实备用站点可访问性：`LEVEL_5_PREDICTION_BEARING`，当前取得两个实际来源并可由移除网络/证据的反事实改变结果。
- Tavily 真实账户调用：本轮为保护免费额度没有消耗真实 Tavily 请求；额度、缓存、provider 互斥和失败不阻断由受控正式路径验证，真实账户本轮标记 `NOT_CAUSALLY_VERIFIED`。
- macOS 打包态真实网络：`NOT_CAUSALLY_VERIFIED`，需要在 macOS 构建/签名环境执行 `pnpm search:live` 与 MAS 包烟测。

## 2026-08-23 第二轮设计纠正：联网必要性必须由 AI 判断

### 纠正结论

第一轮把 GPT、LLM、encoder/decoder 等架构概念加入专业规则，能够修复当前截图，但这是词表覆盖，不是通用的联网必要性判断。它只能证明已列出的词会触发搜索，无法证明新概念、跨领域事实或不同问法也能被正确处理。按照产品要求，这种实现不能作为最终验收。

### 统一设计

正式回答前增加独立的 `WEB_SEARCH_DECISION_V1` 模型评估，不复用“模型是否主动调用 function tool”作为判断结果。评估必须读取：

- 当前用户问题；
- 有限的选中文本和文档标题；
- 本轮专业度判断摘要；
- 当前是否存在 Tavily Key，但不得因为没有 Key 就把 `required` 降为 false。

AI 必须输出受校验的结构：

```json
{
  "required": true,
  "confidence": 0,
  "reason": "需要核对模型架构这一外部事实",
  "queryZh": "GPT 模型 架构 编码器 解码器",
  "queryEn": "GPT model architecture encoder decoder"
}
```

`confidence` 是 AI 对“是否需要联网”分类的自报把握，不是答案正确率。`queryZh/queryEn` 由 AI 针对国内外站点生成，服务端不再用 GPT/encoder/decoder 等领域词表决定搜索，也不再用固定架构术语翻译表修补该问题。

### 保留的非 AI 安全下限

仅保留用户此前明确要求且不能由模型降级绕过的约束：

- 政策、法规和公共治理问题必须联网审查；
- 医学、法律、金融高风险现实决策必须联网并提示人工复核；
- 已由专业度模型/既有通用安全规则判为专业的问题，仍按照“专业问题必须联网审查”的产品不变量执行。

这些安全下限不能被称为 AI 联网判断本身。普通技术事实问题的搜索触发必须能在移除新增架构词表后，仍由 `WEB_SEARCH_DECISION_V1` 的真实输出改变正式执行。

### 失败与低置信度策略

- 评估 JSON 非法、字段缺失、模型调用失败：记录 `web_search_assessment=warning`，保守执行一次搜索，然后继续回答。
- `confidence < 50`：记录低置信度，保守执行搜索；不得把低置信度 `required=false` 当成跳过联网的依据。
- `required=false && confidence>=50` 且没有政策/高风险/专业安全下限：不搜索，避免每个问题一味联网。
- 搜索失败仍生成有效回答；评估失败不能成为不回答的理由。

### 新的反事实验收

1. 删除第一轮新增的 GPT、LLM、encoder/decoder 专业词后，规则对孤立 GPT 问法可以仍为一般；AI 搜索判断返回 `required=true` 时，正式聊天必须搜索并消费证据。
2. 对同一问题仅把 AI 搜索判断改成 `required=false, confidence>=80`，且没有专业/政策安全下限时，备用站点请求增量必须为零。
3. AI 返回 `required=false, confidence=0` 时必须保守搜索，并在 trace 中标记低置信度；不能用 0/100 跳过搜索。
4. AI 返回非法 JSON 时必须保守搜索、保留非空回答并记录 warning。
5. 纯文档解释由 AI 返回高置信度 `required=false` 时不搜索；不能用问题关键词正则抢先覆盖 AI 结果。
6. AI 产生的 `queryZh` 只发送给国内/中文站点，`queryEn` 只发送给英文站点；改变这两个字段必须改变实际站点请求参数。
7. 只有 `web_search_assessment → 搜索计划 → 实际站点请求 → 证据注入 → 回答变化 → 持久化` 同 run 可追溯，才能重新判为 `LEVEL_5_PREDICTION_BEARING`。

## 第二轮实施结果与新鲜证据

### 当前正式逻辑

- `assessQuestionProfessionalism` 中已删除第一轮新增的 GPT、LLM、encoder/decoder、编码器/解码器、模型架构等触发项；`referenceQueryForSite` 也不再包含固定的 AI 架构术语翻译表。
- 每次 Tip 回答在生成正文前，都由当前已配置的大模型执行独立的 `WEB_SEARCH_DECISION_V1`。该调用读取本轮问题、有限选区上下文和专业度摘要，并返回 `required/confidence/reason/queryZh/queryEn`。
- 服务端严格解析结构化输出，随后由 `resolveWebSearchNeed` 生成搜索计划；普通问题中 AI 的高置信度 `required=false` 会直接阻止预搜索，`required=true` 则会在回答前执行搜索并注入证据。
- 政策、专业与医学/法律/金融高风险问题仍保留产品安全下限。这是明确标注的强制审查规则，不伪装成 AI 判断，也不能被 AI 的 `required=false` 降级绕过。
- 判断调用失败、JSON 非法或自报置信度低于 50 时，会显示 `web_search_assessment=warning` 并保守搜索一次；搜索本身失败仍继续生成非空回答。
- AI 生成的 `queryZh/queryEn` 被真实传给中文和英文站点。备用搜索缓存键同时绑定主查询、中文查询和英文查询，改变任一查询都不会复用 stale cache。
- 回答阶段仍保留可选 `web_search` 工具；这是回答模型再次主动请求证据的能力，而不是关键词触发。其 schema 同样支持可选的中英文查询。

### 先失败证据

1. 新回归测试首先证明第一轮代码仍会把孤立的 GPT 架构问法按新增关键词判为 `professional=true, score=72`，违反“由 AI 判断联网必要性”的要求；删除词表前测试按预期失败。
2. 双语查询接入后，新增 stale-cache 反事实：使用相同主查询，第一轮 AI 查询为“中文缓存变体甲 / cache variant alpha”，第二轮改为“中文缓存变体乙 / cache variant beta”。修复前第二轮实际站点请求为 0，证明旧缓存绕过了新 AI 输出；把三项查询共同绑定到缓存签名后通过。

### COMPONENT_CAPABILITY

- 产品回归证明孤立 GPT/encoder/decoder 问法在规则层保持 `general`，没有以新增词表强行触发联网。
- 结构解析拒绝非法 JSON、字段缺失、越界置信度以及 `required=true` 但没有任何查询词的输出。
- 决策合并反事实通过：一般问题的 AI `required=true` 形成 `reasonCode=model`；高置信度 `required=false` 形成 `reasonCode=none`；低置信度与调用失败分别形成保守搜索计划。

### FORMAL_PATH_INTEGRATION 与反事实

- 受控本地模型对“GPT 用的是 encode-only 还是 decoder-only？”在专业分类阶段故意返回 `general, confidence=0, requiresWebReview=false`；独立联网判断返回 `required=true, confidence=91` 和双语查询。正式聊天实际请求五个备用站点、把 `LOCAL_REFERENCE_EVIDENCE` 注入回答输入，最终回答由无证据时的 `BUNDLED_GGUF_CAUSAL_ANSWER` 改变为带 `[S1]` 的 `BUNDLED_GGUF_SEARCH_EVIDENCE_ANSWER` 并持久化。
- 对普通解释问题只把联网判断改为 `required=false, confidence=96`，正式路径的备用站点请求增量为 0，证明不存在旧关键词路径抢先搜索。
- `required=false, confidence=0` 与非法判断 JSON 两个负向用例均实际增加一次搜索请求，trace 为 warning，且最终回答非空。
- 双语缓存反事实证明修改 `queryZh/queryEn` 会改变下一轮实际站点请求；旧缓存不能绕过新判断。
- 全部备用站点失败和 Tavily 失败仍保留有效回答；没有证据时不会伪造 `[S1]`。

### INDEPENDENT_EVALUATION

- `pnpm search:live` 使用 Electron Chromium 系统网络栈真实访问公网，不使用 Tavily Key 或站点 mock。本轮取得 4 个来源：百度百科 GPT、360 百科 GPT、中文维基 ChatGPT、英文维基 Transformer；Britannica 本轮不可用并被明确跳过。
- 真实公网测试证明桌面应用的备用网络组件在当前 Windows 与代理环境可用。由于该诊断直接测试搜索组件而非调用真实用户模型，它与受控正式聊天反事实组合构成证据，不能单独替代模型判断质量评估。

### 回归与边界

- `pnpm skills:test` 全量通过；正式聊天测试共执行 20 次专业判断和 20 次独立联网判断，并覆盖 Word、PDF/OCR Tip、Supabase、本地 GGUF、Ollama、Python、长回答与安全负向路径。
- `pnpm desktop:smoke` 通过，桌面烟测模型已支持独立联网判断调用，不会因评估格式不匹配误触发公网搜索。
- AI 的 `confidence` 是模型对分类的自报把握，不是事实正确率；UI 和 trace 已按此含义显示，不能把 91/100 解读为答案有 91% 正确率。
- 本轮为保护 Tavily 免费额度，没有调用真实 Tavily 账户；Tavily 的正式 provider 互斥、缓存、失败不阻断由受控测试验证，真实账户调用仍为 `NOT_CAUSALLY_VERIFIED`。
- macOS/Mac App Store 打包态尚未在 macOS 主机运行，仍为 `NOT_CAUSALLY_VERIFIED`。

### 第二轮接入等级

- Windows 受控正式聊天中的 AI 联网判断、搜索执行、证据注入、回答改变与持久化：`LEVEL_5_PREDICTION_BEARING`。
- Windows 真实公网备用搜索组件：`INDEPENDENT_EVALUATION` 通过；与正式路径反事实组合支持当前 Windows 结论。
- 真实 Tavily 账户与 macOS 打包态：`NOT_CAUSALLY_VERIFIED`。

### 1.12.2 发布态验证

- Windows x64 安装包已重新构建：`release/AI Tip Setup 1.12.2.exe`。
- 新 `win-unpacked/AI Tip.exe` 以独立进程执行完整 `--smoke-test`，结果为 `ok=true`；联网判断新增调用没有破坏 PDF/OCR Tip、Word 表格编辑、登录、本地模型、Python 或保存主链。
- 同一打包应用以 `--live-reference-search-test` 真实访问公网，取得 3 个来源（360 百科、中文维基、英文维基）；百度百科与 Britannica 本轮不可用并被跳过。该结果与源码态取得 4 个来源的差异属于实时站点可用性变化，不被伪装成固定结果。
- 安装器 SHA-256：`9A0CA1513D1558A1A808F4D4103487EEE189E4F466E98D28788A54235BFE1DBE`。
- 旧 1.12.1 产物已可恢复地移入 `.release-archive/1.12.1`；打包态测试证据保存在 `.release-archive/test-results/1.12.2`，`release` 只保留 1.12.2 构建产物。
