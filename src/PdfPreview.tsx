import { useEffect, useRef, useState } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { api } from "./api";

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
  page: (pageNumber: number, pageCount: number) => string;
}

function PdfPageCanvas({ pdf, pageNumber, labels }: { pdf: PDFDocumentProxy; pageNumber: number; labels: PdfLabels }) {
  const shellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [nearViewport, setNearViewport] = useState(pageNumber === 1);
  const [width, setWidth] = useState(0);
  const [state, setState] = useState<"waiting" | "rendering" | "rendered" | "error">("waiting");

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const updateWidth = () => setWidth(Math.max(280, Math.floor(shell.clientWidth - 28)));
    updateWidth();
    const resize = new ResizeObserver(updateWidth);
    resize.observe(shell);
    const intersection = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setNearViewport(true);
    }, { rootMargin: "700px 0px" });
    intersection.observe(shell);
    return () => { resize.disconnect(); intersection.disconnect(); };
  }, []);

  useEffect(() => {
    if (!nearViewport || !width || !canvasRef.current) return;
    let cancelled = false;
    let renderTask: RenderTask | null = null;
    setState("rendering");
    void (async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled || !canvasRef.current) return;
        const baseViewport = page.getViewport({ scale: 1 });
        const cssScale = Math.min(2.25, width / baseViewport.width);
        const viewport = page.getViewport({ scale: cssScale });
        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        const canvas = canvasRef.current;
        canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
        canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        renderTask = page.render({ canvas, viewport, transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0] });
        await renderTask.promise;
        if (!cancelled) setState("rendered");
      } catch (error) {
        if (!cancelled && (error as { name?: string }).name !== "RenderingCancelledException") setState("error");
      }
    })();
    return () => { cancelled = true; renderTask?.cancel(); };
  }, [nearViewport, pageNumber, pdf, width]);

  return <section className={`pdf-page-shell ${state}`} ref={shellRef} data-pdf-page={pageNumber} aria-label={labels.page(pageNumber, pdf.numPages)}>
    <header><span>{labels.page(pageNumber, pdf.numPages)}</span></header>
    {state === "error" && <div className="pdf-page-error">{labels.loadFailed}</div>}
    {state !== "rendered" && state !== "error" && <div className="pdf-page-skeleton"><span>{labels.loading}</span></div>}
    <canvas ref={canvasRef} className="pdf-page-canvas" aria-label={labels.page(pageNumber, pdf.numPages)} />
  </section>;
}

export function PdfPreview({ documentId, labels }: { documentId: string; labels: PdfLabels }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let disposed = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;
    setPdf(null);
    setError("");
    void (async () => {
      try {
        const bytes = await api.documentSource(documentId);
        if (disposed) return;
        const pdfjs = await loadPdfJs();
        if (disposed) return;
        loadingTask = pdfjs.getDocument({
          data: bytes,
          cMapUrl: "/pdfjs-assets/cmaps/",
          cMapPacked: true,
          iccUrl: "/pdfjs-assets/iccs/",
          standardFontDataUrl: "/pdfjs-assets/standard_fonts/",
          wasmUrl: "/pdfjs-assets/wasm/",
          useSystemFonts: true,
          stopAtErrors: true
        });
        const loaded = await loadingTask.promise;
        if (disposed) { await loaded.destroy(); return; }
        setPdf(loaded);
      } catch (reason) {
        if (!disposed) setError(reason instanceof Error ? reason.message : labels.loadFailed);
      }
    })();
    return () => {
      disposed = true;
      setPdf(null);
      if (loadingTask) void loadingTask.destroy();
    };
  }, [documentId, labels.loadFailed]);

  if (error) return <div className="pdf-preview-state error">{labels.loadFailed}：{error}</div>;
  if (!pdf) return <div className="pdf-preview-state"><span className="pdf-loading-dot" />{labels.loading}</div>;
  return <div className="pdf-preview" data-pdf-document={documentId}>
    {Array.from({ length: pdf.numPages }, (_, index) => <PdfPageCanvas key={index + 1} pdf={pdf} pageNumber={index + 1} labels={labels} />)}
  </div>;
}
