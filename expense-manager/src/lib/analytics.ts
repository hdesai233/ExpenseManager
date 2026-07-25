import type { Account, Category, Transaction } from '../types';
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

export interface DailyAccountSeries { accountId: string; accountName: string; color: string; values: number[] }

/**
 * Day-by-day spend for one month, split out per account — a transaction only ever belongs to one
 * account (unlike categories, accounts aren't split), so this is a straight bucket-and-sum.
 * Accounts are returned biggest-total-first so the largest color anchors the bottom of the stack.
 */
export function dailySpendByAccount(txns: Transaction[], accounts: Account[], ym: string): { days: number[]; series: DailyAccountSeries[] } {
  const dim = daysInMonth(ym);
  const days = Array.from({ length: dim }, (_, i) => i + 1);
  const byAccount = new Map<string, number[]>();

  for (const t of txnsInMonth(txns, ym)) {
    if (!isSpend(t)) continue;
    const day = Number(t.date.slice(8, 10));
    let values = byAccount.get(t.accountId);
    if (!values) { values = new Array(dim).fill(0); byAccount.set(t.accountId, values); }
    // Net spendOf in, not just positive charges — a merchant credit (refund) is a negative
    // contribution and should reduce that day's total, the same way monthlySpend/categorySpend do.
    values[day - 1] += spendOf(t);
  }

  const series = [...byAccount.entries()]
    .map(([accountId, values]): DailyAccountSeries => {
      const account = accounts.find(a => a.id === accountId);
      return { accountId, accountName: account?.name ?? 'Unknown account', color: account?.color || '#cdc7bb', values };
    })
    // Drop an account whose month nets to ~0 (e.g. a refund with nothing else that month) —
    // nothing meaningful to show, and StackedBarChart already skips individual negative segments.
    .filter(s => s.values.reduce((a, b) => a + b, 0) > 0.005)
    .sort((a, b) => b.values.reduce((x, y) => x + y, 0) - a.values.reduce((x, y) => x + y, 0));

  return { days, series };
}

export interface SpendPace {
  days: number[];
  current: Array<number | null>;   // cumulative spend through each day of `ym`; null past "today" for the current month
  priorAvg: Array<number | null>;  // average cumulative curve across `priorMonthCount` earlier months, aligned by day-of-month
  priorMonthCount: number;
  paceDelta: number | null;        // current cumulative minus the prior average at the same point — null with no prior history
  throughDay: number;              // the last day `current`/`paceDelta` reflect — "today" for the current month, else the full month
}

/**
 * Cumulative spend by day-of-month, for pacing: "by day 10 I've already spent what I usually
 * spend by day 18". A prior month shorter than `ym` holds its final cumulative value flat once
 * its own days run out, rather than going null, so the compare line stays continuous.
 */
export function spendPace(txns: Transaction[], ym: string, monthsBack = 3): SpendPace {
  const dim = daysInMonth(ym);
  const days = Array.from({ length: dim }, (_, i) => i + 1);
  const isCurrentMonth = ym === currentYM();
  const todayDay = isCurrentMonth ? Number(todayISO().slice(8, 10)) : dim;

  const dailyCurrent = new Array(dim).fill(0);
  for (const t of txnsInMonth(txns, ym)) {
    dailyCurrent[Number(t.date.slice(8, 10)) - 1] += spendOf(t);
  }
  let running = 0;
  const current: Array<number | null> = dailyCurrent.map((v, i) => {
    if (i + 1 > todayDay) return null;
    running += v;
    return running;
  });

  const priorCurves: number[][] = [];
  for (let i = 1; i <= monthsBack; i++) {
    const pym = addMonths(ym, -i);
    const priorTxns = txnsInMonth(txns, pym);
    if (priorTxns.length === 0) continue; // no data that far back — don't let it drag the average toward zero
    const pdim = daysInMonth(pym);
    const pDaily = new Array(pdim).fill(0);
    for (const t of priorTxns) pDaily[Number(t.date.slice(8, 10)) - 1] += spendOf(t);
    let run = 0;
    const cum = pDaily.map(v => { run += v; return run; });
    priorCurves.push(days.map((_, idx) => cum[Math.min(idx, pdim - 1)]));
  }

  const priorAvg: Array<number | null> = days.map((_, idx) =>
    priorCurves.length === 0 ? null : priorCurves.reduce((a, c) => a + c[idx], 0) / priorCurves.length,
  );

  const latestCurrent = current[todayDay - 1];
  const priorAtSameDay = priorAvg[todayDay - 1];
  const paceDelta = latestCurrent !== null && priorAtSameDay !== null ? latestCurrent - priorAtSameDay : null;

  return { days, current, priorAvg, priorMonthCount: priorCurves.length, paceDelta, throughDay: todayDay };
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface WeekdaySpend { weekday: number; label: string; total: number; occurrences: number; average: number }

/** Parse an ISO date as a *local* calendar date, matching how the rest of this file avoids
 * `new Date(isoString)` (which parses as UTC and can shift the weekday by one near midnight). */
function isoWeekday(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

/**
 * Average spend per weekday (Sun–Sat) over a trailing window of months. `average` divides by how
 * many times that weekday actually occurred in the window, not by transaction count, so a weekday
 * with zero spend on some dates still pulls the average down instead of being silently excluded.
 */
export function dayOfWeekSpend(txns: Transaction[], months: number, anchorYm?: string): WeekdaySpend[] {
  const anchor = anchorYm ?? currentYM();
  const startYm = addMonths(anchor, -(months - 1));
  const isCurrent = anchor === currentYM();
  const endDay = isCurrent ? Number(todayISO().slice(8, 10)) : daysInMonth(anchor);

  const [sy, sm] = startYm.split('-').map(Number);
  const [ey, em] = anchor.split('-').map(Number);
  const startDate = new Date(sy, sm - 1, 1);
  const endDate = new Date(ey, em - 1, endDay);

  const totals = new Array(7).fill(0);
  const occurrences = new Array(7).fill(0);
  for (const cur = new Date(startDate); cur <= endDate; cur.setDate(cur.getDate() + 1)) {
    occurrences[cur.getDay()]++;
  }

  const startISO = `${startYm}-01`;
  const endISO = `${anchor}-${String(endDay).padStart(2, '0')}`;
  for (const t of txns) {
    if (t.date < startISO || t.date > endISO) continue;
    const amt = spendOf(t);
    if (amt === 0) continue;
    totals[isoWeekday(t.date)] += amt;
  }

  return totals.map((total, weekday) => ({
    weekday,
    label: WEEKDAY_LABELS[weekday],
    total,
    occurrences: occurrences[weekday],
    average: occurrences[weekday] > 0 ? total / occurrences[weekday] : 0,
  }));
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

export interface MerchantTrend {
  name: string;
  categoryId: string | null;
  recentAmount: number;
  recentCount: number;
  priorAmount: number;
  priorCount: number;
  amountDelta: number;
  countDelta: number;
}

/**
 * Recent vs. prior window per merchant. A merchant's total can hold steady while its frequency
 * changes underneath it (fewer, bigger trips vs. more, smaller ones) — invisible from a plain
 * top-merchants-by-amount ranking, which is why this tracks count alongside amount.
 */
export function merchantTrends(txns: Transaction[], ym: string, windowMonths = 3): MerchantTrend[] {
  const recentStart = addMonths(ym, -(windowMonths - 1));
  const priorEnd = addMonths(recentStart, -1);
  const priorStart = addMonths(priorEnd, -(windowMonths - 1));

  const bucket = (fromYm: string, toYm: string) => {
    const map = new Map<string, { amount: number; count: number; categoryId: string | null }>();
    for (const t of txns) {
      if (!isSpend(t)) continue;
      const tym = toYM(t.date);
      if (tym < fromYm || tym > toYm) continue;
      const cur = map.get(t.merchantNormalized) ?? { amount: 0, count: 0, categoryId: t.categoryId };
      cur.amount += spendOf(t);
      if (t.amount < 0) cur.count += 1; // count charges, not refunds
      if (t.categoryId) cur.categoryId = t.categoryId;
      map.set(t.merchantNormalized, cur);
    }
    return map;
  };

  const recent = bucket(recentStart, ym);
  const prior = bucket(priorStart, priorEnd);

  const out: MerchantTrend[] = [];
  for (const name of new Set([...recent.keys(), ...prior.keys()])) {
    const r = recent.get(name);
    const p = prior.get(name);
    // needs at least 2 charges somewhere so a single one-off purchase never reads as "trending"
    if ((r?.count ?? 0) < 2 && (p?.count ?? 0) < 2) continue;
    out.push({
      name,
      categoryId: r?.categoryId ?? p?.categoryId ?? null,
      recentAmount: r?.amount ?? 0,
      recentCount: r?.count ?? 0,
      priorAmount: p?.amount ?? 0,
      priorCount: p?.count ?? 0,
      amountDelta: (r?.amount ?? 0) - (p?.amount ?? 0),
      countDelta: (r?.count ?? 0) - (p?.count ?? 0),
    });
  }
  return out.sort((a, b) => Math.abs(b.amountDelta) - Math.abs(a.amountDelta));
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

export interface CategoryAnomaly {
  category: Category;
  amount: number;
  typicalAmount: number;
  ratio: number;
  monthsCompared: number;
}

/**
 * Categories spending well above their own recent history — the category-level analogue of
 * unusualCharges, but comparing against a multi-month median rather than the single prior month
 * categoryMovers uses, so one unusually cheap or expensive prior month can't swing the comparison.
 * Only flags "spent more than usual"; "less than usual" is already covered by categoryMovers.
 */
export function categoryAnomalies(
  txns: Transaction[], categories: Category[], ym: string, monthsBack = 6, minRatio = 1.5, minDelta = 30,
): CategoryAnomaly[] {
  const out: CategoryAnomaly[] = [];
  for (const category of categories.filter(c => !c.parentId)) {
    const current = categorySpend(txns, category.id, ym);
    if (current <= 0.005) continue;

    const hist: number[] = [];
    for (let i = 1; i <= monthsBack; i++) {
      const v = categorySpend(txns, category.id, addMonths(ym, -i));
      if (v > 0.005) hist.push(v);
    }
    if (hist.length < 3) continue; // not enough history to call anything "unusual" with confidence

    const typicalAmount = median(hist);
    if (typicalAmount <= 0.005) continue;
    const ratio = current / typicalAmount;
    if (ratio >= minRatio && current - typicalAmount >= minDelta) {
      out.push({ category, amount: current, typicalAmount, ratio, monthsCompared: hist.length });
    }
  }
  return out.sort((a, b) => b.ratio - a.ratio);
}
