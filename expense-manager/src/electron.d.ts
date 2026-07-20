import type { AppData } from './types';

export interface LedgerApi {
  isEmpty(): Promise<boolean>;
  load(): Promise<AppData>;
  save(data: AppData): Promise<{ ok: true }>;
  info(): Promise<{ path: string; sizeBytes: number; transactionCount: number }>;
  backup(): Promise<{ ok: boolean; path?: string }>;
  restore(): Promise<{ ok: boolean; data?: AppData }>;
  restoreFromJson(data: AppData): Promise<{ ok: boolean; data?: AppData }>;
  exportPdf(defaultName: string): Promise<{ ok: boolean; path?: string }>;
  pickFolder(): Promise<{ ok: boolean; path?: string }>;
  savePdfToFolder(folder: string, filename: string): Promise<{ ok: boolean; path?: string; error?: string }>;

  /** API key storage via the OS keychain (Electron safeStorage) — never touches AppData/JSON backups. */
  secretsIsAvailable(): Promise<boolean>;
  secretsHasApiKey(): Promise<boolean>;
  secretsGetApiKeyMasked(): Promise<string>;
  secretsGetApiKeyForUse(): Promise<string>;
  secretsSetApiKey(key: string): Promise<{ ok: true }>;
  secretsClearApiKey(): Promise<{ ok: true }>;

  /** Passphrase-based database encryption at rest between sessions. */
  securityGetState(): Promise<{ locked: boolean; encrypted: boolean }>;
  securityUnlock(passphrase: string): Promise<{ ok: boolean; error?: string; data?: AppData }>;
  securityEnable(passphrase: string): Promise<{ ok: boolean; error?: string }>;
  securityChangePassphrase(passphrase: string): Promise<{ ok: boolean; error?: string }>;
  securityDisable(): Promise<{ ok: true }>;
}

declare global {
  interface Window {
    ledgerApi?: LedgerApi;
  }
}
