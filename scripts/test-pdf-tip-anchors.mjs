import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from "pdf-lib";

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
  rects: [{ x: 0.12, y: 0.79, width: 0.04, height: 0.025 }, { x: 0.16, y: 0.79, width: 0.05, height: 0.025 }],
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

const firstAnswer = `FIRST_ANSWER_START\n${"这是必须完整写入下载 PDF 批注的第一条回答，包含中文、English、数值 12345 和换行。\n".repeat(80)}FIRST_ANSWER_END`;
const secondAnswer = `SECOND_ANSWER_MUST_NOT_REPLACE_FIRST\n${"第二轮回答。".repeat(30)}`;
const timestamp = new Date().toISOString();
const annotated = await createAnnotatedPdfCopy(bytes, [{
  id: "tip-export-id", title: "解释结论", selectedText, summary: firstAnswer.slice(0, 120), pdfAnchor: anchor,
  messages: [
    { id: "user-1", tipId: "tip-export-id", role: "user", content: "请解释", createdAt: timestamp },
    { id: "assistant-1", tipId: "tip-export-id", role: "assistant", content: firstAnswer, createdAt: timestamp },
    { id: "user-2", tipId: "tip-export-id", role: "user", content: "继续", createdAt: timestamp },
    { id: "assistant-2", tipId: "tip-export-id", role: "assistant", content: secondAnswer, createdAt: timestamp }
  ]
}]);
if (Buffer.compare(Buffer.from(annotated), bytes) === 0 || !Buffer.from(annotated).includes(Buffer.from("tip-export-id"))) throw new Error("导出副本没有因正式 PDF Tip 产生可追踪批注");
const reopened = await PDFDocument.load(annotated);
const annotationContents = (reopened.getPages()[0].node.Annots()?.asArray() || []).map((reference) => {
  const annotation = reopened.context.lookup(reference, PDFDict);
  const name = annotation.lookup(PDFName.of("NM"));
  if (!(name instanceof PDFString) || !name.decodeText().startsWith("aitip:tip-export-id:")) return null;
  const contents = annotation.lookup(PDFName.of("Contents"));
  return contents instanceof PDFString || contents instanceof PDFHexString ? contents.decodeText() : null;
}).filter((contents) => typeof contents === "string");
if (annotationContents.length !== anchor.rects.length + 1) throw new Error(`导出 PDF 没有为全部高亮和 Tip 图标写入批注内容：${annotationContents.length}`);
for (const contents of annotationContents) {
  if (contents !== annotationContents[0] || !contents.includes(firstAnswer) || !contents.includes("FIRST_ANSWER_END") || contents.includes("SECOND_ANSWER_MUST_NOT_REPLACE_FIRST")) {
    throw new Error(`下载 PDF 的 Tip 回答仍被截断或错误读取后续回答：${JSON.stringify({ expected: firstAnswer.length, actual: contents.length, tail: contents.slice(-80) })}`);
  }
}
if (createHash("sha256").update(bytes).digest("hex") !== fingerprint) throw new Error("批注导出修改了原 PDF 字节");
if (process.env.AI_TIP_PDF_TEST_OUTPUT) {
  const outputPath = path.resolve(process.env.AI_TIP_PDF_TEST_OUTPUT);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, annotated);
}

console.log(JSON.stringify({ pdfFingerprint: true, canonicalPageText: true, normalizedRects: true, invalidAnchorsBlocked: true, annotationCopy: true, exportedFirstAnswerLength: firstAnswer.length, exportedAnswerComplete: true }));
