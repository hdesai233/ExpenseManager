const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ledgerApi', {
  isEmpty: () => ipcRenderer.invoke('db:isEmpty'),
  load: () => ipcRenderer.invoke('db:load'),
  save: (data) => ipcRenderer.invoke('db:save', data),
  info: () => ipcRenderer.invoke('db:info'),
  backup: () => ipcRenderer.invoke('db:backup'),
  restore: () => ipcRenderer.invoke('db:restore'),
  restoreFromJson: (data) => ipcRenderer.invoke('db:restoreFromJson', data),
  exportPdf: (defaultName) => ipcRenderer.invoke('report:exportPdf', defaultName),
  pickFolder: () => ipcRenderer.invoke('report:pickFolder'),
  savePdfToFolder: (folder, filename) => ipcRenderer.invoke('report:savePdfToFolder', folder, filename),

  secretsIsAvailable: () => ipcRenderer.invoke('secrets:isAvailable'),
  secretsHasApiKey: () => ipcRenderer.invoke('secrets:hasApiKey'),
  secretsGetApiKeyMasked: () => ipcRenderer.invoke('secrets:getApiKeyMasked'),
  secretsGetApiKeyForUse: () => ipcRenderer.invoke('secrets:getApiKeyForUse'),
  secretsSetApiKey: (key) => ipcRenderer.invoke('secrets:setApiKey', key),
  secretsClearApiKey: () => ipcRenderer.invoke('secrets:clearApiKey'),

  securityGetState: () => ipcRenderer.invoke('security:getState'),
  securityUnlock: (passphrase) => ipcRenderer.invoke('security:unlock', passphrase),
  securityEnable: (passphrase) => ipcRenderer.invoke('security:enable', passphrase),
  securityChangePassphrase: (passphrase) => ipcRenderer.invoke('security:changePassphrase', passphrase),
  securityDisable: () => ipcRenderer.invoke('security:disable'),
});
