// ---- API key storage via the OS keychain (Electron's safeStorage) ----
// Windows: DPAPI (tied to the OS user account). macOS: Keychain. Linux: kwallet/libsecret when
// available. Never touches the SQLite settings table or the AppData snapshot, so the key can
// never leak into a JSON backup or the full-database-export flow.
const { safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

let keyPath = null;

function init(userDataDir) {
  const dir = path.join(userDataDir, 'secrets');
  fs.mkdirSync(dir, { recursive: true });
  keyPath = path.join(dir, 'anthropic-api-key.enc');
}

function isAvailable() {
  return safeStorage.isEncryptionAvailable();
}

function setApiKey(plainText) {
  if (!plainText) { clearApiKey(); return; }
  const encrypted = safeStorage.encryptString(plainText);
  fs.writeFileSync(keyPath, encrypted);
}

function getApiKey() {
  if (!keyPath || !fs.existsSync(keyPath)) return '';
  try {
    return safeStorage.decryptString(fs.readFileSync(keyPath));
  } catch {
    return ''; // undecryptable (e.g. moved to a different OS user account) — treat as unset
  }
}

function hasApiKey() {
  return !!keyPath && fs.existsSync(keyPath);
}

function clearApiKey() {
  if (keyPath && fs.existsSync(keyPath)) fs.unlinkSync(keyPath);
}

module.exports = { init, isAvailable, setApiKey, getApiKey, hasApiKey, clearApiKey };
