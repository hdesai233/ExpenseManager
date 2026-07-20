import type { AppData } from '../types';
import { buildSampleData } from './sample';

// ---- Persistence adapter ----
// In the packaged desktop app, `window.ledgerApi` (exposed by electron/preload.cjs) talks to
// the main process, which stores everything in a real SQLite database via node:sqlite.
// When running in a plain browser (e.g. `npm run dev` outside Electron, or this app's web
// preview), there's no IPC bridge — fall back to localStorage so the UI is still testable.

const STORAGE_KEY = 'ledger-data-v1';

export const isDesktop = typeof window !== 'undefined' && !!window.ledgerApi;

export async function loadData(): Promise<AppData> {
  if (window.ledgerApi) {
    const empty = await window.ledgerApi.isEmpty();
    if (empty) {
      const sample = buildSampleData();
      await window.ledgerApi.save(sample);
      return sample;
    }
    return window.ledgerApi.load();
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw) as AppData;
      if (data.schemaVersion === 1) return data;
    }
  } catch { /* corrupted storage — fall through to fresh sample data */ }
  return buildSampleData();
}

export async function saveData(data: AppData): Promise<void> {
  if (window.ledgerApi) {
    await window.ledgerApi.save(data);
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('Failed to persist', e);
  }
}
