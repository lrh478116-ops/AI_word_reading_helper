import { createHash, randomUUID } from "node:crypto";
import type { DocumentBlock, PdfBlockSource, PdfPageSource } from "../src/types.js";

export const PDF_STRUCTURE_VERSION = 2;

type Matrix = [number, number, number, number, number, number];
type TextItem = { index: number; str: string; x: number; y: number; width: number; height: number };
type TextLine = { items: TextItem[]; y: number; bbox: [number, number, number, number] };

export interface PdfStructureResult {
  version: number;
  status: "complete" | "visual-only" | "failed";
  pageCount: number;
  extractedAt: string;
  blocks: DocumentBlock[];
  fingerprint: string;
  pages: PdfPageSource[];
  error?: string;
}

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const multiply = (left: Matrix, right: Matrix): Matrix => [
  left[0] * right[0] + left[2] * right[1], left[1] * right[0] + left[3] * right[1],
  left[0] * right[2] + left[2] * right[3], left[1] * right[2] + left[3] * right[3],
  left[0] * right[4] + left[2] * right[5] + left[4], left[1] * right[4] + left[3] * right[5] + left[5]
];
const point = (matrix: Matrix, x: number, y: number) => [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]] as const;
const matrixBBox = (matrix: Matrix): [number, number, number, number] => {
  const corners = [point(matrix, 0, 0), point(matrix, 1, 0), point(matrix, 0, 1), point(matrix, 1, 1)];
  const xs = corners.map((item) => item[0]); const ys = corners.map((item) => item[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};

function groupTextLines(items: TextItem[]): TextLine[] {
  const lines: TextLine[] = [];
  for (const item of items.filter((entry) => entry.str.trim() && entry.height > 0)) {
    let line = lines.find((entry) => Math.abs(entry.y - item.y) <= Math.max(2, item.height * 0.25));
    if (!line) { line = { items: [], y: item.y, bbox: [item.x, item.y, item.x + item.width, item.y + item.height] }; lines.push(line); }
    line.items.push(item);
    line.bbox = [Math.min(line.bbox[0], item.x), Math.min(line.bbox[1], item.y), Math.max(line.bbox[2], item.x + item.width), Math.max(line.bbox[3], item.y + item.height)];
  }
  for (const line of lines) line.items.sort((left, right) => left.x - right.x);
  return lines.sort((left, right) => right.y - left.y);
}

function lineText(items: TextItem[]) {
  return items.reduce((content, item, index) => {
    if (index === 0) return item.str;
    const previous = items[index - 1];
    const gap = item.x - (previous.x + previous.width);
    const space = gap > Math.max(1.5, Math.min(previous.height, item.height) * 0.12) ? " " : "";
    return `${content}${space}${item.str}`;
  }, "").trim();
}

function tableRuns(lines: TextLine[]) {
  const tables: Array<{ start: number; end: number; confidence: number }> = [];
  let index = 0;
  while (index < lines.length - 2) {
    const columns = lines[index].items.length;
    if (columns < 2) { index += 1; continue; }
    const starts = lines[index].items.map((item) => item.x);
    let end = index + 1; const gaps: number[] = [];
    while (end < lines.length && lines[end].items.length === columns && lines[end].items.every((item, column) => Math.abs(item.x - starts[column]) <= 8)) {
      gaps.push(lines[end - 1].y - lines[end].y); end += 1;
    }
    const rowCount = end - index;
    const gapMean = gaps.reduce((sum, value) => sum + value, 0) / Math.max(1, gaps.length);
    const gapStable = gaps.every((value) => value > 4 && Math.abs(value - gapMean) <= Math.max(4, gapMean * 0.25));
    const separated = starts.slice(1).every((value, column) => value - starts[column] >= 36);
    if (rowCount >= 3 && gapStable && separated) {
      const xDrift = lines.slice(index, end).flatMap((line) => line.items.map((item, column) => Math.abs(item.x - starts[column])));
      const meanDrift = xDrift.reduce((sum, value) => sum + value, 0) / Math.max(1, xDrift.length);
      tables.push({ start: index, end, confidence: Math.max(0.75, Math.min(0.99, 0.96 - meanDrift / 20)) }); index = end;
    } else index += 1;
  }
  return tables;
}

function newBlock(documentId: string, type: DocumentBlock["type"], content: string, order: number, pdf: PdfBlockSource, table?: DocumentBlock["table"], level?: number): DocumentBlock {
  const timestamp = new Date().toISOString();
  return { id: randomUUID(), documentId, type, content, order, level, contentHash: hash(content), pdf, table, createdAt: timestamp, updatedAt: timestamp };
}

export async function extractPdfStructure(documentId: string, bytes: Uint8Array): Promise<PdfStructureResult> {
  const fingerprint = createHash("sha256").update(bytes).digest("hex");
  let loaded: { destroy: () => Promise<void>; numPages: number; getPage: (page: number) => Promise<any> } | null = null;
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    loaded = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, stopAtErrors: true }).promise;
    const blocks: DocumentBlock[] = [];
    const pages: PdfPageSource[] = [];
    for (let pageNumber = 1; pageNumber <= loaded.numPages; pageNumber++) {
      const page = await loaded.getPage(pageNumber);
      const textContent = await page.getTextContent({ disableNormalization: false });
      const textItems: TextItem[] = textContent.items.flatMap((raw: any, index: number) => typeof raw?.str === "string" ? [{ index, str: raw.str, x: Number(raw.transform?.[4] || 0), y: Number(raw.transform?.[5] || 0), width: Number(raw.width || 0), height: Math.abs(Number(raw.height || raw.transform?.[3] || 0)) }] : []);
      if (textItems.some((item) => item.str.includes("\uFFFD"))) throw new Error(`Page ${pageNumber} contains an invalid Unicode character mapping`);
      let textOffset = 0;
      const canonicalItems = textItems.map((item) => {
        const startOffset = textOffset; textOffset += item.str.length;
        return { index: item.index, text: item.str, startOffset, endOffset: textOffset, bbox: [item.x, item.y, item.x + item.width, item.y + item.height] as [number, number, number, number] };
      });
      const viewBox = page.view.map(Number) as [number, number, number, number];
      pages.push({ pageNumber, width: Math.abs(viewBox[2] - viewBox[0]), height: Math.abs(viewBox[3] - viewBox[1]), viewBox, rotation: Number(page.rotate || 0), text: textItems.map((item) => item.str).join(""), items: canonicalItems, source: canonicalItems.some((item) => item.text.trim()) ? "native" : "none", confidence: canonicalItems.some((item) => item.text.trim()) ? 1 : 0 });
      const lines = groupTextLines(textItems); const detectedTables = tableRuns(lines);
      const tableLineIndices = new Set(detectedTables.flatMap((table) => Array.from({ length: table.end - table.start }, (_, offset) => table.start + offset)));
      const pageBlocks: DocumentBlock[] = [];
      const nonTableHeights = lines.filter((_line, index) => !tableLineIndices.has(index)).map((line) => Math.max(...line.items.map((item) => item.height))).sort((a, b) => a - b);
      const medianHeight = nonTableHeights[Math.floor(nonTableHeights.length / 2)] || 12;
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        if (tableLineIndices.has(lineIndex)) continue;
        const line = lines[lineIndex]; const content = lineText(line.items); if (!content) continue;
        const height = Math.max(...line.items.map((item) => item.height)); const heading = height >= Math.max(17, medianHeight * 1.35);
        pageBlocks.push(newBlock(documentId, heading ? "heading" : "paragraph", content, 0, { page: pageNumber, bbox: line.bbox, textItemIndices: line.items.map((item) => item.index), detection: "text", confidence: 1 }, undefined, heading ? (height >= 22 ? 1 : 2) : undefined));
      }
      for (const detected of detectedTables) {
        const rows = lines.slice(detected.start, detected.end).map((line) => line.items.map((item) => item.str.trim()));
        const allItems = lines.slice(detected.start, detected.end).flatMap((line) => line.items);
        const bbox: [number, number, number, number] = [Math.min(...allItems.map((item) => item.x)), Math.min(...allItems.map((item) => item.y)), Math.max(...allItems.map((item) => item.x + item.width)), Math.max(...allItems.map((item) => item.y + item.height))];
        const content = rows.map((row) => row.join("\t")).join("\n");
        pageBlocks.push(newBlock(documentId, "table", content, 0, { page: pageNumber, bbox, textItemIndices: allItems.map((item) => item.index), detection: "heuristic", confidence: detected.confidence }, { rows, headerRows: 1 }));
      }
      const operatorList = await page.getOperatorList(); let current: Matrix = [1, 0, 0, 1, 0, 0]; const stack: Matrix[] = [];
      for (let operationIndex = 0; operationIndex < operatorList.fnArray.length; operationIndex++) {
        const operation = operatorList.fnArray[operationIndex]; const args = operatorList.argsArray[operationIndex] || [];
        if (operation === pdfjs.OPS.save) stack.push([...current]);
        else if (operation === pdfjs.OPS.restore) current = stack.pop() || [1, 0, 0, 1, 0, 0];
        else if (operation === pdfjs.OPS.transform) current = multiply(current, args as Matrix);
        else if ([pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject, pdfjs.OPS.paintImageMaskXObject, pdfjs.OPS.paintImageXObjectRepeat].includes(operation)) {
          const bbox = matrixBBox(current); if (Math.abs((bbox[2] - bbox[0]) * (bbox[3] - bbox[1])) < 64) continue;
          pageBlocks.push(newBlock(documentId, "image", `[Image: page ${pageNumber}, operation ${operationIndex}]`, 0, { page: pageNumber, bbox, operationIndex, objectId: typeof args[0] === "string" ? args[0] : undefined, detection: "native-image", confidence: 1 }));
        }
      }
      pageBlocks.sort((left, right) => (right.pdf?.bbox[3] || 0) - (left.pdf?.bbox[3] || 0) || (left.pdf?.bbox[0] || 0) - (right.pdf?.bbox[0] || 0)); blocks.push(...pageBlocks);
    }
    blocks.forEach((item, order) => { item.order = order; });
    return { version: PDF_STRUCTURE_VERSION, status: blocks.some((item) => item.type !== "image") ? "complete" : "visual-only", pageCount: loaded.numPages, extractedAt: new Date().toISOString(), blocks, fingerprint, pages };
  } catch (error) {
    return { version: PDF_STRUCTURE_VERSION, status: "failed", pageCount: loaded?.numPages || 0, extractedAt: new Date().toISOString(), blocks: [], fingerprint, pages: [], error: error instanceof Error ? error.message : "Unknown PDF structure error" };
  } finally { if (loaded) await loaded.destroy(); }
}
