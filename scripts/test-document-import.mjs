import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.AI_TIP_EMBEDDED = "1";
process.env.AI_TIP_SUPABASE_ENABLED = "0";
const integrationDataDir = await mkdtemp(path.join(tmpdir(), "ai-tip-docx-table-test-"));
process.env.AI_TIP_DATA_DIR = integrationDataDir;

const {
  DEFAULT_SYSTEM_PROMPTS,
  decodeUploadFilename,
  decodeImportedText,
  defaultPromptForLanguage,
  extractPdfStructure,
  hasValidPdfContainer,
  htmlToBlocks,
  repairImportedDocumentNames,
  resolveSystemPrompt,
  startServer
} = await import("../dist-electron/server.cjs");

const chineseName = "实习进度1.pdf";
const latin1Mojibake = Buffer.from(chineseName, "utf8").toString("latin1");
if (decodeUploadFilename(latin1Mojibake) !== chineseName) throw new Error("中文 UTF-8 文件名没有从 multipart Latin-1 边界恢复");
const emojiName = "研究📘资料.pdf";
if (decodeUploadFilename(Buffer.from(emojiName, "utf8").toString("latin1")) !== emojiName) throw new Error("Emoji 文件名没有恢复");
if (decodeUploadFilename("plain-report.pdf") !== "plain-report.pdf") throw new Error("ASCII 文件名被错误改写");
if (decodeUploadFilename("café.pdf") !== "café.pdf") throw new Error("无法证明为 UTF-8 误解码的 Latin-1 文件名被猜测性改写");
const longEmojiName = `${"研究📘".repeat(80)}.pdf`;
const repairedLongName = repairImportedDocumentNames({ title: longEmojiName.slice(0, -4), originalName: longEmojiName, sourceType: "pdf" }).originalName;
if (!repairedLongName.endsWith(".pdf") || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(repairedLongName)) throw new Error("长 Unicode 文件名截断了扩展名或代理对");

const repaired = repairImportedDocumentNames({ title: latin1Mojibake.slice(0, -4), originalName: latin1Mojibake, sourceType: "pdf" });
if (repaired.title !== "实习进度1" || repaired.originalName !== chineseName || !repaired.changed) throw new Error("旧导入记录没有形成确定性标题迁移");
const customTitle = repairImportedDocumentNames({ title: "用户自定义标题", originalName: latin1Mojibake, sourceType: "pdf" });
if (customTitle.title !== "用户自定义标题") throw new Error("旧文件名迁移错误覆盖了用户自定义标题");
const blankTitle = repairImportedDocumentNames({ title: latin1Mojibake.slice(0, -4), originalName: latin1Mojibake, sourceType: "blank" });
if (blankTitle.changed) throw new Error("空白文档被错误纳入上传文件名迁移");

if (!DEFAULT_SYSTEM_PROMPTS?.["zh-CN"] || !DEFAULT_SYSTEM_PROMPTS?.en) throw new Error("缺少双语内置 Prompt");
if (!defaultPromptForLanguage("en").startsWith("You are")) throw new Error("英文默认 Prompt 仍不是英文");
if (defaultPromptForLanguage("invalid") !== DEFAULT_SYSTEM_PROMPTS["zh-CN"]) throw new Error("非法 Prompt 语言没有安全回退中文");
if (resolveSystemPrompt(DEFAULT_SYSTEM_PROMPTS["zh-CN"], "en") !== DEFAULT_SYSTEM_PROMPTS.en) throw new Error("中文内置 Prompt 没有随英文正式请求切换");
if (resolveSystemPrompt("用户自己写的中文 Prompt", "en") !== "用户自己写的中文 Prompt") throw new Error("用户自定义 Prompt 被擅自翻译");

const fixtureBase64 = (await readFile(new URL("./fixtures/chinese-image.pdf.base64", import.meta.url), "utf8")).replace(/\s+/g, "");
const fixture = Buffer.from(fixtureBase64, "base64");
if (!hasValidPdfContainer(fixture)) throw new Error("PDF 回归 fixture 容器签名无效");
if (hasValidPdfContainer(Buffer.from("%PDF-1.7\nnot a real PDF", "ascii"))) throw new Error("仅伪造 PDF 文件头的文件被错误接纳");
const pdfWithBomAndTrailer = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), fixture, Buffer.alloc(8192, 0x20)]);
if (!hasValidPdfContainer(pdfWithBomAndTrailer)) throw new Error("带 UTF-8 BOM 和有限尾部数据的合法 PDF 容器被错误拒绝");

const utf16le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("中文 UTF-16LE", "utf16le")]);
if (decodeImportedText(utf16le) !== "中文 UTF-16LE") throw new Error("UTF-16LE 文本文档解码失败");
const utf16beText = "中文 UTF-16BE";
const utf16beBody = Buffer.from(utf16beText, "utf16le");
for (let index = 0; index < utf16beBody.length; index += 2) [utf16beBody[index], utf16beBody[index + 1]] = [utf16beBody[index + 1], utf16beBody[index]];
if (decodeImportedText(Buffer.concat([Buffer.from([0xfe, 0xff]), utf16beBody])) !== utf16beText) throw new Error("UTF-16BE 文本文档解码失败");
if (createHash("sha256").update(fixture).digest("hex") !== "dcd1efb66c75ce0e39c54b3c2e0a383d2fc81333d2df9d41a6242156a8978749") throw new Error("PDF 回归 fixture 被改写");

const semanticFixtureBase64 = (await readFile(new URL("./fixtures/semantic-pdf.pdf.base64", import.meta.url), "utf8")).replace(/\s+/g, "");
const semanticFixture = Buffer.from(semanticFixtureBase64, "base64");
const semantic = await extractPdfStructure("semantic-document", semanticFixture);
if (semantic.status !== "complete" || semantic.version < 1 || semantic.pageCount !== 2) throw new Error("PDF 结构提取没有产生版本化完成状态");
const semanticTypes = new Set(semantic.blocks.map((item) => item.type));
if (!semanticTypes.has("heading") || !semanticTypes.has("paragraph") || !semanticTypes.has("table") || !semanticTypes.has("image")) throw new Error(`PDF 没有分别保留文本、表格和图片结构：${[...semanticTypes].join(",")}`);
const table = semantic.blocks.find((item) => item.type === "table");
if (table?.pdf?.detection !== "heuristic" || table.pdf.confidence < 0.75 || table.table?.rows?.length !== 3 || table.table.rows[0]?.length !== 3 || table.table.rows[1]?.[0] !== "准确率") throw new Error("无标签 PDF 表格没有以可审计的几何结构和置信度恢复");
const image = semantic.blocks.find((item) => item.type === "image");
if (!image?.pdf?.bbox || image.pdf.page !== 1 || image.pdf.operationIndex == null) throw new Error("PDF 图片没有保留页码、绘制操作和坐标来源");
if (semantic.blocks.some((item) => item.type === "table" && item.content.includes("两列普通文字"))) throw new Error("普通两列段落被误判为表格");
if (semantic.blocks.some((item) => item.content.includes("�"))) throw new Error("PDF 语义块含替换字符乱码");

const structuredWordBlocks = htmlToBlocks("word-structure-component", "<p>表格之前</p><table><tr><th colspan=\"2\">中文表头</th></tr><tr><td rowspan=\"2\">合并单元格</td><td><p>第一行</p><p>第二行</p></td></tr><tr><td>末行</td></tr></table><p>表格之后</p>");
const structuredWordTable = structuredWordBlocks[1];
if (JSON.stringify(structuredWordBlocks.map((item) => item.type)) !== JSON.stringify(["paragraph", "table", "paragraph"])) throw new Error("Word HTML 表格的文档顺序没有保留");
if (structuredWordTable.table?.cells?.[0]?.[0]?.colSpan !== 2 || structuredWordTable.table.cells[1]?.[0]?.rowSpan !== 2 || structuredWordTable.table.rows[1]?.[1] !== "第一行\n第二行") throw new Error("Word 表头、合并单元格或单元格内多段文本没有保留");
if (structuredWordTable.content.includes("�") || structuredWordTable.table.rows[0]?.[0] !== "中文表头") throw new Error("Word 表格中文内容发生乱码");

let server;
let docxTableIntegration = false;
let docxTableSaveRoundTrip = false;
let staleTableContentRejected = false;
let malformedTableRejected = false;
try {
  server = await startServer(0, "127.0.0.1");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("DOCX 表格测试服务没有监听 TCP 端口");
  const baseURL = `http://127.0.0.1:${address.port}/api`;
  const loginResponse = await fetch(`${baseURL}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "demo@aitip.local", password: "demo1234" })
  });
  if (!loginResponse.ok) throw new Error(`DOCX 表格测试登录失败：${loginResponse.status}`);
  const { token } = await loginResponse.json();
  const headers = { Authorization: `Bearer ${token}` };
  const docxBytes = await readFile(new URL("../node_modules/mammoth/test/test-data/tables.docx", import.meta.url));
  const form = new FormData();
  form.append("file", new Blob([docxBytes], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), "tables.docx");
  const importResponse = await fetch(`${baseURL}/documents/import`, { method: "POST", headers, body: form });
  const imported = await importResponse.json();
  if (!importResponse.ok) throw new Error(`真实 DOCX 表格导入失败：${imported.error || importResponse.status}`);
  const importedTypes = imported.document.blocks.map((item) => item.type);
  const importedTable = imported.document.blocks.find((item) => item.type === "table");
  if (JSON.stringify(importedTypes) !== JSON.stringify(["paragraph", "table", "paragraph"])) throw new Error(`DOCX 表格没有保留原始块顺序：${JSON.stringify(importedTypes)}`);
  if (JSON.stringify(importedTable?.table?.rows) !== JSON.stringify([["Top left", "Top right"], ["Bottom left", "Bottom right"]])) throw new Error("DOCX 表格没有形成两行两列结构");
  if (imported.document.blocks.some((item) => item.type === "paragraph" && /Top left|Top right|Bottom left|Bottom right/.test(item.content))) throw new Error("DOCX 表格单元格又被重复生成为伪段落");
  docxTableIntegration = true;

  const editedRows = importedTable.table.rows.map((row) => [...row]);
  editedRows[1][1] = "Bottom right edited and persisted";
  const staleContent = importedTable.content;
  const editedBlocks = imported.document.blocks.map((item) => item.id === importedTable.id
    ? { ...item, content: staleContent, table: { ...item.table, rows: editedRows } }
    : item);
  const saveResponse = await fetch(`${baseURL}/documents/${imported.document.id}`, {
    method: "PATCH",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ blocks: editedBlocks })
  });
  const saved = await saveResponse.json();
  if (!saveResponse.ok) throw new Error(`DOCX 表格保存失败：${saved.error || saveResponse.status}`);
  const savedTable = saved.document.blocks.find((item) => item.id === importedTable.id);
  if (savedTable?.table?.rows?.[1]?.[1] !== "Bottom right edited and persisted") throw new Error("PATCH 没有消费修改后的表格结构");
  if (!savedTable.content.includes("Bottom right edited and persisted") || savedTable.content === staleContent) throw new Error("服务端沿用了 stale content，没有从表格结构派生正式内容");
  staleTableContentRejected = true;
  const reopenResponse = await fetch(`${baseURL}/documents/${imported.document.id}`, { headers });
  const reopened = await reopenResponse.json();
  const reopenedTable = reopened.document?.blocks?.find((item) => item.id === importedTable.id);
  if (!reopenResponse.ok || reopenedTable?.table?.rows?.[1]?.[1] !== "Bottom right edited and persisted" || reopenedTable.content !== savedTable.content) throw new Error("表格编辑没有在重新打开文档后保持一致");
  docxTableSaveRoundTrip = true;
  const malformedBlocks = reopened.document.blocks.map((item) => item.id === importedTable.id
    ? { ...item, table: { rows: "fabricated replacement", headerRows: 0 } }
    : item);
  const malformedResponse = await fetch(`${baseURL}/documents/${imported.document.id}`, {
    method: "PATCH",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ blocks: malformedBlocks })
  });
  if (malformedResponse.status !== 400) throw new Error(`畸形表格结构没有被明确拒绝：${malformedResponse.status}`);
  const afterMalformed = await fetch(`${baseURL}/documents/${imported.document.id}`, { headers }).then((response) => response.json());
  if (afterMalformed.document.blocks.find((item) => item.id === importedTable.id)?.table?.rows?.[1]?.[1] !== "Bottom right edited and persisted") throw new Error("畸形替换破坏了此前保存的表格");
  malformedTableRejected = true;
} finally {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await rm(integrationDataDir, { recursive: true, force: true });
}

console.log(JSON.stringify({ filenameUtf8: true, legacyTitleMigration: true, bilingualDefaultPrompt: true, pdfFixtureBytes: fixture.length, pdfSemanticBlocks: semantic.blocks.length, pdfSemanticTypes: [...semanticTypes], docxTableIntegration, docxTableSaveRoundTrip, staleTableContentRejected, malformedTableRejected }));
