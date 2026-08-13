import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

process.env.AI_TIP_EMBEDDED = "1";

const { PDF_TIP_ANCHOR_VERSION, createAnnotatedPdfCopy, extractPdfStructure, validatePdfTipAnchor } = await import("../dist-electron/server.cjs");
if (PDF_TIP_ANCHOR_VERSION !== 1 || typeof validatePdfTipAnchor !== "function" || typeof createAnnotatedPdfCopy !== "function") throw new Error("PDF 原版式 Tip 锚点或批注导出能力未定义");

const bytes = Buffer.from((await readFile(new URL("./fixtures/semantic-pdf.pdf.base64", import.meta.url), "utf8")).replace(/\s+/g, ""), "base64");
const structure = await extractPdfStructure("pdf-tip-document", bytes);
const fingerprint = createHash("sha256").update(bytes).digest("hex");
if (structure.fingerprint !== fingerprint || structure.pages?.length !== 2) throw new Error("PDF 结构没有保存原字节指纹和权威页文本");
const page = structure.pages[0];
const selectedText = "可选择";
const textStart = page.text.indexOf(selectedText);
if (textStart < 0 || !page.items.some((item) => item.startOffset <= textStart && item.endOffset >= textStart + selectedText.length)) throw new Error("规范页文本与 text-item 偏移没有形成可验证映射");

const anchor = {
  version: 1,
  pdfFingerprint: fingerprint,
  pageNumber: 1,
  source: "native",
  textStart,
  textEnd: textStart + selectedText.length,
  rects: [{ x: 0.12, y: 0.79, width: 0.09, height: 0.025 }],
  rotation: page.rotation,
  confidence: 1
};
const valid = validatePdfTipAnchor({ fingerprint, pages: structure.pages }, anchor, selectedText);
if (!valid.ok) throw new Error(`合法 PDF 锚点被拒绝：${valid.error}`);
for (const invalid of [
  { ...anchor, pdfFingerprint: "0".repeat(64) },
  { ...anchor, pageNumber: 99 },
  { ...anchor, textEnd: page.text.length + 1 },
  { ...anchor, rects: [] },
  { ...anchor, rects: [{ x: -0.1, y: 0, width: 0.2, height: 0.1 }] }
]) {
  if (validatePdfTipAnchor({ fingerprint, pages: structure.pages }, invalid, selectedText).ok) throw new Error(`损坏 PDF 锚点被错误接受：${JSON.stringify(invalid)}`);
}

const annotated = await createAnnotatedPdfCopy(bytes, [{ id: "tip-export-id", title: "解释结论", selectedText, summary: "摘要", pdfAnchor: anchor }]);
if (Buffer.compare(Buffer.from(annotated), bytes) === 0 || !Buffer.from(annotated).includes(Buffer.from("tip-export-id"))) throw new Error("导出副本没有因正式 PDF Tip 产生可追溯批注");
if (createHash("sha256").update(bytes).digest("hex") !== fingerprint) throw new Error("批注导出修改了原 PDF 字节");

console.log(JSON.stringify({ pdfFingerprint: true, canonicalPageText: true, normalizedRects: true, invalidAnchorsBlocked: true, annotationCopy: true }));
