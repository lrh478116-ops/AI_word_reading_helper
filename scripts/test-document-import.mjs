import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

process.env.AI_TIP_EMBEDDED = "1";

const {
  DEFAULT_SYSTEM_PROMPTS,
  decodeUploadFilename,
  defaultPromptForLanguage,
  hasValidPdfContainer,
  repairImportedDocumentNames,
  resolveSystemPrompt
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
if (createHash("sha256").update(fixture).digest("hex") !== "dcd1efb66c75ce0e39c54b3c2e0a383d2fc81333d2df9d41a6242156a8978749") throw new Error("PDF 回归 fixture 被改写");

console.log(JSON.stringify({ filenameUtf8: true, legacyTitleMigration: true, bilingualDefaultPrompt: true, pdfFixtureBytes: fixture.length }));
