const { app, BrowserWindow, ipcMain, dialog, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const store = require('./db.cjs');
const secrets = require('./secrets.cjs');
const dbCrypto = require('./dbCrypto.cjs');

const isDev = !app.isPackaged;
const VITE_DEV_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5183';

let mainWindow = null;
let dbLocked = false;      // true while an encrypted DB is waiting for its passphrase
let cachedKey = null;      // derived AES key, held in memory only while unlocked + encryption enabled
let quitting = false;      // reentrancy guard for the async before-quit encrypt step

const plainPath = () => path.join(app.getPath('userData'), 'ledger.sqlite');
const encPath = () => path.join(app.getPath('userData'), 'ledger.sqlite.enc');
const metaPath = () => path.join(app.getPath('userData'), 'ledger.security.json');

function readMeta() {
  try { return JSON.parse(fs.readFileSync(metaPath(), 'utf8')); }
  catch { return { encrypted: false, salt: null }; }
}
function writeMeta(meta) { fs.writeFileSync(metaPath(), JSON.stringify(meta)); }

function openUnlockedDb() {
  const dbPath = store.open(app.getPath('userData'));
  console.log('[ledger] sqlite database at', dbPath);
  dbLocked = false;
  // One-time migration off the pre-OS-keychain plaintext apiKey settings row, if one exists.
  const legacyKey = store.takeLegacyApiKey();
  if (legacyKey) secrets.setApiKey(legacyKey);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#eceae4',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDev) {
    mainWindow.loadURL(VITE_DEV_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // Native "Save As" prompt for CSV/JSON exports triggered by <a download> in the renderer,
  // instead of silently dropping into the OS Downloads folder.
  session.defaultSession.on('will-download', (event, item) => {
    const suggested = item.getFilename();
    const result = dialog.showSaveDialogSync(mainWindow, { defaultPath: suggested });
    if (!result) { item.cancel(); return; }
    item.setSavePath(result);
  });
}

app.whenReady().then(() => {
  secrets.init(app.getPath('userData'));

  const meta = readMeta();
  const hasPlain = fs.existsSync(plainPath());
  const hasEnc = fs.existsSync(encPath());

  if (meta.encrypted && hasEnc && !hasPlain) {
    dbLocked = true; // renderer will show the passphrase prompt and call security:unlock
  } else {
    openUnlockedDb();
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Encrypt-on-quit: if encryption is enabled and the DB is open, fold the WAL, close it, encrypt
// the file, and remove the plaintext copy before actually exiting. A crash or force-kill skips
// this — the plaintext file is simply left in place until the next graceful quit — so this is
// "encrypted at rest between sessions," not continuous protection while the process is alive.
app.on('before-quit', (e) => {
  if (quitting) return;
  const meta = readMeta();
  if (meta.encrypted && !dbLocked && cachedKey) {
    e.preventDefault();
    quitting = true;
    try {
      store.checkpoint();
      store.close();
      dbCrypto.encryptFileWithKey(plainPath(), encPath(), cachedKey);
      fs.rmSync(plainPath(), { force: true });
      fs.rmSync(plainPath() + '-wal', { force: true });
      fs.rmSync(plainPath() + '-shm', { force: true });
    } catch (err) {
      console.error('[ledger] failed to encrypt database on quit — leaving plaintext file in place', err);
    } finally {
      cachedKey = null;
      app.quit();
    }
  } else {
    store.close();
  }
});

// ---- IPC: persistence ----

ipcMain.handle('db:isEmpty', () => store.isEmpty());
ipcMain.handle('db:load', () => store.loadSnapshot());
ipcMain.handle('db:save', (_e, data) => { store.saveSnapshot(data); return { ok: true }; });
ipcMain.handle('db:info', () => store.getDbInfo());

ipcMain.handle('db:backup', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Backup Ledger database',
    defaultPath: 'ledger-backup.sqlite',
    filters: [{ name: 'SQLite database', extensions: ['sqlite'] }],
  });
  if (result.canceled || !result.filePath) return { ok: false };
  fs.copyFileSync(store.getDbPath(), result.filePath);
  return { ok: true, path: result.filePath };
});

ipcMain.handle('db:restore', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Restore Ledger database',
    filters: [{ name: 'SQLite database', extensions: ['sqlite'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false };
  store.close();
  fs.copyFileSync(result.filePaths[0], store.getDbPath());
  store.open(app.getPath('userData'));
  return { ok: true, data: store.loadSnapshot() };
});

ipcMain.handle('db:restoreFromJson', (_e, jsonData) => {
  store.saveSnapshot(jsonData);
  return { ok: true, data: store.loadSnapshot() };
});

// ---- IPC: reports ----

// Renders the report as it currently appears in the window (the renderer applies an @media
// print stylesheet that hides the app chrome and shows only the report), matching the desktop
// shell's built-in print-to-PDF approach called for in the requirements doc rather than pulling
// in a separate PDF-generation library.
ipcMain.handle('report:exportPdf', async (_e, defaultName) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save report as PDF',
    defaultPath: (defaultName || 'ledger-report') + '.pdf',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (result.canceled || !result.filePath) return { ok: false };
  const buffer = await mainWindow.webContents.printToPDF({ printBackground: true, pageSize: 'Letter', preferCSSPageSize: false });
  fs.writeFileSync(result.filePath, buffer);
  return { ok: true, path: result.filePath };
});

ipcMain.handle('report:pickFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled || !result.filePaths[0]) return { ok: false };
  return { ok: true, path: result.filePaths[0] };
});

ipcMain.handle('report:savePdfToFolder', async (_e, folder, filename) => {
  try {
    const buffer = await mainWindow.webContents.printToPDF({ printBackground: true, pageSize: 'Letter' });
    const filePath = path.join(folder, filename);
    fs.writeFileSync(filePath, buffer);
    return { ok: true, path: filePath };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

// ---- IPC: secrets (API key, OS keychain via safeStorage) ----

ipcMain.handle('secrets:isAvailable', () => secrets.isAvailable());
ipcMain.handle('secrets:hasApiKey', () => secrets.hasApiKey());
ipcMain.handle('secrets:getApiKeyMasked', () => {
  const k = secrets.getApiKey();
  return k ? `sk-ant-••••••••••••${k.slice(-4)}` : '';
});
ipcMain.handle('secrets:getApiKeyForUse', () => secrets.getApiKey());
ipcMain.handle('secrets:setApiKey', (_e, key) => { secrets.setApiKey(key); return { ok: true }; });
ipcMain.handle('secrets:clearApiKey', () => { secrets.clearApiKey(); return { ok: true }; });

// ---- IPC: database encryption (passphrase-derived AES-256-GCM, whole-file, at rest between sessions) ----

ipcMain.handle('security:getState', () => {
  const meta = readMeta();
  return { locked: dbLocked, encrypted: !!meta.encrypted };
});

ipcMain.handle('security:unlock', (_e, passphrase) => {
  const meta = readMeta();
  if (!meta.encrypted || !meta.salt) return { ok: false, error: 'Encryption is not enabled.' };
  try {
    const key = dbCrypto.deriveKey(passphrase, meta.salt);
    dbCrypto.decryptFileWithKey(encPath(), plainPath(), key);
    fs.rmSync(encPath(), { force: true });
    openUnlockedDb();
    cachedKey = key;
    return { ok: true, data: store.loadSnapshot() };
  } catch {
    fs.rmSync(plainPath(), { force: true }); // discard any partial output from the failed attempt
    return { ok: false, error: 'Incorrect passphrase.' };
  }
});

ipcMain.handle('security:enable', (_e, passphrase) => {
  if (dbLocked) return { ok: false, error: 'Database is locked.' };
  const salt = dbCrypto.newSalt();
  cachedKey = dbCrypto.deriveKey(passphrase, salt);
  writeMeta({ encrypted: true, salt });
  fs.rmSync(encPath(), { force: true }); // stale — will be regenerated correctly on next quit
  return { ok: true };
});

ipcMain.handle('security:changePassphrase', (_e, passphrase) => {
  if (dbLocked) return { ok: false, error: 'Database is locked.' };
  const salt = dbCrypto.newSalt();
  cachedKey = dbCrypto.deriveKey(passphrase, salt);
  writeMeta({ encrypted: true, salt });
  fs.rmSync(encPath(), { force: true }); // old passphrase's copy is stale the moment the key changes
  return { ok: true };
});

ipcMain.handle('security:disable', () => {
  writeMeta({ encrypted: false, salt: null });
  cachedKey = null;
  fs.rmSync(encPath(), { force: true });
  return { ok: true };
});
