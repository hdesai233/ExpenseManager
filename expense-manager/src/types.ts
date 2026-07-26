// ---- Core data model (mirrors requirements §6) ----

export type AccountType = 'checking' | 'credit_card' | 'savings' | 'cash';

/**
 * Sentinel `importBatchId` for hand-entered transactions, which belong to no import.
 * Nothing dereferences importBatchId, so this never needs a matching ImportBatch row.
 */
export const MANUAL_BATCH_ID = 'manual';

export interface Account {
  id: string;
  name: string;           // nickname
  issuingBank: string;
  accountType: AccountType;
  lastFour?: string;
  color: string;
}

/**
 * Ledger tracks spending only — there is no income, savings, or budget concept.
 * `merchant_credit` (a refund/return) nets against spend; `transfer` (card payments and
 * account-to-account movement) is excluded from spend entirely rather than counted as income.
 */
export type FlowType = 'expense' | 'merchant_credit' | 'transfer';
export type TransferSubtype = 'credit_card_payment' | 'internal_transfer';
export type CategorizationSource = 'rule' | 'api' | 'manual' | 'none';

/** One category allocation of a split transaction. Amounts share the parent's sign convention. */
export interface TransactionSplit {
  id: string;
  categoryId: string;
  subcategoryId: string | null;
  amount: number;
  notes: string;
}

export interface Transaction {
  id: string;
  date: string;                 // ISO 8601 (YYYY-MM-DD)
  merchantRaw: string;
  merchantNormalized: string;
  amount: number;               // negative = expense, positive = income/credit
  currency: string;
  accountId: string;
  categoryId: string | null;
  subcategoryId: string | null;
  confidence: number;           // 0..1
  categorizationSource: CategorizationSource;
  flowType: FlowType;
  transferSubtype?: TransferSubtype;
  linkedTransactionId?: string;
  tags: string[];
  notes: string;
  importBatchId: string;
  reviewed: boolean;            // user confirmed the categorization
  /** Present (length >= 2) when the transaction is split across multiple categories. */
  splits?: TransactionSplit[];
}

export interface Category {
  id: string;
  name: string;
  parentId: string | null;
  color: string;
}

export type MatchType = 'exact' | 'contains' | 'regex';

export interface Rule {
  id: string;
  merchantPattern: string;
  matchType: MatchType;
  categoryId: string;
  subcategoryId: string | null;
  createdFrom: 'user' | 'system';
  createdAt: string;
}

export interface ImportBatch {
  id: string;
  accountId: string;
  sourceFilename: string;
  importedAt: string;
  rowCount: number;
  profileId: string | null;
}

export interface ImportProfile {
  id: string;
  name: string;
  accountId: string;
  mapping: ColumnMapping;
  flipSign: boolean;          // true when source represents expenses as positive
}

export interface ColumnMapping {
  date: string;
  description: string;
  amount: string;             // single amount column…
  debit?: string;             // …or split debit/credit columns
  credit?: string;
}

/** LLM backend used for the categorization fallback (§4.4 step 3). Keys live in the OS keychain. */
export type AiProvider = 'anthropic' | 'gemini';

// Note: the LLM API keys and database-encryption state are deliberately NOT part of
// Settings/AppData — they live outside the normal snapshot pipeline (OS keychain / a dedicated
// security metadata file) so they can never leak into a JSON backup or full-database export.
// Which provider is *selected* is not a secret, so it does live here.
// See src/electron.d.ts (secrets*/security* methods) and Settings.tsx.
export interface Settings {
  apiFallbackEnabled: boolean;
  aiProvider: AiProvider;
  /**
   * Per-provider model id override; a missing/empty entry means "use the built-in default".
   * Providers retire model ids on their own schedule, so this is editable at runtime — moving to
   * a newer model shouldn't require rebuilding the app.
   */
  aiModels: Partial<Record<AiProvider, string>>;
  householdName: string;
  /** §4.9 scheduled reports: auto-generate a monthly summary PDF on first launch of a new month. */
  autoReportEnabled: boolean;
  autoReportFolder: string;
  autoReportLastYM: string;
  /**
   * Merchants (by normalized name) excluded from the Subscriptions screen's recurring-charge
   * detection — for false positives like a weekly grocery run that happens to fall on a regular
   * cadence. Detection itself is never persisted (it's recomputed from transactions every time);
   * this dismissal list is the only part of "subscriptions" that needs to survive a reload.
   */
  dismissedSubscriptions: string[];
}

export interface AppData {
  schemaVersion: number;
  accounts: Account[];
  transactions: Transaction[];
  categories: Category[];
  rules: Rule[];
  batches: ImportBatch[];
  profiles: ImportProfile[];
  settings: Settings;
}

export type ViewKey =
  | 'dashboard' | 'transactions' | 'analytics'
  | 'trends' | 'subscriptions' | 'savings' | 'categories' | 'reports' | 'settings';
