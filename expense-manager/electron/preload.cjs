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
  secretsHasApiKey: (provider) => ipcRenderer.invoke('secrets:hasApiKey', provider),
  secretsGetApiKeyMasked: (provider) => ipcRenderer.invoke('secrets:getApiKeyMasked', provider),
  secretsGetApiKeyForUse: (provider) => ipcRenderer.invoke('secrets:getApiKeyForUse', provider),
  secretsSetApiKey: (provider, key) => ipcRenderer.invoke('secrets:setApiKey', provider, key),
  secretsClearApiKey: (provider) => ipcRenderer.invoke('secrets:clearApiKey', provider),

  securityGetState: () => ipcRenderer.invoke('security:getState'),
  securityUnlock: (passphrase) => ipcRenderer.invoke('security:unlock', passphrase),
  securityEnable: (passphrase) => ipcRenderer.invoke('security:enable', passphrase),
  securityChangePassphrase: (passphrase) => ipcRenderer.invoke('security:changePassphrase', passphrase),
  securityDisable: () => ipcRenderer.invoke('security:disable'),
});
