/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useReducer, useState, type ReactNode } from 'react';
import type { Account, AppData, ImportBatch, ImportProfile, Rule, Settings, Transaction } from './types';
import { learnRule } from './lib/categorize';
import * as categoryOps from './lib/categoryOps';
import { buildSampleData } from './lib/sample';
import { loadData, saveData } from './lib/persist';

type Action =
  | { type: 'importCommit'; transactions: Transaction[]; batch: ImportBatch; account?: Account; profile?: ImportProfile }
  | { type: 'categorize'; txnIds: string[]; categoryId: string | null; subcategoryId: string | null; learn: boolean }
  | { type: 'confirmTxn'; txnId: string }
  | { type: 'updateTxn'; txnId: string; patch: Partial<Transaction> }
  | { type: 'deleteTxns'; txnIds: string[] }
  | { type: 'bulkAddTag'; txnIds: string[]; tag: string }
  | { type: 'applyApiResults'; results: Array<{ merchant: string; categoryId: string | null; subcategoryId: string | null; confidence: number }> }
  | { type: 'addRule'; rule: Rule }
  | { type: 'deleteRule'; ruleId: string }
  | { type: 'updateAccount'; account: Account }
  | { type: 'deleteAccount'; accountId: string }
  | { type: 'setTaxDeductible'; categoryId: string; taxDeductible: boolean }
  | { type: 'addCategory'; name: string; color: string; parentId: string | null; id?: string }
  | { type: 'editCategory'; categoryId: string; patch: { name?: string; color?: string } }
  | { type: 'deleteCategory'; categoryId: string; reassignTo: string | null }
  | { type: 'mergeCategory'; fromId: string; intoId: string }
  | { type: 'updateSettings'; patch: Partial<Settings> }
  | { type: 'restore'; data: AppData }
  | { type: 'resetAll' };

function reducer(state: AppData, action: Action): AppData {
  switch (action.type) {
    case 'importCommit': {
      return {
        ...state,
        transactions: [...state.transactions, ...action.transactions],
        batches: [...state.batches, action.batch],
        accounts: action.account && !state.accounts.some(a => a.id === action.account!.id)
          ? [...state.accounts, action.account]
          : state.accounts,
        profiles: action.profile
          ? [...state.profiles.filter(p => p.id !== action.profile!.id), action.profile]
          : state.profiles,
      };
    }
    case 'categorize': {
      const ids = new Set(action.txnIds);
      let rules = state.rules;
      const affected = state.transactions.filter(t => ids.has(t.id));
      if (action.learn && action.categoryId) {
        for (const t of affected) {
          rules = learnRule(rules, t.merchantNormalized, action.categoryId, action.subcategoryId);
        }
      }
      return {
        ...state,
        rules,
        transactions: state.transactions.map(t => ids.has(t.id)
          ? { ...t, categoryId: action.categoryId, subcategoryId: action.subcategoryId, confidence: 1, categorizationSource: 'manual', reviewed: true }
          : t),
      };
    }
    case 'confirmTxn': {
      let rules = state.rules;
      const t = state.transactions.find(x => x.id === action.txnId);
      if (t?.categoryId) rules = learnRule(rules, t.merchantNormalized, t.categoryId, t.subcategoryId);
      return {
        ...state,
        rules,
        transactions: state.transactions.map(x => x.id === action.txnId
          ? { ...x, reviewed: true, confidence: 1, categorizationSource: 'manual' }
          : x),
      };
    }
    case 'updateTxn':
      return { ...state, transactions: state.transactions.map(t => t.id === action.txnId ? { ...t, ...action.patch } : t) };
    case 'deleteTxns': {
      const ids = new Set(action.txnIds);
      return { ...state, transactions: state.transactions.filter(t => !ids.has(t.id)) };
    }
    case 'bulkAddTag': {
      const ids = new Set(action.txnIds);
      const tag = action.tag.trim();
      if (!tag) return state;
      return {
        ...state,
        transactions: state.transactions.map(t => ids.has(t.id) && !t.tags.includes(tag)
          ? { ...t, tags: [...t.tags, tag] }
          : t),
      };
    }
    case 'applyApiResults': {
      const byMerchant = new Map(action.results.map(r => [r.merchant.toUpperCase(), r]));
      let rules = state.rules;
      for (const r of action.results) {
        if (r.categoryId) rules = learnRule(rules, r.merchant, r.categoryId, r.subcategoryId);
      }
      return {
        ...state,
        rules,
        transactions: state.transactions.map(t => {
          if (t.categoryId || t.flowType === 'transfer' || t.reviewed) return t;
          const r = byMerchant.get(t.merchantNormalized.toUpperCase());
          if (!r || !r.categoryId) return t;
          return { ...t, categoryId: r.categoryId, subcategoryId: r.subcategoryId, confidence: r.confidence, categorizationSource: 'api' };
        }),
      };
    }
    case 'addRule':
      return { ...state, rules: [...state.rules, action.rule] };
    case 'deleteRule':
      return { ...state, rules: state.rules.filter(r => r.id !== action.ruleId) };
    case 'updateAccount':
      return { ...state, accounts: state.accounts.map(a => a.id === action.account.id ? action.account : a) };
    case 'deleteAccount': {
      if (state.transactions.some(t => t.accountId === action.accountId)) return state;
      return {
        ...state,
        accounts: state.accounts.filter(a => a.id !== action.accountId),
        batches: state.batches.filter(b => b.accountId !== action.accountId),
        profiles: state.profiles.filter(p => p.accountId !== action.accountId),
      };
    }
    case 'setTaxDeductible':
      return { ...state, categories: state.categories.map(c => c.id === action.categoryId ? { ...c, taxDeductible: action.taxDeductible } : c) };
    case 'addCategory':
      return categoryOps.addCategory(state, action.name, action.color, action.parentId, action.id);
    case 'editCategory':
      return categoryOps.editCategory(state, action.categoryId, action.patch);
    case 'deleteCategory':
      return categoryOps.deleteCategory(state, action.categoryId, action.reassignTo);
    case 'mergeCategory':
      return categoryOps.mergeCategory(state, action.fromId, action.intoId);
    case 'updateSettings':
      return { ...state, settings: { ...state.settings, ...action.patch } };
    case 'restore':
      return withSettingsDefaults(action.data);
    case 'resetAll':
      return buildSampleData();
    default:
      return state;
  }
}

/**
 * Every AppData from outside the app — the boot snapshot, a JSON backup, a restored database —
 * arrives through the `restore` action, so this is the one place to backfill settings added in a
 * later version. Without it an older snapshot loads with fields missing rather than defaulted.
 */
function withSettingsDefaults(data: AppData): AppData {
  const settings = { ...EMPTY.settings, ...data.settings };
  if (settings.aiProvider !== 'anthropic' && settings.aiProvider !== 'gemini') {
    settings.aiProvider = 'anthropic';
  }
  return { ...data, settings };
}

interface StoreCtx {
  state: AppData;
  dispatch: React.Dispatch<Action>;
}

const Ctx = createContext<StoreCtx | null>(null);

// Placeholder used only until the real snapshot loads from SQLite (desktop) or
// localStorage (browser fallback) — never rendered, since StoreProvider gates on `ready`.
const EMPTY: AppData = {
  schemaVersion: 1, accounts: [], transactions: [], categories: [], rules: [],
  batches: [], profiles: [],
  settings: {
    apiFallbackEnabled: false, aiProvider: 'anthropic', householdName: '',
    autoReportEnabled: false, autoReportFolder: '', autoReportLastYM: '',
  },
};

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, EMPTY);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadData().then(data => {
      if (!cancelled) { dispatch({ type: 'restore', data }); setReady(true); }
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const id = setTimeout(() => { saveData(state).catch(e => console.error('Failed to persist', e)); }, 300);
    return () => clearTimeout(id);
  }, [state, ready]);

  const value = useMemo(() => ({ state, dispatch }), [state]);

  if (!ready) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#eceae4', color: '#8a8880', fontFamily: 'Helvetica Neue, Arial, sans-serif', fontSize: 13 }}>
        Loading your ledger…
      </div>
    );
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): StoreCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useStore outside provider');
  return ctx;
}

// ---- Convenience selectors ----

export function categoryName(state: AppData, id: string | null): string {
  if (!id) return 'Uncategorized';
  return state.categories.find(c => c.id === id)?.name ?? 'Uncategorized';
}

export function categoryColor(state: AppData, id: string | null): string {
  if (!id) return '#b6b2a8';
  const cat = state.categories.find(c => c.id === id);
  if (!cat) return '#b6b2a8';
  if (cat.parentId) return state.categories.find(c => c.id === cat.parentId)?.color ?? cat.color;
  return cat.color;
}

export function accountName(state: AppData, id: string): string {
  return state.accounts.find(a => a.id === id)?.name ?? id;
}

export function accountTxnCount(state: AppData, accountId: string): number {
  return state.transactions.filter(t => t.accountId === accountId).length;
}

/** Display label for a transaction's category cell. */
export function txnCategoryLabel(state: AppData, t: Transaction): string {
  if (t.flowType === 'transfer') {
    return t.transferSubtype === 'credit_card_payment' ? 'Card payment' : 'Internal transfer';
  }
  if (t.splits && t.splits.length > 1) return `Split · ${t.splits.length} categories`;
  if (t.subcategoryId) return categoryName(state, t.subcategoryId);
  return categoryName(state, t.categoryId);
}

/** "Groceries + Household" style label listing every split's category — for CSV/export contexts. */
export function txnCategoryList(state: AppData, t: Transaction): string {
  if (t.splits && t.splits.length > 1) {
    return t.splits.map(s => categoryName(state, s.subcategoryId ?? s.categoryId)).join(' + ');
  }
  return txnCategoryLabel(state, t);
}
