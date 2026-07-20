import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { ColumnMapping, Transaction } from '../types';
import { normalizeMerchant, parseAmount, parseDate } from './normalize';

// ---- File parsing + column mapping + validation + dedupe (§4.1) ----

export interface ParsedFile {
  headers: string[];
  rows: Record<string, string>[];
}

export async function parseFile(file: File): Promise<ParsedFile> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xls') || name.endsWith('.xlsx')) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { raw: false, defval: '' });
    const headers = json.length ? Object.keys(json[0]) : [];
    return { headers, rows: json.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v ?? '')]))) };
  }
  const text = await file.text();
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: true,
      complete: res => resolve({ headers: res.meta.fields ?? [], rows: res.data }),
      error: (err: Error) => reject(err),
    });
  });
}

/** Guess a column mapping from header names. */
export function guessMapping(headers: string[]): ColumnMapping {
  const find = (...cands: RegExp[]) => {
    for (const re of cands) {
      const h = headers.find(h => re.test(h.trim()));
      if (h) return h;
    }
    return '';
  };
  const debit = find(/^debit/i, /withdraw/i);
  const credit = find(/^credit$/i, /deposit/i);
  return {
    date: find(/^(trans(action)?\s*)?date$/i, /date/i),
    description: find(/^desc/i, /payee/i, /merchant/i, /^memo/i, /narrative/i),
    amount: find(/^amount$/i, /amount/i),
    debit: debit || undefined,
    credit: credit || undefined,
  };
}

export interface PreviewRow {
  index: number;
  date: string | null;
  merchantRaw: string;
  merchantNormalized: string;
  amount: number | null;
  error: string | null;
  duplicate: boolean;
}

/** Validate + normalize rows against a mapping. flipSign inverts amounts (for sources where expenses are positive). */
export function buildPreview(
  rows: Record<string, string>[],
  mapping: ColumnMapping,
  flipSign: boolean,
  existing: Transaction[],
  accountId: string,
): PreviewRow[] {
  const dupeKeys = new Set(
    existing.filter(t => t.accountId === accountId)
      .map(t => `${t.date}|${t.merchantNormalized.toUpperCase()}|${t.amount.toFixed(2)}`),
  );
  const seen = new Set<string>();

  return rows.map((r, index) => {
    const rawDate = mapping.date ? r[mapping.date] ?? '' : '';
    const rawDesc = mapping.description ? r[mapping.description] ?? '' : '';
    let amount: number | null = null;

    if (mapping.debit && mapping.credit) {
      const d = parseAmount(r[mapping.debit] ?? '');
      const c = parseAmount(r[mapping.credit] ?? '');
      if (d !== null && d !== 0) amount = -Math.abs(d);
      else if (c !== null && c !== 0) amount = Math.abs(c);
    } else if (mapping.amount) {
      amount = parseAmount(r[mapping.amount] ?? '');
    }
    if (amount !== null && flipSign) amount = -amount;

    const date = parseDate(rawDate);
    const merchantNormalized = normalizeMerchant(rawDesc);

    let error: string | null = null;
    if (!rawDesc.trim() && !rawDate.trim() && amount === null) error = 'Empty row';
    else if (!date) error = 'Unparseable date';
    else if (amount === null) error = 'Unparseable amount';
    else if (!rawDesc.trim()) error = 'Missing description';

    let duplicate = false;
    if (!error && date && amount !== null) {
      const key = `${date}|${merchantNormalized.toUpperCase()}|${amount.toFixed(2)}`;
      duplicate = dupeKeys.has(key) || seen.has(key);
      seen.add(key);
    }
    return { index, date, merchantRaw: rawDesc.trim(), merchantNormalized, amount, error, duplicate };
  });
}
