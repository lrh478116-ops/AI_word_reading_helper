import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { LoaderCircle, Puzzle, Settings, X } from 'lucide-react';
import { api, ApiError } from './api';
import { translate, type Language } from './i18n';
import type { UserSkill } from './user-skills';
import { notifySkillChange, SKILLS_CHANGED } from './skill-events';

export function SkillPicker({ language, disabled, onManage, onBusyChange }: { language: Language; disabled: boolean; onManage: () => void; onBusyChange: (busy: boolean) => void }) {
  const t = (key: string, vars?: Record<string, string | number>) => translate(language, key, vars);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<UserSkill[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [position, setPosition] = useState<CSSProperties>({});
  const instance = useId();
  const button = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null);
  const sequence = useRef(0), mounted = useRef(true), openRef = useRef(open);
  const place = useRef(() => {});
  place.current = () => {
    const rect = button.current?.getBoundingClientRect(); if (!rect) return;
    if (!rect.width && !rect.height) { setOpen(false); return; }
    const width = Math.min(340, window.innerWidth - 24), above = rect.top - 20, below = window.innerHeight - rect.bottom - 20;
    setPosition({ width, left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)), ...(above >= below ? { bottom: window.innerHeight - rect.top + 8, maxHeight: above } : { top: rect.bottom + 8, maxHeight: below }) });
  };
  openRef.current = open;
  const refresh = async () => {
    const request = ++sequence.current; setLoading(true);
    try { const result = await api.skills(); if (mounted.current && sequence.current === request) setItems(result.skills); }
    catch (e) { if (mounted.current && sequence.current === request) setError(e instanceof Error ? e.message : t('skills.error.storage')); }
    finally { if (mounted.current && sequence.current === request) setLoading(false); }
  };
  const refreshRef = useRef(refresh); refreshRef.current = refresh;
  useEffect(() => {
    mounted.current = true;
    const changed = () => { if (openRef.current) void refreshRef.current(); else setItems(null); };
    window.addEventListener(SKILLS_CHANGED, changed);
    return () => { mounted.current = false; sequence.current++; window.removeEventListener(SKILLS_CHANGED, changed); onBusyChange(false); };
  }, [onBusyChange]);
  useEffect(() => {
    if (!open) return;
    setError(''); void refreshRef.current();
    popup.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const outside = (event: PointerEvent) => { if (!popup.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); button.current?.focus(); }
      if (event.key === 'Tab' && popup.current?.contains(document.activeElement)) {
        const controls = Array.from(popup.current.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
        if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
      }
    };
    let frame = 0;
    const resize = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => place.current()); };
    const observer = new ResizeObserver(resize); if (button.current) observer.observe(button.current);
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape); window.addEventListener('resize', resize);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); window.removeEventListener('resize', resize); };
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  const show = () => {
    place.current();
    setOpen(value => !value);
  };
  const toggle = async (skill: UserSkill) => {
    if (busy || disabled) return;
    setBusy(true); onBusyChange(true); setError('');
    try {
      const result = await api.updateSkill(skill.id, { enabled: !skill.enabled, signature: skill.signature });
      if (mounted.current) setItems(current => current?.map(item => item.id === skill.id ? result.skill : item) || null);
      notifySkillChange();
    } catch (e) {
      if (mounted.current) { setError(e instanceof ApiError && e.code.startsWith('SKILL_') ? t(`skills.error.${e.code.slice(6).toLowerCase()}`) : e instanceof Error ? e.message : t('skills.error.storage')); void refreshRef.current(); }
    } finally { if (mounted.current) setBusy(false); onBusyChange(false); }
  };
  const count = items?.filter(s => s.enabled).length;
  return <><button ref={button} type="button" className={`composer-skills ${count ? 'on' : ''}`} data-open-skill-picker aria-haspopup="dialog" aria-controls={open ? `${instance}-popup` : undefined} aria-expanded={open} aria-label={t('skills.chooseForChat')} title={t('skills.chooseForChat')} disabled={disabled || busy} onClick={show}><Puzzle size={13} /><span>Skills{count !== undefined ? ` ${count}` : ''}</span></button>
    {open && createPortal(<div id={`${instance}-popup`} className="skill-picker" ref={popup} style={position} role="dialog" aria-label={t('skills.chooseForChat')} data-skill-picker>
      <header><strong>{t('skills.chooseForChat')}</strong><button className="icon-button" aria-label={t('skills.closePicker')} onClick={() => { setOpen(false); button.current?.focus(); }}><X size={15} /></button></header>
      <p>{t('skills.pickerHint')}</p>
      {error && <div className="skill-picker-error" role="alert">{error}</div>}
      <div className="skill-picker-list">{loading ? <span className="skills-empty"><LoaderCircle size={16} className="spin" />{t('skills.loading')}</span> : items?.length ? items.map(s => <div className="skill-choice" key={s.id}><label htmlFor={`${instance}-${s.id}`}><strong>{s.name}</strong><small title={s.description}>{s.description}</small></label><button id={`${instance}-${s.id}`} className={`toggle ${s.enabled ? 'on' : ''}`} data-chat-skill-toggle={s.id} role="switch" aria-checked={s.enabled} aria-label={t('skills.enableLabel', { name: s.name })} disabled={busy || disabled} onClick={() => void toggle(s)}><i /></button></div>) : <p className="skills-empty">{t('skills.emptyHint')}</p>}</div>
      <footer><button className="secondary compact" data-picker-manage onClick={() => { setOpen(false); onManage(); }} disabled={busy}><Settings size={14} />{t('skills.title')}</button></footer>
    </div>, document.body)}</>;
}
