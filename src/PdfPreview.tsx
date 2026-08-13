import { useEffect, useRef, useState, type ReactNode } from "react";
import { Image as ImageIcon, LayoutTemplate, ScanText, Sparkles } from "lucide-react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { api } from "./api";
import type { DocumentBlock, DocumentItem, SelectionInfo, TipThread } from "./types";

let pdfJsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

function loadPdfJs() {
  pdfJsPromise ||= Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url")
  ]).then(([pdfjs, worker]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  });
  return pdfJsPromise;
}

interface PdfLabels {
  loading: string;
  loadFailed: string;
  structured: string;
  original: string;
  structureHint: string;
  tableHeuristic: (confidence: number) => string;
  imageAlt: (page: number) => string;
  structureFailed: (error: string) => string;
  visualOnly: string;
  page: (pageNumber: number, pageCount: number) => string;
}

function offsetWithin(root: Node, node: Node, offset: number) {
  const range = document.createRange(); range.selectNodeContents(root); range.setEnd(node, offset); return range.toString().length;
}

function PdfPageCanvas({ pdf, pageNumber, labels }: { pdf: PDFDocumentProxy; pageNumber: number; labels: PdfLabels }) {
  const shellRef = useRef<HTMLDivElement>(null); const canvasRef = useRef<HTMLCanvasElement>(null); const textLayerRef = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(pageNumber === 1); const [width, setWidth] = useState(0);
  const [state, setState] = useState<"waiting" | "rendering" | "rendered" | "error">("waiting");

  useEffect(() => {
    const shell = shellRef.current; if (!shell) return;
    const updateWidth = () => setWidth(Math.max(280, Math.floor(shell.clientWidth - 28))); updateWidth();
    const resize = new ResizeObserver(updateWidth); resize.observe(shell);
    const intersection = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) setNearViewport(true); }, { rootMargin: "700px 0px" });
    intersection.observe(shell); return () => { resize.disconnect(); intersection.disconnect(); };
  }, []);

  useEffect(() => {
    if (!nearViewport || !width || !canvasRef.current || !textLayerRef.current) return;
    let cancelled = false; let renderTask: RenderTask | null = null; let textLayer: InstanceType<(typeof import("pdfjs-dist"))["TextLayer"]> | null = null;
    setState("rendering");
    void (async () => {
      try {
        const [page, pdfjs] = await Promise.all([pdf.getPage(pageNumber), loadPdfJs()]);
        if (cancelled || !canvasRef.current || !textLayerRef.current) return;
        const baseViewport = page.getViewport({ scale: 1 }); const cssScale = Math.min(2.25, width / baseViewport.width); const viewport = page.getViewport({ scale: cssScale });
        const outputScale = Math.min(window.devicePixelRatio || 1, 2); const canvas = canvasRef.current;
        canvas.width = Math.max(1, Math.floor(viewport.width * outputScale)); canvas.height = Math.max(1, Math.floor(viewport.height * outputScale)); canvas.style.width = `${Math.floor(viewport.width)}px`; canvas.style.height = `${Math.floor(viewport.height)}px`;
        renderTask = page.render({ canvas, viewport, transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0] });
        const textContent = await page.getTextContent({ disableNormalization: false }); await renderTask.promise;
        if (cancelled) return;
        const layer = textLayerRef.current; layer.replaceChildren(); layer.style.width = `${Math.floor(viewport.width)}px`; layer.style.height = `${Math.floor(viewport.height)}px`; layer.style.setProperty("--total-scale-factor", String(viewport.scale));
        textLayer = new pdfjs.TextLayer({ textContentSource: textContent, container: layer, viewport }); await textLayer.render();
        if (!cancelled) setState("rendered");
      } catch (error) { if (!cancelled && (error as { name?: string }).name !== "RenderingCancelledException") setState("error"); }
    })();
    return () => { cancelled = true; renderTask?.cancel(); textLayer?.cancel(); };
  }, [nearViewport, pageNumber, pdf, width]);

  return <section className={`pdf-page-shell ${state}`} ref={shellRef} data-pdf-page={pageNumber} aria-label={labels.page(pageNumber, pdf.numPages)}>
    <header><span>{labels.page(pageNumber, pdf.numPages)}</span></header>
    {state === "error" && <div className="pdf-page-error">{labels.loadFailed}</div>}
    {state !== "rendered" && state !== "error" && <div className="pdf-page-skeleton"><span>{labels.loading}</span></div>}
    <div className="pdf-page-surface"><canvas ref={canvasRef} className="pdf-page-canvas" aria-label={labels.page(pageNumber, pdf.numPages)} /><div ref={textLayerRef} className="textLayer pdf-text-layer" /></div>
  </section>;
}

function PdfImageBlock({ pdf, block, alt }: { pdf: PDFDocumentProxy; block: DocumentBlock; alt: string }) {
  const [source, setSource] = useState(""); const [failed, setFailed] = useState(false);
  useEffect(() => {
    let disposed = false; let task: RenderTask | null = null;
    void (async () => {
      try {
        if (!block.pdf?.bbox) throw new Error("Missing image bounds");
        const page = await pdf.getPage(block.pdf.page); const viewport = page.getViewport({ scale: 1.75 });
        const pageCanvas = document.createElement("canvas"); pageCanvas.width = Math.ceil(viewport.width); pageCanvas.height = Math.ceil(viewport.height);
        task = page.render({ canvas: pageCanvas, viewport }); await task.promise; if (disposed) return;
        const rectangle = viewport.convertToViewportRectangle(block.pdf.bbox); const x = Math.max(0, Math.floor(Math.min(rectangle[0], rectangle[2]))); const y = Math.max(0, Math.floor(Math.min(rectangle[1], rectangle[3])));
        const width = Math.max(1, Math.ceil(Math.abs(rectangle[2] - rectangle[0]))); const height = Math.max(1, Math.ceil(Math.abs(rectangle[3] - rectangle[1])));
        const crop = document.createElement("canvas"); crop.width = width; crop.height = height; crop.getContext("2d")?.drawImage(pageCanvas, x, y, width, height, 0, 0, width, height);
        setSource(crop.toDataURL("image/png"));
      } catch { if (!disposed) setFailed(true); }
    })();
    return () => { disposed = true; task?.cancel(); };
  }, [block, pdf]);
  if (failed) return <div className="pdf-semantic-image-error"><ImageIcon size={18} />{alt}</div>;
  return source ? <img className="pdf-semantic-image" src={source} alt={alt} data-pdf-image-block={block.id} /> : <div className="pdf-semantic-image-loading" />;
}

function PdfSemanticBlock({ pdf, block, tips, labels, onSelection, onOpenTip }: { pdf: PDFDocumentProxy; block: DocumentBlock; tips: TipThread[]; labels: PdfLabels; onSelection: (selection: SelectionInfo) => void; onOpenTip: (tip: TipThread) => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const select = () => {
    const selection = window.getSelection(); const root = rootRef.current;
    if (!selection || selection.isCollapsed || !root || !selection.anchorNode || !selection.focusNode || !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return;
    const raw = selection.toString(); const text = raw.trim(); if (!text) return;
    let start: number;
    const anchorCell = (selection.anchorNode instanceof Element ? selection.anchorNode : selection.anchorNode.parentElement)?.closest<HTMLElement>("[data-cell-start]");
    const focusCell = (selection.focusNode instanceof Element ? selection.focusNode : selection.focusNode.parentElement)?.closest<HTMLElement>("[data-cell-start]");
    if (block.type === "table") {
      if (!anchorCell || anchorCell !== focusCell) return;
      const cellStart = Number(anchorCell.dataset.cellStart || 0); const rawStart = Math.min(offsetWithin(anchorCell, selection.anchorNode, selection.anchorOffset), offsetWithin(anchorCell, selection.focusNode, selection.focusOffset));
      start = cellStart + rawStart + raw.length - raw.trimStart().length;
    } else {
      const rawStart = Math.min(offsetWithin(root, selection.anchorNode, selection.anchorOffset), offsetWithin(root, selection.focusNode, selection.focusOffset)); start = rawStart + raw.length - raw.trimStart().length;
    }
    const end = start + text.length; if (block.content.slice(start, end) !== text) return;
    onSelection({ source: "document", blockId: block.id, text, startOffset: start, endOffset: end, rect: selection.getRangeAt(0).getBoundingClientRect() });
  };
  let body: ReactNode;
  if (block.type === "image") body = <PdfImageBlock pdf={pdf} block={block} alt={labels.imageAlt(block.pdf?.page || 1)} />;
  else if (block.type === "table" && block.table) {
    let canonicalOffset = 0;
    body = <><table data-pdf-table-block={block.id}><tbody>{block.table.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => {
      const start = canonicalOffset; canonicalOffset += cell.length + (cellIndex === row.length - 1 ? 1 : 1); const Tag = rowIndex < block.table!.headerRows ? "th" : "td";
      return <Tag key={cellIndex} data-cell-start={start}>{cell}</Tag>;
    })}</tr>)}</tbody></table>{block.pdf?.detection === "heuristic" && <small className="pdf-table-confidence">{labels.tableHeuristic(Math.round(block.pdf.confidence * 100))}</small>}</>;
  } else {
    const Tag = block.type === "heading" ? (block.level === 1 ? "h1" : "h2") : "p"; body = <Tag>{block.content}</Tag>;
  }
  return <div ref={rootRef} className={`pdf-semantic-block pdf-semantic-${block.type}`} data-pdf-semantic-block={block.id} data-pdf-page-source={block.pdf?.page} onMouseUp={select} onKeyUp={select}>{body}{tips.length > 0 && <div className="pdf-semantic-tips">{tips.map((tip) => <button key={tip.id} onClick={() => onOpenTip(tip)}><Sparkles size={9} />TIP</button>)}</div>}</div>;
}

export function PdfPreview({ documentId, blocks, structure, tipsByBlock, labels, onSelection, onOpenTip }: { documentId: string; blocks: DocumentBlock[]; structure?: DocumentItem["pdfStructure"]; tipsByBlock: Record<string, TipThread[]>; labels: PdfLabels; onSelection: (selection: SelectionInfo) => void; onOpenTip: (tip: TipThread) => void }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null); const [error, setError] = useState("");
  const [view, setView] = useState<"structured" | "original">(structure?.status === "failed" ? "original" : "structured");
  useEffect(() => {
    let disposed = false; let loadingTask: PDFDocumentLoadingTask | null = null; setPdf(null); setError("");
    void (async () => {
      try {
        const bytes = await api.documentSource(documentId); if (disposed) return; const pdfjs = await loadPdfJs(); if (disposed) return;
        loadingTask = pdfjs.getDocument({ data: bytes, cMapUrl: "/pdfjs-assets/cmaps/", cMapPacked: true, iccUrl: "/pdfjs-assets/iccs/", standardFontDataUrl: "/pdfjs-assets/standard_fonts/", wasmUrl: "/pdfjs-assets/wasm/", useSystemFonts: true, stopAtErrors: true });
        const loaded = await loadingTask.promise; if (disposed) { await loaded.destroy(); return; } setPdf(loaded);
      } catch (reason) { if (!disposed) setError(reason instanceof Error ? reason.message : labels.loadFailed); }
    })();
    return () => { disposed = true; setPdf(null); if (loadingTask) void loadingTask.destroy(); };
  }, [documentId, labels.loadFailed]);

  if (error) return <div className="pdf-preview-state error">{labels.loadFailed}：{error}</div>;
  if (!pdf) return <div className="pdf-preview-state"><span className="pdf-loading-dot" />{labels.loading}</div>;
  return <div className="pdf-document-reader" data-pdf-document={documentId} data-pdf-view={view}>
    <div className="pdf-view-switch"><button className={view === "structured" ? "active" : ""} onClick={() => setView("structured")} disabled={structure?.status === "failed"}><ScanText size={14} />{labels.structured}</button><button className={view === "original" ? "active" : ""} onClick={() => setView("original")}><LayoutTemplate size={14} />{labels.original}</button></div>
    {structure?.status === "failed" && <div className="pdf-structure-warning">{labels.structureFailed(structure.error || labels.loadFailed)}</div>}
    {structure?.status === "visual-only" && <div className="pdf-structure-warning">{labels.visualOnly}</div>}
    {view === "structured" ? <div className="pdf-semantic-view"><p className="pdf-structure-hint">{labels.structureHint}</p>{blocks.map((block) => <PdfSemanticBlock key={block.id} pdf={pdf} block={block} tips={tipsByBlock[block.id] || []} labels={labels} onSelection={onSelection} onOpenTip={onOpenTip} />)}</div>
      : <div className="pdf-preview">{Array.from({ length: pdf.numPages }, (_, index) => <PdfPageCanvas key={index + 1} pdf={pdf} pageNumber={index + 1} labels={labels} />)}</div>}
  </div>;
}
