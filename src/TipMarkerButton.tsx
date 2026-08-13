import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { plainMessageContent } from "./tip-tree";
import type { TipThread } from "./types";

interface TipMarkerButtonProps {
  tip: TipThread;
  className: string;
  style?: CSSProperties;
  previewLabel: string;
  openLabel: string;
  closeLabel: string;
  onOpen: (tip: TipThread) => void;
  children: ReactNode;
  pdfTipId?: string;
}

export function TipMarkerButton({ tip, className, style, previewLabel, openLabel, closeLabel, onOpen, children, pdfTipId }: TipMarkerButtonProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const hideTimer = useRef<number | null>(null);
  const anchorObserver = useRef<ResizeObserver | null>(null);
  const anchorMutationObserver = useRef<MutationObserver | null>(null);
  const anchorObserverTimer = useRef<number | null>(null);
  const anchorFrame = useRef<number | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [position, setPosition] = useState({ left: 12, top: 12, width: 360 });
  const assistantAnswer = tip.messages.find((message) => message.role === "assistant")?.content || "";
  const previewText = plainMessageContent(assistantAnswer);

  const cancelHide = () => {
    if (hideTimer.current != null) window.clearTimeout(hideTimer.current);
    hideTimer.current = null;
  };
  const showPreview = () => {
    cancelHide();
    if (previewText) setPreviewOpen(true);
  };
  const scheduleHide = () => {
    cancelHide();
    hideTimer.current = window.setTimeout(() => setPreviewOpen(false), 180);
  };
  const preservePdfReadingAnchor = () => {
    const button = buttonRef.current;
    const reader = button?.closest<HTMLElement>(".pdf-document-reader");
    const scroller = button?.closest<HTMLElement>(".editor-scroll");
    if (!button || !reader || !scroller) return;
    anchorObserver.current?.disconnect();
    anchorMutationObserver.current?.disconnect();
    if (anchorObserverTimer.current != null) window.clearTimeout(anchorObserverTimer.current);
    const targetTop = button.getBoundingClientRect().top;
    let contentTop = targetTop + scroller.scrollTop;
    const restore = () => {
      if (!button.isConnected) return;
      const nextContentTop = button.getBoundingClientRect().top + scroller.scrollTop;
      if (Math.abs(nextContentTop - contentTop) <= 0.25) return;
      contentTop = nextContentTop;
      scroller.scrollTop = nextContentTop - targetTop;
    };
    anchorObserver.current = new ResizeObserver(restore);
    anchorObserver.current.observe(reader);
    anchorMutationObserver.current = new MutationObserver(restore);
    anchorMutationObserver.current.observe(reader, { attributes: true, attributeFilter: ["class", "style"], subtree: true });
    const followLayout = () => {
      restore();
      anchorFrame.current = window.requestAnimationFrame(followLayout);
    };
    anchorFrame.current = window.requestAnimationFrame(followLayout);
    anchorObserverTimer.current = window.setTimeout(() => {
      anchorObserver.current?.disconnect();
      anchorObserver.current = null;
      anchorMutationObserver.current?.disconnect();
      anchorMutationObserver.current = null;
      if (anchorFrame.current != null) window.cancelAnimationFrame(anchorFrame.current);
      anchorFrame.current = null;
      anchorObserverTimer.current = null;
    }, 2500);
  };
  const measure = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.max(260, Math.min(420, window.innerWidth - 24));
    const left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.right - width));
    const preferredTop = rect.bottom + 9;
    const top = preferredTop + 180 < window.innerHeight ? preferredTop : Math.max(12, rect.top - Math.min(360, window.innerHeight * 0.6) - 9);
    setPosition({ left, top, width });
  }, []);

  useEffect(() => {
    if (!previewOpen) return;
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => { window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [measure, previewOpen]);
  useEffect(() => () => {
    cancelHide();
    anchorObserver.current?.disconnect();
    anchorMutationObserver.current?.disconnect();
    if (anchorObserverTimer.current != null) window.clearTimeout(anchorObserverTimer.current);
    if (anchorFrame.current != null) window.cancelAnimationFrame(anchorFrame.current);
  }, []);

  return <>
    <button
      ref={buttonRef}
      type="button"
      data-tip-marker-id={tip.id}
      data-pdf-tip-id={pdfTipId}
      className={className}
      style={style}
      aria-label={openLabel}
      onMouseEnter={showPreview}
      onMouseLeave={scheduleHide}
      onFocus={showPreview}
      onBlur={scheduleHide}
      onClick={(event) => { event.stopPropagation(); preservePdfReadingAnchor(); setPreviewOpen(false); onOpen(tip); }}
    >{children}</button>
    {previewOpen && previewText && createPortal(
      <section
        className="tip-answer-preview"
        data-tip-answer-preview={tip.id}
        role="tooltip"
        style={position}
        onMouseEnter={cancelHide}
        onMouseLeave={scheduleHide}
      >
        <header><strong>{previewLabel}</strong><button type="button" aria-label={closeLabel} onClick={() => setPreviewOpen(false)}><X size={15} /></button></header>
        <div className="tip-answer-preview-body">{previewText}</div>
      </section>,
      document.body
    )}
  </>;
}
