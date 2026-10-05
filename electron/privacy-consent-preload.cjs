const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('privacyConsent', Object.freeze({
  read: () => ipcRenderer.invoke('privacy-consent:read'),
  accept: (input) => ipcRenderer.invoke('privacy-consent:accept', input),
  reject: () => ipcRenderer.invoke('privacy-consent:reject'),
  openLink: (url) => ipcRenderer.invoke('privacy-consent:open-link', url),
}));
