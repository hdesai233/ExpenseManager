import type { Category, Transaction } from '../types';
import { addMonths, currentYM, daysInMonth, todayISO, toYM } from './format';

// ---- Aggregations, forecasting, recurring detection (§4.5, §4.8) ----
// Ledger tracks spending only: there is no income, savings, or budget math here.

/** True spending amount for analytics: expenses net of merchant credits; transfers excluded. */
export function isSpend(t: Transaction): boolean {
  return t.flowType === 'expense' || t.flowType === 'merchant_credit';
}

/** Positive number = spend. Merchant credits net against it (they're positive amounts). */
export function spendOf(t: Transaction): number {
  return isSpend(t) ? -t.amount : 0;
}

export function txnsInMonth(txns: Transaction[], ym: string): Transaction[] {
  return txns.filter(t => toYM(t.date) === ym);
}

export function monthlySpend(txns: Transaction[], ym: string): number {
  return txnsInMonth(txns, ym).reduce((a, t) => a + spendOf(t), 0);
}

export interface CatSpend { category: Category; amount: number; pct: number }

/** Per-category expense contribution of a transaction — splits distribute across their own categories. */
function categoryContributions(t: Transaction): Array<{ categoryId: string | null; amount: number }> {
  if (!isSpend(t)) return [];
  if (t.splits && t.splits.length > 0) {
    return t.splits.map(s => ({ categoryId: s.categoryId, amount: -s.amount }));
  }
  return [{ categoryId: t.categoryId, amount: spendOf(t) }];
}

export function spendByCategory(txns: Transaction[], categories: Category[], ym?: string): CatSpend[] {
  const pool = ym ? txnsInMonth(txns, ym) : txns;
  const byCat = new Map<string, number>();
  for (const t of pool) {
    for (const c of categoryContributions(t)) {
      const cid = c.categoryId ?? 'other';
      byCat.set(cid, (byCat.get(cid) ?? 0) + c.amount);
    }
  }
  const total = [...byCat.values()].reduce((a, b) => a + b, 0) || 1;
  return [...byCat.entries()]
    .map(([cid, amount]) => ({
      category: categories.find(c => c.id === cid) ?? { id: 'other', name: 'Other / Uncategorized', parentId: null, color: '#cdc7bb' },
      amount,
      pct: amount / total,
    }))
    .filter(c => c.amount > 0.005)
    .sort((a, b) => b.amount - a.amount);
}

/** Spend in a category (by top-level category id) for a month — splits count their own share. */
export function categorySpend(txns: Transaction[], categoryId: string, ym: string): number {
  return txnsInMonth(txns, ym).reduce(
    (a, t) => a + categoryContributions(t).filter(c => c.categoryId === categoryId).reduce((sa, c) => sa + c.amount, 0),
    0,
  );
}

// ---- Forecasting: blend of run-rate and historical average (§4.8) ----

export interface Forecast { projected: number; confident: boolean }

export function forecastMonthSpend(txns: Transaction[], ym: string, categoryId?: string): Forecast {
  const today = todayISO();
  const isCurrent = ym === currentYM();
  const dim = daysInMonth(ym);
  const dayOfMonth = isCurrent ? Number(today.slice(8, 10)) : dim;

  const sofar = categoryId ? categorySpend(txns, categoryId, ym) : monthlySpend(txns, ym);
  if (!isCurrent) return { projected: sofar, confident: true };

  // Historical monthly totals (last 6 complete months)
  const hist: number[] = [];
  for (let i = 1; i <= 6; i++) {
    const m = addMonths(ym, -i);
    const v = categoryId ? categorySpend(txns, categoryId, m) : monthlySpend(txns, m);
    if (v > 0) hist.push(v);
  }
  const histAvg = hist.length ? hist.reduce((a, b) => a + b, 0) / hist.length : 0;
  const elapsed = Math.min(Math.max(dayOfMonth / dim, 0.03), 1);
  const runRate = sofar / elapsed;

  // Weight run-rate more as the month progresses
  const projected = hist.length
    ? runRate * elapsed + histAvg * (1 - elapsed) * 0.9 + (runRate - histAvg) * elapsed * 0.1
    : runRate;

  return { projected: Math.max(projected, sofar), confident: hist.length >= 3 };
}

export interface MonthPoint { ym: string; spend: number }

export function monthlySeries(txns: Transaction[], months: number, anchorYm?: string): MonthPoint[] {
  const anchor = anchorYm ?? currentYM();
  const out: MonthPoint[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const ym = addMonths(anchor, -i);
    out.push({ ym, spend: monthlySpend(txns, ym) });
  }
  return out;
}

// ---- Top merchants ----

export interface MerchantAgg { name: string; amount: number; count: number; categoryId: string | null }

export function topMerchants(txns: Transaction[], sinceYM: string, limit: number): MerchantAgg[] {
  const map = new Map<string, MerchantAgg>();
  for (const t of txns) {
    if (!isSpend(t) || toYM(t.date) < sinceYM) continue;
    const key = t.merchantNormalized;
    const cur = map.get(key) ?? { name: key, amount: 0, count: 0, categoryId: t.categoryId };
    cur.amount += spendOf(t);
    if (t.amount < 0) cur.count += 1;
    if (t.categoryId) cur.categoryId = t.categoryId;
    map.set(key, cur);
  }
  return [...map.values()].filter(m => m.amount > 0).sort((a, b) => b.amount - a.amount).slice(0, limit);
}

// ---- Recurring / subscription detection (§4.8: merchant + amount + interval clustering) ----

export interface RecurringCharge {
  merchant: string;
  categoryId: string | null;
  subcategoryId: string | null;
  avgAmount: number;
  cadence: 'monthly' | 'annual' | 'weekly';
  variable: boolean;
  lastDate: string;
  nextDate: string;
  monthlyCost: number;
  unused: boolean;   // no charge in >60 days beyond cadence — possible forgotten sub
}

export function detectRecurring(txns: Transaction[]): RecurringCharge[] {
  const byMerchant = new Map<string, Transaction[]>();
  for (const t of txns) {
    if (t.amount >= 0 || t.flowType !== 'expense') continue;
    const arr = byMerchant.get(t.merchantNormalized) ?? [];
    arr.push(t);
    byMerchant.set(t.merchantNormalized, arr);
  }

  const out: RecurringCharge[] = [];
  const today = new Date(todayISO()).getTime();

  for (const [merchant, list] of byMerchant) {
    if (list.length < 3) continue;
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      gaps.push((new Date(sorted[i].date).getTime() - new Date(sorted[i - 1].date).getTime()) / 86400000);
    }
    const medGap = median(gaps);
    let cadence: RecurringCharge['cadence'] | null = null;
    if (medGap >= 5 && medGap <= 9) cadence = 'weekly';
    else if (medGap >= 26 && medGap <= 35) cadence = 'monthly';
    else if (medGap >= 350 && medGap <= 380) cadence = 'annual';
    if (!cadence) continue;

    // gap regularity: most gaps near the median
    const regular = gaps.filter(g => Math.abs(g - medGap) <= Math.max(4, medGap * 0.15)).length >= gaps.length * 0.6;
    if (!regular) continue;

    // groceries / dining / one-off shopping recur on the calendar but aren't subscriptions
    const NON_SUB_SUBCATS = new Set(['groceries', 'restaurants', 'delivery', 'coffee', 'rent']);
    const NON_SUB_CATS = new Set(['food', 'shopping']);
    const sample = sorted[sorted.length - 1];
    if ((sample.subcategoryId && NON_SUB_SUBCATS.has(sample.subcategoryId)) ||
        (sample.categoryId && NON_SUB_CATS.has(sample.categoryId))) continue;

    const amounts = sorted.map(t => -t.amount);
    const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const madv = median(amounts.map(a => Math.abs(a - median(amounts))));
    const variable = madv / avg > 0.04;
    // amounts must cluster: weekly charges must be near-identical; monthly/annual may vary a bit (utilities)
    if (madv / avg > (cadence === 'weekly' ? 0.08 : 0.3)) continue;

    const last = sorted[sorted.length - 1];
    const lastT = new Date(last.date).getTime();
    const cadDays = cadence === 'weekly' ? 7 : cadence === 'monthly' ? 30 : 365;
    const next = new Date(lastT + cadDays * 86400000);
    const monthlyCost = cadence === 'weekly' ? avg * 4.33 : cadence === 'monthly' ? avg : avg / 12;

    out.push({
      merchant,
      categoryId: last.categoryId,
      subcategoryId: last.subcategoryId,
      avgAmount: avg,
      cadence,
      variable,
      lastDate: last.date,
      nextDate: `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`,
      monthlyCost,
      unused: (today - lastT) / 86400000 > cadDays + 60,
    });
  }
  return out.sort((a, b) => b.monthlyCost - a.monthlyCost);
}

function median(arr: number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ---- Expense trends (what replaced budget pacing and savings goals) ----

export interface CategoryMove {
  category: Category;
  current: number;
  previous: number;
  delta: number;      // positive = spending went up
  pctChange: number;  // 0 when there's no prior spend to compare against
  isNew: boolean;     // spent this month, nothing the month before
}

/**
 * Month-over-month movement per top-level category, biggest absolute change first.
 * Answers "what changed?" rather than "did I stay under a limit?".
 */
export function categoryMovers(txns: Transaction[], categories: Category[], ym: string): CategoryMove[] {
  const prevYm = addMonths(ym, -1);

  return categories
    .filter(c => !c.parentId)
    .map(category => {
      const current = categorySpend(txns, category.id, ym);
      const previous = categorySpend(txns, category.id, prevYm);
      const delta = current - previous;
      return {
        category,
        current,
        previous,
        delta,
        pctChange: previous > 0.005 ? delta / previous : 0,
        isNew: previous <= 0.005 && current > 0.005,
      };
    })
    .filter(m => Math.abs(m.delta) > 0.005)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

export interface SpendStats {
  average: number;   // mean monthly spend across active months
  median: number;
  highest: MonthPoint | null;
  lowest: MonthPoint | null;
}

/** Descriptive stats over a monthly series, ignoring months with no activity at all. */
export function spendStats(series: MonthPoint[]): SpendStats {
  const active = series.filter(m => m.spend > 0.005);
  if (active.length === 0) return { average: 0, median: 0, highest: null, lowest: null };
  const values = active.map(m => m.spend);
  return {
    average: values.reduce((a, b) => a + b, 0) / values.length,
    median: median(values),
    highest: active.reduce((a, m) => (m.spend > a.spend ? m : a), active[0]),
    lowest: active.reduce((a, m) => (m.spend < a.spend ? m : a), active[0]),
  };
}

/** Trailing average over `window` months, index-aligned with `series`; null until enough history. */
export function rollingAverage(series: MonthPoint[], window: number): Array<number | null> {
  return series.map((_, i) => {
    if (i + 1 < window) return null;
    return series.slice(i + 1 - window, i + 1).reduce((a, m) => a + m.spend, 0) / window;
  });
}

export interface Outlier { txn: Transaction; merchantMedian: number; ratio: number }

/**
 * Charges well above what that merchant normally costs. Requires a few prior charges before it
 * will call anything unusual, so a first-time merchant is never flagged just for being new.
 */
export function unusualCharges(txns: Transaction[], ym: string, minRatio = 2): Outlier[] {
  const history = new Map<string, number[]>();
  for (const t of txns) {
    if (!isSpend(t) || toYM(t.date) >= ym) continue;
    const amt = spendOf(t);
    if (amt <= 0) continue;
    const arr = history.get(t.merchantNormalized) ?? [];
    arr.push(amt);
    history.set(t.merchantNormalized, arr);
  }

  const out: Outlier[] = [];
  for (const t of txnsInMonth(txns, ym)) {
    if (!isSpend(t)) continue;
    const amt = spendOf(t);
    const prior = history.get(t.merchantNormalized);
    if (amt <= 0 || !prior || prior.length < 3) continue;
    const merchantMedian = median(prior);
    if (merchantMedian <= 0.005) continue;
    const ratio = amt / merchantMedian;
    if (ratio >= minRatio) out.push({ txn: t, merchantMedian, ratio });
  }
  return out.sort((a, b) => b.ratio - a.ratio);
}
