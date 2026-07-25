// ---- SQLite persistence (main process). Real relational schema, not a JSON blob. ----
// Uses Node's built-in `node:sqlite` — no native compilation, no extra toolchain.
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

// Internal SQLite table-structure version (tracked in schema_meta, drives future migrate() steps).
// Distinct from AppData.schemaVersion (APP_DATA_VERSION below), which is the JSON-backup format
// version — adding transaction_splits didn't change that shape, so it stays at 1.
const SCHEMA_VERSION = 2; // v2: added transaction_splits
const APP_DATA_VERSION = 1;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  issuing_bank TEXT NOT NULL,
  account_type TEXT NOT NULL,
  last_four TEXT,
  color TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT,
  color TEXT NOT NULL,
  tax_deductible INTEGER
);

CREATE TABLE IF NOT EXISTS rules (
  id TEXT PRIMARY KEY,
  merchant_pattern TEXT NOT NULL,
  match_type TEXT NOT NULL,
  category_id TEXT NOT NULL,
  subcategory_id TEXT,
  created_from TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS import_batches (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  source_filename TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  profile_id TEXT
);

CREATE TABLE IF NOT EXISTS import_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  account_id TEXT NOT NULL,
  mapping_json TEXT NOT NULL,
  flip_sign INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  merchant_raw TEXT NOT NULL,
  merchant_normalized TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  account_id TEXT NOT NULL,
  category_id TEXT,
  subcategory_id TEXT,
  confidence REAL NOT NULL,
  categorization_source TEXT NOT NULL,
  flow_type TEXT NOT NULL,
  transfer_subtype TEXT,
  linked_transaction_id TEXT,
  tags_json TEXT NOT NULL,
  notes TEXT NOT NULL,
  import_batch_id TEXT NOT NULL,
  reviewed INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_txn_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_txn_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_txn_category ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_txn_merchant ON transactions(merchant_normalized);

CREATE TABLE IF NOT EXISTS transaction_splits (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  subcategory_id TEXT,
  amount REAL NOT NULL,
  notes TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_splits_txn ON transaction_splits(transaction_id);

CREATE TABLE IF NOT EXISTS budgets (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL,
  monthly_limit REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  target_amount REAL NOT NULL,
  target_date TEXT NOT NULL,
  current_amount REAL NOT NULL,
  monthly_contribution REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

let db = null;
let dbPath = null;

function open(userDataDir) {
  dbPath = path.join(userDataDir, 'ledger.sqlite');
  db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = OFF;'); // app enforces referential integrity itself
  migrate();
  return dbPath;
}

function migrate() {
  // All CREATE TABLE/INDEX statements are IF NOT EXISTS, so re-running the full schema against an
  // existing database is safe and additive (e.g. v1 -> v2 just adds transaction_splits).
  db.exec(SCHEMA_SQL);
  const row = db.prepare('SELECT value FROM schema_meta WHERE key = ?').get('schema_version');
  if (!row) {
    db.prepare('INSERT INTO schema_meta (key, value) VALUES (?, ?)').run('schema_version', String(SCHEMA_VERSION));
  } else if (Number(row.value) < SCHEMA_VERSION) {
    db.prepare('UPDATE schema_meta SET value = ? WHERE key = ?').run(String(SCHEMA_VERSION), 'schema_version');
  }
  // Future migrations needing real column changes: read current version, apply ALTER TABLE steps in order, bump schema_meta.
}

function isEmpty() {
  const row = db.prepare('SELECT COUNT(*) as n FROM accounts').get();
  return row.n === 0;
}

function getDbPath() {
  return dbPath;
}

function getDbInfo() {
  const stat = fs.existsSync(dbPath) ? fs.statSync(dbPath) : null;
  const count = db.prepare('SELECT COUNT(*) as n FROM transactions').get().n;
  return { path: dbPath, sizeBytes: stat ? stat.size : 0, transactionCount: count };
}

// ---- Full-snapshot load/save. Simple, transactional, and correct for this data size ----
// (personal-finance workloads: thousands to tens of thousands of rows, not millions).

function loadSnapshot() {
  const accounts = db.prepare('SELECT * FROM accounts').all().map(r => ({
    id: r.id, name: r.name, issuingBank: r.issuing_bank, accountType: r.account_type,
    lastFour: r.last_four ?? undefined, color: r.color,
  }));
  const categories = db.prepare('SELECT * FROM categories').all().map(r => ({
    id: r.id, name: r.name, parentId: r.parent_id, color: r.color,
    taxDeductible: r.tax_deductible === null ? undefined : !!r.tax_deductible,
  }));
  const rules = db.prepare('SELECT * FROM rules').all().map(r => ({
    id: r.id, merchantPattern: r.merchant_pattern, matchType: r.match_type,
    categoryId: r.category_id, subcategoryId: r.subcategory_id,
    createdFrom: r.created_from, createdAt: r.created_at,
  }));
  const batches = db.prepare('SELECT * FROM import_batches').all().map(r => ({
    id: r.id, accountId: r.account_id, sourceFilename: r.source_filename,
    importedAt: r.imported_at, rowCount: r.row_count, profileId: r.profile_id,
  }));
  const profiles = db.prepare('SELECT * FROM import_profiles').all().map(r => ({
    id: r.id, name: r.name, accountId: r.account_id,
    mapping: JSON.parse(r.mapping_json), flipSign: !!r.flip_sign,
  }));
  const splitsByTxn = new Map();
  for (const r of db.prepare('SELECT * FROM transaction_splits').all()) {
    const split = { id: r.id, categoryId: r.category_id, subcategoryId: r.subcategory_id, amount: r.amount, notes: r.notes };
    const list = splitsByTxn.get(r.transaction_id);
    if (list) list.push(split); else splitsByTxn.set(r.transaction_id, [split]);
  }
  const transactions = db.prepare('SELECT * FROM transactions').all().map(r => ({
    id: r.id, date: r.date, merchantRaw: r.merchant_raw, merchantNormalized: r.merchant_normalized,
    amount: r.amount, currency: r.currency, accountId: r.account_id,
    categoryId: r.category_id, subcategoryId: r.subcategory_id,
    confidence: r.confidence, categorizationSource: r.categorization_source,
    flowType: r.flow_type, transferSubtype: r.transfer_subtype ?? undefined,
    linkedTransactionId: r.linked_transaction_id ?? undefined,
    tags: JSON.parse(r.tags_json), notes: r.notes,
    importBatchId: r.import_batch_id, reviewed: !!r.reviewed,
    splits: splitsByTxn.get(r.id) ?? undefined,
  }));
  const budgets = db.prepare('SELECT * FROM budgets').all().map(r => ({
    id: r.id, categoryId: r.category_id, monthlyLimit: r.monthly_limit,
  }));
  const goals = db.prepare('SELECT * FROM goals').all().map(r => ({
    id: r.id, name: r.name, targetAmount: r.target_amount, targetDate: r.target_date,
    currentAmount: r.current_amount, monthlyContribution: r.monthly_contribution,
  }));
  const settingsRows = db.prepare('SELECT * FROM settings').all();
  const settingsMap = Object.fromEntries(settingsRows.map(r => [r.key, r.value]));
  const settings = {
    apiFallbackEnabled: settingsMap.apiFallbackEnabled === '1',
    aiProvider: settingsMap.aiProvider === 'gemini' ? 'gemini' : 'anthropic',
    householdName: settingsMap.householdName ?? 'Household',
    autoReportEnabled: settingsMap.autoReportEnabled === '1',
    autoReportFolder: settingsMap.autoReportFolder ?? '',
    autoReportLastYM: settingsMap.autoReportLastYM ?? '',
  };

  return { schemaVersion: APP_DATA_VERSION, accounts, transactions, categories, rules, batches, profiles, budgets, goals, settings };
}

function saveSnapshot(data) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const tables = ['transaction_splits', 'transactions', 'import_batches', 'import_profiles', 'rules', 'budgets', 'goals', 'categories', 'accounts', 'settings'];
    for (const t of tables) db.exec(`DELETE FROM ${t}`);

    const insAccount = db.prepare('INSERT INTO accounts (id, name, issuing_bank, account_type, last_four, color) VALUES (?, ?, ?, ?, ?, ?)');
    for (const a of data.accounts) insAccount.run(a.id, a.name, a.issuingBank, a.accountType, a.lastFour ?? null, a.color);

    const insCat = db.prepare('INSERT INTO categories (id, name, parent_id, color, tax_deductible) VALUES (?, ?, ?, ?, ?)');
    for (const c of data.categories) insCat.run(c.id, c.name, c.parentId, c.color, c.taxDeductible === undefined ? null : (c.taxDeductible ? 1 : 0));

    const insRule = db.prepare('INSERT INTO rules (id, merchant_pattern, match_type, category_id, subcategory_id, created_from, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const r of data.rules) insRule.run(r.id, r.merchantPattern, r.matchType, r.categoryId, r.subcategoryId, r.createdFrom, r.createdAt);

    const insBatch = db.prepare('INSERT INTO import_batches (id, account_id, source_filename, imported_at, row_count, profile_id) VALUES (?, ?, ?, ?, ?, ?)');
    for (const b of data.batches) insBatch.run(b.id, b.accountId, b.sourceFilename, b.importedAt, b.rowCount, b.profileId);

    const insProfile = db.prepare('INSERT INTO import_profiles (id, name, account_id, mapping_json, flip_sign) VALUES (?, ?, ?, ?, ?)');
    for (const p of data.profiles) insProfile.run(p.id, p.name, p.accountId, JSON.stringify(p.mapping), p.flipSign ? 1 : 0);

    const insTxn = db.prepare(`INSERT INTO transactions
      (id, date, merchant_raw, merchant_normalized, amount, currency, account_id, category_id, subcategory_id,
       confidence, categorization_source, flow_type, transfer_subtype, linked_transaction_id, tags_json, notes, import_batch_id, reviewed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insSplit = db.prepare('INSERT INTO transaction_splits (id, transaction_id, category_id, subcategory_id, amount, notes) VALUES (?, ?, ?, ?, ?, ?)');
    for (const t of data.transactions) {
      insTxn.run(
        t.id, t.date, t.merchantRaw, t.merchantNormalized, t.amount, t.currency, t.accountId,
        t.categoryId, t.subcategoryId, t.confidence, t.categorizationSource, t.flowType,
        t.transferSubtype ?? null, t.linkedTransactionId ?? null, JSON.stringify(t.tags), t.notes,
        t.importBatchId, t.reviewed ? 1 : 0,
      );
      if (t.splits) {
        for (const s of t.splits) insSplit.run(s.id, t.id, s.categoryId, s.subcategoryId, s.amount, s.notes ?? '');
      }
    }

    const insBudget = db.prepare('INSERT INTO budgets (id, category_id, monthly_limit) VALUES (?, ?, ?)');
    for (const b of data.budgets) insBudget.run(b.id, b.categoryId, b.monthlyLimit);

    const insGoal = db.prepare('INSERT INTO goals (id, name, target_amount, target_date, current_amount, monthly_contribution) VALUES (?, ?, ?, ?, ?, ?)');
    for (const g of data.goals) insGoal.run(g.id, g.name, g.targetAmount, g.targetDate, g.currentAmount, g.monthlyContribution);

    const insSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    insSetting.run('apiFallbackEnabled', data.settings.apiFallbackEnabled ? '1' : '0');
    insSetting.run('aiProvider', data.settings.aiProvider === 'gemini' ? 'gemini' : 'anthropic');
    insSetting.run('householdName', data.settings.householdName ?? '');
    insSetting.run('autoReportEnabled', data.settings.autoReportEnabled ? '1' : '0');
    insSetting.run('autoReportFolder', data.settings.autoReportFolder ?? '');
    insSetting.run('autoReportLastYM', data.settings.autoReportLastYM ?? '');

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function close() {
  if (db) db.close();
  db = null;
}

/** Fold the WAL into the main file and truncate it, so encrypting the DB only needs to touch
 * one file (otherwise ledger.sqlite-wal could hold uncommitted-to-main-file data). */
function checkpoint() {
  if (db) db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
}

/** One-time migration off the old plaintext `apiKey` settings row (pre-OS-keychain versions).
 * Returns the key if one was found (caller pushes it into safeStorage), else null. */
function takeLegacyApiKey() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'apiKey'").get();
  db.prepare("DELETE FROM settings WHERE key IN ('apiKey', 'encryptDb')").run();
  return row && row.value ? row.value : null;
}

module.exports = { open, close, checkpoint, takeLegacyApiKey, isEmpty, loadSnapshot, saveSnapshot, getDbPath, getDbInfo };
