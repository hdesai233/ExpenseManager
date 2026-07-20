// ---- Core data model (mirrors requirements §6) ----

export type AccountType = 'checking' | 'credit_card' | 'savings';

export interface Account {
  id: string;
  name: string;           // nickname
  issuingBank: string;
  accountType: AccountType;
  lastFour?: string;
  color: string;
}

export type FlowType = 'expense' | 'merchant_credit' | 'income' | 'transfer';
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
  taxDeductible?: boolean;
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

export interface Budget {
  id: string;
  categoryId: string;
  monthlyLimit: number;
}

export interface Goal {
  id: string;
  name: string;
  targetAmount: number;
  targetDate: string;         // ISO
  currentAmount: number;
  monthlyContribution: number;
}

// Note: the Anthropic API key and database-encryption state are deliberately NOT part of
// Settings/AppData — they live outside the normal snapshot pipeline (OS keychain / a dedicated
// security metadata file) so they can never leak into a JSON backup or full-database export.
// See src/electron.d.ts (secrets*/security* methods) and Settings.tsx.
export interface Settings {
  apiFallbackEnabled: boolean;
  householdName: string;
  /** §4.9 scheduled reports: auto-generate a monthly summary PDF on first launch of a new month. */
  autoReportEnabled: boolean;
  autoReportFolder: string;
  autoReportLastYM: string;
}

export interface AppData {
  schemaVersion: number;
  accounts: Account[];
  transactions: Transaction[];
  categories: Category[];
  rules: Rule[];
  batches: ImportBatch[];
  profiles: ImportProfile[];
  budgets: Budget[];
  goals: Goal[];
  settings: Settings;
}

export type ViewKey =
  | 'dashboard' | 'transactions' | 'analytics'
  | 'budgets' | 'subscriptions' | 'categories' | 'reports' | 'settings';
