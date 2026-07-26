import type { Account, Category, Transaction } from '../types';
import { isSpend, spendOf } from './analytics';
import { addDaysISO, addMonths, currentYM, daysInMonth, todayISO } from './format';

// ---- Natural-language spending queries: NL text -> structured filter -> local execution ----
// The AI only ever sees the typed question plus category/account *names* (lib/api.ts's
// queryToFilterSpec) — it never sees a transaction, amount, or date from the user's history.
// Matching the resulting FilterSpec against real data (applyFilterSpec, below) happens entirely
// on this device, so the answer and the underlying transactions never leave it.

export type DateRangeToken =
  | 'this_month' | 'last_month' | 'last_3_months' | 'last_6_months'
  | 'last_30_days' | 'last_90_days' | 'this_year' | 'last_year' | 'all_time' | 'custom';

export const DATE_RANGE_TOKENS: DateRangeToken[] = [
  'this_month', 'last_month', 'last_3_months', 'last_6_months',
  'last_30_days', 'last_90_days', 'this_year', 'last_year', 'all_time', 'custom',
];

export interface FilterSpec {
  intent: 'sum' | 'count' | 'average' | 'list';
  dateRange: DateRangeToken;
  dateFrom: string | null;  // only consulted when dateRange === 'custom'
  dateTo: string | null;
  categoryId: string | null;
  subcategoryId: string | null;
  merchantContains: string | null;
  accountId: string | null;
  amountMin: number | null;
  amountMax: number | null;
}

export interface FilterResult {
  matches: Transaction[];
  sum: number;
  count: number;
  average: number;
  from: string | null;
  to: string | null;
}

/**
 * Resolves a date_range token to concrete ISO bounds using this app's own date math, the same way
 * `forecastMonthSpend` and friends never trust an external source to compute a date offset —
 * the model only ever has to pick a *token*, not do arithmetic that could come out one day off.
 */
export function resolveDateRange(dateRange: DateRangeToken, customFrom: string | null, customTo: string | null): { from: string | null; to: string | null } {
  const today = todayISO();
  const ym = currentYM();
  switch (dateRange) {
    case 'this_month': return { from: `${ym}-01`, to: today };
    case 'last_month': { const m = addMonths(ym, -1); return { from: `${m}-01`, to: `${m}-${String(daysInMonth(m)).padStart(2, '0')}` }; }
    case 'last_3_months': return { from: `${addMonths(ym, -2)}-01`, to: today };
    case 'last_6_months': return { from: `${addMonths(ym, -5)}-01`, to: today };
    case 'last_30_days': return { from: addDaysISO(today, -30), to: today };
    case 'last_90_days': return { from: addDaysISO(today, -90), to: today };
    case 'this_year': return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case 'last_year': { const y = String(Number(today.slice(0, 4)) - 1); return { from: `${y}-01-01`, to: `${y}-12-31` }; }
    case 'all_time': return { from: null, to: null };
    case 'custom': return { from: customFrom, to: customTo };
  }
}

/**
 * Spend contribution of one transaction toward a category/subcategory filter, split-aware: a
 * split transaction only contributes the share of it actually allocated to the target category,
 * not its full amount (the same distinction `spendByCategory`'s `categoryContributions` draws for
 * whole-category totals, applied here down to subcategory granularity since a query like "how
 * much on coffee" needs it and the top-level-only analytics helpers don't go that deep).
 */
function categoryContribution(t: Transaction, categoryId: string | null, subcategoryId: string | null): number {
  if (!categoryId && !subcategoryId) return spendOf(t);
  const matchesCat = (catId: string | null, subId: string | null) => subcategoryId ? subId === subcategoryId : catId === categoryId;
  if (t.splits && t.splits.length > 0) {
    return t.splits.filter(s => matchesCat(s.categoryId, s.subcategoryId)).reduce((a, s) => a - s.amount, 0);
  }
  return matchesCat(t.categoryId, t.subcategoryId) ? spendOf(t) : 0;
}

/** Executes a FilterSpec against local transactions — the only step that ever touches real data. */
export function applyFilterSpec(spec: FilterSpec, txns: Transaction[]): FilterResult {
  const { from, to } = resolveDateRange(spec.dateRange, spec.dateFrom, spec.dateTo);
  const wantsCategory = !!(spec.categoryId || spec.subcategoryId);
  const merchantQuery = spec.merchantContains?.trim().toLowerCase() || null;

  const matches: Transaction[] = [];
  let sum = 0;

  for (const t of txns) {
    if (!isSpend(t)) continue;
    if (from && t.date < from) continue;
    if (to && t.date > to) continue;
    if (spec.accountId && t.accountId !== spec.accountId) continue;
    if (merchantQuery && !t.merchantNormalized.toLowerCase().includes(merchantQuery) && !t.merchantRaw.toLowerCase().includes(merchantQuery)) continue;

    const amt = categoryContribution(t, spec.categoryId, spec.subcategoryId);
    if (wantsCategory && amt === 0) continue;
    if (spec.amountMin !== null && amt < spec.amountMin) continue;
    if (spec.amountMax !== null && amt > spec.amountMax) continue;

    matches.push(t);
    sum += amt;
  }

  matches.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const count = matches.length;
  return { matches, sum, count, average: count ? sum / count : 0, from, to };
}

/** Category taxonomy rendered for the AI prompt — names only, same shape as api.ts's merchant-categorization context. */
export function buildCategoryContext(categories: Category[]): string {
  return categories
    .filter(c => !c.parentId)
    .map(c => {
      const subs = categories.filter(s => s.parentId === c.id).map(s => `${s.id} (${s.name})`);
      return `${c.id} (${c.name})${subs.length ? ` — subcategories: ${subs.join(', ')}` : ''}`;
    })
    .join('\n');
}

/** Account list rendered for the AI prompt — nickname and issuing bank only, never balances or numbers. */
export function buildAccountContext(accounts: Account[]): string {
  return accounts.map(a => `${a.id} (${a.name}, ${a.issuingBank}, ${a.accountType.replace('_', ' ')})`).join('\n');
}
