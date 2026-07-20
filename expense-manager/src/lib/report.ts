import type { AppData, Budget, Category, Transaction } from '../types';
import { incomeOf, spendOf, spendByCategory, topMerchants, type CatSpend, type MerchantAgg } from './analytics';
import { addMonths, currentYM, monthShort, todayISO, toYM } from './format';

// ---- Report engine (§4.9): builds report data for any date range; rendering + PDF/print ----
// ---- happen in the Reports screen so this stays a pure, testable data layer.              ----

export type ReportTemplateKey = 'monthly' | 'annual' | 'budget' | 'custom';

export interface ReportSections {
  summary: boolean;
  categoryBreakdown: boolean;
  budgetVsActual: boolean;
  topMerchants: boolean;
  trend: boolean;
  transactions: boolean;
}

export const DEFAULT_SECTIONS: ReportSections = {
  summary: true, categoryBreakdown: true, budgetVsActual: true, topMerchants: true, trend: true, transactions: false,
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
  { key: 'custom', label: 'Custom Date Range', description: 'Pick any start and end date.', defaultSections: DEFAULT_SECTIONS, fixedRange: false },
];

export interface ReportRange { start: string; end: string; label: string }

/** Default range for a fixed-range template, anchored on a reference month (YYYY-MM). */
export function defaultRangeFor(template: ReportTemplateKey, anchorYM: string): ReportRange {
  if (template === 'annual') {
    const year = anchorYM.slice(0, 4);
    return { start: `${year}-01-01`, end: `${year}-12-31`, label: year };
  }
  const [y, m] = anchorYM.split('-').map(Number);
  const start = `${anchorYM}-01`;
  const end = `${anchorYM}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
  return { start, end, label: monthLabelLong(anchorYM) };
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

export interface ReportData {
  title: string;
  range: ReportRange;
  income: number;
  expense: number;
  net: number;
  savingsRate: number;
  categories: CatSpend[];
  budgetRows: BudgetActualRow[];
  merchants: MerchantAgg[];
  trend: Array<{ label: string; spend: number; income: number }>;
  transactions: Transaction[];
  taxRows: Array<{ category: Category; amount: number }>;
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

  return {
    title, range, income, expense, net, savingsRate,
    categories, budgetRows, merchants, trend,
    transactions: [...txns].sort((a, b) => a.date.localeCompare(b.date)),
    taxRows,
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
