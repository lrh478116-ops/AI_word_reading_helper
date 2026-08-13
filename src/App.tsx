import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArchiveRestore, ArrowLeft, BookOpen, Brain, Calculator, Check, CheckCircle2, ChevronDown, ChevronLeft,
  CircleHelp, Clock3, Cloud, CloudOff, Copy, FileCode2, FileText, Folder, Heart, Highlighter,
  GitBranch, Globe2, Languages, Library, LoaderCircle, LogOut, Menu, MessageCircleMore, PanelLeftClose,
  PanelRightClose, Plus, RefreshCw, Search, Send, Settings, ShieldCheck, Sparkles, Square, Star, Trash2,
  Upload, WandSparkles, X, Zap
} from "lucide-react";
import { api, session } from "./api";
import { normalizeLanguage, readStoredLanguage, storeLanguage, translate, type Language } from "./i18n";
import { resolveSystemPrompt } from "./prompts";
import { PdfPreview } from "./PdfPreview";
import { PROVIDER_REGISTRY, PROVIDER_REGISTRY_VERIFIED_AT, providerDefinition } from "./providers";
import type { AiSettings, AiSettingsInput, ApiProvider, BlockType, ChatSelectionInfo, DocumentBlock, DocumentItem, SelectionInfo, SkillTrace, TipMessage, TipThread, User } from "./types";
import { buildTipForest, plainMessageContent, visibleTipLayout, type TipTreeNode } from "./tip-tree";

type Screen = { type: "library"; tab: "all" | "favorites" | "trash" } | { type: "editor"; id: string };
type SaveState = "saved" | "saving" | "error" | "offline";
type Translate = (key: string, variables?: Record<string, string | number>) => string;

const I18nContext = createContext<{ language: Language; setLanguage: (language: Language) => void; t: Translate }>({ language: "zh-CN", setLanguage: () => {}, t: (key) => key });
const useI18n = () => useContext(I18nContext);

function LanguageSelect({ className = "" }: { className?: string }) {
  const { language, setLanguage, t } = useI18n();
  return <label className={`language-select ${className}`}><Languages size={15} /><span>{t("language.label")}</span><select value={language} onChange={(event) => setLanguage(normalizeLanguage(event.target.value))}><option value="zh-CN">{t("language.zh")}</option><option value="en">{t("language.en")}</option></select></label>;
}

function timeAgo(value: string, language: Language, t: Translate) {
  const minutes = Math.floor((Date.now() - new Date(value).getTime()) / 60_000);
  if (minutes < 1) return t("time.now");
  if (minutes < 60) return t("time.minutes", { count: minutes });
  if (minutes < 1440) return t("time.hours", { count: Math.floor(minutes / 60) });
  return new Date(value).toLocaleDateString(language, { month: "short", day: "numeric" });
}

function iconForSource(source: DocumentItem["sourceType"]) {
  if (source === "markdown") return <FileCode2 size={21} />;
  return <FileText size={21} />;
}

function AuthScreen({ onAuth }: { onAuth: (user: User) => void }) {
  const { t } = useI18n();
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
    } catch (err) { setError(err instanceof Error ? err.message : t("auth.loginFailed")); }
    finally { setLoading(false); }
  };

  const demo = async () => {
    setLoading(true); setError("");
    try {
      const result = await api.login("demo@aitip.local", "demo1234");
      session.set(result.token); onAuth(result.user);
    } catch (err) { setError(err instanceof Error ? err.message : t("auth.localFailed")); }
    finally { setLoading(false); }
  };

  return (
    <main className="auth-shell">
      <section className="auth-story">
        <div className="brand brand-light"><span className="brand-mark"><Sparkles size={18} /></span>AI Tip</div>
        <div className="auth-copy">
          <div className="eyebrow"><span /> {t("auth.eyebrow")}</div>
          <h1>{t("auth.hero1")}<br />{t("auth.hero2")}</h1>
          <p>{t("auth.description")}</p>
          <div className="feature-preview">
            <div className="preview-page">
              <div className="preview-lines"><i /><i /><i /><i /></div>
              <div className="preview-select">{t("auth.previewSelection")}</div>
              <div className="preview-tip"><Sparkles size={14} /> {t("auth.previewQuestion")}</div>
            </div>
          </div>
        </div>
        <p className="auth-foot">{t("auth.footer")}</p>
      </section>
      <section className="auth-panel">
        <form className="auth-card" onSubmit={submit}>
          <div className="mobile-brand brand"><span className="brand-mark"><Sparkles size={18} /></span>AI Tip</div>
          <div>
            <p className="overline">{mode === "login" ? t("auth.welcome") : t("auth.start")}</p>
            <h2>{mode === "login" ? t("auth.loginTitle") : t("auth.registerTitle")}</h2>
            <p className="muted">{mode === "login" ? t("auth.loginHint") : t("auth.registerHint")}</p>
          </div>
          <LanguageSelect className="auth-language" />
          {mode === "register" && <label>{t("auth.name")}<input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("auth.namePlaceholder")} /></label>}
          <label>{t("auth.email")}<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" /></label>
          <label>{t("auth.password")}<input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("auth.passwordPlaceholder")} /></label>
          {error && <div className="form-error"><CircleHelp size={16} />{error}</div>}
          <button className="primary auth-submit" disabled={loading}>{loading ? <LoaderCircle className="spin" size={18} /> : null}{mode === "login" ? t("auth.login") : t("auth.create")}</button>
          <div className="divider"><span>{t("auth.or")}</span></div>
          <button type="button" className="secondary demo-button" onClick={demo} disabled={loading}><Zap size={17} />{t("auth.localUse")}</button>
          <p className="auth-switch">{mode === "login" ? t("auth.noAccount") : t("auth.hasAccount")}<button type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>{mode === "login" ? t("auth.freeRegister") : t("auth.backLogin")}</button></p>
        </form>
      </section>
    </main>
  );
}

function SettingsModal({ onClose }: { onClose: () => void }) {
  const { language, t } = useI18n();
  const languageRef = useRef(language);
  const [saved, setSaved] = useState<AiSettings | null>(null);
  const [draft, setDraft] = useState<AiSettingsInput>({ provider: "openai", baseURL: "", model: "", systemPrompt: "", webSearchEnabled: false, searchBudgetMode: "free", pythonEnabled: true, reliabilityEnabled: true });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"save" | "test" | "">("");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [feedbackCategory, setFeedbackCategory] = useState<"feature" | "accuracy" | "bug" | "usability" | "other">("feature");
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelsBusy, setModelsBusy] = useState(false);
  const providerOptions = Object.values(PROVIDER_REGISTRY);

  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    api.settings().then(({ settings }) => {
      setSaved(settings);
      setDraft({ provider: settings.provider, baseURL: settings.baseURL, model: settings.model, systemPrompt: resolveSystemPrompt(settings.systemPrompt, languageRef.current), webSearchEnabled: settings.webSearchEnabled, searchBudgetMode: settings.searchBudgetMode, pythonEnabled: settings.pythonEnabled, reliabilityEnabled: settings.reliabilityEnabled });
    }).catch((error) => setMessage({ kind: "error", text: error instanceof Error ? error.message : t("settings.loadFailed") }))
      .finally(() => setLoading(false));
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  useEffect(() => {
    setDraft((current) => ({ ...current, systemPrompt: resolveSystemPrompt(current.systemPrompt, language) }));
  }, [language]);

  const changeProvider = (provider: ApiProvider) => {
    const preset = providerDefinition(provider);
    setAvailableModels([]);
    setDraft((current) => ({ ...current, provider, baseURL: preset.baseURL, model: preset.defaultModel }));
  };
  const run = async (action: "save" | "test") => {
    setBusy(action); setMessage(null);
    try {
      if (action === "test") {
        const result = await api.testSettings(draft, language);
        setMessage({ kind: "ok", text: result.message });
      } else {
        const result = await api.updateSettings(draft, language);
        setSaved(result.settings);
        setDraft((current) => ({ ...current, apiKey: "", clearApiKey: false, searchApiKey: "", clearSearchApiKey: false }));
        setMessage({ kind: "ok", text: t("settings.saved") });
      }
    } catch (error) { setMessage({ kind: "error", text: error instanceof Error ? error.message : t("settings.failed") }); }
    finally { setBusy(""); }
  };
  const refreshModels = async () => {
    setModelsBusy(true); setMessage(null);
    try {
      const result = await api.listModels(draft, language);
      setAvailableModels(result.models);
      setMessage({ kind: "ok", text: t("settings.modelsUpdated", { count: result.models.length }) });
    } catch (error) { setMessage({ kind: "error", text: error instanceof Error ? error.message : t("settings.failed") }); }
    finally { setModelsBusy(false); }
  };
  const submitFeedback = async () => {
    if (feedbackText.trim().length < 10 || feedbackBusy) return;
    setFeedbackBusy(true); setFeedbackMessage(null);
    try {
      await api.submitFeedback(feedbackCategory, feedbackText.trim());
      setFeedbackText("");
      setFeedbackMessage({ kind: "ok", text: t("feedback.sent") });
    } catch (error) {
      setFeedbackMessage({ kind: "error", text: error instanceof Error ? error.message : t("feedback.failed") });
    } finally { setFeedbackBusy(false); }
  };

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header><div><span className="settings-kicker"><Settings size={13} />{t("settings.kicker")}</span><h2 id="settings-title">{t("settings.title")}</h2><p>{t("settings.subtitle")}</p></div><button className="icon-button" onClick={onClose} aria-label={t("common.close")}><X size={18} /></button></header>
      {loading ? <div className="settings-loading"><LoaderCircle className="spin" size={20} />{t("settings.loading")}</div> : <div className="settings-body">
        <LanguageSelect />
        <div className="settings-grid">
          <label>{t("settings.provider")}<select value={draft.provider} onChange={(event) => changeProvider(event.target.value as ApiProvider)}>{providerOptions.map((item) => <option key={item.id} value={item.id}>{t(item.labelKey)}</option>)}</select></label>
          <label>{t("settings.model")}<input list="provider-models" value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} placeholder={providerDefinition(draft.provider).defaultModel} /><datalist id="provider-models">{availableModels.map((model) => <option key={model} value={model} />)}</datalist></label>
        </div>
        <div className="model-refresh-row"><button type="button" className="secondary compact" onClick={() => void refreshModels()} disabled={modelsBusy}>{modelsBusy ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}{modelsBusy ? t("settings.refreshingModels") : t("settings.refreshModels")}</button><small>{t("settings.modelsHint")} · {t("settings.registryDate", { date: PROVIDER_REGISTRY_VERIFIED_AT })}</small></div>
        <label>{t("settings.apiUrl")}<input value={draft.baseURL} onChange={(event) => setDraft({ ...draft, baseURL: event.target.value })} placeholder="https://api.example.com/v1" /></label>
        <label>{t("settings.apiKey")}<input type="password" value={draft.apiKey || ""} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value, clearApiKey: false })} placeholder={saved?.apiKeyConfigured ? t("settings.savedKey", { mask: saved.apiKeyMasked }) : t("settings.enterKey")} /></label>
        {saved?.apiKeyConfigured && <label className="clear-key"><input type="checkbox" checked={Boolean(draft.clearApiKey)} onChange={(event) => setDraft({ ...draft, clearApiKey: event.target.checked, apiKey: event.target.checked ? "" : draft.apiKey })} />{t("settings.removeKey")}</label>}
        <label>{t("settings.systemPrompt")}<textarea rows={8} value={draft.systemPrompt} onChange={(event) => setDraft({ ...draft, systemPrompt: event.target.value })} placeholder={t("settings.promptPlaceholder")} /><small>{draft.systemPrompt.length} / 12000</small></label>
        <div className="skill-settings">
          <div className="skill-setting-row"><span className="skill-setting-icon"><Globe2 size={17} /></span><div><strong>{t("settings.webSearch")}</strong><small>{t("settings.webSearchHint")}</small></div><button className={`toggle ${draft.webSearchEnabled ? "on" : ""}`} onClick={() => setDraft({ ...draft, webSearchEnabled: !draft.webSearchEnabled })} aria-pressed={draft.webSearchEnabled}><i /></button></div>
          {draft.webSearchEnabled && <label>{t("settings.searchKey")}<input type="password" value={draft.searchApiKey || ""} onChange={(event) => setDraft({ ...draft, searchApiKey: event.target.value, clearSearchApiKey: false })} placeholder={saved?.searchApiKeyConfigured ? t("settings.savedKey", { mask: saved.searchApiKeyMasked }) : t("settings.enterSearchKey")} /></label>}
          {draft.webSearchEnabled && <label>{t("settings.searchBudget")}<select value={draft.searchBudgetMode} onChange={(event) => setDraft({ ...draft, searchBudgetMode: event.target.value as "free" | "quality" })}><option value="free">{t("settings.freeBudget")}</option><option value="quality">{t("settings.qualityBudget")}</option></select></label>}
          {draft.webSearchEnabled && saved?.searchApiKeyConfigured && <label className="clear-key"><input type="checkbox" checked={Boolean(draft.clearSearchApiKey)} onChange={(event) => setDraft({ ...draft, clearSearchApiKey: event.target.checked, searchApiKey: event.target.checked ? "" : draft.searchApiKey })} />{t("settings.removeSearchKey")}</label>}
          <div className="skill-setting-row"><span className="skill-setting-icon"><Calculator size={17} /></span><div><strong>{t("settings.python")}</strong><small>{t("settings.pythonHint")}</small></div><button className={`toggle ${draft.pythonEnabled ? "on" : ""}`} onClick={() => setDraft({ ...draft, pythonEnabled: !draft.pythonEnabled })} aria-pressed={draft.pythonEnabled}><i /></button></div>
          <div className="skill-setting-row"><span className="skill-setting-icon"><ShieldCheck size={17} /></span><div><strong>{t("settings.reliability")}</strong><small>{t("settings.reliabilityHint")}</small></div><button className={`toggle ${draft.reliabilityEnabled ? "on" : ""}`} onClick={() => setDraft({ ...draft, reliabilityEnabled: !draft.reliabilityEnabled })} aria-pressed={draft.reliabilityEnabled}><i /></button></div>
          {draft.reliabilityEnabled && <div className="reliability-list">{Array.from({ length: 12 }, (_, index) => t(`settings.check.${index + 1}`)).map((item) => <span key={item}><Check size={10} />{item}</span>)}</div>}
        </div>
        <div className="settings-note"><Brain size={16} /><span><strong>{t("settings.memoryTitle")}</strong>{t("settings.memoryText")}</span></div>
        <section className="feedback-box" aria-labelledby="feedback-title">
          <header><span><MessageCircleMore size={16} /></span><div><h3 id="feedback-title">{t("feedback.title")}</h3><p>{t("feedback.hint")}</p></div></header>
          <label>{t("feedback.category")}<select value={feedbackCategory} onChange={(event) => setFeedbackCategory(event.target.value as typeof feedbackCategory)}><option value="feature">{t("feedback.feature")}</option><option value="accuracy">{t("feedback.accuracy")}</option><option value="bug">{t("feedback.bug")}</option><option value="usability">{t("feedback.usability")}</option><option value="other">{t("feedback.other")}</option></select></label>
          <label><textarea rows={5} maxLength={4000} value={feedbackText} onChange={(event) => { setFeedbackText(event.target.value); if (feedbackMessage?.kind === "error") setFeedbackMessage(null); }} placeholder={t("feedback.placeholder")} /><small>{t("feedback.length", { count: feedbackText.length })}</small></label>
          <div className="feedback-privacy"><ShieldCheck size={13} />{t("feedback.privacy")}</div>
          {feedbackMessage && <div className={`settings-message ${feedbackMessage.kind}`}>{feedbackMessage.kind === "ok" ? <CheckCircle2 size={16} /> : <CircleHelp size={16} />}{feedbackMessage.text}</div>}
          <button className="secondary feedback-submit" onClick={() => void submitFeedback()} disabled={feedbackBusy || feedbackText.trim().length < 10}>{feedbackBusy ? <LoaderCircle className="spin" size={15} /> : <Send size={15} />}{feedbackBusy ? t("feedback.sending") : t("feedback.submit")}</button>
        </section>
        {message && <div className={`settings-message ${message.kind}`}>{message.kind === "ok" ? <CheckCircle2 size={16} /> : <CircleHelp size={16} />}{message.text}</div>}
      </div>}
      <footer><button className="secondary" onClick={() => void run("test")} disabled={loading || Boolean(busy)}>{busy === "test" ? <LoaderCircle className="spin" size={16} /> : <Zap size={16} />}{t("settings.test")}</button><button className="primary" onClick={() => void run("save")} disabled={loading || Boolean(busy)}>{busy === "save" ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}{t("settings.save")}</button></footer>
    </section>
  </div>;
}

interface NavProps {
  user: User; tab: "all" | "favorites" | "trash"; counts: { all: number; favorite: number; trash: number };
  onTab: (tab: "all" | "favorites" | "trash") => void; onNew: () => void; onUpload: () => void; onLogout: () => void; onSettings: () => void;
}

function AppNav({ user, tab, counts, onTab, onNew, onUpload, onLogout, onSettings }: NavProps) {
  const { t } = useI18n();
  return (
    <aside className="app-nav">
      <div className="brand"><span className="brand-mark"><Sparkles size={17} /></span>AI Tip</div>
      <div className="nav-actions">
        <button className="new-button" onClick={onNew}><Plus size={17} />{t("nav.new")}</button>
        <button className="icon-button upload-mini" onClick={onUpload} title={t("nav.import")}><Upload size={17} /></button>
      </div>
      <nav>
        <p className="nav-label">{t("nav.workspace")}</p>
        <button className={tab === "all" ? "active" : ""} onClick={() => onTab("all")}><Library size={18} />{t("nav.all")}<span>{counts.all}</span></button>
        <button className={tab === "favorites" ? "active" : ""} onClick={() => onTab("favorites")}><Star size={18} />{t("nav.favorites")}<span>{counts.favorite}</span></button>
        <button><Clock3 size={18} />{t("nav.recent")}</button>
        <p className="nav-label second">{t("nav.manage")}</p>
        <button><Folder size={18} />{t("nav.folders")}<Plus size={14} className="nav-add" /></button>
        <button className={tab === "trash" ? "active" : ""} onClick={() => onTab("trash")}><Trash2 size={18} />{t("nav.trash")}<span>{counts.trash}</span></button>
      </nav>
      <div className="nav-bottom">
        <button onClick={onSettings}><Settings size={18} />{t("nav.settings")}</button>
        <div className="user-row">
          <div className="avatar">{user.name.slice(0, 1)}</div>
          <div><strong>{user.name}</strong><span>{user.email}</span></div>
          <button className="logout-button" onClick={onLogout} title={t("nav.logout")}><LogOut size={15} /><span>{t("nav.logout")}</span></button>
        </div>
      </div>
    </aside>
  );
}

interface LibraryProps { user: User; screen: Extract<Screen, { type: "library" }>; onScreen: (screen: Screen) => void; onLogout: () => void; onSettings: () => void; }

function LibraryScreen({ user, screen, onScreen, onLogout, onSettings }: LibraryProps) {
  const { language, t } = useI18n();
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
    } catch (err) { setError(err instanceof Error ? err.message : t("library.loadFailed")); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    try { const { document } = await api.createDocument(); onScreen({ type: "editor", id: document.id }); }
    catch (err) { setError(err instanceof Error ? err.message : t("library.createFailed")); }
  };
  const upload = async (file?: File) => {
    if (!file) return;
    setLoading(true);
    try { const { document } = await api.upload(file); onScreen({ type: "editor", id: document.id }); }
    catch (err) { setError(err instanceof Error ? err.message : t("library.importFailed")); setLoading(false); }
  };
  const patch = async (document: DocumentItem, change: Partial<DocumentItem>) => {
    try { await api.updateDocument(document.id, change); await load(); } catch (err) { setError(err instanceof Error ? err.message : t("library.operationFailed")); }
  };
  const remove = async (document: DocumentItem, permanent = false) => {
    if (permanent && !window.confirm(t("library.deleteConfirm"))) return;
    try { await api.deleteDocument(document.id, permanent); await load(); } catch (err) { setError(err instanceof Error ? err.message : t("library.operationFailed")); }
  };

  const base = screen.tab === "trash" ? trash : screen.tab === "favorites" ? documents.filter((d) => d.favorite) : documents;
  const filtered = base.filter((item) => item.title.toLowerCase().includes(query.toLowerCase())).sort((a, b) => {
    if (sort === "name") return a.title.localeCompare(b.title, language);
    if (sort === "created") return b.createdAt.localeCompare(a.createdAt);
    if (sort === "tips") return b.tipCount - a.tipCount;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
  const title = screen.tab === "favorites" ? t("nav.favorites") : screen.tab === "trash" ? t("nav.trash") : t("nav.all");

  return (
    <div className="app-layout">
      <input ref={fileRef} type="file" accept=".txt,.md,.markdown,.docx,.pdf,application/pdf" hidden onChange={(e) => void upload(e.target.files?.[0])} />
      <AppNav user={user} tab={screen.tab} counts={{ all: documents.length, favorite: documents.filter((d) => d.favorite).length, trash: trash.length }} onTab={(tab) => onScreen({ type: "library", tab })} onNew={() => void create()} onUpload={() => fileRef.current?.click()} onLogout={onLogout} onSettings={onSettings} />
      <main className="library-main">
        <header className="library-header">
          <div><p className="overline">{t("library.space")}</p><h1>{title}</h1><p>{screen.tab === "trash" ? t("library.trashDescription") : t("library.description")}</p></div>
          <div className="header-actions"><button className="secondary" onClick={() => fileRef.current?.click()}><Upload size={17} />{t("nav.import")}</button><button className="primary" onClick={() => void create()}><Plus size={17} />{t("nav.new")}</button></div>
        </header>
        <section className="library-toolbar">
          <div className="search-box"><Search size={18} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("library.search")} />{query && <button onClick={() => setQuery("")}><X size={15} /></button>}</div>
          <div className="sort-select"><span>{t("library.sort")}</span><select value={sort} onChange={(e) => setSort(e.target.value)}><option value="updated">{t("library.updated")}</option><option value="created">{t("library.created")}</option><option value="name">{t("library.name")}</option><option value="tips">{t("library.tips")}</option></select><ChevronDown size={15} /></div>
        </section>
        {error && <div className="page-error"><CircleHelp size={17} />{error}<button onClick={() => void load()}>{t("common.retry")}</button></div>}
        {loading ? <div className="loading-state"><LoaderCircle className="spin" /><span>{t("library.loading")}</span></div> : filtered.length === 0 ? (
          <div className="empty-state"><div><BookOpen size={28} /></div><h2>{query ? t("library.noMatch") : screen.tab === "trash" ? t("library.emptyTrash") : t("library.start")}</h2><p>{query ? t("library.shorter") : t("library.emptyHint")}</p>{screen.tab !== "trash" && !query && <button className="primary" onClick={() => void create()}><Plus size={17} />{t("nav.new")}</button>}</div>
        ) : (
          <section className="document-grid">
            {filtered.map((document) => (
              <article className="document-card" key={document.id} onClick={() => screen.tab !== "trash" && onScreen({ type: "editor", id: document.id })}>
                <div className={`file-icon source-${document.sourceType}`}>{iconForSource(document.sourceType)}</div>
                <button className={`favorite-button ${document.favorite ? "active" : ""}`} title={document.favorite ? t("library.unfavorite") : t("library.favorite")} onClick={(e) => { e.stopPropagation(); void patch(document, { favorite: !document.favorite }); }}><Heart size={17} fill={document.favorite ? "currentColor" : "none"} /></button>
                <div className="doc-copy"><h3>{document.title}</h3><p>{document.blocks.find((b) => b.content.trim())?.content.slice(0, 88) || t("library.blank")}</p></div>
                <div className="doc-meta"><span><MessageCircleMore size={14} />{document.tipCount} Tips</span><span>{timeAgo(document.updatedAt, language, t)}</span></div>
                <div className="card-actions" onClick={(e) => e.stopPropagation()}>
                  {screen.tab === "trash" ? <><button onClick={() => void patch(document, { status: "active" })}><ArchiveRestore size={15} />{t("library.restore")}</button><button className="danger-text" onClick={() => void remove(document, true)}><Trash2 size={15} />{t("library.permanentDelete")}</button></> : <button onClick={() => void remove(document)}><Trash2 size={15} />{t("library.moveTrash")}</button>}
                </div>
              </article>
            ))}
          </section>
        )}
        <footer className="library-foot"><span>{t("library.count", { count: filtered.length })}</span><span><Cloud size={14} />{t("library.localSaved")}</span></footer>
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
  const { t } = useI18n();
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
    onSelection({ source: "document", blockId: item.id, text, startOffset: start, endOffset: end, rect: selection.getRangeAt(0).getBoundingClientRect() });
  };
  const Tag = item.type === "heading" ? (item.level === 1 ? "h1" : item.level === 3 ? "h3" : "h2") : item.type === "code" ? "pre" : item.type === "quote" ? "blockquote" : "p";
  return (
    <div ref={rowRef} className={`block-row block-${item.type}`} data-block-row={item.id}>
      {item.type === "list_item" && <span className="list-bullet">•</span>}
      <Tag ref={ref as never} data-block-id={item.id} contentEditable suppressContentEditableWarning spellCheck onInput={(e) => onChange(item.id, e.currentTarget.innerText)} onMouseUp={select} onKeyUp={select}>{item.content}</Tag>
      {tips.length > 0 && <div className="tip-marker-layer">{tips.map((tip) => <button key={tip.id} style={markerPositions[tip.id]} className={`tip-marker ${tip.status === "resolved" ? "resolved" : ""} ${tip.anchorStatus === "orphaned" ? "orphaned" : ""}`} onClick={() => onOpenTip(tip)} title={t("tip.open", { title: tip.summary || tip.title })}><Sparkles size={10} /><span>TIP</span>{tip.messages.length > 0 && <small>{tip.messages.length}</small>}</button>)}</div>}
    </div>
  );
}

function SelectionToolbar({ selection, onCreate, onClose }: { selection: SelectionInfo | ChatSelectionInfo; onCreate: () => void; onClose: () => void }) {
  const { t } = useI18n();
  const left = Math.max(14, Math.min(window.innerWidth - 310, selection.rect.left + selection.rect.width / 2 - 145));
  const top = Math.max(10, selection.rect.top - 52);
  return <div className="selection-toolbar" style={{ left, top }}>
    <button onClick={onCreate}><WandSparkles size={15} />{t("selection.createTip")}</button><span />
    <button title={t("selection.highlight")}><Highlighter size={15} /></button><button title={t("common.copy")} onClick={() => void navigator.clipboard.writeText(selection.text)}><Copy size={15} /></button><button title={t("common.close")} onClick={onClose}><X size={15} /></button>
  </div>;
}

function messagePresentation(content: string) {
  const normalized = content.replace(/\r\n?/g, "\n");
  const bold: Array<{ start: number; end: number }> = []; let plain = ""; let cursor = 0;
  for (const match of normalized.matchAll(/\*\*([^*]+)\*\*/g)) {
    const index = match.index || 0; plain += normalized.slice(cursor, index);
    const start = plain.length; plain += match[1]; bold.push({ start, end: plain.length }); cursor = index + match[0].length;
  }
  plain += normalized.slice(cursor);
  return { plain, bold };
}

function renderMessageRange(content: string, start = 0, end?: number, keyPrefix = "message") {
  const presentation = messagePresentation(content); const limit = end ?? presentation.plain.length;
  const boundaries = new Set([start, limit]);
  for (const range of presentation.bold) { if (range.start > start && range.start < limit) boundaries.add(range.start); if (range.end > start && range.end < limit) boundaries.add(range.end); }
  const sorted = [...boundaries].sort((a, b) => a - b); const nodes: React.ReactNode[] = [];
  for (let index = 0; index < sorted.length - 1; index++) {
    const from = sorted[index]; const to = sorted[index + 1]; const value = presentation.plain.slice(from, to);
    const isBold = presentation.bold.some((range) => from >= range.start && to <= range.end);
    nodes.push(isBold ? <strong key={`${keyPrefix}-${from}`}>{value}</strong> : <span key={`${keyPrefix}-${from}`}>{value}</span>);
  }
  return nodes;
}

function renderMessage(text: string) {
  return renderMessageRange(text);
}

function MessageContent({ tip, message, childTips, onSelection, onOpenTip }: { tip: TipThread; message: TipMessage; childTips: TipThread[]; onSelection: (selection: ChatSelectionInfo) => void; onOpenTip: (tip: TipThread) => void }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const content = plainMessageContent(message.content);
  const anchored = childTips.filter((child) => child.anchorMessageId === message.id && child.anchorStatus !== "orphaned").sort((a, b) => a.startOffset - b.startOffset);
  const select = () => {
    const selection = window.getSelection(); const root = ref.current;
    if (!selection || selection.isCollapsed || !root || !selection.anchorNode || !selection.focusNode || !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return;
    const range = selection.getRangeAt(0);
    if (anchored.some((child) => {
      const marker = root.querySelector(`[data-chat-tip-anchor="${child.id}"]`);
      return marker ? range.intersectsNode(marker) : false;
    })) return;
    const rawText = selection.toString(); const text = rawText.trim();
    if (!text) return;
    const rawStart = Math.min(offsetWithin(root, selection.anchorNode, selection.anchorOffset), offsetWithin(root, selection.focusNode, selection.focusOffset));
    const start = rawStart + rawText.length - rawText.trimStart().length; const end = start + text.length;
    if (content.slice(start, end) !== text) return;
    onSelection({ source: "message", parentTipId: tip.id, messageId: message.id, text, startOffset: start, endOffset: end, rect: range.getBoundingClientRect() });
  };
  const pieces: React.ReactNode[] = []; let cursor = 0;
  for (const child of anchored) {
    if (child.startOffset < cursor || child.endOffset > content.length || content.slice(child.startOffset, child.endOffset) !== child.selectedText) continue;
    if (child.startOffset > cursor) pieces.push(<span key={`text-${cursor}`}>{renderMessageRange(message.content, cursor, child.startOffset, `text-${cursor}`)}</span>);
    pieces.push(<mark className="chat-tip-anchor" data-chat-tip-anchor={child.id} key={child.id}>{renderMessageRange(message.content, child.startOffset, child.endOffset, `anchor-${child.id}`)}<button onClick={(event) => { event.stopPropagation(); onOpenTip(child); }} title={t("tip.open", { title: child.title })}><Sparkles size={9} /><span className="sr-only">Tip</span></button></mark>);
    cursor = child.endOffset;
  }
  if (cursor < content.length) pieces.push(<span key={`text-${cursor}`}>{renderMessageRange(message.content, cursor, content.length, `text-${cursor}`)}</span>);
  return <div ref={ref} className="message-content" onMouseUp={select} onKeyUp={select}>{pieces}</div>;
}

function TipTreeVertex({ node, activeId, onNavigate, onRename }: { node: TipTreeNode; activeId: string | null; onNavigate: (tip: TipThread) => void; onRename: (tipId: string, title: string) => void }) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const save = (input: HTMLInputElement) => { const title = input.value.trim(); if (title && title !== node.tip.title) onRename(node.tip.id, title); else input.value = node.tip.title; };
  return <li><div className={`tip-tree-vertex ${node.tip.id === activeId ? "active" : ""}`} data-tip-tree-id={node.tip.id}><button className="tip-tree-locate" onClick={() => onNavigate(node.tip)} title={t("tip.treeLocate")}><MessageCircleMore size={13} /></button><input ref={inputRef} aria-label={t("tip.treeName")} defaultValue={node.tip.title} maxLength={80} onBlur={(event) => save(event.currentTarget)} onKeyDown={(event) => { if (event.key === "Enter") { save(event.currentTarget); event.currentTarget.blur(); } if (event.key === "Escape") { event.currentTarget.value = node.tip.title; event.currentTarget.blur(); } }} /><button className="tip-tree-save" onMouseDown={(event) => event.preventDefault()} onClick={() => { if (inputRef.current) save(inputRef.current); }} title={t("common.save")}><Check size={12} /></button><small>L{node.tip.depth}</small></div>{node.children.length > 0 && <ul>{node.children.map((child) => <TipTreeVertex key={child.tip.id} node={child} activeId={activeId} onNavigate={onNavigate} onRename={onRename} />)}</ul>}</li>;
}

function TipTreeDialog({ tips, activeId, onClose, onNavigate, onRename }: { tips: TipThread[]; activeId: string | null; onClose: () => void; onNavigate: (tip: TipThread) => void; onRename: (tipId: string, title: string) => void }) {
  const { t } = useI18n(); const forest = buildTipForest(tips);
  return <div className="modal-backdrop tip-tree-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="tip-tree-dialog" role="dialog" aria-modal="true" aria-labelledby="tip-tree-title"><header><div><span><GitBranch size={14} />{t("tip.treeKicker")}</span><h2 id="tip-tree-title">{t("tip.treeTitle")}</h2><p>{t("tip.treeHint")}</p></div><button className="icon-button" onClick={onClose}><X size={18} /></button></header><div className="tip-tree-scroll"><div className="tip-tree-document"><FileText size={14} />{t("tip.treeDocument")}</div><ul className="tip-tree-roots">{forest.map((node) => <TipTreeVertex key={node.tip.id} node={node} activeId={activeId} onNavigate={(tip) => { onNavigate(tip); onClose(); }} onRename={onRename} />)}</ul></div></section></div>;
}

function SkillResults({ skills }: { skills?: SkillTrace[] }) {
  if (!skills?.length) return null;
  return <div className="skill-results">{skills.map((skill, index) => <div className={`skill-result ${skill.name} ${skill.status || "success"}`} key={`${skill.name}-${index}`}>
    <span>{["web_search", "web_fetch", "cross_check", "conflict_check", "freshness_check"].includes(skill.name) ? <Globe2 size={12} /> : ["python", "unit_check", "uncertainty", "symbolic_math", "data_analysis"].includes(skill.name) ? <Calculator size={12} /> : <ShieldCheck size={12} />}{skill.label}</span><small>{skill.detail}</small>
    {skill.sources?.length ? <div className="skill-sources">{skill.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title}</a>)}</div> : null}
  </div>)}</div>;
}

interface TipPanelProps { tip: TipThread; childTips: TipThread[]; streamingText: string; streamingSkills: SkillTrace[]; isStreaming: boolean; error: string; contextMode?: boolean; onSend: (question: string) => void; onStop: () => void; onCollapse: () => void; onFocus?: () => void; onResolve: () => void; onDelete: () => void; onToggleMemory: () => void; onMessageSelection: (selection: ChatSelectionInfo) => void; onOpenTip: (tip: TipThread) => void; }
function TipPanel({ tip, childTips, streamingText, streamingSkills, isStreaming, error, contextMode = false, onSend, onStop, onCollapse, onFocus, onResolve, onDelete, onToggleMemory, onMessageSelection, onOpenTip }: TipPanelProps) {
  const { language, t } = useI18n();
  const [question, setQuestion] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [tip.messages.length, streamingText]);
  const submit = () => { if (!question.trim() || isStreaming) return; onSend(question.trim()); setQuestion(""); };
  const prompts = language === "en"
    ? [
      ["tip.simple", "Explain this passage in plain language."],
      ["tip.detailed", "Explain this passage in detail, breaking down its concepts, mechanisms, assumptions, and causal relationships step by step, with examples."],
      ["tip.professional", "Explain this passage from a professional researcher's perspective using precise terminology and formal descriptions, including boundary conditions and related theory."],
      ["tip.example", "Give me a concrete example to help me understand this passage."]
    ]
    : [
      ["tip.simple", "请用通俗的语言解释这段内容"],
      ["tip.detailed", "请详细解释这段内容，逐步拆解概念、机制、前提和因果关系，并给出例子"],
      ["tip.professional", "请以专业研究者的视角解释这段内容，使用准确术语、形式化表述，并说明边界条件与相关理论"],
      ["tip.example", "请给一个具体例子帮助我理解"]
    ];
  return (
    <aside className={`tip-panel ${contextMode ? "tip-panel-context" : ""}`} data-tip-panel={tip.id}>
      <header className="tip-head"><div><span className="tip-kicker"><Sparkles size={13} />{contextMode ? t("tip.parentConversation") : t("tip.independent")}</span><h2>{tip.title}</h2></div>{contextMode ? <button className="icon-button" onClick={onFocus} title={t("tip.focusConversation")}><ChevronLeft size={18} /></button> : <button className="icon-button" onClick={onCollapse} title={t("tip.collapse")}><PanelRightClose size={18} /></button>}</header>
      <div className="selected-quote"><p>{tip.anchorType === "message" ? t("tip.selectedChat") : t("tip.selected")}</p><blockquote>{tip.selectedText}</blockquote><div className="tip-context-controls"><span className={`anchor-badge ${tip.anchorStatus}`}>{tip.anchorStatus === "valid" ? t("tip.anchorValid") : tip.anchorStatus === "recovered" ? t("tip.anchorRecovered") : t("tip.anchorLost")}</span><button className={tip.memoryEnabled === false ? "" : "active"} onClick={onToggleMemory} title={t("tip.memoryHint")}><Brain size={12} />{tip.memoryEnabled === false ? t("tip.memoryOff") : t("tip.memoryOn")}</button></div></div>
      <div className="message-list">
        {tip.messages.length === 0 && !streamingText && <div className="tip-welcome"><div><WandSparkles size={20} /></div><h3>{t("tip.start")}</h3><p>{t("tip.welcome")}</p><div className="tip-prompts">{prompts.map(([key, prompt]) => <button key={key} onClick={() => onSend(prompt)}>{t(key)}</button>)}</div></div>}
        {tip.messages.map((message) => <div className={`message ${message.role}`} key={message.id} data-message-id={message.id}>{message.role === "assistant" && <span className="assistant-mark"><Sparkles size={13} /></span>}<div>{message.role === "assistant" && <SkillResults skills={message.skills} />}<MessageContent tip={tip} message={message} childTips={childTips} onSelection={onMessageSelection} onOpenTip={onOpenTip} />{message.role === "assistant" && <button className="copy-message" onClick={() => void navigator.clipboard.writeText(message.content)}><Copy size={13} />{t("common.copy")}</button>}</div></div>)}
        {isStreaming && <div className="message assistant"><span className="assistant-mark"><Sparkles size={13} /></span><div><SkillResults skills={streamingSkills} />{streamingText ? renderMessage(streamingText) : streamingSkills.length ? <span className="tool-thinking">{t("tip.checkingTools")}</span> : <span className="thinking"><i /><i /><i /></span>}<span className="cursor" /></div></div>}
        {error && <div className="chat-error"><CircleHelp size={15} />{error}</div>}
        <div ref={endRef} />
      </div>
      <div className="tip-composer">
        <textarea value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }} placeholder={t("tip.followup")} rows={3} />
        <div><span>{t("tip.sendHint")}</span>{isStreaming ? <button className="stop-button" onClick={onStop}><Square size={13} fill="currentColor" />{t("tip.stop")}</button> : <button className="send-button" disabled={!question.trim()} onClick={submit}><Send size={15} /></button>}</div>
      </div>
      {!contextMode && <footer className="tip-actions"><button onClick={onResolve}><CheckCircle2 size={15} />{tip.status === "resolved" ? t("tip.resolved") : t("tip.resolve")}</button><button className="danger-text" onClick={onDelete}><Trash2 size={15} />{t("common.delete")}</button></footer>}
    </aside>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  const { t } = useI18n();
  if (state === "saving") return <span className="save-state"><LoaderCircle className="spin" size={14} />{t("save.saving")}</span>;
  if (state === "error") return <span className="save-state error"><CloudOff size={14} />{t("save.failed")}</span>;
  if (state === "offline") return <span className="save-state error"><CloudOff size={14} />{t("save.offline")}</span>;
  return <span className="save-state"><Check size={14} />{t("save.saved")}</span>;
}

interface EditorProps { id: string; onBack: () => void; onSettings: () => void; }
function EditorScreen({ id, onBack, onSettings }: EditorProps) {
  const { language, t } = useI18n();
  const [documentItem, setDocumentItem] = useState<DocumentItem | null>(null);
  const [tips, setTips] = useState<TipThread[]>([]);
  const [activeTipId, setActiveTipId] = useState<string | null>(null);
  const [selection, setSelection] = useState<SelectionInfo | ChatSelectionInfo | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [error, setError] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [streamingSkills, setStreamingSkills] = useState<SkillTrace[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingTipId, setStreamingTipId] = useState<string | null>(null);
  const [chatError, setChatError] = useState("");
  const [chatErrorTipId, setChatErrorTipId] = useState<string | null>(null);
  const [treeOpen, setTreeOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(true);
  const [outlineOpen, setOutlineOpen] = useState(true);
  const dirty = useRef(false);
  const controller = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    try { const result = await api.document(id); setDocumentItem(result.document); setTips(result.tips); }
    catch (err) { setError(err instanceof Error ? err.message : t("editor.loadFailed")); }
  }, [id, t]);
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
    try {
      let tip: TipThread;
      if (selection.source === "document") {
        const target = documentItem.blocks.find((b) => b.id === selection.blockId);
        if (!target) return;
        ({ tip } = await api.createTip(documentItem.id, { blockId: selection.blockId, selectedText: selection.text, startOffset: selection.startOffset, endOffset: selection.endOffset, prefixText: target.content.slice(Math.max(0, selection.startOffset - 32), selection.startOffset), suffixText: target.content.slice(selection.endOffset, selection.endOffset + 32) }));
      } else {
        const parent = tips.find((item) => item.id === selection.parentTipId);
        const message = parent?.messages.find((item) => item.id === selection.messageId);
        if (!parent || !message) throw new Error(t("tip.sourceMessageMissing"));
        const content = plainMessageContent(message.content);
        ({ tip } = await api.createChildTip(parent.id, { messageId: message.id, selectedText: selection.text, startOffset: selection.startOffset, endOffset: selection.endOffset, prefixText: content.slice(Math.max(0, selection.startOffset - 32), selection.startOffset), suffixText: content.slice(selection.endOffset, selection.endOffset + 32) }));
      }
      setTips((current) => [...current, tip]); setActiveTipId(tip.id); setSelection(null); window.getSelection()?.removeAllRanges();
    } catch (err) { setError(err instanceof Error ? err.message : t("editor.createTipFailed")); }
  };
  const patchTip = async (tipId: string, patch: Partial<TipThread>) => {
    try { const { tip } = await api.updateTip(tipId, patch); setTips((current) => current.map((t) => t.id === tipId ? tip : t)); return tip; }
    catch (err) { setChatError(err instanceof Error ? err.message : t("editor.operationFailed")); }
  };
  const openTip = (tip: TipThread) => { if (isStreaming && streamingTipId !== tip.id) controller.current?.abort(); setActiveTipId(tip.id); setSelection(null); setChatError(""); setChatErrorTipId(null); if (tip.status === "collapsed") void patchTip(tip.id, { status: "open" }); };
  const send = async (tipId: string, question: string) => {
    if (isStreaming) return;
    setIsStreaming(true); setStreamingTipId(tipId); setStreamingText(""); setStreamingSkills([]); setChatError(""); setChatErrorTipId(null);
    const ctrl = new AbortController(); controller.current = ctrl;
    setTips((current) => current.map((tip) => tip.id === tipId ? { ...tip, messages: [...tip.messages, { id: `temp-${Date.now()}`, tipId: tip.id, role: "user", content: question, createdAt: new Date().toISOString() }] } : tip));
    try {
      const finalTip = await api.streamTip(tipId, question, language, ctrl.signal, (chunk) => setStreamingText((text) => text + chunk), (skill) => setStreamingSkills((current) => [...current, skill]));
      setTips((current) => current.map((tip) => tip.id === tipId ? finalTip : tip)); setStreamingText(""); setStreamingSkills([]);
    } catch (err) {
      if ((err as Error).name !== "AbortError") { setChatError(err instanceof Error ? err.message : t("editor.generateFailed")); setChatErrorTipId(tipId); }
      await load();
    } finally { setIsStreaming(false); setStreamingTipId(null); controller.current = null; }
  };
  const deleteTip = async (tipId: string) => {
    if (!window.confirm(t("tip.deleteConfirm"))) return;
    try {
      const deleting = tips.find((tip) => tip.id === tipId); const result = await api.deleteTip(tipId); const deleted = new Set(result.deletedIds);
      setTips((current) => current.filter((tip) => !deleted.has(tip.id)));
      setActiveTipId((current) => current && deleted.has(current) ? deleting?.parentTipId || null : current);
    }
    catch (err) { setChatError(err instanceof Error ? err.message : t("editor.deleteFailed")); }
  };

  const collapseTip = (tip: TipThread) => {
    if (streamingTipId === tip.id) controller.current?.abort();
    void patchTip(tip.id, { status: "collapsed" });
    setSelection(null); setActiveTipId(tip.parentTipId || null);
  };

  const activeTip = tips.find((tip) => tip.id === activeTipId) || null;
  const layout = visibleTipLayout(tips, activeTipId);
  const leftTip = layout.left.kind === "tip" ? tips.find((tip) => tip.id === layout.left.tipId) || null : null;
  const hasNestedTips = tips.some((tip) => Boolean(tip.parentTipId));
  const childrenOf = (tipId: string) => tips.filter((tip) => tip.parentTipId === tipId);
  const tipsByBlock = useMemo(() => tips.filter((tip) => tip.anchorType !== "message").reduce<Record<string, TipThread[]>>((acc, tip) => { (acc[tip.blockId] ||= []).push(tip); return acc; }, {}), [tips]);
  const outline = documentItem?.blocks.filter((b) => b.type === "heading") || [];

  if (error && !documentItem) return <div className="fatal-state"><CircleHelp size={30} /><h2>{t("editor.openFailed")}</h2><p>{error}</p><button className="secondary" onClick={onBack}><ArrowLeft size={16} />{t("editor.library")}</button></div>;
  if (!documentItem) return <div className="loading-state fullscreen"><LoaderCircle className="spin" /><span>{t("editor.opening")}</span></div>;
  const renderTipPanel = (tip: TipThread, contextMode = false) => <TipPanel
    key={`${contextMode ? "context" : "active"}-${tip.id}`} tip={tip} childTips={childrenOf(tip.id)} contextMode={contextMode}
    streamingText={streamingTipId === tip.id ? streamingText : ""} streamingSkills={streamingTipId === tip.id ? streamingSkills : []}
    isStreaming={isStreaming && streamingTipId === tip.id} error={chatErrorTipId === tip.id ? chatError : ""}
    onSend={(question) => void send(tip.id, question)} onStop={() => { if (streamingTipId === tip.id) controller.current?.abort(); }}
    onCollapse={() => collapseTip(tip)} onFocus={() => openTip(tip)}
    onResolve={() => void patchTip(tip.id, { status: tip.status === "resolved" ? "open" : "resolved" })}
    onDelete={() => void deleteTip(tip.id)} onToggleMemory={() => void patchTip(tip.id, { memoryEnabled: tip.memoryEnabled === false })}
    onMessageSelection={setSelection} onOpenTip={openTip}
  />;
  return (
    <div className={`editor-shell ${activeTip ? "with-tip" : ""} ${!navOpen ? "nav-hidden" : ""}`}>
      {navOpen && <aside className="editor-nav">
        <div className="editor-nav-top"><button className="back-button" onClick={onBack}><ChevronLeft size={17} />{t("editor.library")}</button><button className="icon-button" onClick={() => setNavOpen(false)}><PanelLeftClose size={17} /></button></div>
        <div className="mini-brand"><span className="brand-mark"><Sparkles size={14} /></span>AI Tip</div>
        <button className="outline-toggle" onClick={() => setOutlineOpen(!outlineOpen)}><span>{t("editor.outline")}</span><ChevronDown size={15} className={outlineOpen ? "" : "rotated"} /></button>
        {outlineOpen && <nav className="outline">{outline.map((item) => <button key={item.id} className={`level-${item.level || 2}`} onClick={() => document.querySelector(`[data-block-row="${item.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" })}>{item.content || t("editor.untitledHeading")}</button>)}</nav>}
        <div className="tip-summary"><p><MessageCircleMore size={15} />{t("editor.documentTips")} <span>{tips.length}</span></p>{tips.filter((tip) => !tip.parentTipId).slice(0, 5).map((tip) => <button key={tip.id} onClick={() => openTip(tip)}><i className={tip.status} /> <span>{tip.title}</span><small>{tip.messages.length}</small></button>)}</div>
      </aside>}
      {leftTip ? renderTipPanel(leftTip, true) : <main className="editor-main">
        <header className="editor-topbar">
          <div>{!navOpen && <button className="icon-button" onClick={() => setNavOpen(true)}><Menu size={18} /></button>}<div className="doc-breadcrumb"><FileText size={16} /><span>{documentItem.title || t("editor.untitled")}</span></div></div>
          <div className="editor-controls"><SaveIndicator state={saveState} /><button className="secondary compact" onClick={() => void manualSave()}><Cloud size={15} />{t("common.save")}</button><button className={`icon-button ${documentItem.favorite ? "starred" : ""}`} onClick={async () => { const favorite = !documentItem.favorite; setDocumentItem({ ...documentItem, favorite }); await api.updateDocument(documentItem.id, { favorite }); }}><Star size={17} fill={documentItem.favorite ? "currentColor" : "none"} /></button><button className="icon-button" onClick={onSettings} title={t("editor.settings")}><Settings size={18} /></button></div>
        </header>
        <div className="editor-scroll" onScroll={() => setSelection(null)}>
          <article className="document-page">
            <div className="page-meta"><span>{documentItem.sourceType === "blank" ? t("editor.personalNote") : t("editor.imported", { type: documentItem.sourceType.toUpperCase() })}</span><span>{t("editor.lastEdited", { time: timeAgo(documentItem.updatedAt, language, t) })}</span></div>
            <input className="document-title" value={documentItem.title} onChange={(e) => updateTitle(e.target.value)} placeholder={t("editor.untitled")} />
            <div className="document-rule" />
            {documentItem.sourceType === "pdf" ? <PdfPreview documentId={documentItem.id} blocks={documentItem.blocks} structure={documentItem.pdfStructure} tipsByBlock={tipsByBlock} onSelection={setSelection} onOpenTip={openTip} labels={{ loading: t("pdf.loading"), loadFailed: t("pdf.loadFailed"), structured: t("pdf.structured"), original: t("pdf.original"), structureHint: t("pdf.structureHint"), tableHeuristic: (confidence) => t("pdf.tableHeuristic", { confidence }), imageAlt: (page) => t("pdf.imageAlt", { page }), structureFailed: (error) => t("pdf.structureFailed", { error }), visualOnly: t("pdf.visualOnly"), page: (pageNumber, pageCount) => t("pdf.page", { page: pageNumber, count: pageCount }) }} /> : <>
              <div className="blocks">
                {documentItem.blocks.map((item) => <EditableBlock key={item.id} item={item} tips={tipsByBlock[item.id] || []} onChange={updateBlock} onSelection={setSelection} onOpenTip={openTip} />)}
              </div>
              <div className="add-block-row"><button onClick={() => addBlock("paragraph")}><Plus size={15} />{t("editor.addParagraph")}</button><button onClick={() => addBlock("heading")}>{t("editor.heading")}</button><button onClick={() => addBlock("code")}>{t("editor.code")}</button><button onClick={() => addBlock("quote")}>{t("editor.quote")}</button></div>
            </>}
          </article>
        </div>
      </main>}
      {selection && <SelectionToolbar selection={selection} onCreate={() => void createTip()} onClose={() => setSelection(null)} />}
      {activeTip && renderTipPanel(activeTip)}
      {hasNestedTips && <button className={`tip-tree-button ${navOpen ? "with-nav" : ""}`} onClick={() => setTreeOpen(true)} title={t("tip.treeTitle")}><GitBranch size={17} /><span>{t("tip.treeButton")}</span></button>}
      {treeOpen && <TipTreeDialog tips={tips} activeId={activeTipId} onClose={() => setTreeOpen(false)} onNavigate={openTip} onRename={(tipId, title) => { void patchTip(tipId, { title }); }} />}
      {!activeTip && tips.some((tip) => tip.status === "collapsed") && <button className="floating-tip-count" onClick={() => openTip(tips.find((tip) => tip.status === "collapsed")!)}><Sparkles size={16} /><span>{tips.filter((tip) => tip.status === "collapsed").length}</span></button>}
    </div>
  );
}

function AppContent() {
  const { t } = useI18n();
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(Boolean(session.get()));
  const [screen, setScreen] = useState<Screen>({ type: "library", tab: "all" });
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => {
    if (!session.get()) return;
    api.me().then(({ user: current }) => setUser(current)).catch(() => session.clear()).finally(() => setChecking(false));
  }, []);
  if (checking) return <div className="loading-state fullscreen"><LoaderCircle className="spin" /><span>{t("app.entering")}</span></div>;
  if (!user) return <AuthScreen onAuth={setUser} />;
  return <>{screen.type === "editor"
    ? <EditorScreen id={screen.id} onBack={() => setScreen({ type: "library", tab: "all" })} onSettings={() => setSettingsOpen(true)} />
    : <LibraryScreen user={user} screen={screen} onScreen={setScreen} onLogout={() => { session.clear(); setSettingsOpen(false); setScreen({ type: "library", tab: "all" }); setUser(null); }} onSettings={() => setSettingsOpen(true)} />}
    {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
  </>;
}

export default function App() {
  const [language, setLanguageState] = useState<Language>(readStoredLanguage);
  const setLanguage = useCallback((nextLanguage: Language) => {
    const normalized = normalizeLanguage(nextLanguage);
    storeLanguage(normalized);
    setLanguageState(normalized);
  }, []);
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  const t = useCallback<Translate>((key, variables) => translate(language, key, variables), [language]);
  const i18n = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t]);
  return <I18nContext.Provider value={i18n}><AppContent /></I18nContext.Provider>;
}
