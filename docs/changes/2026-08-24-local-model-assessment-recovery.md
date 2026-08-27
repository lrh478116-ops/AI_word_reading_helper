# 本地小模型结构化判断失败恢复

## 审计结论

用户输入普通短文本 `hyzg` 后，当前正式链连续出现：

```text
专业度模型返回非法结构
→ professional_assessment warning
→ 联网模型返回损坏 JSON
→ resolveWebSearchNeed 将任何判断错误一律转成 required=true
→ 请求五个备用百科站点
→ 0 个相关结果和多条无关 warning
```

这条路径把“AI 没有完成判断”错误地等同于“AI 判断需要联网”。它不符合由 AI 自主判断联网必要性的要求，也会让轻量本地模型的 JSON 能力不足转化为无意义的公网请求。

## 统一设计

1. 结构化 `WEB_SEARCH_DECISION_V1` 仍是首选，继续输出 `required/confidence/reason/queryZh/queryEn`。
2. 结构化输出解析失败时，使用同一配置模型执行一次更简单的 `WEB_SEARCH_DECISION_BINARY_V1`，只允许输出 `SEARCH` 或 `NO_SEARCH`。这仍是 AI 语义判断，不是关键词表。
3. 二元重判结果明确标记为 `source=binary`；不伪造模型置信度，也不把内部占位值展示成答案正确率。
4. 普通问题的二元结果为 `NO_SEARCH` 时不联网；为 `SEARCH` 时使用原问题生成回退查询并联网。
5. 两次 AI 判断都失败、且没有专业/政策/高风险安全下限时，不再盲目搜索，显示 warning 后继续回答。
6. 两次 AI 判断都失败、但规则或专业模型已确定安全下限时，仍强制联网，不能让格式错误绕过政策和高风险审查。
7. 结构化判断合法但自报置信度低于 50 的原策略保持不变：保守搜索，并明确显示低置信度。

## 反事实验收

1. `hyzg` 的结构化判断故意返回损坏 JSON，二元重判返回 `NO_SEARCH`：备用站点请求增量必须为 0，最终回答非空。
2. 只把二元重判改成 `SEARCH`：正式路径必须执行搜索。
3. 结构化和二元判断都损坏的一般问题：请求增量为 0，trace 必须说明“未盲目搜索”。
4. 同样损坏两个判断，但问题满足 RCU/政策/高风险安全下限：仍必须搜索。
5. 合法结构化 `required=true`、合法结构化高置信度 `required=false`、低置信度和双语查询缓存因果测试继续通过。

## 非目标

- 不增加 `hyzg`、GPT 或其他问题关键词特例。
- 不把规则评分或二元重判占位值显示为概率。
- 不静默声称结构化判断成功；发生降级必须进入折叠工具记录。

## 实施与验证结果

- 新增严格的 `WEB_SEARCH_DECISION_BINARY_V1`：只接受完整的 `SEARCH` 或 `NO_SEARCH`；其他内容视为第二次失败。
- 二元重判使用 `source=binary` 进入正式搜索计划，不走关键词表；trace 明确说明二元重判不提供置信度，不显示伪造概率。
- 修改前失败证据：`source=binary, required=false` 因内部置信度占位为 0 被旧 resolver 强制改成 `model-low-confidence + required=true`。
- 修复后 `hyzg` 结构化 JSON 故意损坏、二元重判为 `NO_SEARCH` 时，备用站点请求增量为 0，最终回答非空。
- 结构化和二元判断都损坏的一般问题请求增量为 0，trace 为 warning 并显示“未盲目搜索”。
- 同样损坏两个判断的 RCU 专业问题仍增加一次搜索，标签为“必须联网”，状态为 warning；格式失败不能被误标为成功。
- 既有结构化 `required=true`、高置信度 `required=false`、低置信度保守搜索、双语查询与 stale-cache 反事实继续通过。
- `pnpm skills:test`、`pnpm desktop:smoke` 和 `pnpm search:live` 通过；真实 Chromium 搜索本轮取得 4 个来源，Britannica 不可用并被跳过。

## 接入等级

- 本地模型结构化失败 → AI 二元重判 → 搜索计划 → 实际请求/不请求 → 最终回答：`LEVEL_5_PREDICTION_BEARING`。
- 两次 AI 判断都失败时的一般问题不盲目搜索，以及专业安全下限仍搜索：`LEVEL_5_PREDICTION_BEARING`。
- 这证明失败恢复路径真实影响执行，不代表任意本地小模型的语义判断准确率已经校准；开放域判断准确率仍为 `NOT_CAUSALLY_VERIFIED`。

## 1.12.3 发布态

- 新 `win-unpacked/AI Tip.exe` 通过完整桌面 smoke。
- 同一打包应用通过 `--live-reference-search-test`，本轮真实取得百度百科、360 百科、中文维基和英文维基共 4 个来源；Britannica 不可用并被跳过。
- 安装包和测试证据与建议箱修复共用 1.12.3 发布记录；SHA-256 见同日建议箱变更说明。
