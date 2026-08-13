import { app, BrowserWindow, Menu, safeStorage, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let mainWindow = null;
let localServer = null;
let localURL = null;
let pythonCalculation = null;
let pythonWorkerTest = null;
let smokeDataDir = null;
const smokeResultPath = process.env.AI_TIP_SMOKE_RESULT_PATH ? path.resolve(process.env.AI_TIP_SMOKE_RESULT_PATH) : "";

async function bootServer() {
  if (localURL) return localURL;
  process.env.AI_TIP_EMBEDDED = "1";
  process.env.AI_TIP_DESKTOP = "1";
  if (process.argv.includes("--smoke-test")) smokeDataDir ||= mkdtempSync(path.join(tmpdir(), "ai-tip-desktop-smoke-"));
  process.env.AI_TIP_DATA_DIR = smokeDataDir || path.join(app.getPath("userData"), "data");
  process.env.AI_TIP_DIST_DIR = path.join(appRoot, "dist");
  process.env.AI_TIP_APP_ROOT = appRoot;
  const serverModule = await import(new URL("../dist-electron/server.cjs", import.meta.url));
  const startServer = serverModule.startServer || serverModule.default?.startServer;
  const configureSecretProtection = serverModule.configureSecretProtection || serverModule.default?.configureSecretProtection;
  pythonCalculation = serverModule.runPythonCalculation || serverModule.default?.runPythonCalculation;
  pythonWorkerTest = serverModule.runPythonWorker || serverModule.default?.runPythonWorker;
  if (!startServer) throw new Error("本地服务模块加载失败");
  if (configureSecretProtection && safeStorage.isEncryptionAvailable()) {
    configureSecretProtection(
      (value) => safeStorage.encryptString(value).toString("base64"),
      (value) => safeStorage.decryptString(Buffer.from(value, "base64"))
    );
  }
  localServer = await startServer(process.argv.includes("--dev") ? 8787 : 0, "127.0.0.1");
  const address = localServer.address();
  if (!address || typeof address === "string") throw new Error("无法启动本地服务");
  localURL = `http://127.0.0.1:${address.port}`;
  return localURL;
}

function installMenu() {
  const template = [
    ...(process.platform === "darwin" ? [{ label: app.name, submenu: [{ role: "about" }, { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" }, { role: "quit" }] }] : []),
    { label: "编辑", submenu: [{ role: "undo", label: "撤销" }, { role: "redo", label: "重做" }, { type: "separator" }, { role: "cut", label: "剪切" }, { role: "copy", label: "复制" }, { role: "paste", label: "粘贴" }, { role: "selectAll", label: "全选" }] },
    { label: "视图", submenu: [{ role: "reload", label: "重新载入" }, { role: "togglefullscreen", label: "切换全屏" }] },
    { label: "窗口", submenu: [{ role: "minimize", label: "最小化" }, { role: "close", label: "关闭" }] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow() {
  const serverURL = await bootServer();
  const smokeTest = process.argv.includes("--smoke-test");
  mainWindow = new BrowserWindow({
    width: 1440,
    height: smokeTest ? 800 : 920,
    minWidth: 980,
    minHeight: 680,
    show: false,
    backgroundColor: "#f5f6f1",
    title: "AI Tip",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once("ready-to-show", () => { if (!smokeTest) mainWindow?.show(); });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowedOrigin = process.argv.includes("--dev") ? "http://127.0.0.1:5173" : serverURL;
    if (!url.startsWith(allowedOrigin)) event.preventDefault();
  });
  await mainWindow.loadURL(process.argv.includes("--dev") ? "http://127.0.0.1:5173" : serverURL);
  if (smokeTest) {
    const snapshot = await mainWindow.webContents.executeJavaScript("({ title: document.title, url: location.href, text: document.body.innerText.slice(0, 300) })");
    if (snapshot.title === "Error" || !snapshot.text.includes("AI Tip")) throw new Error(`桌面页面加载异常：${JSON.stringify(snapshot)}`);
    const externalPdfFixturePath = process.env.AI_TIP_PDF_FIXTURE_PATH ? path.resolve(process.env.AI_TIP_PDF_FIXTURE_PATH) : "";
    const pdfFixturePath = externalPdfFixturePath || path.join(appRoot, "scripts", "fixtures", "semantic-pdf.pdf.base64");
    const pdfFixtureBase64 = existsSync(pdfFixturePath) ? readFileSync(pdfFixturePath, "utf8").replace(/\s+/g, "") : "";
    const ocrPdfFixturePath = path.join(appRoot, "scripts", "fixtures", "scanned-pdf.pdf.base64");
    const ocrPdfFixtureBase64 = existsSync(ocrPdfFixturePath) ? readFileSync(ocrPdfFixturePath, "utf8").replace(/\s+/g, "") : "";
    if (!pdfFixtureBase64 || !ocrPdfFixtureBase64) throw new Error("桌面验收所需的 PDF 测试文件缺失");
    let productBehavior;
    try { productBehavior = await mainWindow.webContents.executeJavaScript(`(async () => {
      const pdfFixtureBase64 = ${JSON.stringify(pdfFixtureBase64)};
      const ocrPdfFixtureBase64 = ${JSON.stringify(ocrPdfFixtureBase64)};
      const capturePdfCanvas = ${JSON.stringify(Boolean(process.env.AI_TIP_PDF_SCREENSHOT_PATH))};
      const waitFor = async (selector, timeout = 5000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          const element = document.querySelector(selector);
          if (element) return element;
          await new Promise(resolve => setTimeout(resolve, 40));
        }
        throw new Error('等待界面元素超时：' + selector);
      };
      const waitUntil = async (test, label, timeout = 10000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          const value = test();
          if (value) return value;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        throw new Error('等待状态超时：' + label);
      };
      const change = (select, value) => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); };
      const setTextArea = (element, value) => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); };
      const setInput = (element, value) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); };
      const selectText = (element, start = 0, length = 4) => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let cursor = 0; let startNode = null; let endNode = null; let startOffset = 0; let endOffset = 0;
        while (walker.nextNode()) {
          const node = walker.currentNode; const next = cursor + node.data.length;
          if (!startNode && start >= cursor && start <= next) { startNode = node; startOffset = start - cursor; }
          if (start + length >= cursor && start + length <= next) { endNode = node; endOffset = start + length - cursor; break; }
          cursor = next;
        }
        if (!startNode || !endNode) throw new Error('无法建立测试选区');
        const range = document.createRange(); range.setStart(startNode, startOffset); range.setEnd(endNode, endOffset);
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
        element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      };
      const authLanguage = await waitFor('.auth-language select');
      change(authLanguage, 'zh-CN');
      await new Promise(resolve => setTimeout(resolve, 80));
      if (!document.querySelector('.demo-button')?.textContent?.includes('仅本地使用')) throw new Error('中文本地入口未接入语言状态');
      if (document.body.innerText.includes('直接进入演示')) throw new Error('旧展示入口文案仍然可见');
      change(authLanguage, 'en');
      await new Promise(resolve => setTimeout(resolve, 80));
      if (!document.querySelector('.demo-button')?.textContent?.includes('Local use only')) throw new Error('英文语言切换未改变正式登录界面');
      if (localStorage.getItem('ai-tip-language') !== 'en') throw new Error('登录页语言选择没有持久化');
      document.querySelector('.demo-button').click();
      await waitFor('.app-nav');
      const token = localStorage.getItem('ai-tip-token');
      const documents = await fetch('/api/documents', { headers: { Authorization: 'Bearer ' + token } }).then(response => response.json());
      if (!Array.isArray(documents.documents) || documents.documents.length !== 0) throw new Error('本地账户仍含 Transformer 样例文档');
      if (!document.querySelector('.logout-button')?.textContent?.includes('Sign out')) throw new Error('退出登录按钮未显示英文标签');
      document.querySelector('.nav-bottom > button').click();
      const settingsLanguage = await waitFor('.settings-body > .language-select select');
      if (settingsLanguage.value !== 'en') throw new Error('设置与登录页没有共享语言状态');
      const defaultPromptArea = document.querySelector('.settings-body > label textarea[rows="8"]');
      if (!defaultPromptArea?.value?.startsWith('You are') || /[\u3400-\u9fff]/u.test(defaultPromptArea.value)) throw new Error('英文设置仍显示中文内置 Prompt');
      const providerLabels = [...document.querySelectorAll('.settings-grid select option')].map(option => option.textContent || '');
      if (providerLabels.length !== 8 || providerLabels.some(label => /[\u3400-\u9fff]/u.test(label))) throw new Error('英文接口服务商列表仍含中文或条目缺失：' + providerLabels.join(','));
      if (!document.querySelector('.feedback-box') || document.body.innerText.includes('@qq.com')) throw new Error('建议箱缺失或收件地址暴露在界面中');
      const feedbackText = 'This suggestion must remain visible when the email relay is not configured.';
      const feedbackArea = document.querySelector('.feedback-box textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(feedbackArea, feedbackText);
      feedbackArea.dispatchEvent(new Event('input', { bubbles: true }));
      feedbackArea.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 100));
      const feedbackSubmit = document.querySelector('.feedback-submit');
      if (feedbackSubmit.disabled) throw new Error('有效建议没有启用发送按钮');
      feedbackSubmit.click();
      await waitFor('.feedback-box .settings-message.error');
      if (document.querySelector('.feedback-box textarea').value !== feedbackText) throw new Error('建议发送失败后输入内容被错误清空');
      change(settingsLanguage, 'zh-CN');
      await new Promise(resolve => setTimeout(resolve, 80));
      if (!document.querySelector('.logout-button')?.textContent?.includes('退出登录')) throw new Error('设置中的语言切换未传播到导航');
      if (localStorage.getItem('ai-tip-language') !== 'zh-CN') throw new Error('设置页语言选择没有持久化');
      document.querySelector('.settings-modal > header .icon-button').click();
      window.__desktopSmokeStep = 'empty import';
      const emptyImport = await waitFor('[data-empty-import]');
      if (!emptyImport.textContent.includes('导入文档') || emptyImport.querySelector('.lucide-plus')) throw new Error('空文档库主操作仍是新建空白文档');
      const acceptedExtensions = (document.querySelector('[data-global-document-input]')?.getAttribute('accept') || '').split(',').map(value => value.trim()).filter(Boolean);
      if (JSON.stringify(acceptedExtensions) !== JSON.stringify(['.txt', '.md', '.markdown', '.docx', '.pdf'])) throw new Error('全局导入类型与服务端支持集不一致：' + JSON.stringify(acceptedExtensions));
      document.querySelector('.header-actions .primary').click();
      const dropSourceEditor = await waitFor('[data-editor-document]');
      const dropSourceId = dropSourceEditor.getAttribute('data-editor-document');
      setInput(document.querySelector('.document-title'), '拖放前必须保存的标题');
      const dropSourceBlock = await waitFor('[contenteditable][data-block-id]');
      dropSourceBlock.innerText = '这段最新修改必须在上传新文档前持久化。';
      dropSourceBlock.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: dropSourceBlock.innerText }));
      document.querySelector('.editor-controls .icon-button:last-child').click();
      const dropTarget = await waitFor('.settings-modal');
      const dispatchFileDrop = (target, files) => {
        const transfer = new DataTransfer(); files.forEach(file => transfer.items.add(file));
        target.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: transfer }));
        target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
        return !target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
      };
      const documentsBeforeDrop = await fetch('/api/documents', { headers: { Authorization: 'Bearer ' + token } }).then(response => response.json());
      window.__desktopSmokeStep = 'unsupported drop';
      const unsupportedPrevented = dispatchFileDrop(dropTarget, [new File(['not a document'], 'unsafe.exe', { type: 'application/octet-stream' })]);
      await waitFor('[data-import-error]');
      const documentsAfterUnsupportedDrop = await fetch('/api/documents', { headers: { Authorization: 'Bearer ' + token } }).then(response => response.json());
      if (!unsupportedPrevented || documentsAfterUnsupportedDrop.documents.length !== documentsBeforeDrop.documents.length || document.querySelector('[data-editor-document]')?.getAttribute('data-editor-document') !== dropSourceId) throw new Error('不支持文件拖放没有阻止默认导航或错误触发了上传');
      const originalFetch = window.fetch.bind(window); const importTrace = []; let failNextSourceSave = true;
      window.fetch = async (input, init = {}) => {
        const url = String(input instanceof Request ? input.url : input); const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
        if (url.includes('/api/documents/' + dropSourceId) && method === 'PATCH') {
          importTrace.push('PATCH:start');
          if (failNextSourceSave) { failNextSourceSave = false; importTrace.push('PATCH:failed'); throw new Error('injected save failure'); }
          const response = await originalFetch(input, init); importTrace.push('PATCH:done'); return response;
        }
        if (url.includes('/api/documents/import') && method === 'POST') importTrace.push('IMPORT:start');
        return originalFetch(input, init);
      };
      const droppedMarkdown = new File(['# Drag import\\n\\nImported from the settings overlay.'], 'drag-import.md', { type: 'text/markdown' });
      window.__desktopSmokeStep = 'failed-save drop';
      dispatchFileDrop(dropTarget, [droppedMarkdown]);
      await waitUntil(() => document.querySelector('[data-import-error]')?.textContent?.length > 0, 'save failure blocks drag import');
      await new Promise(resolve => setTimeout(resolve, 100));
      const afterFailedSave = await originalFetch('/api/documents', { headers: { Authorization: 'Bearer ' + token } }).then(response => response.json());
      if (afterFailedSave.documents.length !== documentsBeforeDrop.documents.length || importTrace.includes('IMPORT:start') || document.querySelector('[data-editor-document]')?.getAttribute('data-editor-document') !== dropSourceId) throw new Error('保存失败后仍上传或替换了原文档');
      window.__desktopSmokeStep = 'successful drop';
      dispatchFileDrop(dropTarget, [droppedMarkdown]);
      const importedEditor = await waitUntil(() => { const editor = document.querySelector('[data-editor-document]'); return editor?.getAttribute('data-editor-document') !== dropSourceId ? editor : null; }, 'drag import opens returned document');
      window.fetch = originalFetch;
      const importedId = importedEditor.getAttribute('data-editor-document');
      const savedSource = await originalFetch('/api/documents/' + dropSourceId, { headers: { Authorization: 'Bearer ' + token } }).then(response => response.json());
      const importedDropDocument = await originalFetch('/api/documents/' + importedId, { headers: { Authorization: 'Bearer ' + token } }).then(response => response.json());
      if (savedSource.document.title !== '拖放前必须保存的标题' || savedSource.document.blocks[0]?.content !== '这段最新修改必须在上传新文档前持久化。' || importedDropDocument.document.sourceType !== 'markdown' || !importedDropDocument.document.blocks.some(block => block.content.includes('Imported from the settings overlay.'))) throw new Error('拖放导入没有保证原文档保存或新文档解析');
      if (importTrace.indexOf('PATCH:done') < 0 || importTrace.indexOf('IMPORT:start') < importTrace.indexOf('PATCH:done') || document.querySelector('.settings-modal')) throw new Error('拖放事务顺序不是保存完成后再上传，或成功后未显示新文档');
      document.querySelector('.back-button').click();
      await waitFor('.app-nav');
      let pdfVisual = false;
      let ocrLayoutMaxDelta = 0;
      let pdfTipOpenLayoutMaxDelta = 0;
      let pdfCanvasDataUrl = '';
      let pdfSecondCanvasDataUrl = '';
      if (pdfFixtureBase64) {
        const binary = atob(pdfFixtureBase64); const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
        const file = new File([bytes], '中文图片资料.pdf', { type: 'application/pdf' });
        const transfer = new DataTransfer(); transfer.items.add(file);
        const fileInput = document.querySelector('input[type="file"]');
        fileInput.files = transfer.files;
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        await waitFor('[data-pdf-document]');
        const originalPages = await waitUntil(() => document.querySelectorAll('[data-pdf-page]').length === 2 ? [...document.querySelectorAll('[data-pdf-page]')] : null, 'PDF original pages');
        await waitUntil(() => originalPages[0].classList.contains('rendered') && originalPages[0].querySelectorAll('.pdf-text-layer span').length >= 5, 'PDF original TextLayer');
        const originalSelectionSpan = await waitUntil(() => [...originalPages[0].querySelectorAll('.pdf-text-layer span')].find(element => element.textContent?.includes('可选择')), 'selectable PDF source text');
        const originalSelectionStart = originalSelectionSpan.textContent.indexOf('可选择');
        selectText(originalSelectionSpan, originalSelectionStart, '可选择'.length);
        (await waitFor('.selection-toolbar button')).click();
        const pdfTipPanel = await waitFor('[data-tip-panel]');
        const pdfTipId = pdfTipPanel.getAttribute('data-tip-panel');
        const pdfDocumentId = document.querySelector('[data-pdf-document]').getAttribute('data-pdf-document');
        const persistedPdf = await fetch('/api/documents/' + pdfDocumentId, { headers: { Authorization: 'Bearer ' + token } }).then(response => response.json());
        const persistedPdfTip = persistedPdf.tips.find(tip => tip.id === pdfTipId);
        if (persistedPdfTip?.anchorType !== 'pdf' || persistedPdfTip?.pdfAnchor?.pdfFingerprint !== persistedPdf.document.pdfStructure?.fingerprint || persistedPdfTip?.selectedText !== '可选择') throw new Error('PDF TextLayer selection did not create a fingerprint-bound PDF Tip through the formal path');
        pdfTipPanel.querySelector('.tip-head .icon-button').click();
        await waitUntil(() => !document.querySelector('[data-tip-panel]') && document.querySelector('.pdf-page-tip'), 'PDF Tip overlay after collapse');
        document.querySelector('.pdf-page-tip').click();
        await waitUntil(() => document.querySelector('[data-tip-panel="' + pdfTipId + '"]'), 'reopen PDF Tip from overlay');
        document.querySelector('[data-tip-panel="' + pdfTipId + '"] .tip-head .icon-button').click();
        await waitUntil(() => !document.querySelector('[data-tip-panel]'), 'restore PDF page after Tip collapse');
        if (document.querySelector('.document-title')?.value !== '中文图片资料') throw new Error('Electron 文件输入没有保留中文 PDF 标题');
        document.querySelector('.pdf-view-switch button:first-child').click();
        const semanticText = await waitFor('[data-pdf-semantic-block] p');
        const semanticTable = await waitFor('[data-pdf-table-block]');
        const semanticImage = await waitUntil(() => document.querySelector('[data-pdf-image-block]')?.naturalWidth > 100 ? document.querySelector('[data-pdf-image-block]') : null, 'PDF 独立图片对象');
        if (!semanticText.textContent.includes('可选择') || semanticTable.querySelectorAll('tr').length !== 3 || semanticImage.tagName !== 'IMG') throw new Error('PDF 结构化视图没有分别保留文本、表格和图片');
        document.querySelector('.pdf-view-switch button:nth-child(2)').click();
        const pages = await waitUntil(() => document.querySelectorAll('[data-pdf-page]').length === 2 ? [...document.querySelectorAll('[data-pdf-page]')] : null, 'PDF 两页结构');
        const firstCanvas = await waitUntil(() => pages[0].classList.contains('rendered') && pages[0].querySelector('canvas')?.width > 500 ? pages[0].querySelector('canvas') : null, 'PDF 第一页 Canvas');
        if (pages[0].querySelectorAll('.pdf-text-layer span').length < 5) throw new Error('PDF 原始版式没有叠加真实可选择 TextLayer');
        const pixels = firstCanvas.getContext('2d').getImageData(0, 0, firstCanvas.width, firstCanvas.height).data;
        let coloredPixels = 0;
        for (let index = 0; index < pixels.length; index += 64) {
          const red = pixels[index], green = pixels[index + 1], blue = pixels[index + 2], alpha = pixels[index + 3];
          if (alpha > 0 && Math.max(red, green, blue) - Math.min(red, green, blue) > 35) coloredPixels += 1;
        }
        if (coloredPixels < 150) throw new Error('PDF 第一页彩色图片或矢量内容没有进入 Canvas');
        if (capturePdfCanvas) pdfCanvasDataUrl = firstCanvas.toDataURL('image/png');
        pages[1].scrollIntoView({ block: 'center' });
        const secondCanvas = await waitUntil(() => pages[1].classList.contains('rendered') && pages[1].querySelector('canvas')?.height > 500 ? pages[1].querySelector('canvas') : null, 'PDF 第二页按需渲染');
        if (capturePdfCanvas) pdfSecondCanvasDataUrl = secondCanvas.toDataURL('image/png');
        pdfVisual = true;
        document.querySelector('.back-button').click();
        await waitFor('.app-nav');
        if (ocrPdfFixtureBase64) {
          const ocrBinary = atob(ocrPdfFixtureBase64); const ocrBytes = new Uint8Array(ocrBinary.length);
          for (let index = 0; index < ocrBinary.length; index++) ocrBytes[index] = ocrBinary.charCodeAt(index);
          const ocrFile = new File([ocrBytes], 'scanned-ocr-test.pdf', { type: 'application/pdf' });
          const ocrTransfer = new DataTransfer(); ocrTransfer.items.add(ocrFile);
          const ocrInput = document.querySelector('input[type="file"]'); ocrInput.files = ocrTransfer.files;
          ocrInput.dispatchEvent(new Event('change', { bubbles: true }));
          const ocrDocument = await waitFor('[data-pdf-document]');
          const ocrDocumentId = ocrDocument.getAttribute('data-pdf-document');
          const ocrPage = await waitFor('[data-pdf-page="1"]');
          await waitUntil(() => ocrPage.classList.contains('rendered'), 'scanned PDF canvas');
          const ocrButton = await waitFor('.pdf-page-shell > header button');
          ocrButton.click();
          await waitUntil(() => ocrPage.querySelectorAll('.pdf-ocr-word').length >= 3 && ocrPage.querySelector('header small'), 'offline OCR word layer', 120000);
          const ocrWord = await waitUntil(() => [...ocrPage.querySelectorAll('.pdf-ocr-word')].find(element => /OCR/i.test(element.textContent || '')), 'OCR selectable word');
          selectText(ocrWord, 0, Math.min(3, ocrWord.textContent.trim().length));
          (await waitUntil(() => document.querySelector('.selection-toolbar button'), 'first-page OCR selection toolbar')).click();
          let ocrTipPanel = await waitUntil(() => document.querySelector('[data-tip-panel]'), 'first-page OCR Tip panel');
          const ocrTipId = ocrTipPanel.getAttribute('data-tip-panel');
          const persistedOcr = await fetch('/api/documents/' + ocrDocumentId, { headers: { Authorization: 'Bearer ' + token } }).then(response => response.json());
          const persistedOcrTip = persistedOcr.tips.find(tip => tip.id === ocrTipId);
          if (persistedOcr.document.pdfStructure?.pages?.[0]?.source !== 'ocr' || persistedOcrTip?.anchorType !== 'pdf' || persistedOcrTip?.pdfAnchor?.source !== 'ocr' || !(persistedOcrTip?.pdfAnchor?.confidence > 0)) throw new Error('offline OCR output did not become a persisted PDF Tip authority');
          const ocrComposer = ocrTipPanel.querySelector('.tip-composer textarea');
          for (let turn = 1; turn <= 3; turn++) {
            setTextArea(ocrComposer, 'Explain this selected text in more detail, turn ' + turn + '.');
            ocrTipPanel.querySelector('.send-button').click();
            await waitUntil(() => ocrTipPanel.querySelectorAll('.message.assistant .message-content').length >= turn && [...ocrTipPanel.querySelectorAll('.message.assistant .message-content')].every(element => element.textContent.length > 8), 'persisted OCR Tip answer ' + turn);
          }
          const persistedOcrConversation = await fetch('/api/documents/' + ocrDocumentId, { headers: { Authorization: 'Bearer ' + token } }).then(response => response.json());
          if ((persistedOcrConversation.tips.find(tip => tip.id === ocrTipId)?.messages?.length || 0) < 6) throw new Error('PDF Tip reopening regression requires persisted multi-turn history');
          ocrTipPanel.querySelector('.tip-head .icon-button').click();
          const firstOcrTipMarker = await waitUntil(() => !document.querySelector('[data-tip-panel]') && document.querySelector('[data-pdf-tip-id="' + ocrTipId + '"]'), 'collapsed first-page OCR Tip marker');
          firstOcrTipMarker.scrollIntoView({ block: 'center' });
          await new Promise(resolve => setTimeout(resolve, 500));
          window.scrollTo(0, 0); document.documentElement.scrollTop = 0; document.body.scrollTop = 0;
          const tipOpenScroll = document.querySelector('.editor-scroll'); const tipOpenNav = document.querySelector('.editor-nav'); const tipOpenTopbar = document.querySelector('.editor-topbar');
          const sampleTipOpenLayout = () => ({ anchorTop: firstOcrTipMarker.getBoundingClientRect().top, scrollTop: tipOpenScroll.scrollTop, navTop: tipOpenNav.getBoundingClientRect().top, navBottom: tipOpenNav.getBoundingClientRect().bottom, topbarTop: tipOpenTopbar.getBoundingClientRect().top, windowScroll: window.scrollY, documentScroll: document.documentElement.scrollTop, bodyScroll: document.body.scrollTop });
          const initialTipOpenLayout = sampleTipOpenLayout(); const tipOpenSamples = [initialTipOpenLayout];
          const tipOpenTimer = setInterval(() => tipOpenSamples.push(sampleTipOpenLayout()), 8);
          firstOcrTipMarker.click();
          ocrTipPanel = await waitUntil(() => document.querySelector('[data-tip-panel="' + ocrTipId + '"]'), 'reopened OCR Tip panel');
          await waitUntil(() => { const list = ocrTipPanel.querySelector('.message-list'); return list && list.scrollHeight - list.clientHeight - list.scrollTop <= 2 ? list : null; }, 'reopened PDF Tip internal message scroll');
          tipOpenSamples.push(sampleTipOpenLayout()); clearInterval(tipOpenTimer);
          const messageList = ocrTipPanel.querySelector('.message-list');
          if (messageList.scrollHeight - messageList.clientHeight - messageList.scrollTop > 2) throw new Error('reopened PDF Tip did not scroll its own message history to the bottom');
          const maximumRootScroll = tipOpenSamples.reduce((result, sample) => Math.max(result, Math.abs(sample.windowScroll), Math.abs(sample.documentScroll), Math.abs(sample.bodyScroll)), 0);
          if (maximumRootScroll > 1) throw new Error('opening a PDF Tip with history scrolled the application root by ' + maximumRootScroll + 'px');
          pdfTipOpenLayoutMaxDelta = tipOpenSamples.reduce((result, sample) => Math.max(result, Math.abs(sample.anchorTop - initialTipOpenLayout.anchorTop), Math.abs(sample.navTop - initialTipOpenLayout.navTop), Math.abs(sample.navBottom - initialTipOpenLayout.navBottom), Math.abs(sample.topbarTop - initialTipOpenLayout.topbarTop)), 0);
          if (pdfTipOpenLayoutMaxDelta > 2) throw new Error('opening an existing PDF Tip moved the reading anchor or app columns by ' + pdfTipOpenLayoutMaxDelta + 'px');
          const scannedPages = [...document.querySelectorAll('[data-pdf-page]')];
          if (scannedPages.length !== 4) throw new Error('OCR layout regression requires a four-page scanned PDF');
          const layoutPage = scannedPages[2];
          layoutPage.scrollIntoView({ block: 'center' });
          await waitUntil(() => layoutPage.classList.contains('rendered') && layoutPage.querySelector('header button'), 'middle scanned PDF page');
          await new Promise(resolve => setTimeout(resolve, 500));
          const editorScroll = document.querySelector('.editor-scroll'); const editorNav = document.querySelector('.editor-nav');
          const sampleLayout = () => ({ pageHeight: layoutPage.getBoundingClientRect().height, scrollTop: editorScroll.scrollTop, navTop: editorNav.getBoundingClientRect().top, navBottom: editorNav.getBoundingClientRect().bottom, tipTop: ocrTipPanel.getBoundingClientRect().top, tipBottom: ocrTipPanel.getBoundingClientRect().bottom });
          const initialLayout = sampleLayout(); const layoutSamples = [initialLayout];
          const layoutTimer = setInterval(() => layoutSamples.push(sampleLayout()), 8);
          layoutPage.querySelector('header button').click();
          await waitUntil(() => layoutPage.querySelectorAll('.pdf-ocr-word').length >= 3 && layoutPage.querySelector('header small'), 'middle-page OCR word layer', 120000);
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          layoutSamples.push(sampleLayout()); clearInterval(layoutTimer);
          const maximumLayoutDelta = layoutSamples.reduce((result, sample) => Math.max(result, Math.abs(sample.pageHeight - initialLayout.pageHeight), Math.abs(sample.scrollTop - initialLayout.scrollTop), Math.abs(sample.navTop - initialLayout.navTop), Math.abs(sample.navBottom - initialLayout.navBottom), Math.abs(sample.tipTop - initialLayout.tipTop), Math.abs(sample.tipBottom - initialLayout.tipBottom)), 0);
          ocrLayoutMaxDelta = maximumLayoutDelta;
          if (maximumLayoutDelta > 2) throw new Error('OCR changed page height, scroll position, or three-column geometry by ' + maximumLayoutDelta + 'px');
          ocrTipPanel.querySelector('.tip-head .icon-button').click();
          await waitUntil(() => !document.querySelector('[data-tip-panel]') && document.querySelector('.pdf-page-tip'), 'first OCR Tip overlay');
          const middleOcrWord = await waitUntil(() => [...layoutPage.querySelectorAll('.pdf-ocr-word')].find(element => /OCR/i.test(element.textContent || '')), 'middle-page OCR selectable word');
          selectText(middleOcrWord, 0, Math.min(3, middleOcrWord.textContent.trim().length));
          (await waitUntil(() => document.querySelector('.selection-toolbar button'), 'middle-page OCR selection toolbar')).click();
          const middleOcrTipPanel = await waitUntil(() => document.querySelector('[data-tip-panel]'), 'middle-page OCR Tip panel');
          const verifiedLayoutOcr = await fetch('/api/documents/' + ocrDocumentId, { headers: { Authorization: 'Bearer ' + token } }).then(response => response.json());
          const middleOcrTip = verifiedLayoutOcr.tips.find(tip => tip.id === middleOcrTipPanel.getAttribute('data-tip-panel'));
          if (verifiedLayoutOcr.document.pdfStructure?.pages?.[2]?.source !== 'ocr' || middleOcrTip?.pdfAnchor?.pageNumber !== 3 || middleOcrTip?.pdfAnchor?.source !== 'ocr') throw new Error('layout-stable OCR result did not continue into the formal PDF Tip path');
          middleOcrTipPanel.querySelector('.tip-head .icon-button').click();
          await waitUntil(() => !document.querySelector('[data-tip-panel]'), 'middle-page OCR Tip collapse');
          document.querySelector('.back-button').click();
          await waitFor('.app-nav');
        }
      }
      document.querySelector('.header-actions .primary').click();
      const editableBlock = await waitFor('[contenteditable][data-block-id]');
      editableBlock.innerText = '这是用于验证聊天内递归 Tip 的原文内容。';
      editableBlock.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: editableBlock.innerText }));
      await new Promise(resolve => setTimeout(resolve, 1100));
      selectText(editableBlock, 0, 6);
      (await waitFor('.selection-toolbar button')).click();
      const rootPanel = await waitFor('[data-tip-panel]');
      const rootId = rootPanel.getAttribute('data-tip-panel');
      const rootComposer = rootPanel.querySelector('.tip-composer textarea');
      setTextArea(rootComposer, '这个概念是什么意思？');
      rootPanel.querySelector('.send-button').click();
      const rootMessage = await waitUntil(() => {
        const element = document.querySelector('[data-tip-panel="' + rootId + '"] .message.assistant .message-content');
        return element?.textContent?.length > 8 ? element : null;
      }, '根 Tip 回答');
      selectText(rootMessage, 0, 4);
      (await waitFor('.selection-toolbar button')).click();
      const childPanel = await waitUntil(() => [...document.querySelectorAll('[data-tip-panel]')].find(element => element.getAttribute('data-tip-panel') !== rootId), '子 Tip 面板');
      const childId = childPanel.getAttribute('data-tip-panel');
      if (document.querySelector('.tip-panel-context')?.getAttribute('data-tip-panel') !== rootId || !document.querySelector('.tip-tree-button')) throw new Error('子 Tip 没有形成父聊天替换文档的双栏布局或树入口');
      document.querySelector('.tip-tree-button').click();
      await waitFor('.tip-tree-dialog');
      const childVertex = document.querySelector('[data-tip-tree-id="' + childId + '"]');
      if (!childVertex) throw new Error('Tip 树没有显示子对话节点');
      const childName = '可修改的子对话名称';
      childVertex.querySelector('input').focus();
      setInput(childVertex.querySelector('input'), childName);
      childVertex.querySelector('.tip-tree-save').click();
      await new Promise(resolve => setTimeout(resolve, 180));
      document.querySelector('[data-tip-tree-id="' + rootId + '"] .tip-tree-locate').click();
      await waitUntil(() => document.querySelector('.document-page') && document.querySelector('[data-tip-panel="' + rootId + '"]') && !document.querySelector('.tip-panel-context'), '树节点定位根 Tip');
      document.querySelector('.tip-tree-button').click();
      await waitFor('.tip-tree-dialog');
      document.querySelector('[data-tip-tree-id="' + childId + '"] .tip-tree-locate').click();
      await waitUntil(() => document.querySelector('.tip-panel-context')?.getAttribute('data-tip-panel') === rootId && document.querySelector('[data-tip-panel="' + childId + '"]:not(.tip-panel-context)'), '树节点定位子 Tip');
      const childComposer = document.querySelector('[data-tip-panel="' + childId + '"] .tip-composer textarea');
      setTextArea(childComposer, '请继续解释这个局部概念');
      document.querySelector('[data-tip-panel="' + childId + '"] .send-button').click();
      const childMessage = await waitUntil(() => {
        const element = document.querySelector('[data-tip-panel="' + childId + '"] .message.assistant .message-content');
        return element?.textContent?.length > 8 ? element : null;
      }, '子 Tip 回答');
      selectText(childMessage, 0, 4);
      (await waitFor('.selection-toolbar button')).click();
      const grandPanel = await waitUntil(() => [...document.querySelectorAll('[data-tip-panel]')].find(element => ![rootId, childId].includes(element.getAttribute('data-tip-panel'))), '孙 Tip 面板');
      const grandId = grandPanel.getAttribute('data-tip-panel');
      if (document.querySelector('.tip-panel-context')?.getAttribute('data-tip-panel') !== childId) throw new Error('孙 Tip 没有递归显示为子聊天 + 孙聊天');
      grandPanel.querySelector('.tip-head .icon-button').click();
      await waitUntil(() => document.querySelector('.tip-panel-context')?.getAttribute('data-tip-panel') === rootId && document.querySelector('[data-tip-panel="' + childId + '"]:not(.tip-panel-context)'), '收回孙 Tip 恢复父子布局');
      document.querySelector('[data-tip-panel="' + childId + '"]:not(.tip-panel-context) .tip-head .icon-button').click();
      await waitUntil(() => document.querySelector('.document-page') && document.querySelector('[data-tip-panel="' + rootId + '"]') && !document.querySelector('.tip-panel-context'), '收回子 Tip 恢复文档与根 Tip');
      document.querySelector('[data-tip-panel="' + rootId + '"] .tip-head .icon-button').click();
      await waitUntil(() => document.querySelector('.document-page') && !document.querySelector('[data-tip-panel]'), '收回根 Tip 恢复文档');
      const nestedDocuments = await fetch('/api/documents', { headers: { Authorization: 'Bearer ' + token } }).then(response => response.json());
      const nestedDocument = await fetch('/api/documents/' + nestedDocuments.documents[0].id, { headers: { Authorization: 'Bearer ' + token } }).then(response => response.json());
      if (!nestedDocument.tips.some(tip => tip.id === childId && tip.parentTipId === rootId && tip.title === childName) || !nestedDocument.tips.some(tip => tip.id === grandId && tip.parentTipId === childId && tip.depth === 3)) throw new Error('树改名或递归 lineage 没有持久化：' + JSON.stringify({ rootId, childId, grandId, tips: nestedDocument.tips.map(tip => ({ id: tip.id, parentTipId: tip.parentTipId, title: tip.title, depth: tip.depth })) }));
      document.querySelector('.back-button').click();
      await waitFor('.app-nav');
      document.querySelector('.logout-button').click();
      await waitFor('.auth-shell');
      if (localStorage.getItem('ai-tip-token') !== null) throw new Error('退出登录没有清除正式会话');
      return { localEntry: true, languageShared: true, englishDefaultPrompt: true, feedbackFailurePreserved: true, recipientHidden: true, transformerRemoved: true, emptyImportDefault: true, globalDropImport: true, unsupportedDropBlocked: true, saveFailureBlocked: true, saveBeforeDropUpload: true, pdfVisual, pdfOriginalTipSelection: true, pdfTipOverlayReopen: true, pdfTipOpenLayoutStable: true, pdfTipOpenLayoutMaxDelta, offlineOcr: true, ocrTipAuthority: true, ocrLayoutStable: true, ocrLayoutMaxDelta, pdfCanvasDataUrl, pdfSecondCanvasDataUrl, nestedTipSelection: true, recursiveLayout: true, treeRename: true, collapseRestored: true, logoutCleared: true };
    })()`); }
    catch (error) {
      const diagnostic = await mainWindow.webContents.executeJavaScript("({ step: window.__desktopSmokeStep || 'unknown', text: document.body.innerText.slice(-700), importError: document.querySelector('[data-import-error]')?.textContent || '', editor: document.querySelector('[data-editor-document]')?.getAttribute('data-editor-document') || '' })").catch(() => ({}));
      throw new Error(`Desktop UI smoke failed at ${JSON.stringify(diagnostic)}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (process.env.AI_TIP_PDF_SCREENSHOT_PATH && productBehavior.pdfCanvasDataUrl) {
      const png = String(productBehavior.pdfCanvasDataUrl).replace(/^data:image\/png;base64,/, "");
      writeFileSync(path.resolve(process.env.AI_TIP_PDF_SCREENSHOT_PATH), Buffer.from(png, "base64"));
      if (productBehavior.pdfSecondCanvasDataUrl) {
        const requested = path.parse(path.resolve(process.env.AI_TIP_PDF_SCREENSHOT_PATH));
        const secondPath = path.join(requested.dir, `${requested.name.replace(/-page-1$/, "")}-page-2${requested.ext || ".png"}`);
        const secondPng = String(productBehavior.pdfSecondCanvasDataUrl).replace(/^data:image\/png;base64,/, "");
        writeFileSync(secondPath, Buffer.from(secondPng, "base64"));
      }
    }
    delete productBehavior.pdfCanvasDataUrl;
    delete productBehavior.pdfSecondCanvasDataUrl;
    if (!pythonCalculation) throw new Error("Python 技能模块未加载");
    const pythonResult = await pythonCalculation("decimal.Decimal('0.1') + decimal.Decimal('0.2')");
    if (!pythonResult.includes("0.3")) throw new Error(`Python 技能自检失败：${pythonResult}`);
    if (!pythonWorkerTest) throw new Error("高级 Python Worker 未加载");
    const uncertainty = await pythonWorkerTest("uncertainty", { terms: [{ value: 10, uncertainty: 0.2 }, { value: 5, uncertainty: 0.1, coefficient: -1 }] }, 15000);
    if (!uncertainty.includes("standard_uncertainty")) throw new Error(`高级技能自检失败：${uncertainty}`);
    const secretResult = await mainWindow.webContents.executeJavaScript(`(async () => {
      const login = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'demo@aitip.local', password: 'demo1234' }) }).then(r => r.json());
      const response = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.token }, body: JSON.stringify({ provider: 'openai', baseURL: 'https://api.openai.com/v1', model: 'gpt-5-mini', apiKey: 'desktop-smoke-secret', systemPrompt: 'test', webSearchEnabled: false, pythonEnabled: true, reliabilityEnabled: true }) });
      return response.ok;
    })()`);
    if (!secretResult || !smokeDataDir) throw new Error("系统密钥存储自检请求失败");
    const persisted = readFileSync(path.join(smokeDataDir, "store.json"), "utf8");
    if (persisted.includes("desktop-smoke-secret") || !persisted.includes("safe:v1:")) throw new Error("系统密钥存储自检失败");
    rmSync(smokeDataDir, { recursive: true, force: true }); smokeDataDir = null;
    const smokeResult = `Desktop smoke test passed: ${snapshot.title}; ${JSON.stringify(productBehavior)}; ${pythonResult}; advanced worker and safeStorage ok`;
    if (smokeResultPath) writeFileSync(smokeResultPath, JSON.stringify({ ok: true, result: smokeResult }), "utf8");
    console.log(smokeResult);
    app.quit();
  }
}

app.whenReady().then(async () => {
  installMenu();
  await createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
}).catch((error) => {
  if (smokeResultPath) {
    try { writeFileSync(smokeResultPath, JSON.stringify({ ok: false, error: error instanceof Error ? error.stack || error.message : String(error) }), "utf8"); } catch {}
  }
  console.error(error);
  app.exit(1);
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => {
  localServer?.close();
  if (smokeDataDir) { try { rmSync(smokeDataDir, { recursive: true, force: true }); } catch {} smokeDataDir = null; }
});
