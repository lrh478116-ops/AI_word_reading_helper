const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aiTipDesktop", Object.freeze({
  copyText: async (value) => {
    const result = await ipcRenderer.invoke("ai-tip:copy-text", { value });
    if (!result?.copied) throw new Error("Could not copy text");
    return result;
  },
  loadRememberedLogin: () => ipcRenderer.invoke("ai-tip:load-remembered-login"),
  saveRememberedLogin: (email, password) => ipcRenderer.invoke("ai-tip:save-remembered-login", { email, password }),
  clearRememberedLogin: () => ipcRenderer.invoke("ai-tip:clear-remembered-login"),
  captureStoreAsset: (name) => ipcRenderer.invoke("ai-tip:capture-store-asset", { name }),
  getOllamaStatus: () => ipcRenderer.invoke("ai-tip:get-ollama-status"),
  chooseOllamaInstallerDestination: async () => {
    const result = await ipcRenderer.invoke("ai-tip:choose-ollama-installer-destination");
    if (result?.error) throw new Error(result.error);
    return result;
  },
  downloadOllamaInstaller: async (requestId, selectionToken) => {
    const result = await ipcRenderer.invoke("ai-tip:download-ollama-installer", { requestId, selectionToken });
    if (result?.error) throw new Error(result.error);
    return result;
  },
  cancelOllamaInstaller: (requestId) => ipcRenderer.invoke("ai-tip:cancel-ollama-installer", { requestId }),
  onOllamaInstallerProgress: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on("ai-tip:ollama-installer-progress", handler);
    return () => ipcRenderer.removeListener("ai-tip:ollama-installer-progress", handler);
  },
  chooseModelDirectory: (suggestedPath = "", runtimeKind = "llama.cpp") => ipcRenderer.invoke("ai-tip:choose-model-directory", { suggestedPath, runtimeKind }),
  prepareModelDirectory: async (selectionToken) => {
    const result = await ipcRenderer.invoke("ai-tip:prepare-model-directory", { selectionToken });
    if (result?.error) throw new Error(result.error);
    return result;
  },
  chooseLocalModelFile: async (modelId) => {
    const result = await ipcRenderer.invoke("ai-tip:choose-local-model-file", { modelId });
    if (result?.error) throw new Error(result.error);
    return result;
  }
}));
