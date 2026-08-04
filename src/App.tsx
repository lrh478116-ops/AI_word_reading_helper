import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArchiveRestore, ArrowLeft, BookOpen, Brain, Calculator, Check, CheckCircle2, ChevronDown, ChevronLeft,
  CircleHelp, Clock3, Cloud, CloudOff, Copy, FileCode2, FileText, Folder, Heart, Highlighter,
  Globe2, Library, LoaderCircle, Menu, MessageCircleMore, MoreHorizontal, PanelLeftClose,
  PanelRightClose, Plus, RefreshCw, Search, Send, Settings, ShieldCheck, Sparkles, Square, Star, Trash2,
  Upload, WandSparkles, X, Zap
} from "lucide-react";
import { api, session } from "./api";
import type { AiSettings, AiSettingsInput, ApiProvider, BlockType, DocumentBlock, DocumentItem, SelectionInfo, SkillTrace, TipThread, User } from "./types";

type Screen = { type: "library"; tab: "all" | "favorites" | "trash" } | { type: "editor"; id: string };
type SaveState = "saved" | "saving" | "error" | "offline";

function timeAgo(value: string) {
  const minutes = Math.floor((Date.now() - new Date(value).getTime()) / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前`;
  return new Date(value).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

function iconForSource(source: DocumentItem["sourceType"]) {
  if (source === "markdown") return <FileCode2 size={21} />;
  return <FileText size={21} />;
}

function AuthScreen({ onAuth }: { onAuth: (user: User) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true); setError("");
    try {
      const result = mode === "login" ? await api.login(email, password) : await api.register(name, email, password);
      session.set(result.token); onAuth(result.user);
    } catch (err) { setError(err instanceof Error ? err.message : "登录失败"); }
    finally { setLoading(false); }
  };

  const demo = async () => {
    setLoading(true); setError("");
    try {
      const result = await api.login("demo@aitip.local", "demo1234");
      session.set(result.token); onAuth(result.user);
    } catch (err) { setError(err instanceof Error ? err.message : "无法进入演示"); }
    finally { setLoading(false); }
  };

  return (
    <main className="auth-shell">
      <section className="auth-story">
        <div className="brand brand-light"><span className="brand-mark"><Sparkles size={18} /></span>AI Tip</div>
        <div className="auth-copy">
          <div className="eyebrow"><span /> 为深度阅读而生</div>
          <h1>让每一次疑问，<br />都留在知识发生的地方。</h1>
          <p>选中一段文字，就地开启一场独立的 AI 对话。理解、追问、折叠，再回来时思路仍然完整。</p>
          <div className="feature-preview">
            <div className="preview-page">
              <div className="preview-lines"><i /><i /><i /><i /></div>
              <div className="preview-select">自注意力机制允许序列中的每个 Token…</div>
              <div className="preview-tip"><Sparkles size={14} /> 这里的“聚合”是什么意思？</div>
            </div>
          </div>
        </div>
        <p className="auth-foot">阅读不是浏览，而是和知识建立连接。</p>
      </section>
      <section className="auth-panel">
        <form className="auth-card" onSubmit={submit}>
          <div className="mobile-brand brand"><span className="brand-mark"><Sparkles size={18} /></span>AI Tip</div>
          <div>
            <p className="overline">{mode === "login" ? "欢迎回来" : "开始使用"}</p>
            <h2>{mode === "login" ? "继续你的阅读旅程" : "创建你的知识空间"}</h2>
            <p className="muted">{mode === "login" ? "登录后继续上次未完的思考。" : "注册后会自动创建一篇引导文档。"}</p>
          </div>
          {mode === "register" && <label>你的名字<input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：林同学" /></label>}
          <label>邮箱地址<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" /></label>
          <label>密码<input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="至少 6 位" /></label>
          {error && <div className="form-error"><CircleHelp size={16} />{error}</div>}
          <button className="primary auth-submit" disabled={loading}>{loading ? <LoaderCircle className="spin" size={18} /> : null}{mode === "login" ? "登录" : "创建账户"}</button>
          <div className="divider"><span>或</span></div>
          <button type="button" className="secondary demo-button" onClick={demo} disabled={loading}><Zap size={17} />直接进入演示</button>
          <p className="auth-switch">{mode === "login" ? "还没有账户？" : "已经有账户？"}<button type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>{mode === "login" ? "免费注册" : "返回登录"}</button></p>
        </form>
      </section>
    </main>
  );
}

const providerOptions: Array<{ value: ApiProvider; label: string; baseURL: string; model: string }> = [
  { value: "openai", label: "OpenAI", baseURL: "https://api.openai.com/v1", model: "gpt-5-mini" },
  { value: "deepseek", label: "DeepSeek", baseURL: "https://api.deepseek.com", model: "deepseek-chat" },
  { value: "siliconflow", label: "硅基流动", baseURL: "https://api.siliconflow.cn/v1", model: "deepseek-ai/DeepSeek-V3" },
  { value: "moonshot", label: "Moonshot", baseURL: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" },
  { value: "zhipu", label: "智谱 AI", baseURL: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash" },
  { value: "gemini", label: "Google Gemini（兼容接口）", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.5-flash" },
  { value: "ollama", label: "Ollama 本地模型", baseURL: "http://127.0.0.1:11434/v1", model: "qwen3:8b" },
  { value: "custom", label: "OpenAI 兼容接口", baseURL: "", model: "" }
];

function SettingsModal({ onClose }: { onClose: () => void }) {
  const [saved, setSaved] = useState<AiSettings | null>(null);
  const [draft, setDraft] = useState<AiSettingsInput>({ provider: "openai", baseURL: "", model: "", systemPrompt: "", webSearchEnabled: false, searchBudgetMode: "free", pythonEnabled: true, reliabilityEnabled: true });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"save" | "test" | "">("");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    api.settings().then(({ settings }) => {
      setSaved(settings);
      setDraft({ provider: settings.provider, baseURL: settings.baseURL, model: settings.model, systemPrompt: settings.systemPrompt, webSearchEnabled: settings.webSearchEnabled, searchBudgetMode: settings.searchBudgetMode, pythonEnabled: settings.pythonEnabled, reliabilityEnabled: settings.reliabilityEnabled });
    }).catch((error) => setMessage({ kind: "error", text: error instanceof Error ? error.message : "设置加载失败" }))
      .finally(() => setLoading(false));
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const changeProvider = (provider: ApiProvider) => {
    const preset = providerOptions.find((item) => item.value === provider)!;
    setDraft((current) => ({ ...current, provider, baseURL: preset.baseURL, model: preset.model }));
  };
  const run = async (action: "save" | "test") => {
    setBusy(action); setMessage(null);
    try {
      if (action === "test") {
        const result = await api.testSettings(draft);
        setMessage({ kind: "ok", text: result.message });
      } else {
        const result = await api.updateSettings(draft);
        setSaved(result.settings);
        setDraft((current) => ({ ...current, apiKey: "", clearApiKey: false, searchApiKey: "", clearSearchApiKey: false }));
        setMessage({ kind: "ok", text: "设置已保存，之后的新回答会使用此配置。" });
      }
    } catch (error) { setMessage({ kind: "error", text: error instanceof Error ? error.message : "操作失败" }); }
    finally { setBusy(""); }
  };

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header><div><span className="settings-kicker"><Settings size={13} />AI 配置</span><h2 id="settings-title">接口与 Prompt</h2><p>支持云端兼容接口与 Ollama；桌面版密钥由系统安全存储加密。</p></div><button className="icon-button" onClick={onClose} aria-label="关闭设置"><X size={18} /></button></header>
      {loading ? <div className="settings-loading"><LoaderCircle className="spin" size={20} />正在读取配置…</div> : <div className="settings-body">
        <div className="settings-grid">
          <label>API 服务商<select value={draft.provider} onChange={(event) => changeProvider(event.target.value as ApiProvider)}>{providerOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label>模型名称<input value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} placeholder="例如 gpt-5-mini" /></label>
        </div>
        <label>API 地址<input value={draft.baseURL} onChange={(event) => setDraft({ ...draft, baseURL: event.target.value })} placeholder="https://api.example.com/v1" /></label>
        <label>API Key<input type="password" value={draft.apiKey || ""} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value, clearApiKey: false })} placeholder={saved?.apiKeyConfigured ? `已保存 ${saved.apiKeyMasked}（留空保持不变）` : "请输入 API Key"} /></label>
        {saved?.apiKeyConfigured && <label className="clear-key"><input type="checkbox" checked={Boolean(draft.clearApiKey)} onChange={(event) => setDraft({ ...draft, clearApiKey: event.target.checked, apiKey: event.target.checked ? "" : draft.apiKey })} />删除已保存的 API Key</label>}
        <label>系统 Prompt<textarea rows={8} value={draft.systemPrompt} onChange={(event) => setDraft({ ...draft, systemPrompt: event.target.value })} placeholder="定义 AI 的角色、回答风格与约束…" /><small>{draft.systemPrompt.length} / 12000</small></label>
        <div className="skill-settings">
          <div className="skill-setting-row"><span className="skill-setting-icon"><Globe2 size={17} /></span><div><strong>联网搜索</strong><small>搜索最新资料并把来源随回答展示（Tavily）</small></div><button className={`toggle ${draft.webSearchEnabled ? "on" : ""}`} onClick={() => setDraft({ ...draft, webSearchEnabled: !draft.webSearchEnabled })} aria-pressed={draft.webSearchEnabled}><i /></button></div>
          {draft.webSearchEnabled && <label>搜索 API Key<input type="password" value={draft.searchApiKey || ""} onChange={(event) => setDraft({ ...draft, searchApiKey: event.target.value, clearSearchApiKey: false })} placeholder={saved?.searchApiKeyConfigured ? `已保存 ${saved.searchApiKeyMasked}（留空保持不变）` : "请输入 Tavily API Key"} /></label>}
          {draft.webSearchEnabled && <label>搜索额度策略<select value={draft.searchBudgetMode} onChange={(event) => setDraft({ ...draft, searchBudgetMode: event.target.value as "free" | "quality" })}><option value="free">免费额度保护（每条回答最多 1 次）</option><option value="quality">质量优先（每条回答最多 3 次）</option></select></label>}
          {draft.webSearchEnabled && saved?.searchApiKeyConfigured && <label className="clear-key"><input type="checkbox" checked={Boolean(draft.clearSearchApiKey)} onChange={(event) => setDraft({ ...draft, clearSearchApiKey: event.target.checked, searchApiKey: event.target.checked ? "" : draft.searchApiKey })} />删除已保存的搜索 Key</label>}
          <div className="skill-setting-row"><span className="skill-setting-icon"><Calculator size={17} /></span><div><strong>Python 精确计算</strong><small>通过本地 Pyodide/WASM 沙箱执行数值计算</small></div><button className={`toggle ${draft.pythonEnabled ? "on" : ""}`} onClick={() => setDraft({ ...draft, pythonEnabled: !draft.pythonEnabled })} aria-pressed={draft.pythonEnabled}><i /></button></div>
          <div className="skill-setting-row"><span className="skill-setting-icon"><ShieldCheck size={17} /></span><div><strong>完整可靠性检查</strong><small>多源、原文、引用、量纲、误差、测试与高风险复核</small></div><button className={`toggle ${draft.reliabilityEnabled ? "on" : ""}`} onClick={() => setDraft({ ...draft, reliabilityEnabled: !draft.reliabilityEnabled })} aria-pressed={draft.reliabilityEnabled}><i /></button></div>
          {draft.reliabilityEnabled && <div className="reliability-list">{["多来源交叉验证", "原始网页读取", "引用结构审计", "单位与量纲检查", "不确定性计算", "符号数学", "代码执行与测试", "结构化数据分析", "来源冲突检测", "时效性检查", "Prompt 注入隔离", "高风险证据门槛"].map((item) => <span key={item}><Check size={10} />{item}</span>)}</div>}
        </div>
        <div className="settings-note"><Brain size={16} /><span><strong>Tip 记忆如何工作</strong>每个 Tip 的完整聊天仍然隔离；打开“记忆”时，只会读取同一文档其他 Tip 的摘要，不会混入原始对话。</span></div>
        {message && <div className={`settings-message ${message.kind}`}>{message.kind === "ok" ? <CheckCircle2 size={16} /> : <CircleHelp size={16} />}{message.text}</div>}
      </div>}
      <footer><button className="secondary" onClick={() => void run("test")} disabled={loading || Boolean(busy)}>{busy === "test" ? <LoaderCircle className="spin" size={16} /> : <Zap size={16} />}测试连接</button><button className="primary" onClick={() => void run("save")} disabled={loading || Boolean(busy)}>{busy === "save" ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}保存设置</button></footer>
    </section>
  </div>;
}

interface NavProps {
  user: User; tab: "all" | "favorites" | "trash"; counts: { all: number; favorite: number; trash: number };
  onTab: (tab: "all" | "favorites" | "trash") => void; onNew: () => void; onUpload: () => void; onLogout: () => void; onSettings: () => void;
}

function AppNav({ user, tab, counts, onTab, onNew, onUpload, onLogout, onSettings }: NavProps) {
  return (
    <aside className="app-nav">
      <div className="brand"><span className="brand-mark"><Sparkles size={17} /></span>AI Tip</div>
      <div className="nav-actions">
        <button className="new-button" onClick={onNew}><Plus size={17} />新建文档</button>
        <button className="icon-button upload-mini" onClick={onUpload} title="导入文档"><Upload size={17} /></button>
      </div>
      <nav>
        <p className="nav-label">工作空间</p>
        <button className={tab === "all" ? "active" : ""} onClick={() => onTab("all")}><Library size={18} />全部文档<span>{counts.all}</span></button>
        <button className={tab === "favorites" ? "active" : ""} onClick={() => onTab("favorites")}><Star size={18} />收藏<span>{counts.favorite}</span></button>
        <button><Clock3 size={18} />最近打开</button>
        <p className="nav-label second">管理</p>
        <button><Folder size={18} />文件夹<Plus size={14} className="nav-add" /></button>
        <button className={tab === "trash" ? "active" : ""} onClick={() => onTab("trash")}><Trash2 size={18} />回收站<span>{counts.trash}</span></button>
      </nav>
      <div className="nav-bottom">
        <button onClick={onSettings}><Settings size={18} />设置</button>
        <div className="user-row">
          <div className="avatar">{user.name.slice(0, 1)}</div>
          <div><strong>{user.name}</strong><span>{user.email}</span></div>
          <button className="more" onClick={onLogout} title="退出登录"><MoreHorizontal size={17} /></button>
        </div>
      </div>
    </aside>
  );
}

interface LibraryProps { user: User; screen: Extract<Screen, { type: "library" }>; onScreen: (screen: Screen) => void; onLogout: () => void; onSettings: () => void; }

function LibraryScreen({ user, screen, onScreen, onLogout, onSettings }: LibraryProps) {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [trash, setTrash] = useState<DocumentItem[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("updated");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [active, deleted] = await Promise.all([api.documents("active"), api.documents("deleted")]);
      setDocuments(active.documents); setTrash(deleted.documents);
    } catch (err) { setError(err instanceof Error ? err.message : "加载失败"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    try { const { document } = await api.createDocument(); onScreen({ type: "editor", id: document.id }); }
    catch (err) { setError(err instanceof Error ? err.message : "创建失败"); }
  };
  const upload = async (file?: File) => {
    if (!file) return;
    setLoading(true);
    try { const { document } = await api.upload(file); onScreen({ type: "editor", id: document.id }); }
    catch (err) { setError(err instanceof Error ? err.message : "导入失败"); setLoading(false); }
  };
  const patch = async (document: DocumentItem, change: Partial<DocumentItem>) => {
    try { await api.updateDocument(document.id, change); await load(); } catch (err) { setError(err instanceof Error ? err.message : "操作失败"); }
  };
  const remove = async (document: DocumentItem, permanent = false) => {
    if (permanent && !window.confirm("永久删除后，文档与全部 Tip 对话将无法恢复。确认删除？")) return;
    try { await api.deleteDocument(document.id, permanent); await load(); } catch (err) { setError(err instanceof Error ? err.message : "删除失败"); }
  };

  const base = screen.tab === "trash" ? trash : screen.tab === "favorites" ? documents.filter((d) => d.favorite) : documents;
  const filtered = base.filter((item) => item.title.toLowerCase().includes(query.toLowerCase())).sort((a, b) => {
    if (sort === "name") return a.title.localeCompare(b.title, "zh-CN");
    if (sort === "created") return b.createdAt.localeCompare(a.createdAt);
    if (sort === "tips") return b.tipCount - a.tipCount;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
  const title = screen.tab === "favorites" ? "收藏" : screen.tab === "trash" ? "回收站" : "全部文档";

  return (
    <div className="app-layout">
      <input ref={fileRef} type="file" accept=".txt,.md,.markdown,.docx" hidden onChange={(e) => void upload(e.target.files?.[0])} />
      <AppNav user={user} tab={screen.tab} counts={{ all: documents.length, favorite: documents.filter((d) => d.favorite).length, trash: trash.length }} onTab={(tab) => onScreen({ type: "library", tab })} onNew={() => void create()} onUpload={() => fileRef.current?.click()} onLogout={onLogout} onSettings={onSettings} />
      <main className="library-main">
        <header className="library-header">
          <div><p className="overline">你的知识空间</p><h1>{title}</h1><p>{screen.tab === "trash" ? "已删除的文档会保留在这里，直到你永久清除。" : "把阅读、理解和追问，整理成可随时返回的知识脉络。"}</p></div>
          <div className="header-actions"><button className="secondary" onClick={() => fileRef.current?.click()}><Upload size={17} />导入文档</button><button className="primary" onClick={() => void create()}><Plus size={17} />新建文档</button></div>
        </header>
        <section className="library-toolbar">
          <div className="search-box"><Search size={18} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索标题…" />{query && <button onClick={() => setQuery("")}><X size={15} /></button>}</div>
          <div className="sort-select"><span>排序</span><select value={sort} onChange={(e) => setSort(e.target.value)}><option value="updated">最近修改</option><option value="created">最近创建</option><option value="name">文档名称</option><option value="tips">Tip 数量</option></select><ChevronDown size={15} /></div>
        </section>
        {error && <div className="page-error"><CircleHelp size={17} />{error}<button onClick={() => void load()}>重试</button></div>}
        {loading ? <div className="loading-state"><LoaderCircle className="spin" /><span>正在整理你的文档…</span></div> : filtered.length === 0 ? (
          <div className="empty-state"><div><BookOpen size={28} /></div><h2>{query ? "没有匹配的文档" : screen.tab === "trash" ? "回收站是空的" : "从第一篇文档开始"}</h2><p>{query ? "试试更短的关键词。" : "新建空白文档，或导入 TXT、Markdown、DOCX。"}</p>{screen.tab !== "trash" && !query && <button className="primary" onClick={() => void create()}><Plus size={17} />新建文档</button>}</div>
        ) : (
          <section className="document-grid">
            {filtered.map((document) => (
              <article className="document-card" key={document.id} onClick={() => screen.tab !== "trash" && onScreen({ type: "editor", id: document.id })}>
                <div className={`file-icon source-${document.sourceType}`}>{iconForSource(document.sourceType)}</div>
                <button className={`favorite-button ${document.favorite ? "active" : ""}`} title={document.favorite ? "取消收藏" : "收藏"} onClick={(e) => { e.stopPropagation(); void patch(document, { favorite: !document.favorite }); }}><Heart size={17} fill={document.favorite ? "currentColor" : "none"} /></button>
                <div className="doc-copy"><h3>{document.title}</h3><p>{document.blocks.find((b) => b.content.trim())?.content.slice(0, 88) || "空白文档"}</p></div>
                <div className="doc-meta"><span><MessageCircleMore size={14} />{document.tipCount} Tips</span><span>{timeAgo(document.updatedAt)}</span></div>
                <div className="card-actions" onClick={(e) => e.stopPropagation()}>
                  {screen.tab === "trash" ? <><button onClick={() => void patch(document, { status: "active" })}><ArchiveRestore size={15} />恢复</button><button className="danger-text" onClick={() => void remove(document, true)}><Trash2 size={15} />永久删除</button></> : <button onClick={() => void remove(document)}><Trash2 size={15} />移到回收站</button>}
                </div>
              </article>
            ))}
          </section>
        )}
        <footer className="library-foot"><span>{filtered.length} 篇文档</span><span><Cloud size={14} />内容已安全保存在本地服务端</span></footer>
      </main>
    </div>
  );
}

function offsetWithin(root: Node, node: Node, offset: number) {
  const range = document.createRange();
  range.selectNodeContents(root); range.setEnd(node, offset);
  return range.toString().length;
}

function rectForOffsets(root: HTMLElement, start: number, end: number) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let cursor = 0;
  let startNode: Text | null = null; let endNode: Text | null = null;
  let startInNode = 0; let endInNode = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const next = cursor + node.data.length;
    if (!startNode && start >= cursor && start <= next) { startNode = node; startInNode = start - cursor; }
    if (end >= cursor && end <= next) { endNode = node; endInNode = end - cursor; break; }
    cursor = next;
  }
  if (!startNode || !endNode) return null;
  const range = document.createRange();
  range.setStart(startNode, Math.min(startInNode, startNode.length));
  range.setEnd(endNode, Math.min(endInNode, endNode.length));
  const rects = range.getClientRects();
  return rects.length ? rects[0] : range.getBoundingClientRect();
}

function EditableBlock({ item, tips, onChange, onSelection, onOpenTip }: { item: DocumentBlock; tips: TipThread[]; onChange: (id: string, value: string) => void; onSelection: (selection: SelectionInfo) => void; onOpenTip: (tip: TipThread) => void }) {
  const ref = useRef<HTMLElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const [markerPositions, setMarkerPositions] = useState<Record<string, { left: number; top: number }>>({});
  useEffect(() => { if (ref.current && document.activeElement !== ref.current && ref.current.innerText !== item.content) ref.current.innerText = item.content; }, [item.content]);
  useLayoutEffect(() => {
    const measure = () => {
      const root = ref.current; const row = rowRef.current;
      if (!root || !row) return;
      const rowRect = row.getBoundingClientRect();
      const next: Record<string, { left: number; top: number }> = {};
      tips.forEach((tip, index) => {
        const rect = rectForOffsets(root, tip.startOffset, tip.endOffset);
        next[tip.id] = rect
          ? { left: Math.min(rowRect.width - 22, Math.max(4, rect.right - rowRect.left + 5)), top: Math.max(-7, rect.top - rowRect.top - 9 + index * 3) }
          : { left: rowRect.width - 22, top: index * 24 };
      });
      setMarkerPositions(next);
    };
    measure(); window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [item.content, tips]);
  const select = () => {
    const selection = window.getSelection();
    const root = ref.current;
    if (!selection || selection.isCollapsed || !root || !selection.anchorNode || !selection.focusNode || !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return;
    const rawText = selection.toString();
    const text = rawText.trim();
    if (!text) return;
    const rawStart = Math.min(offsetWithin(root, selection.anchorNode, selection.anchorOffset), offsetWithin(root, selection.focusNode, selection.focusOffset));
    const leadingWhitespace = rawText.length - rawText.trimStart().length;
    const start = rawStart + leadingWhitespace;
    const end = start + text.length;
    onSelection({ blockId: item.id, text, startOffset: start, endOffset: end, rect: selection.getRangeAt(0).getBoundingClientRect() });
  };
  const Tag = item.type === "heading" ? (item.level === 1 ? "h1" : item.level === 3 ? "h3" : "h2") : item.type === "code" ? "pre" : item.type === "quote" ? "blockquote" : "p";
  return (
    <div ref={rowRef} className={`block-row block-${item.type}`} data-block-row={item.id}>
      {item.type === "list_item" && <span className="list-bullet">•</span>}
      <Tag ref={ref as never} data-block-id={item.id} contentEditable suppressContentEditableWarning spellCheck onInput={(e) => onChange(item.id, e.currentTarget.innerText)} onMouseUp={select} onKeyUp={select}>{item.content}</Tag>
      {tips.length > 0 && <div className="tip-marker-layer">{tips.map((tip) => <button key={tip.id} style={markerPositions[tip.id]} className={`tip-marker ${tip.status === "resolved" ? "resolved" : ""} ${tip.anchorStatus === "orphaned" ? "orphaned" : ""}`} onClick={() => onOpenTip(tip)} title={`打开 Tip：${tip.summary || tip.title}`}><Sparkles size={10} /><span>TIP</span>{tip.messages.length > 0 && <small>{tip.messages.length}</small>}</button>)}</div>}
    </div>
  );
}

function SelectionToolbar({ selection, onCreate, onClose }: { selection: SelectionInfo; onCreate: () => void; onClose: () => void }) {
  const left = Math.max(14, Math.min(window.innerWidth - 310, selection.rect.left + selection.rect.width / 2 - 145));
  const top = Math.max(10, selection.rect.top - 52);
  return <div className="selection-toolbar" style={{ left, top }}>
    <button onClick={onCreate}><WandSparkles size={15} />创建 Tip</button><span />
    <button title="高亮"><Highlighter size={15} /></button><button title="复制" onClick={() => void navigator.clipboard.writeText(selection.text)}><Copy size={15} /></button><button onClick={onClose}><X size={15} /></button>
  </div>;
}

function renderMessage(text: string) {
  return text.split("\n").map((line, index) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    return <span key={index}>{parts.map((part, i) => part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part)}{index < text.split("\n").length - 1 && <br />}</span>;
  });
}

function SkillResults({ skills }: { skills?: SkillTrace[] }) {
  if (!skills?.length) return null;
  return <div className="skill-results">{skills.map((skill, index) => <div className={`skill-result ${skill.name} ${skill.status || "success"}`} key={`${skill.name}-${index}`}>
    <span>{["web_search", "web_fetch", "cross_check", "conflict_check", "freshness_check"].includes(skill.name) ? <Globe2 size={12} /> : ["python", "unit_check", "uncertainty", "symbolic_math", "data_analysis"].includes(skill.name) ? <Calculator size={12} /> : <ShieldCheck size={12} />}{skill.label}</span><small>{skill.detail}</small>
    {skill.sources?.length ? <div className="skill-sources">{skill.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title}</a>)}</div> : null}
  </div>)}</div>;
}

interface TipPanelProps { tip: TipThread; streamingText: string; streamingSkills: SkillTrace[]; isStreaming: boolean; error: string; onSend: (question: string) => void; onStop: () => void; onCollapse: () => void; onResolve: () => void; onDelete: () => void; onToggleMemory: () => void; }
function TipPanel({ tip, streamingText, streamingSkills, isStreaming, error, onSend, onStop, onCollapse, onResolve, onDelete, onToggleMemory }: TipPanelProps) {
  const [question, setQuestion] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [tip.messages.length, streamingText]);
  const submit = () => { if (!question.trim() || isStreaming) return; onSend(question.trim()); setQuestion(""); };
  return (
    <aside className="tip-panel">
      <header className="tip-head"><div><span className="tip-kicker"><Sparkles size={13} />AI TIP · 独立对话</span><h2>{tip.title}</h2></div><button className="icon-button" onClick={onCollapse} title="折叠 Tip"><PanelRightClose size={18} /></button></header>
      <div className="selected-quote"><p>选中的原文</p><blockquote>{tip.selectedText}</blockquote><div className="tip-context-controls"><span className={`anchor-badge ${tip.anchorStatus}`}>{tip.anchorStatus === "valid" ? "已定位原文" : tip.anchorStatus === "recovered" ? "已自动恢复位置" : "原文位置已失效"}</span><button className={tip.memoryEnabled === false ? "" : "active"} onClick={onToggleMemory} title="仅共享其他 Tip 的摘要，不共享完整聊天"><Brain size={12} />记忆 {tip.memoryEnabled === false ? "关" : "开"}</button></div></div>
      <div className="message-list">
        {tip.messages.length === 0 && !streamingText && <div className="tip-welcome"><div><WandSparkles size={20} /></div><h3>从这段原文开始</h3><p>当前 Tip 保持独立聊天；开启记忆时可参考本文其他 Tip 的摘要。</p><div className="tip-prompts"><button onClick={() => onSend("请用通俗的语言解释这段内容")}>通俗解释</button><button onClick={() => onSend("请详细解释这段内容，逐步拆解概念、机制、前提和因果关系，并给出例子")}>详细解释</button><button onClick={() => onSend("请以专业研究者的视角解释这段内容，使用准确术语、形式化表述，并说明边界条件与相关理论")}>专业解释</button><button onClick={() => onSend("请给一个具体例子帮助我理解")}>举个例子</button></div></div>}
        {tip.messages.map((message) => <div className={`message ${message.role}`} key={message.id}>{message.role === "assistant" && <span className="assistant-mark"><Sparkles size={13} /></span>}<div>{message.role === "assistant" && <SkillResults skills={message.skills} />}{renderMessage(message.content)}{message.role === "assistant" && <button className="copy-message" onClick={() => void navigator.clipboard.writeText(message.content)}><Copy size={13} />复制</button>}</div></div>)}
        {isStreaming && <div className="message assistant"><span className="assistant-mark"><Sparkles size={13} /></span><div><SkillResults skills={streamingSkills} />{streamingText ? renderMessage(streamingText) : streamingSkills.length ? <span className="tool-thinking">正在核对工具结果…</span> : <span className="thinking"><i /><i /><i /></span>}<span className="cursor" /></div></div>}
        {error && <div className="chat-error"><CircleHelp size={15} />{error}</div>}
        <div ref={endRef} />
      </div>
      <div className="tip-composer">
        <textarea value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }} placeholder="继续追问…" rows={3} />
        <div><span>Enter 发送 · Shift + Enter 换行</span>{isStreaming ? <button className="stop-button" onClick={onStop}><Square size={13} fill="currentColor" />停止</button> : <button className="send-button" disabled={!question.trim()} onClick={submit}><Send size={15} /></button>}</div>
      </div>
      <footer className="tip-actions"><button onClick={onResolve}><CheckCircle2 size={15} />{tip.status === "resolved" ? "重新打开" : "标记已解决"}</button><button className="danger-text" onClick={onDelete}><Trash2 size={15} />删除</button></footer>
    </aside>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "saving") return <span className="save-state"><LoaderCircle className="spin" size={14} />正在保存</span>;
  if (state === "error") return <span className="save-state error"><CloudOff size={14} />保存失败</span>;
  if (state === "offline") return <span className="save-state error"><CloudOff size={14} />离线编辑</span>;
  return <span className="save-state"><Check size={14} />已保存</span>;
}

interface EditorProps { id: string; onBack: () => void; onSettings: () => void; }
function EditorScreen({ id, onBack, onSettings }: EditorProps) {
  const [documentItem, setDocumentItem] = useState<DocumentItem | null>(null);
  const [tips, setTips] = useState<TipThread[]>([]);
  const [activeTipId, setActiveTipId] = useState<string | null>(null);
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [error, setError] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [streamingSkills, setStreamingSkills] = useState<SkillTrace[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [chatError, setChatError] = useState("");
  const [navOpen, setNavOpen] = useState(true);
  const [outlineOpen, setOutlineOpen] = useState(true);
  const dirty = useRef(false);
  const controller = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    try { const result = await api.document(id); setDocumentItem(result.document); setTips(result.tips); }
    catch (err) { setError(err instanceof Error ? err.message : "文档加载失败"); }
  }, [id]);
  useEffect(() => { void load(); return () => controller.current?.abort(); }, [load]);

  useEffect(() => {
    if (!dirty.current || !documentItem) return;
    setSaveState(navigator.onLine ? "saving" : "offline");
    const timer = window.setTimeout(async () => {
      try { await api.updateDocument(documentItem.id, { title: documentItem.title, blocks: documentItem.blocks }); dirty.current = false; setSaveState("saved"); }
      catch { setSaveState(navigator.onLine ? "error" : "offline"); }
    }, 900);
    return () => window.clearTimeout(timer);
  }, [documentItem]);

  useEffect(() => {
    const online = () => { if (dirty.current) setSaveState("saving"); };
    const offline = () => setSaveState("offline");
    window.addEventListener("online", online); window.addEventListener("offline", offline);
    return () => { window.removeEventListener("online", online); window.removeEventListener("offline", offline); };
  }, []);

  const updateBlock = (blockId: string, content: string) => {
    setDocumentItem((current) => current ? { ...current, blocks: current.blocks.map((b) => b.id === blockId ? { ...b, content, updatedAt: new Date().toISOString() } : b) } : current);
    dirty.current = true;
  };
  const updateTitle = (title: string) => { setDocumentItem((current) => current ? { ...current, title } : current); dirty.current = true; };
  const manualSave = async () => {
    if (!documentItem) return;
    setSaveState("saving");
    try { await api.updateDocument(documentItem.id, { title: documentItem.title, blocks: documentItem.blocks }); dirty.current = false; setSaveState("saved"); }
    catch { setSaveState("error"); }
  };
  const addBlock = (type: BlockType) => {
    if (!documentItem) return;
    const stamp = new Date().toISOString();
    const newBlock: DocumentBlock = { id: crypto.randomUUID(), documentId: documentItem.id, type, content: "", level: type === "heading" ? 2 : undefined, order: documentItem.blocks.length, contentHash: "", createdAt: stamp, updatedAt: stamp };
    setDocumentItem({ ...documentItem, blocks: [...documentItem.blocks, newBlock] }); dirty.current = true;
  };
  const createTip = async () => {
    if (!selection || !documentItem) return;
    const target = documentItem.blocks.find((b) => b.id === selection.blockId);
    if (!target) return;
    try {
      const { tip } = await api.createTip(documentItem.id, { blockId: selection.blockId, selectedText: selection.text, startOffset: selection.startOffset, endOffset: selection.endOffset, prefixText: target.content.slice(Math.max(0, selection.startOffset - 32), selection.startOffset), suffixText: target.content.slice(selection.endOffset, selection.endOffset + 32) });
      setTips((current) => [...current, tip]); setActiveTipId(tip.id); setSelection(null); window.getSelection()?.removeAllRanges();
    } catch (err) { setError(err instanceof Error ? err.message : "创建 Tip 失败"); }
  };
  const patchTip = async (tipId: string, patch: Partial<TipThread>) => {
    try { const { tip } = await api.updateTip(tipId, patch); setTips((current) => current.map((t) => t.id === tipId ? tip : t)); return tip; }
    catch (err) { setChatError(err instanceof Error ? err.message : "操作失败"); }
  };
  const openTip = (tip: TipThread) => { setActiveTipId(tip.id); setChatError(""); if (tip.status === "collapsed") void patchTip(tip.id, { status: "open" }); };
  const send = async (question: string) => {
    if (!activeTipId || isStreaming) return;
    setIsStreaming(true); setStreamingText(""); setStreamingSkills([]); setChatError("");
    const ctrl = new AbortController(); controller.current = ctrl;
    setTips((current) => current.map((tip) => tip.id === activeTipId ? { ...tip, messages: [...tip.messages, { id: `temp-${Date.now()}`, tipId: tip.id, role: "user", content: question, createdAt: new Date().toISOString() }] } : tip));
    try {
      const finalTip = await api.streamTip(activeTipId, question, ctrl.signal, (chunk) => setStreamingText((text) => text + chunk), (skill) => setStreamingSkills((current) => [...current, skill]));
      setTips((current) => current.map((tip) => tip.id === activeTipId ? finalTip : tip)); setStreamingText(""); setStreamingSkills([]);
    } catch (err) {
      if ((err as Error).name !== "AbortError") setChatError(err instanceof Error ? err.message : "生成失败");
      await load();
    } finally { setIsStreaming(false); controller.current = null; }
  };
  const deleteTip = async (tipId: string) => {
    if (!window.confirm("删除这个 Tip 及其全部对话？")) return;
    try { await api.deleteTip(tipId); setTips((current) => current.filter((t) => t.id !== tipId)); setActiveTipId(null); }
    catch (err) { setChatError(err instanceof Error ? err.message : "删除失败"); }
  };

  const activeTip = tips.find((tip) => tip.id === activeTipId) || null;
  const tipsByBlock = useMemo(() => tips.reduce<Record<string, TipThread[]>>((acc, tip) => { (acc[tip.blockId] ||= []).push(tip); return acc; }, {}), [tips]);
  const outline = documentItem?.blocks.filter((b) => b.type === "heading") || [];

  if (error && !documentItem) return <div className="fatal-state"><CircleHelp size={30} /><h2>无法打开文档</h2><p>{error}</p><button className="secondary" onClick={onBack}><ArrowLeft size={16} />返回文档库</button></div>;
  if (!documentItem) return <div className="loading-state fullscreen"><LoaderCircle className="spin" /><span>正在打开文档…</span></div>;
  return (
    <div className={`editor-shell ${activeTip ? "with-tip" : ""} ${!navOpen ? "nav-hidden" : ""}`}>
      {navOpen && <aside className="editor-nav">
        <div className="editor-nav-top"><button className="back-button" onClick={onBack}><ChevronLeft size={17} />文档库</button><button className="icon-button" onClick={() => setNavOpen(false)}><PanelLeftClose size={17} /></button></div>
        <div className="mini-brand"><span className="brand-mark"><Sparkles size={14} /></span>AI Tip</div>
        <button className="outline-toggle" onClick={() => setOutlineOpen(!outlineOpen)}><span>本文目录</span><ChevronDown size={15} className={outlineOpen ? "" : "rotated"} /></button>
        {outlineOpen && <nav className="outline">{outline.map((item) => <button key={item.id} className={`level-${item.level || 2}`} onClick={() => document.querySelector(`[data-block-row="${item.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" })}>{item.content || "未命名标题"}</button>)}</nav>}
        <div className="tip-summary"><p><MessageCircleMore size={15} />本文 Tips <span>{tips.length}</span></p>{tips.slice(0, 5).map((tip) => <button key={tip.id} onClick={() => openTip(tip)}><i className={tip.status} /> <span>{tip.title}</span><small>{tip.messages.length}</small></button>)}</div>
      </aside>}
      <main className="editor-main">
        <header className="editor-topbar">
          <div>{!navOpen && <button className="icon-button" onClick={() => setNavOpen(true)}><Menu size={18} /></button>}<div className="doc-breadcrumb"><FileText size={16} /><span>{documentItem.title || "无标题文档"}</span></div></div>
          <div className="editor-controls"><SaveIndicator state={saveState} /><button className="secondary compact" onClick={() => void manualSave()}><Cloud size={15} />保存</button><button className={`icon-button ${documentItem.favorite ? "starred" : ""}`} onClick={async () => { const favorite = !documentItem.favorite; setDocumentItem({ ...documentItem, favorite }); await api.updateDocument(documentItem.id, { favorite }); }}><Star size={17} fill={documentItem.favorite ? "currentColor" : "none"} /></button><button className="icon-button" onClick={onSettings} title="AI 设置"><Settings size={18} /></button></div>
        </header>
        <div className="editor-scroll" onScroll={() => setSelection(null)}>
          <article className="document-page">
            <div className="page-meta"><span>{documentItem.sourceType === "blank" ? "个人笔记" : `${documentItem.sourceType.toUpperCase()} 导入`}</span><span>上次编辑于 {timeAgo(documentItem.updatedAt)}</span></div>
            <input className="document-title" value={documentItem.title} onChange={(e) => updateTitle(e.target.value)} placeholder="无标题文档" />
            <div className="document-rule" />
            <div className="blocks">
              {documentItem.blocks.map((item) => <EditableBlock key={item.id} item={item} tips={tipsByBlock[item.id] || []} onChange={updateBlock} onSelection={setSelection} onOpenTip={openTip} />)}
            </div>
            <div className="add-block-row"><button onClick={() => addBlock("paragraph")}><Plus size={15} />添加段落</button><button onClick={() => addBlock("heading")}>标题</button><button onClick={() => addBlock("code")}>代码</button><button onClick={() => addBlock("quote")}>引用</button></div>
          </article>
        </div>
      </main>
      {selection && <SelectionToolbar selection={selection} onCreate={() => void createTip()} onClose={() => setSelection(null)} />}
      {activeTip && <TipPanel tip={activeTip} streamingText={streamingText} streamingSkills={streamingSkills} isStreaming={isStreaming} error={chatError} onSend={(q) => void send(q)} onStop={() => controller.current?.abort()} onCollapse={() => { void patchTip(activeTip.id, { status: "collapsed" }); setActiveTipId(null); }} onResolve={() => void patchTip(activeTip.id, { status: activeTip.status === "resolved" ? "open" : "resolved" })} onDelete={() => void deleteTip(activeTip.id)} onToggleMemory={() => void patchTip(activeTip.id, { memoryEnabled: activeTip.memoryEnabled === false })} />}
      {!activeTip && tips.some((tip) => tip.status === "collapsed") && <button className="floating-tip-count" onClick={() => openTip(tips.find((tip) => tip.status === "collapsed")!)}><Sparkles size={16} /><span>{tips.filter((tip) => tip.status === "collapsed").length}</span></button>}
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(Boolean(session.get()));
  const [screen, setScreen] = useState<Screen>({ type: "library", tab: "all" });
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => {
    if (!session.get()) return;
    api.me().then(({ user: current }) => setUser(current)).catch(() => session.clear()).finally(() => setChecking(false));
  }, []);
  if (checking) return <div className="loading-state fullscreen"><LoaderCircle className="spin" /><span>正在进入 AI Tip…</span></div>;
  if (!user) return <AuthScreen onAuth={setUser} />;
  return <>{screen.type === "editor"
    ? <EditorScreen id={screen.id} onBack={() => setScreen({ type: "library", tab: "all" })} onSettings={() => setSettingsOpen(true)} />
    : <LibraryScreen user={user} screen={screen} onScreen={setScreen} onLogout={() => { session.clear(); setUser(null); }} onSettings={() => setSettingsOpen(true)} />}
    {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
  </>;
}
