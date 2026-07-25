import type { AppData, Budget, Category, Transaction } from '../types';
import { incomeOf, isSpend, spendOf, spendByCategory, topMerchants, type CatSpend, type MerchantAgg } from './analytics';
import { addMonths, currentYM, monthShort, todayISO, toYM } from './format';

// ---- Report engine (§4.9): builds report data for any date range; rendering + PDF/print ----
// ---- happen in the Reports screen so this stays a pure, testable data layer.              ----

export type ReportTemplateKey = 'monthly' | 'annual' | 'budget' | 'expense' | 'custom';

export interface ReportSections {
  summary: boolean;
  categoryBreakdown: boolean;
  categoryDetail: boolean;
  categoryTrend: boolean;
  budgetVsActual: boolean;
  topMerchants: boolean;
  trend: boolean;
  transactions: boolean;
}

export const DEFAULT_SECTIONS: ReportSections = {
  summary: true, categoryBreakdown: true, categoryDetail: false, categoryTrend: false,
  budgetVsActual: true, topMerchants: true, trend: true, transactions: false,
};

export interface ReportTemplateDef {
  key: ReportTemplateKey;
  label: string;
  description: string;
  defaultSections: ReportSections;
  fixedRange: boolean; // true = template computes its own range; false = user picks dates (Custom)
}

export const REPORT_TEMPLATES: ReportTemplateDef[] = [
  { key: 'monthly', label: 'Monthly Summary', description: 'Income, spend, categories, and top merchants for one month.', defaultSections: DEFAULT_SECTIONS, fixedRange: true },
  { key: 'annual', label: 'Annual / Year-in-Review', description: 'A full calendar year, with the month-by-month trend front and center.', defaultSections: { ...DEFAULT_SECTIONS, budgetVsActual: false }, fixedRange: true },
  { key: 'budget', label: 'Budget Performance', description: 'One month, focused on budget vs. actual by category.', defaultSections: { ...DEFAULT_SECTIONS, topMerchants: false, trend: false }, fixedRange: true },
  {
    key: 'expense',
    label: 'Expense Breakdown',
    description: 'Where the money actually went — every category and subcategory, charted. No budget comparison.',
    defaultSections: { ...DEFAULT_SECTIONS, categoryDetail: true, categoryTrend: true, budgetVsActual: false, trend: false },
    fixedRange: true,
  },
  { key: 'custom', label: 'Custom Date Range', description: 'Pick any start and end date.', defaultSections: DEFAULT_SECTIONS, fixedRange: false },
];

export interface ReportRange { start: string; end: string; label: string }

/**
 * Default range for a fixed-range template, anchored on a reference month (YYYY-MM).
 * `monthsBack` (Expense Breakdown only) widens it into a trailing window ending at the anchor.
 */
export function defaultRangeFor(template: ReportTemplateKey, anchorYM: string, monthsBack = 1): ReportRange {
  if (template === 'annual') {
    const year = anchorYM.slice(0, 4);
    return { start: `${year}-01-01`, end: `${year}-12-31`, label: year };
  }
  const [y, m] = anchorYM.split('-').map(Number);
  const end = `${anchorYM}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;

  if (template === 'expense' && monthsBack > 1) {
    const startYM = addMonths(anchorYM, -(monthsBack - 1));
    return { start: `${startYM}-01`, end, label: `${monthLabelShortYear(startYM)} – ${monthLabelLong(anchorYM)}` };
  }
  return { start: `${anchorYM}-01`, end, label: monthLabelLong(anchorYM) };
}

function monthLabelShortYear(ym: string): string {
  return `${monthShort(ym)} ${ym.slice(0, 4)}`;
}

function monthLabelLong(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export function txnsInRange(txns: Transaction[], start: string, end: string): Transaction[] {
  return txns.filter(t => t.date >= start && t.date <= end);
}

function monthsSpanned(start: string, end: string): string[] {
  const out: string[] = [];
  let ym = start.slice(0, 7);
  const endYm = end.slice(0, 7);
  let guard = 0;
  while (ym <= endYm && guard++ < 600) { out.push(ym); ym = addMonths(ym, 1); }
  return out;
}

export interface BudgetActualRow { category: Category; actual: number; target: number; pct: number; over: boolean }

// ---- Expense-focused grouping: category → subcategory, split-aware (§4.9 Expense Breakdown) ----

const UNCATEGORIZED: Category = { id: 'other', name: 'Other / Uncategorized', parentId: null, color: '#cdc7bb' };

interface SpendContribution { categoryId: string | null; subcategoryId: string | null; amount: number; txnId: string }

/** One transaction's positive spend amounts, distributed across its splits when it has any. */
function spendContributions(t: Transaction): SpendContribution[] {
  if (!isSpend(t)) return [];
  if (t.splits && t.splits.length > 0) {
    return t.splits.map(s => ({ categoryId: s.categoryId, subcategoryId: s.subcategoryId, amount: -s.amount, txnId: t.id }));
  }
  return [{ categoryId: t.categoryId, subcategoryId: t.subcategoryId, amount: spendOf(t), txnId: t.id }];
}

/** Resolve a contribution to (top-level id, subcategory id) — tolerating a subcategory stored in categoryId. */
function resolveCategoryIds(c: SpendContribution, categories: Category[]): { topId: string; subId: string | null } {
  const cat = c.categoryId ? categories.find(x => x.id === c.categoryId) : undefined;
  if (!cat) return { topId: UNCATEGORIZED.id, subId: c.subcategoryId ?? null };
  return {
    topId: cat.parentId ?? cat.id,
    subId: c.subcategoryId ?? (cat.parentId ? cat.id : null),
  };
}

export interface CategoryDetailSub {
  category: Category;
  amount: number;
  pct: number;       // share of the parent category, not of total
  count: number;
  direct: boolean;   // true = spend sitting on the parent with no subcategory assigned
}

export interface CategoryDetailRow {
  category: Category;
  amount: number;
  pct: number;         // share of total expense
  count: number;
  avgPerMonth: number;
  subs: CategoryDetailSub[];
}

function buildCategoryDetail(txns: Transaction[], categories: Category[], monthCount: number): CategoryDetailRow[] {
  interface Bucket { amount: number; txns: Set<string>; subs: Map<string, { amount: number; txns: Set<string> }> }
  const tops = new Map<string, Bucket>();

  for (const t of txns) {
    for (const c of spendContributions(t)) {
      const { topId, subId } = resolveCategoryIds(c, categories);
      let top = tops.get(topId);
      if (!top) { top = { amount: 0, txns: new Set(), subs: new Map() }; tops.set(topId, top); }
      top.amount += c.amount;
      top.txns.add(c.txnId);

      const key = subId ?? '';
      let sub = top.subs.get(key);
      if (!sub) { sub = { amount: 0, txns: new Set() }; top.subs.set(key, sub); }
      sub.amount += c.amount;
      sub.txns.add(c.txnId);
    }
  }

  const total = [...tops.values()].reduce((a, v) => a + v.amount, 0) || 1;

  return [...tops.entries()]
    .map(([id, v]) => {
      const category = categories.find(c => c.id === id) ?? UNCATEGORIZED;
      const subs = [...v.subs.entries()]
        .map(([subId, sv]): CategoryDetailSub => ({
          category: subId
            ? (categories.find(c => c.id === subId) ?? { ...UNCATEGORIZED, id: subId, name: 'Unknown', parentId: id })
            : { id: `${id}:direct`, name: '(no subcategory)', parentId: id, color: category.color },
          amount: sv.amount,
          pct: v.amount > 0 ? sv.amount / v.amount : 0,
          count: sv.txns.size,
          direct: !subId,
        }))
        .filter(s => s.amount > 0.005)
        .sort((a, b) => b.amount - a.amount);
      return {
        category,
        amount: v.amount,
        pct: v.amount / total,
        count: v.txns.size,
        avgPerMonth: v.amount / Math.max(monthCount, 1),
        subs,
      };
    })
    .filter(r => r.amount > 0.005)
    .sort((a, b) => b.amount - a.amount);
}

export interface CategoryTrendSeries { category: Category; values: number[] }

/** Per-month spend for the biggest categories, aligned index-for-index with `ReportData.trend`. */
function buildCategoryTrend(
  txns: Transaction[], categories: Category[], months: string[], rows: CategoryDetailRow[], limit: number,
): CategoryTrendSeries[] {
  const picked = rows.slice(0, limit);
  const monthIndex = new Map(months.map((m, i) => [m, i]));
  const acc = new Map<string, number[]>(picked.map(r => [r.category.id, new Array(months.length).fill(0)]));

  for (const t of txns) {
    const i = monthIndex.get(toYM(t.date));
    if (i === undefined) continue;
    for (const c of spendContributions(t)) {
      const arr = acc.get(resolveCategoryIds(c, categories).topId);
      if (arr) arr[i] += c.amount;
    }
  }
  return picked.map(r => ({ category: r.category, values: acc.get(r.category.id)! }));
}

export interface ReportData {
  title: string;
  range: ReportRange;
  income: number;
  expense: number;
  net: number;
  savingsRate: number;
  categories: CatSpend[];
  categoryDetail: CategoryDetailRow[];
  categoryTrend: CategoryTrendSeries[];
  budgetRows: BudgetActualRow[];
  merchants: MerchantAgg[];
  trend: Array<{ label: string; spend: number; income: number }>;
  transactions: Transaction[];
  taxRows: Array<{ category: Category; amount: number }>;
  monthCount: number;
  generatedAt: string;
}

export function buildReport(data: AppData, range: ReportRange, title: string): ReportData {
  const txns = txnsInRange(data.transactions, range.start, range.end);
  const income = txns.reduce((a, t) => a + incomeOf(t), 0);
  const expense = txns.reduce((a, t) => a + spendOf(t), 0);
  const net = income - expense;
  const savingsRate = income > 0 ? net / income : 0;

  const categories = spendByCategory(txns, data.categories);
  const catAmountById = new Map(categories.map(c => [c.category.id, c.amount]));

  const months = monthsSpanned(range.start, range.end);
  const monthCount = months.length || 1;

  const budgetRows: BudgetActualRow[] = (data.budgets as Budget[])
    .map(b => {
      const category = data.categories.find(c => c.id === b.categoryId);
      if (!category) return null;
      const actual = catAmountById.get(b.categoryId) ?? 0;
      const target = b.monthlyLimit * monthCount;
      return { category, actual, target, pct: target > 0 ? actual / target : 0, over: actual > target + 0.005 };
    })
    .filter((x): x is BudgetActualRow => x !== null)
    .sort((a, b) => b.actual - a.actual);

  const merchants = topMerchants(txns, months[0] ?? currentYM(), 10);

  const trend = months.map(ym => {
    const inMonth = txns.filter(t => toYM(t.date) === ym);
    return {
      label: monthShort(ym),
      spend: inMonth.reduce((a, t) => a + spendOf(t), 0),
      income: inMonth.reduce((a, t) => a + incomeOf(t), 0),
    };
  });

  const taxRows = categories
    .filter(c => c.category.taxDeductible)
    .map(c => ({ category: c.category, amount: c.amount }));

  const categoryDetail = buildCategoryDetail(txns, data.categories, monthCount);
  const categoryTrend = buildCategoryTrend(txns, data.categories, months, categoryDetail, 6);

  return {
    title, range, income, expense, net, savingsRate,
    categories, categoryDetail, categoryTrend, budgetRows, merchants, trend,
    transactions: [...txns].sort((a, b) => a.date.localeCompare(b.date)),
    taxRows,
    monthCount,
    generatedAt: todayISO(),
  };
}

// ---- Filtered transaction export (§4.9: export whatever's on screen, not a full dump) ----

export interface TransactionFilter {
  start?: string;
  end?: string;
  accountId?: string;      // '' or undefined = all accounts
  categoryId?: string;     // '' or undefined = all categories
  flow?: 'all' | 'spending' | 'income' | 'transfers';
  tag?: string;
  search?: string;
}

export function applyTransactionFilter(txns: Transaction[], f: TransactionFilter): Transaction[] {
  let list = txns;
  if (f.start) list = list.filter(t => t.date >= f.start!);
  if (f.end) list = list.filter(t => t.date <= f.end!);
  if (f.accountId) list = list.filter(t => t.accountId === f.accountId);
  if (f.categoryId) list = list.filter(t => t.categoryId === f.categoryId || t.subcategoryId === f.categoryId
    || (t.splits ?? []).some(s => s.categoryId === f.categoryId || s.subcategoryId === f.categoryId));
  if (f.flow === 'spending') list = list.filter(t => t.flowType === 'expense' || t.flowType === 'merchant_credit');
  else if (f.flow === 'income') list = list.filter(t => t.flowType === 'income');
  else if (f.flow === 'transfers') list = list.filter(t => t.flowType === 'transfer');
  if (f.tag) list = list.filter(t => t.tags.some(tag => tag.toLowerCase() === f.tag!.toLowerCase()));
  if (f.search) {
    const q = f.search.toLowerCase();
    list = list.filter(t => t.merchantNormalized.toLowerCase().includes(q) || t.merchantRaw.toLowerCase().includes(q) || t.notes.toLowerCase().includes(q));
  }
  return [...list].sort((a, b) => b.date.localeCompare(a.date));
}
