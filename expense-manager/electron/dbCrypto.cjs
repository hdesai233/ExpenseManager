// ---- Passphrase-based encryption at rest for the SQLite database file ----
//
// node:sqlite (chosen specifically to avoid a native-compiler toolchain — see README/session
// notes) is vanilla SQLite: no SQLCipher, no pluggable VFS/cipher support. True continuous
// encryption-while-running would need a native SQLCipher build, which reintroduces exactly the
// Rust/MSVC dependency this app deliberately avoided.
//
// What this module gives instead: the live ledger.sqlite is ordinary plaintext SQLite while the
// app is running (required — SQLite needs to read/write it directly), but whenever the app is
// NOT running, the on-disk artifact is AES-256-GCM encrypted and unreadable without the
// passphrase. That's a real, honest "encrypted at rest" guarantee between sessions — it is not
// protection against someone reading the file while the app is open, and a crash/force-quit
// skips the final encryption step (the plaintext file is simply left as-is until next graceful
// quit). Both limitations are surfaced in the Settings UI copy.
const crypto = require('node:crypto');
const fs = require('node:fs');

const KEY_LEN = 32;   // AES-256
const IV_LEN = 12;    // recommended for GCM
const TAG_LEN = 16;

function deriveKey(passphrase, saltB64) {
  const salt = Buffer.from(saltB64, 'base64');
  return crypto.scryptSync(passphrase, salt, KEY_LEN);
}

function newSalt() {
  return crypto.randomBytes(16).toString('base64');
}

/** Encrypt `plainPath` into `encPath` using an already-derived key. Layout: [iv][tag][ciphertext]. */
function encryptFileWithKey(plainPath, encPath, key) {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plain = fs.readFileSync(plainPath);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  fs.writeFileSync(encPath, Buffer.concat([iv, tag, ciphertext]));
}

/** Decrypt `encPath` into `plainPath` using an already-derived key. Throws on wrong key (GCM auth-tag check). */
function decryptFileWithKey(encPath, plainPath, key) {
  const data = fs.readFileSync(encPath);
  const iv = data.subarray(0, IV_LEN);
  const tag = data.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = data.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]); // throws if key is wrong
  fs.writeFileSync(plainPath, plain);
}

module.exports = { deriveKey, newSalt, encryptFileWithKey, decryptFileWithKey };
