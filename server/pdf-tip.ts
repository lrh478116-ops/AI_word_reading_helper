import { PDFDocument, PDFHexString, PDFName, PDFSignature, PDFString } from "pdf-lib";
import type { DocumentItem, PdfNormalizedRect, PdfTipAnchor, TipThread } from "../src/types.js";
import { plainMessageContent } from "../src/tip-tree.js";

export const PDF_TIP_ANCHOR_VERSION = 1;

type PdfAuthority = Pick<NonNullable<DocumentItem["pdfStructure"]>, "fingerprint" | "pages">;

const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value);
const validRect = (rect: PdfNormalizedRect) => finite(rect?.x) && finite(rect?.y) && finite(rect?.width) && finite(rect?.height)
  && rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0 && rect.x + rect.width <= 1.000001 && rect.y + rect.height <= 1.000001;

export function validatePdfTipAnchor(authority: PdfAuthority | undefined, anchor: PdfTipAnchor | undefined, selectedText: string) {
  if (!authority || !/^[a-f0-9]{64}$/i.test(authority.fingerprint || "")) return { ok: false as const, error: "PDF 权威指纹不存在" };
  if (!anchor || anchor.version !== PDF_TIP_ANCHOR_VERSION) return { ok: false as const, error: "PDF Tip 锚点版本无效" };
  if (anchor.pdfFingerprint !== authority.fingerprint) return { ok: false as const, error: "PDF Tip 指纹与原文件不一致" };
  if (!Number.isInteger(anchor.pageNumber) || anchor.pageNumber < 1) return { ok: false as const, error: "PDF Tip 页码无效" };
  const page = authority.pages.find((item) => item.pageNumber === anchor.pageNumber);
  if (!page) return { ok: false as const, error: "PDF Tip 页码超出原文件范围" };
  if (anchor.source !== "native" && anchor.source !== "ocr") return { ok: false as const, error: "PDF Tip 文字来源无效" };
  if (anchor.source !== page.source) return { ok: false as const, error: "PDF Tip 文字来源与页面不一致" };
  if (!Number.isInteger(anchor.textStart) || !Number.isInteger(anchor.textEnd) || anchor.textStart < 0 || anchor.textEnd <= anchor.textStart || anchor.textEnd > page.text.length) return { ok: false as const, error: "PDF Tip 文字偏移越界" };
  if (!selectedText.trim() || page.text.slice(anchor.textStart, anchor.textEnd) !== selectedText) return { ok: false as const, error: "PDF Tip 选中文字与原页面不一致" };
  if (!Array.isArray(anchor.rects) || anchor.rects.length < 1 || anchor.rects.length > 64 || anchor.rects.some((rect) => !validRect(rect))) return { ok: false as const, error: "PDF Tip 页面坐标无效" };
  if (![0, 90, 180, 270].includes(((anchor.rotation % 360) + 360) % 360)) return { ok: false as const, error: "PDF Tip 页面旋转值无效" };
  if (!finite(anchor.confidence) || anchor.confidence < 0 || anchor.confidence > 1) return { ok: false as const, error: "PDF Tip 识别置信度无效" };
  return { ok: true as const, page };
}

function rectToPdf(rect: PdfNormalizedRect, viewBox: [number, number, number, number]) {
  const width = Math.abs(viewBox[2] - viewBox[0]); const height = Math.abs(viewBox[3] - viewBox[1]);
  const x1 = viewBox[0] + rect.x * width; const y1 = viewBox[1] + rect.y * height;
  return { x1, y1, x2: x1 + rect.width * width, y2: y1 + rect.height * height };
}

export async function createAnnotatedPdfCopy(bytes: Uint8Array, tips: Array<Pick<TipThread, "id" | "title" | "selectedText" | "messages" | "pdfAnchor">>) {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  if (document.getForm().getFields().some((field) => field instanceof PDFSignature)) {
    throw new Error("检测到 PDF 数字签名字段。为避免让签名失效，不能生成批注副本");
  }
  const pages = document.getPages();
  for (const tip of tips) {
    const anchor = tip.pdfAnchor; if (!anchor || anchor.pageNumber < 1 || anchor.pageNumber > pages.length) continue;
    const page = pages[anchor.pageNumber - 1]; const viewBox = page.getMediaBox();
    const box: [number, number, number, number] = [viewBox.x, viewBox.y, viewBox.x + viewBox.width, viewBox.y + viewBox.height];
    const firstAnswer = tip.messages.find((message) => message.role === "assistant")?.content || "";
    const answerText = firstAnswer ? plainMessageContent(firstAnswer) : "（尚无 AI 回答）";
    const note = `AI Tip ID: ${tip.id}\n标题：${tip.title}\n选中文字：\n${tip.selectedText}\n第一条回答：\n${answerText}`;
    const noteContents = document.context.register(PDFHexString.fromText(note));
    anchor.rects.forEach((rect, index) => {
      const { x1, y1, x2, y2 } = rectToPdf(rect, box);
      const annotation = document.context.obj({
        Type: "Annot", Subtype: "Highlight", Rect: [x1, y1, x2, y2],
        QuadPoints: [x1, y2, x2, y2, x1, y1, x2, y1], C: [1, 0.78, 0.18], CA: 0.34, F: 4,
        T: PDFHexString.fromText("AI Tip"), Contents: noteContents, NM: PDFString.of(`aitip:${tip.id}:highlight:${index}`)
      });
      page.node.addAnnot(document.context.register(annotation));
      if (index === 0) {
        const size = Math.max(14, Math.min(22, (y2 - y1) * 1.25));
        const textAnnotation = document.context.obj({
          Type: "Annot", Subtype: "Text", Rect: [x2, y2, x2 + size, y2 + size], Name: PDFName.of("Comment"), Open: false, F: 4,
          T: PDFHexString.fromText("AI Tip"), Contents: noteContents, NM: PDFString.of(`aitip:${tip.id}:note`)
        });
        page.node.addAnnot(document.context.register(textAnnotation));
      }
    });
  }
  return await document.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
}
