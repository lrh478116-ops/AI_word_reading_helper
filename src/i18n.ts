export type Language = "zh-CN" | "en";

export const LANGUAGE_STORAGE_KEY = "ai-tip-language";

const zh: Record<string, string> = {
  "language.label": "界面语言", "language.zh": "简体中文", "language.en": "English",
  "common.close": "关闭", "common.save": "保存", "common.delete": "删除", "common.copy": "复制", "common.retry": "重试", "common.loading": "加载中…",
  "auth.eyebrow": "为深度阅读而生", "auth.hero1": "让每一次疑问，", "auth.hero2": "都留在知识发生的地方。",
  "auth.description": "选中一段文字，就地开启一场独立的 AI 对话。理解、追问、折叠，再回来时思路仍然完整。",
  "auth.previewSelection": "自注意力机制允许序列中的每个 Token…", "auth.previewQuestion": "这里的“聚合”是什么意思？",
  "auth.footer": "阅读不是浏览，而是和知识建立连接。", "auth.welcome": "欢迎回来", "auth.start": "开始使用",
  "auth.loginTitle": "继续你的阅读旅程", "auth.registerTitle": "创建你的知识空间", "auth.loginHint": "登录后继续上次未完的思考。",
  "auth.registerHint": "账户和文档只保存在本机。", "auth.name": "你的名字", "auth.namePlaceholder": "例如：林同学", "auth.email": "邮箱地址",
  "auth.password": "密码", "auth.passwordPlaceholder": "至少 6 位", "auth.login": "登录", "auth.create": "创建账户", "auth.or": "或",
  "auth.localUse": "仅本地使用", "auth.noAccount": "还没有账户？", "auth.hasAccount": "已经有账户？", "auth.freeRegister": "免费注册", "auth.backLogin": "返回登录",
  "auth.loginFailed": "登录失败", "auth.localFailed": "无法进入本地账户",
  "settings.kicker": "AI 配置", "settings.title": "接口与 Prompt", "settings.subtitle": "支持云端兼容接口与 Ollama；桌面版密钥由系统安全存储加密。",
  "settings.loading": "正在读取配置…", "settings.provider": "API 服务商", "settings.model": "模型名称", "settings.apiUrl": "API 地址", "settings.apiKey": "API Key",
  "settings.savedKey": "已保存 {mask}（留空保持不变）", "settings.enterKey": "请输入 API Key", "settings.removeKey": "删除已保存的 API Key",
  "settings.systemPrompt": "系统 Prompt", "settings.promptPlaceholder": "定义 AI 的角色、回答风格与约束…", "settings.webSearch": "联网搜索",
  "settings.webSearchHint": "搜索最新资料并把来源随回答展示（Tavily）", "settings.searchKey": "搜索 API Key", "settings.enterSearchKey": "请输入 Tavily API Key",
  "settings.searchBudget": "搜索额度策略", "settings.freeBudget": "免费额度保护（每条回答最多 1 次）", "settings.qualityBudget": "质量优先（每条回答最多 3 次）",
  "settings.removeSearchKey": "删除已保存的搜索 Key", "settings.python": "Python 精确计算", "settings.pythonHint": "通过本地 Pyodide/WASM 沙箱执行数值计算",
  "settings.reliability": "完整可靠性检查", "settings.reliabilityHint": "多源、原文、引用、量纲、误差、测试与高风险复核",
  "settings.check.1": "多来源交叉验证", "settings.check.2": "原始网页读取", "settings.check.3": "引用结构审计", "settings.check.4": "单位与量纲检查",
  "settings.check.5": "不确定性计算", "settings.check.6": "符号数学", "settings.check.7": "代码执行与测试", "settings.check.8": "结构化数据分析",
  "settings.check.9": "来源冲突检测", "settings.check.10": "时效性检查", "settings.check.11": "Prompt 注入隔离", "settings.check.12": "高风险证据门槛",
  "settings.memoryTitle": "Tip 记忆如何工作", "settings.memoryText": "每个 Tip 的完整聊天仍然隔离；打开“记忆”时，只会读取同一文档其他 Tip 的摘要，不会混入原始对话。",
  "settings.test": "测试连接", "settings.save": "保存设置", "settings.saved": "设置已保存，之后的新回答会使用此配置。", "settings.loadFailed": "设置加载失败", "settings.failed": "操作失败",
  "feedback.title": "修改建议箱", "feedback.hint": "建议将通过安全邮件中继发送给开发者。不会附带文档、Tip 对话、API Key 或 Prompt。", "feedback.category": "建议类型",
  "feedback.feature": "功能建议", "feedback.accuracy": "回答准确性", "feedback.bug": "问题报告", "feedback.usability": "使用体验", "feedback.other": "其他",
  "feedback.placeholder": "请描述希望修改的内容、遇到的问题或预期行为…", "feedback.submit": "发送建议", "feedback.sending": "正在发送…", "feedback.sent": "建议已发送，感谢你的反馈。",
  "feedback.failed": "建议发送失败", "feedback.length": "{count} / 4000", "feedback.privacy": "仅在点击发送后提交；收件地址不会在应用中显示。",
  "nav.new": "新建文档", "nav.import": "导入文档", "nav.workspace": "工作空间", "nav.all": "全部文档", "nav.favorites": "收藏", "nav.recent": "最近打开",
  "nav.manage": "管理", "nav.folders": "文件夹", "nav.trash": "回收站", "nav.settings": "设置", "nav.logout": "退出登录",
  "library.space": "你的知识空间", "library.description": "把阅读、理解和追问，整理成可随时返回的知识脉络。", "library.trashDescription": "已删除的文档会保留在这里，直到你永久清除。",
  "library.search": "搜索标题…", "library.sort": "排序", "library.updated": "最近修改", "library.created": "最近创建", "library.name": "文档名称", "library.tips": "Tip 数量",
  "library.loading": "正在整理你的文档…", "library.noMatch": "没有匹配的文档", "library.emptyTrash": "回收站是空的", "library.start": "从第一篇文档开始",
  "library.shorter": "试试更短的关键词。", "library.emptyHint": "新建空白文档，或导入 TXT、Markdown、DOCX。", "library.blank": "空白文档",
  "library.unfavorite": "取消收藏", "library.favorite": "收藏", "library.restore": "恢复", "library.permanentDelete": "永久删除", "library.moveTrash": "移到回收站",
  "library.count": "{count} 篇文档", "library.localSaved": "内容已安全保存在本机", "library.loadFailed": "加载失败", "library.createFailed": "创建失败", "library.importFailed": "导入失败", "library.operationFailed": "操作失败",
  "library.deleteConfirm": "永久删除后，文档与全部 Tip 对话将无法恢复。确认删除？",
  "time.now": "刚刚", "time.minutes": "{count} 分钟前", "time.hours": "{count} 小时前",
  "editor.library": "文档库", "editor.outline": "本文目录", "editor.untitledHeading": "未命名标题", "editor.documentTips": "本文 Tips", "editor.untitled": "无标题文档",
  "editor.personalNote": "个人笔记", "editor.imported": "{type} 导入", "editor.lastEdited": "上次编辑于 {time}", "editor.addParagraph": "添加段落", "editor.heading": "标题", "editor.code": "代码", "editor.quote": "引用",
  "editor.opening": "正在打开文档…", "editor.openFailed": "无法打开文档", "editor.loadFailed": "文档加载失败", "editor.createTipFailed": "创建 Tip 失败",
  "editor.operationFailed": "操作失败", "editor.generateFailed": "生成失败", "editor.deleteFailed": "删除失败", "editor.settings": "AI 设置",
  "save.saving": "正在保存", "save.failed": "保存失败", "save.offline": "离线编辑", "save.saved": "已保存",
  "selection.createTip": "创建 Tip", "selection.highlight": "高亮",
  "tip.independent": "AI TIP · 独立对话", "tip.parentConversation": "父级对话 · 当前上下文", "tip.focusConversation": "定位到这个对话", "tip.selected": "选中的原文", "tip.selectedChat": "选中的聊天内容", "tip.anchorValid": "已定位原文", "tip.anchorRecovered": "已自动恢复位置", "tip.anchorLost": "原文位置已失效",
  "tip.memoryOn": "记忆 开", "tip.memoryOff": "记忆 关", "tip.memoryHint": "仅共享其他 Tip 的摘要，不共享完整聊天", "tip.start": "从这段原文开始",
  "tip.welcome": "当前 Tip 保持独立聊天；开启记忆时可参考本文其他 Tip 的摘要。", "tip.simple": "通俗解释", "tip.detailed": "详细解释", "tip.professional": "专业解释", "tip.example": "举个例子",
  "tip.followup": "继续追问…", "tip.sendHint": "Enter 发送 · Shift + Enter 换行", "tip.stop": "停止", "tip.resolved": "重新打开", "tip.resolve": "标记已解决", "tip.deleteConfirm": "删除这个 Tip、全部对话及其所有子 Tip？", "tip.sourceMessageMissing": "来源聊天消息已失效，请重新选择",
  "tip.treeButton": "Tip 树", "tip.treeKicker": "对话定位", "tip.treeTitle": "Tip 树状图", "tip.treeHint": "点击节点定位对话；直接修改名称并按 Enter 或移开焦点即可保存。", "tip.treeDocument": "原文档", "tip.treeLocate": "定位到这个对话", "tip.treeName": "对话名称",
  "tip.open": "打开 Tip：{title}", "tip.collapse": "折叠 Tip", "tip.checkingTools": "正在核对工具结果…", "app.entering": "正在进入 AI Tip…"
};

const en: Record<string, string> = {
  "language.label": "Language", "language.zh": "简体中文", "language.en": "English",
  "common.close": "Close", "common.save": "Save", "common.delete": "Delete", "common.copy": "Copy", "common.retry": "Retry", "common.loading": "Loading…",
  "auth.eyebrow": "Built for deep reading", "auth.hero1": "Keep every question", "auth.hero2": "where knowledge happens.",
  "auth.description": "Select a passage and start an independent AI conversation in place. Understand, follow up, collapse it, and return without losing your train of thought.",
  "auth.previewSelection": "Self-attention lets each token aggregate…", "auth.previewQuestion": "What does “aggregate” mean here?", "auth.footer": "Reading is not browsing; it is building a connection with knowledge.",
  "auth.welcome": "Welcome back", "auth.start": "Get started", "auth.loginTitle": "Continue your reading journey", "auth.registerTitle": "Create your knowledge space",
  "auth.loginHint": "Sign in to continue where you left off.", "auth.registerHint": "Your account and documents stay on this device.", "auth.name": "Your name", "auth.namePlaceholder": "For example: Lin",
  "auth.email": "Email", "auth.password": "Password", "auth.passwordPlaceholder": "At least 6 characters", "auth.login": "Sign in", "auth.create": "Create account", "auth.or": "or",
  "auth.localUse": "Local use only", "auth.noAccount": "No account yet?", "auth.hasAccount": "Already have an account?", "auth.freeRegister": "Register", "auth.backLogin": "Back to sign in",
  "auth.loginFailed": "Sign-in failed", "auth.localFailed": "Could not open the local account",
  "settings.kicker": "AI configuration", "settings.title": "API and Prompt", "settings.subtitle": "Supports compatible cloud APIs and Ollama. Desktop secrets are encrypted by the operating system.",
  "settings.loading": "Loading settings…", "settings.provider": "API provider", "settings.model": "Model", "settings.apiUrl": "API URL", "settings.apiKey": "API key",
  "settings.savedKey": "Saved {mask} (leave blank to keep it)", "settings.enterKey": "Enter API key", "settings.removeKey": "Remove saved API key", "settings.systemPrompt": "System prompt",
  "settings.promptPlaceholder": "Define the AI role, answer style, and constraints…", "settings.webSearch": "Web search", "settings.webSearchHint": "Search current sources and show citations with the answer (Tavily)",
  "settings.searchKey": "Search API key", "settings.enterSearchKey": "Enter Tavily API key", "settings.searchBudget": "Search budget", "settings.freeBudget": "Free-tier protection (max 1 search per answer)",
  "settings.qualityBudget": "Quality first (max 3 searches per answer)", "settings.removeSearchKey": "Remove saved search key", "settings.python": "Precise Python calculations",
  "settings.pythonHint": "Run numerical calculations in a local Pyodide/WASM sandbox", "settings.reliability": "Full reliability checks", "settings.reliabilityHint": "Multiple sources, originals, citations, units, uncertainty, tests, and high-risk review",
  "settings.check.1": "Multi-source cross-check", "settings.check.2": "Original page retrieval", "settings.check.3": "Citation structure audit", "settings.check.4": "Unit and dimension checks",
  "settings.check.5": "Uncertainty calculation", "settings.check.6": "Symbolic mathematics", "settings.check.7": "Code execution and testing", "settings.check.8": "Structured data analysis",
  "settings.check.9": "Source conflict detection", "settings.check.10": "Freshness checks", "settings.check.11": "Prompt-injection isolation", "settings.check.12": "High-risk evidence threshold",
  "settings.memoryTitle": "How Tip memory works", "settings.memoryText": "Each Tip keeps a separate full chat. With memory enabled, only summaries from other Tips in the same document are shared.",
  "settings.test": "Test connection", "settings.save": "Save settings", "settings.saved": "Settings saved. New answers will use this configuration.", "settings.loadFailed": "Could not load settings", "settings.failed": "Operation failed",
  "feedback.title": "Suggestion box", "feedback.hint": "Suggestions are sent to the developer through a secure email relay. Documents, Tip chats, API keys, and prompts are never attached.", "feedback.category": "Category",
  "feedback.feature": "Feature request", "feedback.accuracy": "Answer accuracy", "feedback.bug": "Bug report", "feedback.usability": "Usability", "feedback.other": "Other",
  "feedback.placeholder": "Describe what should change, what happened, and what you expected…", "feedback.submit": "Send suggestion", "feedback.sending": "Sending…", "feedback.sent": "Suggestion sent. Thank you for the feedback.",
  "feedback.failed": "Could not send suggestion", "feedback.length": "{count} / 4000", "feedback.privacy": "Nothing is submitted until you click send. The recipient address is not shown in the app.",
  "nav.new": "New document", "nav.import": "Import", "nav.workspace": "Workspace", "nav.all": "All documents", "nav.favorites": "Favorites", "nav.recent": "Recent",
  "nav.manage": "Manage", "nav.folders": "Folders", "nav.trash": "Trash", "nav.settings": "Settings", "nav.logout": "Sign out",
  "library.space": "Your knowledge space", "library.description": "Turn reading, understanding, and questions into a connected body of knowledge you can revisit.", "library.trashDescription": "Deleted documents stay here until you remove them permanently.",
  "library.search": "Search titles…", "library.sort": "Sort", "library.updated": "Recently updated", "library.created": "Recently created", "library.name": "Document name", "library.tips": "Tip count",
  "library.loading": "Organizing your documents…", "library.noMatch": "No matching documents", "library.emptyTrash": "Trash is empty", "library.start": "Start with your first document",
  "library.shorter": "Try a shorter keyword.", "library.emptyHint": "Create a blank document or import TXT, Markdown, or DOCX.", "library.blank": "Blank document",
  "library.unfavorite": "Remove from favorites", "library.favorite": "Favorite", "library.restore": "Restore", "library.permanentDelete": "Delete permanently", "library.moveTrash": "Move to trash",
  "library.count": "{count} documents", "library.localSaved": "Content is stored safely on this device", "library.loadFailed": "Loading failed", "library.createFailed": "Could not create document", "library.importFailed": "Import failed", "library.operationFailed": "Operation failed",
  "library.deleteConfirm": "This permanently deletes the document and all Tip conversations. Continue?",
  "time.now": "just now", "time.minutes": "{count} min ago", "time.hours": "{count} hr ago",
  "editor.library": "Library", "editor.outline": "Outline", "editor.untitledHeading": "Untitled heading", "editor.documentTips": "Document Tips", "editor.untitled": "Untitled document",
  "editor.personalNote": "Personal note", "editor.imported": "Imported {type}", "editor.lastEdited": "Last edited {time}", "editor.addParagraph": "Add paragraph", "editor.heading": "Heading", "editor.code": "Code", "editor.quote": "Quote",
  "editor.opening": "Opening document…", "editor.openFailed": "Could not open document", "editor.loadFailed": "Document loading failed", "editor.createTipFailed": "Could not create Tip",
  "editor.operationFailed": "Operation failed", "editor.generateFailed": "Generation failed", "editor.deleteFailed": "Deletion failed", "editor.settings": "AI settings",
  "save.saving": "Saving", "save.failed": "Save failed", "save.offline": "Offline editing", "save.saved": "Saved",
  "selection.createTip": "Create Tip", "selection.highlight": "Highlight",
  "tip.independent": "AI TIP · Separate chat", "tip.parentConversation": "Parent chat · Current context", "tip.focusConversation": "Focus this conversation", "tip.selected": "Selected text", "tip.selectedChat": "Selected chat text", "tip.anchorValid": "Located in source", "tip.anchorRecovered": "Position recovered", "tip.anchorLost": "Source position lost",
  "tip.memoryOn": "Memory on", "tip.memoryOff": "Memory off", "tip.memoryHint": "Shares summaries only, never full chats", "tip.start": "Start from this passage",
  "tip.welcome": "This Tip has its own chat. Enable memory to reference summaries from other Tips in this document.", "tip.simple": "Simple explanation", "tip.detailed": "Detailed explanation", "tip.professional": "Expert explanation", "tip.example": "Give an example",
  "tip.followup": "Ask a follow-up…", "tip.sendHint": "Enter to send · Shift + Enter for a new line", "tip.stop": "Stop", "tip.resolved": "Reopen", "tip.resolve": "Mark resolved", "tip.deleteConfirm": "Delete this Tip, its chat, and every child Tip?", "tip.sourceMessageMissing": "The source chat message is no longer available. Select it again.",
  "tip.treeButton": "Tip tree", "tip.treeKicker": "Conversation map", "tip.treeTitle": "Tip tree", "tip.treeHint": "Select a node to navigate. Edit its name and press Enter or move focus to save.", "tip.treeDocument": "Source document", "tip.treeLocate": "Go to this conversation", "tip.treeName": "Conversation name",
  "tip.open": "Open Tip: {title}", "tip.collapse": "Collapse Tip", "tip.checkingTools": "Checking tool results…", "app.entering": "Opening AI Tip…"
};

const dictionaries: Record<Language, Record<string, string>> = { "zh-CN": zh, en };

export function normalizeLanguage(value: unknown): Language {
  return value === "en" ? "en" : "zh-CN";
}

export function translate(language: Language, key: string, variables: Record<string, string | number> = {}) {
  const template = dictionaries[language][key] ?? dictionaries["zh-CN"][key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_match, name) => String(variables[name] ?? `{${name}}`));
}

export function readStoredLanguage(): Language {
  if (typeof localStorage === "undefined") return "zh-CN";
  return normalizeLanguage(localStorage.getItem(LANGUAGE_STORAGE_KEY));
}

export function storeLanguage(language: Language) {
  if (typeof localStorage !== "undefined") localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
}
