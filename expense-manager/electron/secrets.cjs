// ---- API key storage via the OS keychain (Electron's safeStorage) ----
// Windows: DPAPI (tied to the OS user account). macOS: Keychain. Linux: kwallet/libsecret when
// available. Never touches the SQLite settings table or the AppData snapshot, so the key can
// never leak into a JSON backup or the full-database-export flow.
//
// One key per LLM provider, so switching providers doesn't destroy the other's key.
const { safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// Allowlist — also keeps a provider id coming over IPC from being used as a path fragment.
const KEY_FILES = {
  anthropic: 'anthropic-api-key.enc',
  gemini: 'gemini-api-key.enc',
};

let secretsDir = null;

function init(userDataDir) {
  secretsDir = path.join(userDataDir, 'secrets');
  fs.mkdirSync(secretsDir, { recursive: true });
}

function keyPathFor(provider) {
  const file = KEY_FILES[provider];
  if (!file || !secretsDir) return null;
  return path.join(secretsDir, file);
}

function isAvailable() {
  return safeStorage.isEncryptionAvailable();
}

function setApiKey(provider, plainText) {
  const keyPath = keyPathFor(provider);
  if (!keyPath) return;
  if (!plainText) { clearApiKey(provider); return; }
  fs.writeFileSync(keyPath, safeStorage.encryptString(plainText));
}

function getApiKey(provider) {
  const keyPath = keyPathFor(provider);
  if (!keyPath || !fs.existsSync(keyPath)) return '';
  try {
    return safeStorage.decryptString(fs.readFileSync(keyPath));
  } catch {
    return ''; // undecryptable (e.g. moved to a different OS user account) — treat as unset
  }
}

function hasApiKey(provider) {
  const keyPath = keyPathFor(provider);
  return !!keyPath && fs.existsSync(keyPath);
}

function clearApiKey(provider) {
  const keyPath = keyPathFor(provider);
  if (keyPath && fs.existsSync(keyPath)) fs.unlinkSync(keyPath);
}

module.exports = { init, isAvailable, setApiKey, getApiKey, hasApiKey, clearApiKey };
