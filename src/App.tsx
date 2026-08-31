import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArchiveRestore, ArrowLeft, BookOpen, Brain, Calculator, Check, CheckCircle2, ChevronDown, ChevronLeft,
  CircleHelp, Clock3, Cloud, CloudOff, Copy, Cpu, Download, FileCode2, FileText, Folder, HardDrive, Heart, Highlighter,
  GitBranch, Globe2, Languages, Library, LoaderCircle, LogOut, Mail, Menu, MessageCircleMore, PanelLeftClose,
  PanelRightClose, Plus, RefreshCw, Search, Send, Settings, ShieldCheck, Sparkles, Square, Star, Trash2,
  Upload, WandSparkles, X, Zap
} from "lucide-react";
import { ApiError, api, session } from "./api";
import { normalizeLanguage, readStoredLanguage, storeLanguage, translate, type Language } from "./i18n";
import { resolveSystemPrompt } from "./prompts";
import { PdfPreview } from "./PdfPreview";
import { TipMarkerButton } from "./TipMarkerButton";
import { PROVIDER_REGISTRY, PROVIDER_REGISTRY_VERIFIED_AT, providerDefinition } from "./providers";
import type { AiRuntimeStatus, AiSettings, AiSettingsInput, ApiProvider, BlockType, ChatSelectionInfo, CloudUsage, DocumentBlock, DocumentItem, PdfSelectionInfo, PdfTableData, SelectionInfo, SkillTrace, TipMessage, TipThread, User } from "./types";
import type { LocalModelCatalogItem, OllamaRuntimeInfo } from "./local-models";
import { buildTipForest, httpLinkRanges, plainMessageContent, visibleTipLayout, type TipTreeNode } from "./tip-tree";

type Screen = { type: "library"; tab: "all" | "favorites" | "trash" } | { type: "editor"; id: string };
type SaveState = "saved" | "saving" | "error" | "offline";
type Translate = (key: string, variables?: Record<string, string | number>) => string;
type ImportPhase = "idle" | "dragging" | "saving" | "uploading";

const DOCUMENT_ACCEPT = ".txt,.md,.markdown,.docx,.pdf";
const CONTACT_EMAIL = "2280810215@qq.com";
const PUBLIC_SITE_URL = String(import.meta.env.VITE_AI_TIP_PUBLIC_SITE_URL || "https://lrh478116-ops.github.io/AI_word_reading_helper").replace(/\/$/, "");
const SUPPORTED_DOCUMENT_EXTENSIONS = new Set(DOCUMENT_ACCEPT.split(","));

function documentExtension(file: Pick<File, "name">) {
  const dot = file.name.lastIndexOf(".");
  return dot >= 0 ? file.name.slice(dot).toLowerCase() : "";
}

function isSupportedDocument(file: Pick<File, "name">) {
  return SUPPORTED_DOCUMENT_EXTENSIONS.has(documentExtension(file));
}

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

type AuthMode = "login" | "register" | "verify-registration" | "recover" | "reset";

function AuthScreen({ onAuth }: { onAuth: (user: User) => void }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<AuthMode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [accountExists, setAccountExists] = useState(false);
  const [rememberLogin, setRememberLogin] = useState(false);
  const [credentialStorageAvailable, setCredentialStorageAvailable] = useState(true);

  useEffect(() => {
    let active = true;
    void window.aiTipDesktop?.loadRememberedLogin().then((result) => {
      if (!active) return;
      setCredentialStorageAvailable(result.available);
      if (result.credentials) {
        setEmail(result.credentials.email);
        setPassword(result.credentials.password);
        setRememberLogin(true);
      }
    }).catch(() => { if (active) setCredentialStorageAvailable(false); });
    return () => { active = false; };
  }, []);

  const changeMode = (next: AuthMode) => {
    setMode(next); setError(""); setNotice(""); setCode(""); setAccountExists(false);
  };

  const finishAuth = async (result: Awaited<ReturnType<typeof api.login>>, persistLogin = false) => {
    if (!result.token || !result.user) throw new Error(t("auth.missingSession"));
    if (persistLogin && window.aiTipDesktop) {
      try {
        if (rememberLogin) await window.aiTipDesktop.saveRememberedLogin(email, password);
        else await window.aiTipDesktop.clearRememberedLogin();
      } catch (error) { console.warn("Could not update remembered login:", error instanceof Error ? error.message : String(error)); }
    }
    session.set(result.token, result.refreshToken);
    onAuth(result.user);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true); setError(""); setNotice(""); setAccountExists(false);
    try {
      if (mode === "register") {
        const result = await api.register(name, email, password);
        if (result.confirmationRequired || result.verificationRequired) {
          setMode("verify-registration"); setNotice(t("auth.confirmEmail")); return;
        }
        await finishAuth(result); return;
      }
      if (mode === "verify-registration") { await finishAuth(await api.verifyRegistration(email, code)); return; }
      if (mode === "recover") {
        await api.requestPasswordRecovery(email);
        setMode("reset"); setNotice(t("auth.recoverySent")); return;
      }
      if (mode === "reset") { await finishAuth(await api.resetPassword(email, code, password)); return; }
      await finishAuth(await api.login(email, password), true);
    } catch (err) {
      if (err instanceof ApiError && err.code === "ACCOUNT_EXISTS") {
        setAccountExists(true); setError(t("auth.accountExists"));
      } else setError(err instanceof Error ? err.message : t("auth.loginFailed"));
    } finally { setLoading(false); }
  };

  const demo = async () => {
    setLoading(true); setError(""); setNotice("");
    try { await finishAuth(await api.login("demo@aitip.local", "demo1234")); }
    catch (err) { setError(err instanceof Error ? err.message : t("auth.localFailed")); }
    finally { setLoading(false); }
  };

  const title = mode === "login" ? t("auth.loginTitle") : mode === "register" ? t("auth.registerTitle") : mode === "verify-registration" ? t("auth.verifyTitle") : mode === "recover" ? t("auth.recoverTitle") : t("auth.resetTitle");
  const hint = mode === "login" ? t("auth.loginHint") : mode === "register" ? t("auth.registerHint") : mode === "verify-registration" ? t("auth.verifyHint") : mode === "recover" ? t("auth.recoverHint") : t("auth.resetHint");
  const action = mode === "login" ? t("auth.login") : mode === "register" ? t("auth.create") : mode === "verify-registration" ? t("auth.verify") : mode === "recover" ? t("auth.sendCode") : t("auth.reset");
  const showPassword = mode === "login" || mode === "register" || mode === "reset";
  const showCode = mode === "verify-registration" || mode === "reset";
  const primaryModes = mode === "login" || mode === "register";

  return (
    <main className="auth-shell">
      <section className="auth-story">
        <div className="brand brand-light"><span className="brand-mark"><Sparkles size={18} /></span>AI Tip</div>
        <div className="auth-copy">
          <div className="eyebrow"><span /> {t("auth.eyebrow")}</div>
          <h1>{t("auth.hero1")}<br />{t("auth.hero2")}</h1>
          <p>{t("auth.description")}</p>
          <div className="feature-preview"><div className="preview-page"><div className="preview-lines"><i /><i /><i /><i /></div><div className="preview-select">{t("auth.previewSelection")}</div><div className="preview-tip"><Sparkles size={14} /> {t("auth.previewQuestion")}</div></div></div>
        </div>
        <p className="auth-foot">{t("auth.footer")}</p>
      </section>
      <section className="auth-panel">
        <form className="auth-card" data-auth-mode={mode} onSubmit={submit}>
          <div className="mobile-brand brand"><span className="brand-mark"><Sparkles size={18} /></span>AI Tip</div>
          <div><p className="overline">{mode === "login" ? t("auth.welcome") : t("auth.start")}</p><h2>{title}</h2><p className="muted">{hint}</p></div>
          <LanguageSelect className="auth-language" />
          {mode === "register" && <label>{t("auth.name")}<input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} placeholder={t("auth.namePlaceholder")} required /></label>}
          <label>{t("auth.email")}<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" required readOnly={mode === "verify-registration" || mode === "reset"} /></label>
          {showCode && <label>{t("auth.code")}<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder={t("auth.codePlaceholder")} required /></label>}
          {showPassword && <label>{mode === "reset" ? t("auth.newPassword") : t("auth.password")}<input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={t("auth.passwordPlaceholder")} required minLength={6} /></label>}
          {mode === "login" && <div className="auth-remember-row"><label><input type="checkbox" data-remember-login checked={rememberLogin} disabled={!credentialStorageAvailable} onChange={(event) => setRememberLogin(event.target.checked)} /><span>{t("auth.rememberLogin")}</span></label>{rememberLogin && <button type="button" onClick={() => { setRememberLogin(false); void window.aiTipDesktop?.clearRememberedLogin(); }}>{t("auth.clearRemembered")}</button>}</div>}
          {mode === "login" && !credentialStorageAvailable && <p className="auth-security-note">{t("auth.secureStorageUnavailable")}</p>}
          {(mode === "login" || (mode === "register" && accountExists)) && <button type="button" className="auth-inline-action" onClick={() => changeMode("recover")}>{t("auth.forgot")}</button>}
          {notice && <div className="form-success"><CheckCircle2 size={16} />{notice}</div>}
          {error && <div className="form-error"><CircleHelp size={16} />{error}</div>}
          <button className="primary auth-submit" disabled={loading}>{loading ? <LoaderCircle className="spin" size={18} /> : null}{action}</button>
          {primaryModes ? <><div className="divider"><span>{t("auth.or")}</span></div><button type="button" className="secondary demo-button" onClick={demo} disabled={loading}><Zap size={17} />{t("auth.localUse")}</button><p className="auth-switch">{mode === "login" ? t("auth.noAccount") : t("auth.hasAccount")}<button type="button" onClick={() => changeMode(mode === "login" ? "register" : "login")}>{mode === "login" ? t("auth.freeRegister") : t("auth.backLogin")}</button></p></> : <p className="auth-switch"><button type="button" onClick={() => changeMode("login")}>{t("auth.back")}</button></p>}
        </form>
      </section>
    </main>
  );
}

function formatModelBytes(bytes: number, language: Language) {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes === 0) return "0 MB";
  if (bytes < 1_000_000_000) return `${Math.round(bytes / 1_000_000)} MB`;
  return `${(bytes / 1_000_000_000).toLocaleString(language, { maximumFractionDigits: 2 })} GB`;
}

function formatDownloadEta(seconds: number, language: Language) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  if (seconds < 60) return language === "en" ? `${Math.ceil(seconds)} sec` : `${Math.ceil(seconds)} 秒`;
  const minutes = Math.ceil(seconds / 60);
  return language === "en" ? `${minutes} min` : `${minutes} 分钟`;
}

function LocalModelsScreen({ onBack, onConnected }: { onBack: () => void; onConnected: () => void }) {
  const { language, t } = useI18n();
  const [models, setModels] = useState<LocalModelCatalogItem[]>([]);
  const [runtime, setRuntime] = useState<OllamaRuntimeInfo | null>(null);
  const [verifiedAt, setVerifiedAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<{ model: LocalModelCatalogItem; source: LocalModelCatalogItem["sources"][number]; directory: string; selectionToken: string; freeBytes: number } | null>(null);
  const [ollamaSetup, setOllamaSetup] = useState<{ model: LocalModelCatalogItem; source: LocalModelCatalogItem["sources"][number]; installed: boolean; supported: boolean; mas: boolean; executable: string; installer: { version: string; assetName: string; size: number; sha256: string; startUrl: string } | null; destination: string; selectionToken: string; requestId: string; completed: number; total: number; status: string; speedBps: number; downloading: boolean; message: string } | null>(null);
  const [download, setDownload] = useState<{ modelId: string; sourceId: string; completed: number; total: number; status: string; speedBps: number; startedAt: number; networkStack: string; initialHost: string; finalHost: string; proxyDescription: string } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const metrics = useRef({ at: 0, bytes: 0, speed: 0 });
  const installerMetrics = useRef({ at: 0, bytes: 0, speed: 0 });

  const importGguf = async () => {
    if (!window.aiTipDesktop) { setError(t("localModels.desktopOnly")); return; }
    setError("");
    try {
      const modelId = "aitip:imported-gguf";
      const selected = await window.aiTipDesktop.chooseLocalModelFile(modelId);
      if (selected.canceled) return;
      const connected = await api.connectLocalModel(modelId);
      setRuntime(connected.runtime);
      onConnected();
      window.alert(t("localModels.importConnected"));
    } catch (error) { setError(error instanceof Error ? error.message : t("localModels.importFailed")); }
  };

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const result = await api.localModels();
      setModels(result.models); setRuntime(result.runtime); setVerifiedAt(result.verifiedAt);
    } catch (error) { setError(error instanceof Error ? error.message : t("localModels.loadFailed")); }
    finally { setLoading(false); }
  }, [t]);
  useEffect(() => {
    void load();
    const unsubscribe = window.aiTipDesktop?.onOllamaInstallerProgress((event) => setOllamaSetup((current) => {
      if (!current || current.requestId !== event.requestId) return current;
      const at = Date.now();
      const elapsed = (at - installerMetrics.current.at) / 1000;
      let speedBps = current.speedBps;
      if (elapsed >= 0.35 && event.completed > installerMetrics.current.bytes) {
        const instant = (event.completed - installerMetrics.current.bytes) / elapsed;
        speedBps = installerMetrics.current.speed ? installerMetrics.current.speed * 0.65 + instant * 0.35 : instant;
        installerMetrics.current = { at, bytes: event.completed, speed: speedBps };
      }
      return { ...current, completed: event.completed, total: event.total || current.total, status: event.status, speedBps };
    }));
    return () => { controller.current?.abort(); unsubscribe?.(); };
  }, [load]);

  const openDownload = async (model: LocalModelCatalogItem, source: LocalModelCatalogItem["sources"][number]) => {
    if (download) return;
    setError("");
    if (source.id === "ollama") {
      if (!window.aiTipDesktop) { setError(t("localModels.desktopOnly")); return; }
      try {
        const status = await window.aiTipDesktop.getOllamaStatus();
        if (!status.installed) {
          setOllamaSetup({ model, source, ...status, destination: "", selectionToken: "", requestId: "", completed: 0, total: status.installer?.size || 0, status: t("localModels.waiting"), speedBps: 0, downloading: false, message: "" });
          return;
        }
      } catch (error) { setError(error instanceof Error ? error.message : t("localModels.ollamaCheckFailed")); return; }
    }
    setPending({ model, source, directory: source.id === "ollama" ? "" : runtime?.storagePath || "", selectionToken: "", freeBytes: 0 });
  };

  const chooseOllamaInstallerDestination = async () => {
    if (!ollamaSetup || !window.aiTipDesktop) return;
    try {
      const result = await window.aiTipDesktop.chooseOllamaInstallerDestination();
      if (!result.canceled && result.path && result.selectionToken) setOllamaSetup((current) => current ? { ...current, destination: result.path!, selectionToken: result.selectionToken!, message: "" } : current);
    } catch (error) { setOllamaSetup((current) => current ? { ...current, message: error instanceof Error ? error.message : t("localModels.directoryFailed") } : current); }
  };

  const startOllamaInstaller = async () => {
    if (!ollamaSetup || !window.aiTipDesktop || !ollamaSetup.selectionToken || ollamaSetup.downloading) return;
    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    installerMetrics.current = { at: Date.now(), bytes: 0, speed: 0 };
    setOllamaSetup((current) => current ? { ...current, requestId, downloading: true, completed: 0, speedBps: 0, status: t("localModels.preparing"), message: "" } : current);
    try {
      const result = await window.aiTipDesktop.downloadOllamaInstaller(requestId, ollamaSetup.selectionToken);
      setOllamaSetup((current) => current ? { ...current, downloading: false, completed: result.size, total: result.size, status: t("localModels.ollamaInstallerVerified"), selectionToken: "", message: result.opened ? t("localModels.ollamaInstallerOpened") : t("localModels.ollamaInstallerSaved", { path: result.finalPath }) } : current);
    } catch (error) {
      setOllamaSetup((current) => current ? { ...current, downloading: false, selectionToken: "", message: error instanceof Error ? error.message : t("localModels.downloadFailed") } : current);
    }
  };

  const recheckOllama = async () => {
    if (!ollamaSetup || !window.aiTipDesktop) return;
    try {
      const status = await window.aiTipDesktop.getOllamaStatus();
      if (status.installed) {
        const { model, source } = ollamaSetup;
        setOllamaSetup(null);
        setPending({ model, source, directory: "", selectionToken: "", freeBytes: 0 });
      } else setOllamaSetup((current) => current ? { ...current, ...status, message: t("localModels.ollamaStillMissing") } : current);
    } catch (error) { setOllamaSetup((current) => current ? { ...current, message: error instanceof Error ? error.message : t("localModels.ollamaCheckFailed") } : current); }
  };

  const chooseDirectory = async () => {
    if (!pending) return;
    if (!window.aiTipDesktop) { setError(t("localModels.desktopOnly")); return; }
    try {
      const result = await window.aiTipDesktop.chooseModelDirectory(pending.directory, pending.source.id === "ollama" ? "ollama" : "llama.cpp");
      if (!result.canceled && result.path && result.selectionToken) setPending((current) => current ? { ...current, directory: result.path!, selectionToken: result.selectionToken!, freeBytes: 0 } : current);
    } catch (error) { setError(error instanceof Error ? error.message : t("localModels.directoryFailed")); }
  };

  const startDownload = async () => {
    if (!pending || download) return;
    const { model, source } = pending;
    let destinationPath = pending.directory;
    if (!destinationPath) { setError(t("localModels.chooseFirst")); return; }
    setError("");
    if (pending.selectionToken) {
      if (!window.aiTipDesktop) { setError(t("localModels.desktopOnly")); return; }
      try {
        const prepared = await window.aiTipDesktop.prepareModelDirectory(pending.selectionToken);
        destinationPath = prepared.directory;
        if (prepared.freeBytes > 0 && prepared.freeBytes < model.approxBytes * 1.1) {
          setPending((current) => current ? { ...current, directory: prepared.directory, selectionToken: "", freeBytes: prepared.freeBytes } : current);
          setError(t("localModels.insufficientSpace", { free: formatModelBytes(prepared.freeBytes, language), needed: formatModelBytes(Math.ceil(model.approxBytes * 1.1), language) }));
          return;
        }
        const refreshed = await api.localModels();
        setRuntime(refreshed.runtime);
        setPending((current) => current ? { ...current, directory: prepared.directory, selectionToken: "", freeBytes: prepared.freeBytes } : current);
      } catch (error) { setPending((current) => current ? { ...current, selectionToken: "" } : current); setError(error instanceof Error ? error.message : t("localModels.runtimePrepareFailed")); return; }
    }
    const ctrl = new AbortController(); controller.current = ctrl;
    const startedAt = Date.now();
    metrics.current = { at: startedAt, bytes: 0, speed: 0 };
    setDownload({ modelId: model.id, sourceId: source.id, completed: 0, total: model.approxBytes, status: t("localModels.preparing"), speedBps: 0, startedAt, networkStack: "", initialHost: "", finalHost: "", proxyDescription: "" });
    try {
      const result = await api.downloadLocalModel(model.id, source.id, destinationPath, ctrl.signal, (event) => {
        if (event.type === "progress" || event.type === "start") setDownload((current) => {
          if (!current) return current;
          const nowAt = Date.now();
          const completed = Math.max(current.completed, event.completed || 0);
          const elapsed = (nowAt - metrics.current.at) / 1000;
          if (elapsed >= 0.35 && completed > metrics.current.bytes) {
            const instant = (completed - metrics.current.bytes) / elapsed;
            metrics.current.speed = metrics.current.speed ? metrics.current.speed * 0.65 + instant * 0.35 : instant;
            metrics.current.at = nowAt; metrics.current.bytes = completed;
          }
          return { ...current, completed, total: event.total || current.total, status: event.status || current.status, speedBps: metrics.current.speed, networkStack: event.networkStack || current.networkStack, initialHost: event.initialHost || current.initialHost, finalHost: event.finalHost || current.finalHost, proxyDescription: event.proxyDescription || current.proxyDescription };
        });
      });
      setRuntime(result.runtime);
      setDownload(null);
      setPending(null);
      onConnected();
      window.alert(t("localModels.connected", { model: model.name }));
    } catch (error) {
      if ((error as Error).name !== "AbortError") setError(error instanceof Error ? error.message : t("localModels.downloadFailed"));
      setDownload(null);
    } finally { controller.current = null; }
  };

  const tierLabel = (tier: LocalModelCatalogItem["tier"]) => t(`localModels.tier.${tier}`);
  const ramGb = runtime ? runtime.totalRamBytes / 1024 ** 3 : 0;
  const percent = download?.total ? Math.min(100, Math.round(download.completed / download.total * 100)) : 0;
  const remainingSeconds = download?.speedBps && download.total > download.completed ? (download.total - download.completed) / download.speedBps : 0;
  return <main className="local-models-screen" data-local-models-screen>
    <header className="local-models-header">
      <div><button className="secondary compact" onClick={onBack}><ArrowLeft size={15} />{t("common.back")}</button><span className="settings-kicker"><Cpu size={13} />{t("localModels.kicker")}</span><h1>{t("localModels.title")}</h1><p>{t("localModels.subtitle")}</p></div>
      <div className="local-model-header-actions"><button className="secondary" onClick={() => void importGguf()}><Upload size={15} />{t("localModels.importGguf")}</button><LanguageSelect /></div>
    </header>
    <section className={`local-runtime-card ${runtime?.reachable ? "ready" : "missing"}`}>
      <div className="local-runtime-icon"><HardDrive size={22} /></div>
      <div><strong>{runtime?.reachable ? t("localModels.runtimeReady") : t("localModels.runtimeBundled")}</strong><p>{runtime?.reachable ? t("localModels.runtimeReadyHint", { version: runtime.version || t("localModels.unknownVersion") }) : t("localModels.runtimeBundledHint")}</p><small>{t("localModels.storage")}: {runtime?.storagePath || "—"} · {runtime?.storagePathSource === "user-selected" ? t("localModels.storageSelected") : t("localModels.storageDefault")}</small></div>
      <div className="local-hardware"><span>{t("localModels.systemRam")}</span><strong>{ramGb ? `${ramGb.toFixed(0)} GB` : "—"}</strong><button className="icon-button" onClick={() => void load()} title={t("common.retry")}><RefreshCw size={16} /></button></div>
    </section>
    <div className="local-model-notes"><ShieldCheck size={16} /><p>{t("localModels.runtimeNote")}<br />{t("localModels.mirrorNote")}</p></div>
    {error && !pending && <div className="local-model-error"><CircleHelp size={16} /><span>{error}</span><button onClick={() => setError("")}><X size={14} /></button></div>}
    {loading ? <div className="settings-loading"><LoaderCircle className="spin" size={20} />{t("localModels.loading")}</div> : <section className="local-model-table-wrap">
      <div className="local-model-table-meta"><span>{t("localModels.catalog", { count: models.length })}</span><small>{t("localModels.verified", { date: verifiedAt })}</small></div>
      <div className="local-model-table" role="table">
        <div className="local-model-row local-model-head" role="row"><span>{t("localModels.tier")}</span><span>{t("localModels.model")}</span><span>{t("localModels.size")}</span><span>{t("localModels.ram")}</span><span>{t("localModels.gpu")}</span><span>{t("localModels.features")}</span><span>{t("localModels.sources")}</span></div>
        {models.map((model) => {
          const installed = runtime?.installedModels.includes(`aitip:${model.id}`);
          return <div className={`local-model-row ${model.recommended ? "recommended" : ""}`} role="row" key={model.id} data-local-model-id={model.id}>
            <span><i className={`tier-badge ${model.tier}`}>{tierLabel(model.tier)}</i>{model.recommended && <em>{t("localModels.recommended")}</em>}</span>
            <span><strong>{model.name}</strong><small>{model.quantization}</small></span>
            <span>{formatModelBytes(model.approxBytes, language)}</span><span>{model.ram}</span><span>{model.gpu}</span>
            <span className="local-model-feature">{language === "en" ? model.featuresEn : model.featuresZh}</span>
            <span className="local-model-sources">{installed ? <b><CheckCircle2 size={13} />{t("localModels.installed")}</b> : model.sources.map((source) => {
              const active = download?.modelId === model.id && download.sourceId === source.id;
              const percent = active && download.total ? Math.min(100, Math.round(download.completed / download.total * 100)) : 0;
              return <button key={source.id} className="secondary compact source-download" data-model-source={source.id} title={source.artifact?.filename || source.modelRef} disabled={Boolean(download)} onClick={() => void openDownload(model, source)}>{active ? <LoaderCircle className="spin" size={13} /> : <Download size={13} />}{active ? `${percent}%` : language === "en" ? source.labelEn : source.labelZh}<code>{source.artifact?.filename || source.modelRef}</code></button>;
            })}</span>
          </div>;
        })}
      </div>
    </section>}
    {ollamaSetup && <div className="modal-backdrop local-download-backdrop"><section className="local-download-dialog" role="dialog" aria-modal="true" data-ollama-installer-dialog>
      <header><div><span className="settings-kicker"><Download size={13} />{t("localModels.ollamaInstallerKicker")}</span><h2>{t("localModels.ollamaInstallerTitle")}</h2><p>{ollamaSetup.mas ? t("localModels.ollamaMasBlocked") : t("localModels.ollamaInstallerHint")}</p></div><button className="icon-button" disabled={ollamaSetup.downloading} onClick={() => setOllamaSetup(null)}><X size={18} /></button></header>
      <div className="local-download-body">
        {ollamaSetup.message && <div className="local-model-error"><CircleHelp size={16} /><span>{ollamaSetup.message}</span></div>}
        {ollamaSetup.installer && <div className="local-download-summary"><div><span>{t("localModels.version")}</span><strong>{ollamaSetup.installer.version}</strong></div><div><span>{t("localModels.downloadSize")}</span><strong>{formatModelBytes(ollamaSetup.installer.size, language)}</strong></div><div><span>SHA-256</span><strong title={ollamaSetup.installer.sha256}>{ollamaSetup.installer.sha256.slice(0, 16)}…</strong></div><div><span>{t("localModels.source")}</span><strong>ollama.com → GitHub Releases</strong></div></div>}
        {!ollamaSetup.mas && ollamaSetup.supported && <label className="model-directory-field"><span>{t("localModels.installerPath")}</span><div><input readOnly value={ollamaSetup.destination} placeholder={t("localModels.installerPathPlaceholder")} /><button className="secondary compact" disabled={ollamaSetup.downloading} onClick={() => void chooseOllamaInstallerDestination()}><Folder size={15} />{t("localModels.choosePath")}</button></div><small>{t("localModels.ollamaInstallerRoute")}</small></label>}
        {!ollamaSetup.mas && <div className="local-download-progress"><div><strong>{ollamaSetup.status}</strong><b>{ollamaSetup.total ? `${Math.min(100, Math.round(ollamaSetup.completed / ollamaSetup.total * 100))}%` : "0%"}</b></div><progress max={ollamaSetup.total || 1} value={ollamaSetup.completed} /><div className="download-metrics"><span><small>{t("localModels.downloaded")}</small><strong>{formatModelBytes(ollamaSetup.completed, language)} / {formatModelBytes(ollamaSetup.total, language)}</strong></span><span><small>{t("localModels.speed")}</small><strong>{ollamaSetup.speedBps ? `${formatModelBytes(ollamaSetup.speedBps, language)}/s` : "—"}</strong></span><span><small>{t("localModels.eta")}</small><strong>{ollamaSetup.speedBps ? formatDownloadEta((ollamaSetup.total - ollamaSetup.completed) / ollamaSetup.speedBps, language) : "—"}</strong></span></div></div>}
      </div>
      <footer><button className="secondary" disabled={ollamaSetup.downloading} onClick={() => setOllamaSetup(null)}>{t("common.close")}</button>{ollamaSetup.downloading ? <button className="secondary danger-soft" onClick={() => void window.aiTipDesktop?.cancelOllamaInstaller(ollamaSetup.requestId)}>{t("localModels.cancel")}</button> : <><button className="secondary" onClick={() => void recheckOllama()}><RefreshCw size={15} />{t("localModels.recheckOllama")}</button>{!ollamaSetup.mas && <button className="primary" disabled={!ollamaSetup.selectionToken} onClick={() => void startOllamaInstaller()}><Download size={16} />{t("localModels.downloadOfficialInstaller")}</button>}</>}</footer>
    </section></div>}
    {pending && <div className="modal-backdrop local-download-backdrop"><section className="local-download-dialog" role="dialog" aria-modal="true" data-local-download-dialog>
      <header><div><span className="settings-kicker"><Download size={13} />{t("localModels.downloadKicker")}</span><h2>{t("localModels.downloadTitle", { model: pending.model.name })}</h2><p>{t("localModels.downloadHint")}</p></div><button className="icon-button" data-local-download-close disabled={Boolean(download)} onClick={() => setPending(null)}><X size={18} /></button></header>
      <div className="local-download-body">
        {error && <div className="local-model-error"><CircleHelp size={16} /><span>{error}</span><button onClick={() => setError("")}><X size={14} /></button></div>}
        <div className="local-download-summary"><div><span>{t("localModels.source")}</span><strong>{language === "en" ? pending.source.labelEn : pending.source.labelZh}</strong></div><div><span>{t("localModels.quantization")}</span><strong>{pending.model.quantization}</strong></div><div><span>{t("localModels.downloadSize")}</span><strong>{formatModelBytes(pending.model.approxBytes, language)}</strong></div>{pending.freeBytes > 0 && <div><span>{t("localModels.freeSpace")}</span><strong>{formatModelBytes(pending.freeBytes, language)}</strong></div>}</div>
        <label className="model-directory-field"><span>{t("localModels.directory")}</span><div><input readOnly data-model-directory value={pending.directory} placeholder={t("localModels.directoryPlaceholder")} /><button className="secondary compact" data-choose-model-directory disabled={Boolean(download)} onClick={() => void chooseDirectory()}><Folder size={15} />{t("localModels.chooseDirectory")}</button></div><small>{t("localModels.directoryHint")}</small></label>
        <div className="local-download-progress" data-download-progress>
          <div><strong>{download ? download.status : t("localModels.waiting")}</strong><b>{download ? `${percent}%` : "0%"}</b></div><progress max={download?.total || pending.model.approxBytes || 1} value={download?.completed || 0} />
          {download?.networkStack === "chromium" && <small className="official-download-route"><ShieldCheck size={13} />{t("localModels.officialDirect", { host: download.finalHost || download.initialHost || (language === "en" ? pending.source.labelEn : pending.source.labelZh), proxy: download.proxyDescription || "—" })}</small>}
          <div className="download-metrics"><span><small>{t("localModels.downloaded")}</small><strong>{download ? `${formatModelBytes(download.completed, language)} / ${formatModelBytes(download.total, language)}` : `0 MB / ${formatModelBytes(pending.model.approxBytes, language)}`}</strong></span><span><small>{t("localModels.speed")}</small><strong>{download?.speedBps ? `${formatModelBytes(download.speedBps, language)}/s` : "—"}</strong></span><span><small>{t("localModels.eta")}</small><strong>{download?.speedBps ? formatDownloadEta(remainingSeconds, language) : "—"}</strong></span></div>
        </div>
      </div>
      <footer><button className="secondary" disabled={Boolean(download)} onClick={() => setPending(null)}>{t("common.close")}</button>{download ? <button className="secondary danger-soft" onClick={() => controller.current?.abort()}>{t("localModels.cancel")}</button> : <button className="primary" onClick={() => void startDownload()}><Download size={16} />{t("localModels.startDownload")}</button>}</footer>
    </section></div>}
  </main>;
}

function SettingsModal({ user, onClose, onOpenLocalModels, onSaved, onAccountDeleted }: { user: User; onClose: () => void; onOpenLocalModels: () => void; onSaved: () => void; onAccountDeleted: () => void }) {
  const { language, t } = useI18n();
  const languageRef = useRef(language);
  const [saved, setSaved] = useState<AiSettings | null>(null);
  const [draft, setDraft] = useState<AiSettingsInput>({ provider: "openai", baseURL: "", model: "", systemPrompt: "", webSearchEnabled: false, searchBudgetMode: "free", pythonEnabled: true, reliabilityEnabled: true });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"save" | "test" | "">("");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [accountConfirmation, setAccountConfirmation] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);
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
        onSaved();
        setMessage({ kind: "ok", text: t("settings.saved") });
      }
    } catch (error) { setMessage({ kind: "error", text: error instanceof Error ? error.message : t("settings.failed") }); }
    finally { setBusy(""); }
  };
  const deleteAccount = async () => {
    if (accountConfirmation.trim().toLowerCase() !== user.email.toLowerCase()) return;
    if (!window.confirm(user.authMode === "supabase" ? t("account.deleteFinalConfirm") : t("account.clearLocalFinalConfirm"))) return;
    setDeletingAccount(true); setMessage(null);
    try {
      await api.deleteAccount(accountConfirmation);
      session.clear();
      await window.aiTipDesktop?.clearRememberedLogin().catch(() => undefined);
      onAccountDeleted();
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : t("account.deleteFailed") });
    } finally { setDeletingAccount(false); }
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
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header><div><span className="settings-kicker"><Settings size={13} />{t("settings.kicker")}</span><h2 id="settings-title">{t("settings.title")}</h2><p>{t("settings.subtitle")}</p></div><button className="icon-button" onClick={onClose} aria-label={t("common.close")}><X size={18} /></button></header>
      {loading ? <div className="settings-loading"><LoaderCircle className="spin" size={20} />{t("settings.loading")}</div> : <div className="settings-body">
        <LanguageSelect />
        <div className="settings-grid">
          <label>{t("settings.provider")}<select value={draft.provider} onChange={(event) => changeProvider(event.target.value as ApiProvider)}>{providerOptions.map((item) => <option key={item.id} value={item.id}>{t(item.labelKey)}</option>)}</select></label>
          <label>{t("settings.model")}<input list="provider-models" value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} placeholder={providerDefinition(draft.provider).defaultModel} /><datalist id="provider-models">{availableModels.map((model) => <option key={model} value={model} />)}</datalist></label>
        </div>
        <div className="model-refresh-row"><button type="button" className="secondary compact" onClick={() => void refreshModels()} disabled={modelsBusy}>{modelsBusy ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}{modelsBusy ? t("settings.refreshingModels") : t("settings.refreshModels")}</button><button type="button" className="secondary compact" onClick={onOpenLocalModels}><Download size={14} />{t("settings.localModels")}</button><small>{t("settings.modelsHint")} · {t("settings.registryDate", { date: PROVIDER_REGISTRY_VERIFIED_AT })}</small></div>
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
        <section className="account-privacy" data-account-privacy>
          <div><ShieldCheck size={17} /><span><strong>{t("account.title")}</strong><small>{t("account.subtitle")}</small></span></div>
          <div className="account-links"><a data-privacy-link href={`${PUBLIC_SITE_URL}/privacy/`} target="_blank" rel="noreferrer">{t("account.privacy")}</a><a href={`${PUBLIC_SITE_URL}/account-deletion/`} target="_blank" rel="noreferrer">{t("account.deletionHelp")}</a><a href={`mailto:${CONTACT_EMAIL}`}>{t("account.contact")}</a></div>
          <p>{user.authMode === "supabase" ? t("account.cloudDeleteHint") : t("account.localDeleteHint")}</p>
          <label>{t("account.confirmLabel")}<input data-account-confirmation value={accountConfirmation} onChange={(event) => setAccountConfirmation(event.target.value)} placeholder={user.email} /></label>
          <button type="button" className="danger-button" data-delete-account onClick={() => void deleteAccount()} disabled={deletingAccount || accountConfirmation.trim().toLowerCase() !== user.email.toLowerCase()}>{deletingAccount ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}{user.authMode === "supabase" ? t("account.delete") : t("account.clearLocal")}</button>
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
  const [contactCopyState, setContactCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const copyContact = async () => {
    let copied = false;
    try {
      if (window.aiTipDesktop?.copyText) await window.aiTipDesktop.copyText(CONTACT_EMAIL);
      else await navigator.clipboard.writeText(CONTACT_EMAIL);
      copied = true;
    } catch {
      const input = document.createElement("textarea");
      input.value = CONTACT_EMAIL;
      input.setAttribute("readonly", "");
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      try { copied = document.execCommand("copy"); } catch { copied = false; }
      input.remove();
    }
    setContactCopyState(copied ? "copied" : "failed");
    window.setTimeout(() => setContactCopyState("idle"), 2400);
  };
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
        <button className="contact-copy-button" data-contact-copy onClick={() => void copyContact()} title={t("nav.contact")}><Mail size={17} /><span>{t("nav.contact")}</span></button>
        <span className={`contact-copy-status ${contactCopyState}`} data-contact-copy-status aria-live="polite">{contactCopyState === "copied" ? t("nav.contactCopied") : contactCopyState === "failed" ? t("nav.contactCopyFailed") : ""}</span>
        <button data-open-settings onClick={onSettings}><Settings size={18} />{t("nav.settings")}</button>
        <div className="user-row">
          <div className="avatar">{user.name.slice(0, 1)}</div>
          <div><strong>{user.name}</strong><span>{user.email}</span></div>
          <button className="logout-button" onClick={onLogout} title={t("nav.logout")}><LogOut size={15} /><span>{t("nav.logout")}</span></button>
        </div>
      </div>
    </aside>
  );
}

interface LibraryProps { user: User; screen: Extract<Screen, { type: "library" }>; onScreen: (screen: Screen) => void; onUpload: () => void; onLogout: () => void; onSettings: () => void; }

function LibraryScreen({ user, screen, onScreen, onUpload, onLogout, onSettings }: LibraryProps) {
  const { language, t } = useI18n();
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [trash, setTrash] = useState<DocumentItem[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("updated");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cloudUsage, setCloudUsage] = useState<CloudUsage | null>(null);
  const [cloudBusyId, setCloudBusyId] = useState("");
  const [cloudDeletingId, setCloudDeletingId] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [active, deleted, usage] = await Promise.all([api.documents("active"), api.documents("deleted"), user.authMode === "supabase" ? api.cloudUsage().catch(() => null) : Promise.resolve(null)]);
      setDocuments(active.documents); setTrash(deleted.documents);
      if (usage) setCloudUsage(usage.usage);
    } catch (err) { setError(err instanceof Error ? err.message : t("library.loadFailed")); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    try { const { document } = await api.createDocument(); onScreen({ type: "editor", id: document.id }); }
    catch (err) { setError(err instanceof Error ? err.message : t("library.createFailed")); }
  };
  const patch = async (document: DocumentItem, change: Partial<DocumentItem>) => {
    try { await api.updateDocument(document.id, change); await load(); } catch (err) { setError(err instanceof Error ? err.message : t("library.operationFailed")); }
  };
  const remove = async (document: DocumentItem, permanent = false) => {
    if (permanent && !window.confirm(t("library.deleteConfirm"))) return;
    try { await api.deleteDocument(document.id, permanent); await load(); } catch (err) { setError(err instanceof Error ? err.message : t("library.operationFailed")); }
  };
  const syncCloud = async (document: DocumentItem) => {
    setCloudBusyId(document.id); setError("");
    try { const result = await api.uploadDocumentToCloud(document.id); setCloudUsage(result.usage); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : t("cloud.failed")); }
    finally { setCloudBusyId(""); }
  };
  const removeCloud = async (document: DocumentItem) => {
    if (!window.confirm(t("cloud.removeConfirm"))) return;
    setCloudDeletingId(document.id); setError("");
    try { const result = await api.removeDocumentFromCloud(document.id); setCloudUsage(result.usage); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : t("cloud.failed")); }
    finally { setCloudDeletingId(""); }
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
      <AppNav user={user} tab={screen.tab} counts={{ all: documents.length, favorite: documents.filter((d) => d.favorite).length, trash: trash.length }} onTab={(tab) => onScreen({ type: "library", tab })} onNew={() => void create()} onUpload={onUpload} onLogout={onLogout} onSettings={onSettings} />
      <main className="library-main">
        <header className="library-header">
          <div><p className="overline">{t("library.space")}</p><h1>{title}</h1><p>{screen.tab === "trash" ? t("library.trashDescription") : user.authMode === "supabase" ? t("cloud.localOnlyHint") : t("library.description")}</p>{user.authMode === "supabase" && <p className="cloud-usage"><Cloud size={13} />{cloudUsage ? t("cloud.usage", { used: (cloudUsage.usedBytes / 1048576).toFixed(2) }) : t("cloud.quota")}</p>}</div>
          <div className="header-actions"><button className="secondary" onClick={onUpload}><Upload size={17} />{t("nav.import")}</button><button className="primary" onClick={() => void create()}><Plus size={17} />{t("nav.new")}</button></div>
        </header>
        <section className="library-toolbar">
          <div className="search-box"><Search size={18} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("library.search")} />{query && <button onClick={() => setQuery("")}><X size={15} /></button>}</div>
          <div className="sort-select"><span>{t("library.sort")}</span><select value={sort} onChange={(e) => setSort(e.target.value)}><option value="updated">{t("library.updated")}</option><option value="created">{t("library.created")}</option><option value="name">{t("library.name")}</option><option value="tips">{t("library.tips")}</option></select><ChevronDown size={15} /></div>
        </section>
        {error && <div className="page-error"><CircleHelp size={17} />{error}<button onClick={() => void load()}>{t("common.retry")}</button></div>}
        {loading ? <div className="loading-state"><LoaderCircle className="spin" /><span>{t("library.loading")}</span></div> : filtered.length === 0 ? (
          <div className="empty-state"><div>{screen.tab === "trash" || query ? <BookOpen size={28} /> : <Upload size={28} />}</div><h2>{query ? t("library.noMatch") : screen.tab === "trash" ? t("library.emptyTrash") : t("library.start")}</h2><p>{query ? t("library.shorter") : t("library.emptyHint")}</p>{screen.tab !== "trash" && !query && <button className="primary" data-empty-import onClick={onUpload}><Upload size={17} />{t("nav.import")}</button>}</div>
        ) : (
          <section className="document-grid">
            {filtered.map((document) => (
              <article className="document-card" key={document.id} onClick={() => screen.tab !== "trash" && onScreen({ type: "editor", id: document.id })}>
                <div className={`file-icon source-${document.sourceType}`}>{iconForSource(document.sourceType)}</div>
                <button className={`favorite-button ${document.favorite ? "active" : ""}`} title={document.favorite ? t("library.unfavorite") : t("library.favorite")} onClick={(e) => { e.stopPropagation(); void patch(document, { favorite: !document.favorite }); }}><Heart size={17} fill={document.favorite ? "currentColor" : "none"} /></button>
                <div className="doc-copy"><h3>{document.title}</h3><p>{document.blocks.find((b) => b.content.trim())?.content.slice(0, 88) || t("library.blank")}</p></div>
                <div className="doc-meta"><span><MessageCircleMore size={14} />{document.tipCount} Tips</span><span>{timeAgo(document.updatedAt, language, t)}</span></div>
                {user.authMode === "supabase" && <span className={`cloud-state ${document.cloudState || "local"}`}>{document.cloudState === "synced" ? t("cloud.synced") : document.cloudState === "modified" ? t("cloud.modified") : t("cloud.local")}</span>}
                <div className="card-actions" onClick={(e) => e.stopPropagation()}>
                  {screen.tab === "trash" ? <><button onClick={() => void patch(document, { status: "active" })}><ArchiveRestore size={15} />{t("library.restore")}</button><button className="danger-text" onClick={() => void remove(document, true)}><Trash2 size={15} />{t("library.permanentDelete")}</button></> : <>{user.authMode === "supabase" && document.cloudState !== "synced" && <button className="cloud-action" disabled={cloudBusyId === document.id || cloudDeletingId === document.id} onClick={() => void syncCloud(document)}>{cloudBusyId === document.id ? <LoaderCircle className="spin" size={15} /> : <Cloud size={15} />}{cloudBusyId === document.id ? t("cloud.uploading") : document.cloudState === "modified" ? t("cloud.update") : t("cloud.upload")}</button>}{user.authMode === "supabase" && Boolean(document.cloudSyncedAt) && <button className="danger-text" data-delete-cloud-file={document.id} disabled={cloudBusyId === document.id || cloudDeletingId === document.id} onClick={() => void removeCloud(document)}>{cloudDeletingId === document.id ? <LoaderCircle className="spin" size={15} /> : <CloudOff size={15} />}{cloudDeletingId === document.id ? t("cloud.deleting") : t("cloud.remove")}</button>}<button onClick={() => void remove(document)}><Trash2 size={15} />{t("library.moveTrash")}</button></>}
                </div>
              </article>
            ))}
          </section>
        )}
        <footer className="library-foot"><span>{t("library.count", { count: filtered.length })}</span><span><Cloud size={14} />{user.authMode === "supabase" ? t("library.cloudSaved") : t("library.localSaved")}</span></footer>
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

function tableText(rows: string[][]) {
  return rows.map((row) => row.join("\t")).join("\n");
}

function tableCellOffset(rows: string[][], rowIndex: number, cellIndex: number) {
  let offset = 0;
  for (let row = 0; row < rowIndex; row++) offset += rows[row].reduce((total, cell) => total + cell.length, 0) + Math.max(0, rows[row].length - 1) + 1;
  for (let cell = 0; cell < cellIndex; cell++) offset += rows[rowIndex][cell].length + 1;
  return offset;
}

function tableSelectionOffset(root: HTMLElement, node: Node, offset: number, rows: string[][]) {
  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  const cell = element?.closest<HTMLElement>("[data-table-cell]");
  if (!cell || !root.contains(cell)) return null;
  const [rowIndex, cellIndex] = String(cell.dataset.tableCell || "").split(":").map(Number);
  if (!Number.isInteger(rowIndex) || !Number.isInteger(cellIndex) || !rows[rowIndex]?.[cellIndex] && rows[rowIndex]?.[cellIndex] !== "") return null;
  return tableCellOffset(rows, rowIndex, cellIndex) + offsetWithin(cell, node, offset);
}

function tableRectForOffsets(root: HTMLElement, rows: string[][], start: number, end: number) {
  let startCell: HTMLElement | null = null; let endCell: HTMLElement | null = null;
  let startLocal = 0; let endLocal = 0;
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    for (let cellIndex = 0; cellIndex < rows[rowIndex].length; cellIndex++) {
      const cell = rows[rowIndex][cellIndex];
      const base = tableCellOffset(rows, rowIndex, cellIndex);
      const element = root.querySelector<HTMLElement>(`[data-table-cell="${rowIndex}:${cellIndex}"]`);
      if (!element) continue;
      if (!startCell && start >= base && start <= base + cell.length) { startCell = element; startLocal = start - base; }
      if (end >= base && end <= base + cell.length) { endCell = element; endLocal = end - base; }
    }
  }
  if (!startCell || !endCell) return null;
  const startPoint = rectForOffsets(startCell, startLocal, startLocal || Math.min(1, startCell.innerText.length));
  if (startCell === endCell) return rectForOffsets(startCell, startLocal, endLocal);
  const endPoint = rectForOffsets(endCell, Math.max(0, endLocal - 1), endLocal);
  if (!startPoint || !endPoint) return startPoint || endPoint;
  return { left: startPoint.left, top: startPoint.top, right: endPoint.right, bottom: endPoint.bottom, width: endPoint.right - startPoint.left, height: endPoint.bottom - startPoint.top, x: startPoint.x, y: startPoint.y, toJSON: () => ({}) } as DOMRect;
}

type EditableBlockPatch = { content: string; table?: PdfTableData };

function EditableTableCell({ as: Tag, content, rowIndex, cellIndex, colSpan, rowSpan, onInput }: { as: "th" | "td"; content: string; rowIndex: number; cellIndex: number; colSpan: number; rowSpan: number; onInput: (content: string) => void }) {
  const ref = useRef<HTMLTableCellElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element && document.activeElement !== element && element.innerText !== content) element.innerText = content;
  }, [content]);
  return <Tag ref={ref as never} data-table-cell={`${rowIndex}:${cellIndex}`} colSpan={colSpan} rowSpan={rowSpan} contentEditable suppressContentEditableWarning spellCheck onInput={(event) => onInput(event.currentTarget.innerText)} />;
}

function EditableBlock({ item, tips, onChange, onSelection, onOpenTip }: { item: DocumentBlock; tips: TipThread[]; onChange: (id: string, patch: EditableBlockPatch) => void; onSelection: (selection: SelectionInfo) => void; onOpenTip: (tip: TipThread) => void }) {
  const { t } = useI18n();
  const ref = useRef<HTMLElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const [markerPositions, setMarkerPositions] = useState<Record<string, { left: number; top: number }>>({});
  useLayoutEffect(() => { if (item.type !== "table" && ref.current && document.activeElement !== ref.current && ref.current.innerText !== item.content) ref.current.innerText = item.content; }, [item.id, item.content, item.type]);
  useLayoutEffect(() => {
    const measure = () => {
      const root = ref.current; const row = rowRef.current;
      if (!root || !row) return;
      const rowRect = row.getBoundingClientRect();
      const next: Record<string, { left: number; top: number }> = {};
      tips.forEach((tip, index) => {
        const rect = item.type === "table" && item.table ? tableRectForOffsets(root, item.table.rows, tip.startOffset, tip.endOffset) : rectForOffsets(root, tip.startOffset, tip.endOffset);
        next[tip.id] = rect
          ? { left: Math.min(rowRect.width - 22, Math.max(4, rect.right - rowRect.left + 5)), top: Math.max(-7, rect.top - rowRect.top - 9 + index * 3) }
          : { left: rowRect.width - 22, top: index * 24 };
      });
      setMarkerPositions(next);
    };
    measure(); window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [item.content, item.table, item.type, tips]);
  const select = () => {
    const selection = window.getSelection();
    const root = ref.current;
    if (!selection || selection.isCollapsed || !root || !selection.anchorNode || !selection.focusNode || !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return;
    const rawText = selection.toString();
    let text = rawText.trim();
    if (!text) return;
    let start: number; let end: number;
    if (item.type === "table" && item.table) {
      const anchorOffset = tableSelectionOffset(root, selection.anchorNode, selection.anchorOffset, item.table.rows);
      const focusOffset = tableSelectionOffset(root, selection.focusNode, selection.focusOffset, item.table.rows);
      if (anchorOffset == null || focusOffset == null) return;
      start = Math.min(anchorOffset, focusOffset); end = Math.max(anchorOffset, focusOffset);
      while (start < end && /\s/.test(item.content[start])) start += 1;
      while (end > start && /\s/.test(item.content[end - 1])) end -= 1;
      text = item.content.slice(start, end);
    } else {
      const rawStart = Math.min(offsetWithin(root, selection.anchorNode, selection.anchorOffset), offsetWithin(root, selection.focusNode, selection.focusOffset));
      const leadingWhitespace = rawText.length - rawText.trimStart().length;
      start = rawStart + leadingWhitespace;
      end = start + text.length;
    }
    if (!text) return;
    onSelection({ source: "document", blockId: item.id, text, startOffset: start, endOffset: end, rect: selection.getRangeAt(0).getBoundingClientRect() });
  };
  if (item.type === "table" && item.table) {
    const editCell = (rowIndex: number, cellIndex: number, content: string) => {
      const rows = item.table!.rows.map((row) => [...row]); rows[rowIndex][cellIndex] = content;
      const cells = rows.map((row, currentRow) => row.map((value, currentCell) => ({
        content: value,
        header: item.table!.cells?.[currentRow]?.[currentCell]?.header ?? currentRow < item.table!.headerRows,
        colSpan: item.table!.cells?.[currentRow]?.[currentCell]?.colSpan || 1,
        rowSpan: item.table!.cells?.[currentRow]?.[currentCell]?.rowSpan || 1
      })));
      const table = { ...item.table!, rows, cells };
      onChange(item.id, { content: tableText(rows), table });
    };
    return <div ref={rowRef} className="block-row block-table" data-block-row={item.id}>
      <div className="word-table-scroll">
        <table ref={ref as React.Ref<HTMLTableElement>} className="word-table" data-block-id={item.id} data-word-table onMouseUp={select} onKeyUp={select}><tbody>{item.table.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((content, cellIndex) => {
          const metadata = item.table!.cells?.[rowIndex]?.[cellIndex];
          const Tag = metadata?.header || rowIndex < item.table!.headerRows ? "th" : "td";
          return <EditableTableCell key={cellIndex} as={Tag} content={content} rowIndex={rowIndex} cellIndex={cellIndex} colSpan={metadata?.colSpan || 1} rowSpan={metadata?.rowSpan || 1} onInput={(nextContent) => editCell(rowIndex, cellIndex, nextContent)} />;
        })}</tr>)}</tbody></table>
      </div>
      {tips.length > 0 && <div className="tip-marker-layer">{tips.map((tip) => <TipMarkerButton key={tip.id} tip={tip} style={markerPositions[tip.id]} className={`tip-marker ${tip.status === "resolved" ? "resolved" : ""} ${tip.anchorStatus === "orphaned" ? "orphaned" : ""}`} onOpen={onOpenTip} openLabel={t("tip.open", { title: tip.title })} previewLabel={t("tip.fullPreview")} closeLabel={t("common.close")}><Sparkles size={10} /><span>TIP</span>{tip.messages.length > 0 && <small>{tip.messages.length}</small>}</TipMarkerButton>)}</div>}
    </div>;
  }
  const Tag = item.type === "heading" ? (item.level === 1 ? "h1" : item.level === 3 ? "h3" : "h2") : item.type === "code" ? "pre" : item.type === "quote" ? "blockquote" : "p";
  return (
    <div ref={rowRef} className={`block-row block-${item.type}`} data-block-row={item.id}>
      {item.type === "list_item" && <span className="list-bullet">•</span>}
      <Tag ref={ref as never} data-block-id={item.id} contentEditable suppressContentEditableWarning spellCheck onInput={(e) => onChange(item.id, { content: e.currentTarget.innerText })} onMouseUp={select} onKeyUp={select} />
      {tips.length > 0 && <div className="tip-marker-layer">{tips.map((tip) => <TipMarkerButton key={tip.id} tip={tip} style={markerPositions[tip.id]} className={`tip-marker ${tip.status === "resolved" ? "resolved" : ""} ${tip.anchorStatus === "orphaned" ? "orphaned" : ""}`} onOpen={onOpenTip} openLabel={t("tip.open", { title: tip.title })} previewLabel={t("tip.fullPreview")} closeLabel={t("common.close")}><Sparkles size={10} /><span>TIP</span>{tip.messages.length > 0 && <small>{tip.messages.length}</small>}</TipMarkerButton>)}</div>}
    </div>
  );
}

function SelectionToolbar({ selection, onCreate, onClose }: { selection: SelectionInfo | PdfSelectionInfo | ChatSelectionInfo; onCreate: () => void; onClose: () => void }) {
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
  const links = httpLinkRanges(presentation.plain);
  const boundaries = new Set([start, limit]);
  for (const range of presentation.bold) { if (range.start > start && range.start < limit) boundaries.add(range.start); if (range.end > start && range.end < limit) boundaries.add(range.end); }
  for (const range of links) { if (range.start > start && range.start < limit) boundaries.add(range.start); if (range.end > start && range.end < limit) boundaries.add(range.end); }
  const sorted = [...boundaries].sort((a, b) => a - b); const nodes: React.ReactNode[] = [];
  for (let index = 0; index < sorted.length - 1; index++) {
    const from = sorted[index]; const to = sorted[index + 1]; const value = presentation.plain.slice(from, to);
    const isBold = presentation.bold.some((range) => from >= range.start && to <= range.end);
    const link = links.find((range) => from >= range.start && to <= range.end);
    const rendered = isBold ? <strong>{value}</strong> : value;
    nodes.push(link ? <a data-message-link key={`${keyPrefix}-${from}`} href={link.url} target="_blank" rel="noreferrer">{rendered}</a> : <span key={`${keyPrefix}-${from}`}>{rendered}</span>);
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
    pieces.push(<mark className="chat-tip-anchor" data-chat-tip-anchor={child.id} key={child.id}>{renderMessageRange(message.content, child.startOffset, child.endOffset, `anchor-${child.id}`)}<TipMarkerButton tip={child} className="" onOpen={onOpenTip} openLabel={t("tip.open", { title: child.title })} previewLabel={t("tip.fullPreview")} closeLabel={t("common.close")}><Sparkles size={9} /><span className="sr-only">Tip</span></TipMarkerButton></mark>);
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
  const { t } = useI18n();
  if (!skills?.length) return null;
  const warnings = skills.filter((skill) => skill.status === "warning" || skill.status === "error").length;
  return <details className="skill-results" data-skill-results>
    <summary><span><Zap size={12} />{t("tip.toolsSummary", { count: skills.length })}</span>{warnings > 0 && <small>{t("tip.toolsWarnings", { count: warnings })}</small>}<ChevronDown size={13} /></summary>
    <div className="skill-results-body">{skills.map((skill, index) => <div className={`skill-result ${skill.name} ${skill.status || "success"}`} key={`${skill.name}-${index}`}>
      <span>{["web_search", "web_fetch", "cross_check", "conflict_check", "freshness_check", "manual_lookup"].includes(skill.name) ? <Globe2 size={12} /> : ["python", "unit_check", "uncertainty", "symbolic_math", "data_analysis"].includes(skill.name) ? <Calculator size={12} /> : <ShieldCheck size={12} />}{skill.label}</span><small>{skill.detail}</small>
      {skill.sources?.length ? <div className="skill-sources">{skill.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title}</a>)}</div> : null}
    </div>)}</div>
  </details>;
}

interface TipPanelProps { tip: TipThread; childTips: TipThread[]; modelStatus: AiRuntimeStatus | null; webSearchEnabled: boolean | null; webSearchBusy: boolean; streamingText: string; streamingSkills: SkillTrace[]; isStreaming: boolean; error: string; contextMode?: boolean; onSend: (question: string) => void; onStop: () => void; onToggleWebSearch: () => void; onCollapse: () => void; onFocus?: () => void; onResolve: () => void; onDelete: () => void; onToggleMemory: () => void; onMessageSelection: (selection: ChatSelectionInfo) => void; onOpenTip: (tip: TipThread) => void; onOpenSettings: () => void; onOpenLocalModels: () => void; }
function TipPanel({ tip, childTips, modelStatus, webSearchEnabled, webSearchBusy, streamingText, streamingSkills, isStreaming, error, contextMode = false, onSend, onStop, onToggleWebSearch, onCollapse, onFocus, onResolve, onDelete, onToggleMemory, onMessageSelection, onOpenTip, onOpenSettings, onOpenLocalModels }: TipPanelProps) {
  const { language, t } = useI18n();
  const [question, setQuestion] = useState("");
  const messageListRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const messageList = messageListRef.current;
    if (messageList) messageList.scrollTop = messageList.scrollHeight;
  }, [tip.id, tip.messages.length, streamingText]);
  const modelReady = modelStatus?.configured === true;
  const submit = () => { if (!question.trim() || isStreaming || !modelReady) return; onSend(question.trim()); setQuestion(""); };
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
      <div className="selected-quote"><p>{tip.anchorType === "message" ? t("tip.selectedChat") : tip.anchorType === "pdf" ? t("tip.selectedPdf", { page: tip.pdfAnchor?.pageNumber || 1 }) : t("tip.selected")}</p><blockquote>{tip.selectedText}</blockquote><div className="tip-context-controls"><span className={`anchor-badge ${tip.anchorStatus}`}>{tip.anchorStatus === "valid" ? t("tip.anchorValid") : tip.anchorStatus === "recovered" ? t("tip.anchorRecovered") : t("tip.anchorLost")}</span><button className={tip.memoryEnabled === false ? "" : "active"} onClick={onToggleMemory} title={t("tip.memoryHint")}><Brain size={12} />{tip.memoryEnabled === false ? t("tip.memoryOff") : t("tip.memoryOn")}</button></div></div>
      <div ref={messageListRef} className="message-list">
        {tip.messages.length === 0 && !streamingText && modelReady && <div className="tip-welcome"><div><WandSparkles size={20} /></div><h3>{t("tip.start")}</h3><p>{t("tip.welcome")}</p><div className="tip-prompts">{prompts.map(([key, prompt]) => <button key={key} onClick={() => onSend(prompt)}>{t(key)}</button>)}</div></div>}
        {tip.messages.map((message) => <div className={`message ${message.role}`} key={message.id} data-message-id={message.id}>{message.role === "assistant" && <span className="assistant-mark"><Sparkles size={13} /></span>}<div>{message.role === "assistant" && <SkillResults skills={message.skills} />}<MessageContent tip={tip} message={message} childTips={childTips} onSelection={onMessageSelection} onOpenTip={onOpenTip} />{message.role === "assistant" && <button className="copy-message" onClick={() => void navigator.clipboard.writeText(message.content)}><Copy size={13} />{t("common.copy")}</button>}</div></div>)}
        {isStreaming && <div className="message assistant"><span className="assistant-mark"><Sparkles size={13} /></span><div><SkillResults skills={streamingSkills} />{streamingText ? renderMessage(streamingText) : streamingSkills.length ? <span className="tool-thinking">{t("tip.checkingTools")}</span> : <span className="thinking"><i /><i /><i /></span>}<span className="cursor" /></div></div>}
        {error && <div className="chat-error"><CircleHelp size={15} />{error}</div>}
        {!modelReady && <div className="tip-model-required" data-model-required={modelStatus?.reason || "checking"}><div>{modelStatus ? <Cpu size={20} /> : <LoaderCircle className="spin" size={20} />}</div><h3>{modelStatus ? t("tip.modelRequiredTitle") : t("tip.modelChecking")}</h3><p>{modelStatus?.reason === "ollama-unreachable" || modelStatus?.reason === "invalid-local-endpoint" ? t("tip.ollamaUnavailable") : modelStatus?.reason === "model-not-installed" ? t("tip.localModelMissing") : modelStatus ? t("tip.modelRequired") : t("tip.modelCheckingHint")}</p>{modelStatus && <div><button className="secondary compact" onClick={onOpenSettings}><Settings size={14} />{t("tip.configureApi")}</button><button className="primary compact" onClick={onOpenLocalModels}><Download size={14} />{t("tip.downloadLocal")}</button></div>}</div>}
        <div />
      </div>
      <div className="tip-composer">
        <textarea disabled={!modelReady} value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }} placeholder={modelReady ? t("tip.followup") : t("tip.modelRequiredPlaceholder")} rows={3} />
        <div><span>{t("tip.sendHint")}</span><div className="tip-composer-actions"><button className={`composer-web-search ${webSearchEnabled ? "on" : "off"}`} data-chat-web-search-toggle aria-pressed={webSearchEnabled === true} disabled={webSearchEnabled === null || webSearchBusy || isStreaming} onClick={onToggleWebSearch} title={webSearchBusy ? t("tip.webSearchUpdating") : t("tip.webSearchHint")}><Globe2 size={13} /><span>{webSearchEnabled ? t("tip.webSearchOn") : t("tip.webSearchOff")}</span><i /></button>{isStreaming ? <button className="stop-button" onClick={onStop}><Square size={13} fill="currentColor" />{t("tip.stop")}</button> : <button className="send-button" disabled={!question.trim() || !modelReady} onClick={submit}><Send size={15} /></button>}</div></div>
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

interface EditorProps { id: string; cloudEnabled: boolean; settingsRevision: number; onBack: () => void; onSettings: () => void; onOpenLocalModels: () => void; onRegisterSave: (save: (() => Promise<void>) | null) => void; }
function EditorScreen({ id, cloudEnabled, settingsRevision, onBack, onSettings, onOpenLocalModels, onRegisterSave }: EditorProps) {
  const { language, t } = useI18n();
  const [documentItem, setDocumentItem] = useState<DocumentItem | null>(null);
  const [tips, setTips] = useState<TipThread[]>([]);
  const [activeTipId, setActiveTipId] = useState<string | null>(null);
  const [selection, setSelection] = useState<SelectionInfo | PdfSelectionInfo | ChatSelectionInfo | null>(null);
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
  const [modelStatus, setModelStatus] = useState<AiRuntimeStatus | null>(null);
  const [webSearchEnabled, setWebSearchEnabled] = useState<boolean | null>(null);
  const [webSearchBusy, setWebSearchBusy] = useState(false);
  const [cloudOperation, setCloudOperation] = useState<"upload" | "delete" | null>(null);
  const dirty = useRef(false);
  const editVersion = useRef(0);
  const documentRef = useRef<DocumentItem | null>(null);
  const saveInFlight = useRef<Promise<void> | null>(null);
  const controller = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    try { const result = await api.document(id); setDocumentItem(result.document); setTips(result.tips); }
    catch (err) { setError(err instanceof Error ? err.message : t("editor.loadFailed")); }
  }, [id, t]);
  useEffect(() => { void load(); return () => controller.current?.abort(); }, [load]);
  const refreshModelStatus = useCallback(async () => {
    try { setModelStatus((await api.aiStatus()).status); }
    catch { setModelStatus({ configured: false, provider: "openai", model: "", reason: "no-api-key", local: false }); }
  }, []);
  useEffect(() => { setModelStatus(null); void refreshModelStatus(); }, [refreshModelStatus, settingsRevision]);
  useEffect(() => {
    let active = true;
    void api.settings().then(({ settings }) => { if (active) setWebSearchEnabled(settings.webSearchEnabled); })
      .catch(() => { if (active) setWebSearchEnabled(null); });
    return () => { active = false; };
  }, [settingsRevision]);
  useLayoutEffect(() => { documentRef.current = documentItem; }, [documentItem]);

  const saveNow = useCallback(async () => {
    while (dirty.current) {
      if (saveInFlight.current) {
        await saveInFlight.current;
        continue;
      }
      const snapshot = documentRef.current;
      if (!snapshot) return;
      const savingVersion = editVersion.current;
      setSaveState(navigator.onLine ? "saving" : "offline");
      const request = api.updateDocument(snapshot.id, { title: snapshot.title, blocks: snapshot.blocks }).then(() => {
        if (editVersion.current === savingVersion) dirty.current = false;
      });
      saveInFlight.current = request;
      try { await request; }
      catch (error) { setSaveState(navigator.onLine ? "error" : "offline"); throw error; }
      finally { if (saveInFlight.current === request) saveInFlight.current = null; }
    }
    setSaveState("saved");
  }, []);

  useEffect(() => {
    onRegisterSave(saveNow);
    return () => onRegisterSave(null);
  }, [onRegisterSave, saveNow]);

  useEffect(() => {
    if (!dirty.current || !documentItem) return;
    setSaveState(navigator.onLine ? "saving" : "offline");
    const timer = window.setTimeout(() => { void saveNow().catch(() => undefined); }, 900);
    return () => window.clearTimeout(timer);
  }, [documentItem, saveNow]);

  useEffect(() => {
    const online = () => { if (dirty.current) setSaveState("saving"); };
    const offline = () => setSaveState("offline");
    window.addEventListener("online", online); window.addEventListener("offline", offline);
    return () => { window.removeEventListener("online", online); window.removeEventListener("offline", offline); };
  }, []);

  const updateBlock = (blockId: string, patch: EditableBlockPatch) => {
    const current = documentRef.current;
    if (!current) return;
    const next = { ...current, blocks: current.blocks.map((b) => b.id === blockId ? { ...b, ...patch, updatedAt: new Date().toISOString() } : b) };
    documentRef.current = next;
    setDocumentItem(next);
    dirty.current = true; editVersion.current += 1;
  };
  const updateTitle = (title: string) => {
    const current = documentRef.current;
    if (!current) return;
    const next = { ...current, title };
    documentRef.current = next;
    setDocumentItem(next); dirty.current = true; editVersion.current += 1;
  };
  const manualSave = async () => {
    try { await saveNow(); }
    catch { setSaveState("error"); }
  };
  const uploadCloud = async () => {
    setCloudOperation("upload"); setError("");
    try { await saveNow(); const result = await api.uploadDocumentToCloud(id); documentRef.current = result.document; setDocumentItem(result.document); }
    catch (err) { setError(err instanceof Error ? err.message : t("cloud.failed")); }
    finally { setCloudOperation(null); }
  };
  const removeCloud = async () => {
    if (!documentRef.current?.cloudSyncedAt || !window.confirm(t("cloud.removeConfirm"))) return;
    setCloudOperation("delete"); setError("");
    try {
      await saveNow();
      const result = await api.removeDocumentFromCloud(id);
      documentRef.current = result.document;
      setDocumentItem(result.document);
    } catch (err) { setError(err instanceof Error ? err.message : t("cloud.failed")); }
    finally { setCloudOperation(null); }
  };
  const leaveEditor = async () => {
    try { await saveNow(); onBack(); }
    catch { setSaveState("error"); }
  };
  useEffect(() => {
    const saveShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void manualSave(); }
    };
    window.addEventListener("keydown", saveShortcut);
    return () => window.removeEventListener("keydown", saveShortcut);
  });
  const addBlock = (type: BlockType) => {
    const current = documentRef.current;
    if (!current) return;
    const stamp = new Date().toISOString();
    const newBlock: DocumentBlock = { id: crypto.randomUUID(), documentId: current.id, type, content: "", level: type === "heading" ? 2 : undefined, order: current.blocks.length, contentHash: "", createdAt: stamp, updatedAt: stamp };
    const next = { ...current, blocks: [...current.blocks, newBlock] };
    documentRef.current = next;
    setDocumentItem(next); dirty.current = true; editVersion.current += 1;
  };
  const createTip = async () => {
    if (!selection || !documentItem) return;
    try {
      let tip: TipThread;
      if (selection.source === "document") {
        const target = documentItem.blocks.find((b) => b.id === selection.blockId);
        if (!target) return;
        ({ tip } = await api.createTip(documentItem.id, { blockId: selection.blockId, selectedText: selection.text, startOffset: selection.startOffset, endOffset: selection.endOffset, prefixText: target.content.slice(Math.max(0, selection.startOffset - 32), selection.startOffset), suffixText: target.content.slice(selection.endOffset, selection.endOffset + 32) }));
      } else if (selection.source === "pdf") {
        ({ tip } = await api.createPdfTip(documentItem.id, { selectedText: selection.text, prefixText: selection.prefixText, suffixText: selection.suffixText, pdfAnchor: selection.pdfAnchor }));
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
    if (isStreaming || !modelStatus?.configured) return;
    setIsStreaming(true); setStreamingTipId(tipId); setStreamingText(""); setStreamingSkills([]); setChatError(""); setChatErrorTipId(null);
    const ctrl = new AbortController(); controller.current = ctrl;
    setTips((current) => current.map((tip) => tip.id === tipId ? { ...tip, messages: [...tip.messages, { id: `temp-${Date.now()}`, tipId: tip.id, role: "user", content: question, createdAt: new Date().toISOString() }] } : tip));
    try {
      const finalTip = await api.streamTip(tipId, question, language, ctrl.signal, (chunk) => setStreamingText((text) => text + chunk), (skill) => setStreamingSkills((current) => [...current, skill]));
      setTips((current) => current.map((tip) => tip.id === tipId ? finalTip : tip)); setStreamingText(""); setStreamingSkills([]);
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setChatError(err instanceof Error ? err.message : t("editor.generateFailed")); setChatErrorTipId(tipId);
        if (err instanceof ApiError && ["MODEL_NOT_CONFIGURED", "LOCAL_MODEL_NOT_INSTALLED", "LOCAL_RUNTIME_UNAVAILABLE"].includes(err.code)) void refreshModelStatus();
      }
      await load();
    } finally { setIsStreaming(false); setStreamingTipId(null); controller.current = null; }
  };
  const toggleWebSearch = async (tipId: string) => {
    if (webSearchEnabled === null || webSearchBusy || isStreaming) return;
    setWebSearchBusy(true); setChatError(""); setChatErrorTipId(null);
    try {
      const { settings } = await api.updateWebSearchEnabled(!webSearchEnabled, language);
      setWebSearchEnabled(settings.webSearchEnabled);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : t("tip.webSearchUpdateFailed"));
      setChatErrorTipId(tipId);
    } finally { setWebSearchBusy(false); }
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
    modelStatus={modelStatus} webSearchEnabled={webSearchEnabled} webSearchBusy={webSearchBusy}
    streamingText={streamingTipId === tip.id ? streamingText : ""} streamingSkills={streamingTipId === tip.id ? streamingSkills : []}
    isStreaming={isStreaming && streamingTipId === tip.id} error={chatErrorTipId === tip.id ? chatError : ""}
    onSend={(question) => void send(tip.id, question)} onStop={() => { if (streamingTipId === tip.id) controller.current?.abort(); }} onToggleWebSearch={() => void toggleWebSearch(tip.id)}
    onCollapse={() => collapseTip(tip)} onFocus={() => openTip(tip)}
    onResolve={() => void patchTip(tip.id, { status: tip.status === "resolved" ? "open" : "resolved" })}
    onDelete={() => void deleteTip(tip.id)} onToggleMemory={() => void patchTip(tip.id, { memoryEnabled: tip.memoryEnabled === false })}
    onMessageSelection={setSelection} onOpenTip={openTip} onOpenSettings={onSettings} onOpenLocalModels={onOpenLocalModels}
  />;
  return (
    <div className={`editor-shell ${activeTip ? "with-tip" : ""} ${!navOpen ? "nav-hidden" : ""}`} data-editor-document={documentItem.id}>
      {navOpen && <aside className="editor-nav">
        <div className="editor-nav-top"><button className="back-button" onClick={() => void leaveEditor()}><ChevronLeft size={17} />{t("editor.library")}</button><button className="icon-button" onClick={() => setNavOpen(false)}><PanelLeftClose size={17} /></button></div>
        <div className="mini-brand"><span className="brand-mark"><Sparkles size={14} /></span>AI Tip</div>
        <button className="outline-toggle" onClick={() => setOutlineOpen(!outlineOpen)}><span>{t("editor.outline")}</span><ChevronDown size={15} className={outlineOpen ? "" : "rotated"} /></button>
        {outlineOpen && <nav className="outline">{outline.map((item) => <button key={item.id} className={`level-${item.level || 2}`} onClick={() => document.querySelector(`[data-block-row="${item.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" })}>{item.content || t("editor.untitledHeading")}</button>)}</nav>}
        <div className="tip-summary"><p><MessageCircleMore size={15} />{t("editor.documentTips")} <span>{tips.length}</span></p>{tips.filter((tip) => !tip.parentTipId).slice(0, 5).map((tip) => <button key={tip.id} onClick={() => openTip(tip)}><i className={tip.status} /> <span>{tip.title}</span><small>{tip.messages.length}</small></button>)}</div>
      </aside>}
      {leftTip ? renderTipPanel(leftTip, true) : <main className="editor-main">
        <header className="editor-topbar">
          <div>{!navOpen && <button className="icon-button" onClick={() => setNavOpen(true)}><Menu size={18} /></button>}<div className="doc-breadcrumb"><FileText size={16} /><span>{documentItem.title || t("editor.untitled")}</span></div></div>
          <div className="editor-controls"><SaveIndicator state={saveState} /><button className="secondary compact" onClick={() => void manualSave()}><HardDrive size={15} />{t("common.save")}</button>{cloudEnabled && <button className="secondary compact cloud-upload-button" disabled={cloudOperation !== null || documentItem.cloudState === "synced"} onClick={() => void uploadCloud()}>{cloudOperation === "upload" ? <LoaderCircle className="spin" size={15} /> : <Cloud size={15} />}{cloudOperation === "upload" ? t("cloud.uploading") : documentItem.cloudState === "synced" ? t("cloud.synced") : documentItem.cloudState === "modified" ? t("cloud.update") : t("cloud.upload")}</button>}{cloudEnabled && Boolean(documentItem.cloudSyncedAt) && <button className="secondary compact cloud-delete-button" data-delete-cloud-file={documentItem.id} disabled={cloudOperation !== null} onClick={() => void removeCloud()}>{cloudOperation === "delete" ? <LoaderCircle className="spin" size={15} /> : <CloudOff size={15} />}{cloudOperation === "delete" ? t("cloud.deleting") : t("cloud.remove")}</button>}<button className={`icon-button ${documentItem.favorite ? "starred" : ""}`} onClick={async () => { const favorite = !documentItem.favorite; setDocumentItem({ ...documentItem, favorite }); await api.updateDocument(documentItem.id, { favorite }); }}><Star size={17} fill={documentItem.favorite ? "currentColor" : "none"} /></button><button className="icon-button" onClick={onSettings} title={t("editor.settings")}><Settings size={18} /></button></div>
        </header>
        <div className="editor-scroll" onScroll={() => setSelection(null)}>
          <article className="document-page">
            <div className="page-meta"><span>{documentItem.sourceType === "blank" ? t("editor.personalNote") : t("editor.imported", { type: documentItem.sourceType.toUpperCase() })}</span><span>{t("editor.lastEdited", { time: timeAgo(documentItem.updatedAt, language, t) })}</span></div>
            <input className="document-title" value={documentItem.title} onChange={(e) => updateTitle(e.target.value)} placeholder={t("editor.untitled")} />
            <div className="document-rule" />
            {documentItem.sourceType === "pdf" ? <PdfPreview documentId={documentItem.id} blocks={documentItem.blocks} structure={documentItem.pdfStructure} tipsByBlock={tipsByBlock} onSelection={setSelection} onOpenTip={openTip} labels={{ loading: t("pdf.loading"), loadFailed: t("pdf.loadFailed"), structured: t("pdf.structured"), original: t("pdf.original"), structureHint: t("pdf.structureHint"), tableHeuristic: (confidence) => t("pdf.tableHeuristic", { confidence }), imageAlt: (page) => t("pdf.imageAlt", { page }), structureFailed: (error) => t("pdf.structureFailed", { error }), visualOnly: t("pdf.visualOnly"), exportAnnotations: t("pdf.exportAnnotations"), exportingAnnotations: t("pdf.exportingAnnotations"), runOcr: t("pdf.runOcr"), runningOcr: t("pdf.runningOcr"), ocrSource: (confidence) => t("pdf.ocrSource", { confidence }), page: (pageNumber, pageCount) => t("pdf.page", { page: pageNumber, count: pageCount }), tipPreview: t("tip.fullPreview"), close: t("common.close"), openTip: (title) => t("tip.open", { title }) }} /> : <>
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
  const [localModelsOpen, setLocalModelsOpen] = useState(false);
  const [settingsRevision, setSettingsRevision] = useState(0);
  const [importPhase, setImportPhase] = useState<ImportPhase>("idle");
  const [importError, setImportError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const saveBeforeImportRef = useRef<(() => Promise<void>) | null>(null);
  const importBusyRef = useRef(false);
  const dragDepthRef = useRef(0);
  const registerSave = useCallback((save: (() => Promise<void>) | null) => { saveBeforeImportRef.current = save; }, []);

  const importDocuments = useCallback(async (files: File[]) => {
    if (!files.length || importBusyRef.current) return;
    const unsupported = files.filter((file) => !isSupportedDocument(file));
    if (unsupported.length) {
      setImportError(t("import.unsupported", { names: unsupported.map((file) => file.name).join(", ") }));
      setImportPhase("idle");
      return;
    }
    importBusyRef.current = true;
    setImportError("");
    try {
      setImportPhase("saving");
      await saveBeforeImportRef.current?.();
      setImportPhase("uploading");
      let lastDocument: DocumentItem | null = null;
      for (const file of files) ({ document: lastDocument } = await api.upload(file));
      if (!lastDocument) throw new Error(t("library.importFailed"));
      setSettingsOpen(false);
      setScreen({ type: "editor", id: lastDocument.id });
    } catch (error) {
      setImportError(error instanceof Error ? error.message : t("library.importFailed"));
    } finally {
      importBusyRef.current = false;
      setImportPhase("idle");
    }
  }, [t]);

  useEffect(() => {
    if (!user) return;
    const containsFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types || []).includes("Files");
    const dragEnter = (event: DragEvent) => {
      if (!containsFiles(event)) return;
      event.preventDefault(); event.stopPropagation();
      dragDepthRef.current += 1;
      if (!importBusyRef.current) { setImportError(""); setImportPhase("dragging"); }
    };
    const dragOver = (event: DragEvent) => {
      if (!containsFiles(event)) return;
      event.preventDefault(); event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const dragLeave = (event: DragEvent) => {
      if (!containsFiles(event)) return;
      event.preventDefault(); event.stopPropagation();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0 && !importBusyRef.current) setImportPhase("idle");
    };
    const drop = (event: DragEvent) => {
      if (!containsFiles(event)) return;
      event.preventDefault(); event.stopPropagation();
      dragDepthRef.current = 0;
      void importDocuments(Array.from(event.dataTransfer?.files || []));
    };
    window.addEventListener("dragenter", dragEnter, true);
    window.addEventListener("dragover", dragOver, true);
    window.addEventListener("dragleave", dragLeave, true);
    window.addEventListener("drop", drop, true);
    return () => {
      window.removeEventListener("dragenter", dragEnter, true);
      window.removeEventListener("dragover", dragOver, true);
      window.removeEventListener("dragleave", dragLeave, true);
      window.removeEventListener("drop", drop, true);
      dragDepthRef.current = 0;
    };
  }, [importDocuments, user]);

  useEffect(() => {
    if (!session.get()) return;
    api.me().then(({ user: current }) => setUser(current)).catch(() => session.clear()).finally(() => setChecking(false));
  }, []);
  if (checking) return <div className="loading-state fullscreen"><LoaderCircle className="spin" /><span>{t("app.entering")}</span></div>;
  if (!user) return <AuthScreen onAuth={setUser} />;
  const openLocalModels = () => {
    void (async () => {
      try { await saveBeforeImportRef.current?.(); }
      catch { setImportError(t("save.failed")); return; }
      setSettingsOpen(false); setLocalModelsOpen(true);
    })();
  };
  return <>
    <input ref={fileInputRef} data-global-document-input type="file" accept={DOCUMENT_ACCEPT} multiple hidden onChange={(event) => { const files = Array.from(event.currentTarget.files || []); event.currentTarget.value = ""; void importDocuments(files); }} />
    {localModelsOpen ? <LocalModelsScreen onBack={() => setLocalModelsOpen(false)} onConnected={() => setSettingsRevision((value) => value + 1)} /> : screen.type === "editor"
    ? <EditorScreen id={screen.id} cloudEnabled={user.authMode === "supabase"} settingsRevision={settingsRevision} onBack={() => setScreen({ type: "library", tab: "all" })} onSettings={() => setSettingsOpen(true)} onOpenLocalModels={openLocalModels} onRegisterSave={registerSave} />
    : <LibraryScreen user={user} screen={screen} onScreen={setScreen} onUpload={() => fileInputRef.current?.click()} onLogout={() => { session.clear(); setSettingsOpen(false); setLocalModelsOpen(false); setImportError(""); setImportPhase("idle"); setScreen({ type: "library", tab: "all" }); setUser(null); }} onSettings={() => setSettingsOpen(true)} />}
    {settingsOpen && <SettingsModal user={user} onClose={() => setSettingsOpen(false)} onOpenLocalModels={openLocalModels} onSaved={() => setSettingsRevision((value) => value + 1)} onAccountDeleted={() => { session.clear(); setSettingsOpen(false); setLocalModelsOpen(false); setImportError(""); setImportPhase("idle"); setScreen({ type: "library", tab: "all" }); setUser(null); }} />}
    {importPhase !== "idle" && <div className={`document-drop-overlay ${importPhase}`} data-import-phase={importPhase}><div>{importPhase === "uploading" || importPhase === "saving" ? <LoaderCircle className="spin" size={28} /> : <Upload size={28} />}<h2>{importPhase === "dragging" ? t("import.dropTitle") : importPhase === "saving" ? t("import.saving") : t("import.uploading")}</h2><p>{importPhase === "dragging" ? t("import.dropHint") : t("import.wait")}</p></div></div>}
    {importError && <div className="global-import-error" data-import-error><CircleHelp size={16} /><span>{importError}</span><button onClick={() => setImportError("")}><X size={14} /><span className="sr-only">{t("common.close")}</span></button></div>}
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
