import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Download, FileText, Folder, LoaderCircle, Plus, Puzzle, Search, Trash2, Upload, X } from 'lucide-react';
import { api, ApiError } from './api';
import { translate, type Language } from './i18n';
import { SKILL_LIMITS, type SkillDraft, type UserSkill } from './user-skills';
import { notifySkillChange } from './skill-events';

const asDraft = (s: SkillDraft): SkillDraft => ({ name: s.name, description: s.description, instructions: s.instructions, files: s.files.map(f => ({ ...f })), format: s.format });
export function SkillManager({ language, onClose }: { language: Language; onClose: () => void }) {
  const t = (key: string, vars?: Record<string, string | number>) => translate(language, key, vars);
  const [skills, setSkills] = useState<UserSkill[]>([]);
  const [selected, setSelected] = useState<UserSkill | null>(null);
  const [draft, setDraft] = useState<SkillDraft | null>(null);
  const [initial, setInitial] = useState('');
  const [preview, setPreview] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const dirty = draft !== null && JSON.stringify(draft) !== initial;
  const confirmLeave = () => !dirty || window.confirm(t('skills.discard'));
  const close = () => { if (!busy && confirmLeave()) onClose(); };
  const closeRef = useRef(close); closeRef.current = close;
  useEffect(() => {
    let active = true;
    api.skills().then(result => { if (active) setSkills(result.skills); }).catch(error => { if (active) setMessage({ error: true, text: String(error.message) }); }).finally(() => { if (active) setLoading(false); });
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') || []).filter(el => el.getClientRects().length > 0);
      const first = focusable[0], last = focusable.at(-1);
      if (!first) return;
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus(); }
    };
    dialog.current?.addEventListener('keydown', handler);
    const node = dialog.current;
    return () => { active = false; node?.removeEventListener('keydown', handler); previous?.focus(); };
  }, []);
  const visible = useMemo(() => skills.filter(s => `${s.name} ${s.description}`.toLowerCase().includes(query.toLowerCase()) && (filter === 'all' || s.enabled === (filter === 'enabled'))), [skills, query, filter]);
  const select = (s: UserSkill) => { if (!confirmLeave()) return; const value = asDraft(s); setSelected(s); setDraft(value); setInitial(JSON.stringify(value)); setPreview(false); setMessage(null); };
  const run = async (action: () => Promise<void>) => {
    if (busy) return; setBusy(true); setMessage(null);
    try { await action(); } catch (error) {
      setMessage({ error: true, text: error instanceof ApiError && error.code.startsWith('SKILL_') ? t(`skills.error.${error.code.slice(6).toLowerCase()}`) : error instanceof Error ? error.message : t('skills.error.storage') });
    } finally { setBusy(false); }
  };
  const importFiles = (files: File[], folder = false) => {
    if (!files.length || !confirmLeave()) return;
    void run(async () => {
      if (files.length > SKILL_LIMITS.files || files.reduce((n, f) => n + f.size, 0) > SKILL_LIMITS.uploadBytes) throw new Error(t('skills.error.limit'));
      let result;
      if (folder) {
        const input = await Promise.all(files.filter(f => f.name !== '.DS_Store' && !f.webkitRelativePath.startsWith('__MACOSX/')).map(async f => {
          if (f.size > SKILL_LIMITS.fileBytes) throw new Error(t('skills.error.limit'));
          let content: string; try { content = new TextDecoder('utf-8', { fatal: true }).decode(await f.arrayBuffer()); } catch { throw new Error(t('skills.error.encoding')); }
          return { path: f.webkitRelativePath || f.name, content };
        }));
        result = await api.previewSkillFolder(input);
      } else { if (files.length !== 1) throw new Error(t('skills.error.entry')); result = await api.previewSkill(files[0]); }
      const value = asDraft(result.preview); setSelected(null); setDraft(value); setInitial(''); setPreview(true);
    });
  };
  const save = () => { if (!draft) return; void run(async () => {
    const result = selected ? await api.updateSkill(selected.id, { ...draft, signature: selected.signature }) : await api.createSkill(draft);
    setSkills(current => selected ? current.map(s => s.id === selected.id ? result.skill : s) : [...current, result.skill]);
    setSelected(result.skill); const value = asDraft(result.skill); setDraft(value); setInitial(JSON.stringify(value)); setPreview(false);
    setMessage({ error: false, text: t(selected ? 'skills.saved' : 'skills.installed') });
    notifySkillChange();
  }); };
  const toggle = (s: UserSkill) => { if (dirty && s.id === selected?.id && !confirmLeave()) return; void run(async () => {
    const result = await api.updateSkill(s.id, { enabled: !s.enabled, signature: s.signature });
    setSkills(current => current.map(item => item.id === s.id ? result.skill : item));
    notifySkillChange();
    if (selected?.id === s.id) { setSelected(result.skill); const value = asDraft(result.skill); setDraft(value); setInitial(JSON.stringify(value)); }
  }); };
  const remove = () => { if (!selected || !window.confirm(t('skills.deleteConfirm', { name: selected.name }))) return; void run(async () => {
    await api.deleteSkill(selected.id, selected.signature); setSkills(current => current.filter(s => s.id !== selected.id)); setSelected(null); setDraft(null); setInitial(''); setMessage({ error: false, text: t('skills.deleted') });
    notifySkillChange();
  }); };
  const exportFile = () => { if (!selected) return; void run(async () => {
    const blob = await api.exportSkill(selected.id); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${selected.name.replace(/[<>:"/\\|?*]/g, '-')}.zip`; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 5000);
  }); };
  return <div className="modal-backdrop skills-backdrop" data-skill-manager-backdrop onDragEnter={e => e.stopPropagation()} onDragOver={e => { e.preventDefault(); e.stopPropagation(); }} onDrop={e => { e.preventDefault(); e.stopPropagation(); importFiles(Array.from(e.dataTransfer.files)); }}>
    <section className="skills-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="skills-title" tabIndex={-1} data-skill-manager>
      <header><div><span className="settings-kicker"><Puzzle size={14} />SKILLS</span><h2 id="skills-title">{t('skills.title')}</h2><p>{t('skills.subtitle')}</p></div><button className="icon-button" onClick={close} disabled={busy} aria-label={t('skills.close')}><X size={18} /></button></header>
      <div className="skills-toolbar"><div className="skills-import-actions"><button className="primary" data-skill-import onClick={() => fileInput.current?.click()} disabled={busy}><Upload size={16} />{t('skills.import')}</button><button className="secondary" onClick={() => folderInput.current?.click()} disabled={busy}><Folder size={16} />{t('skills.folder')}</button><button className="secondary" data-skill-new onClick={() => { if (!confirmLeave()) return; setSelected(null); setDraft({ name: '', description: '', instructions: '', files: [], format: 'markdown' }); setInitial(''); setPreview(false); setMessage(null); }} disabled={busy}><Plus size={16} />{t('skills.new')}</button></div><span>{t('skills.count', { count: skills.length, enabled: skills.filter(s => s.enabled).length })}</span></div>
      <input hidden ref={fileInput} type="file" accept=".md,.zip" data-skill-file onChange={e => { importFiles(Array.from(e.target.files || [])); e.target.value = ''; }} />
      <input hidden ref={folderInput} type="file" {...{ webkitdirectory: '' }} data-skill-folder onChange={e => { importFiles(Array.from(e.target.files || []), true); e.target.value = ''; }} />
      {message && <div className={`skills-notice ${message.error ? 'error' : 'ok'}`} role="status" data-skill-notice>{message.text}</div>}
      <div className="skills-layout"><aside className="skills-list">
        <label className="skills-search"><Search size={15} /><input aria-label={t('skills.search')} placeholder={t('skills.search')} value={query} onChange={e => setQuery(e.target.value)} /></label>
        <select aria-label={t('skills.all')} value={filter} onChange={e => setFilter(e.target.value)}>{['all', 'enabled', 'disabled'].map(f => <option key={f} value={f}>{t(`skills.${f}`)}</option>)}</select>
        <div className="skills-list-scroll">{loading ? <p className="skills-empty"><LoaderCircle className="spin" size={18} />{t('skills.loading')}</p> : visible.length ? visible.map(s => <div className={`skill-card ${selected?.id === s.id ? 'selected' : ''}`} key={s.id} data-skill-id={s.id}><button className="skill-card-content" disabled={busy} onClick={() => select(s)}><span><Puzzle size={15} /><strong>{s.name}</strong></span><p>{s.description}</p><small>{t(s.enabled ? 'skills.enabled' : 'skills.disabled')}</small></button><button className={`toggle ${s.enabled ? 'on' : ''}`} data-skill-toggle={s.id} disabled={busy} role="switch" aria-checked={s.enabled} aria-label={t('skills.enableLabel', { name: s.name })} onClick={() => toggle(s)}><i /></button></div>) : <p className="skills-empty">{t(skills.length ? 'skills.noMatch' : 'skills.empty')}</p>}</div>
      </aside><main className="skill-detail">
        {draft ? <><div className="skill-detail-scroll"><div className="skill-detail-status"><span title={selected?.signature}>{selected ? t('skills.version', { revision: selected.revision }) : t(preview ? 'skills.preview' : 'skills.newDraft')}</span>{selected && <span className={`skill-enabled-badge ${selected.enabled ? 'on' : ''}`}>{t(selected.enabled ? 'skills.enabled' : 'skills.disabled')}</span>}</div>
          <label>{t('skills.name')}<input data-skill-name value={draft.name} maxLength={draft.format === 'agent-skill' ? 64 : 80} disabled={busy} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
          <label>{t('skills.description')}<textarea data-skill-description rows={2} maxLength={1024} value={draft.description} disabled={busy} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
          <label>{t('skills.instructions')}<textarea data-skill-instructions className="skill-instructions" rows={12} value={draft.instructions} disabled={busy} onChange={e => setDraft({ ...draft, instructions: e.target.value })} /><small>{t('skills.instructionsHint')}</small></label>
          {draft.files.length > 0 && <details className="skill-references"><summary><FileText size={15} />{t('skills.references', { count: draft.files.length })}</summary>{draft.files.map((f, index) => <label key={f.path}><code>{f.path}</code><textarea value={f.content} rows={5} disabled={busy} onChange={e => setDraft({ ...draft, files: draft.files.map((other, i) => i === index ? { ...other, content: e.target.value } : other) })} /></label>)}</details>}
          </div><div className="skill-detail-actions">{selected && <><button className="secondary" onClick={exportFile} disabled={busy || dirty}><Download size={15} />{t('skills.export')}</button><button className="secondary danger-soft" data-skill-delete onClick={remove} disabled={busy}><Trash2 size={15} />{t('skills.delete')}</button></>}<button className="primary" data-skill-save onClick={save} disabled={busy || !dirty || !draft.name.trim() || !draft.description.trim() || !draft.instructions.trim()}>{busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}{t(selected ? 'skills.save' : 'skills.install')}</button></div>
        </> : <div className="skill-empty-detail"><Puzzle size={38} /><h3>{t(skills.length ? 'skills.choose' : 'skills.empty')}</h3><p>{t('skills.emptyHint')}</p></div>}
      </main></div>
      <footer><span><Puzzle size={14} />{t('skills.local')}</span><p>{t('skills.support')}<br />{t('skills.budget')}</p></footer>
    </section>
  </div>;
}
