import type { Account, Category, Transaction } from '../types';
import { addDaysISO, addMonths, currentYM, daysInMonth, todayISO, toYM } from './format';
import { clusterMerchants } from './merchantCluster';

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

export interface CumulativeSpend { days: number[]; values: Array<number | null> }

/**
 * Running-total spend across one month, day by day — a "growth" curve rather than a per-day
 * amount. For the current month, days after today are `null` rather than the final running total
 * held flat — they haven't happened yet, so freezing the line there would misleadingly read as
 * "spending stopped" instead of "no data yet" (the same convention `spendPace` uses for its own
 * cumulative curve, for the same reason).
 */
export function cumulativeSpend(txns: Transaction[], ym: string): CumulativeSpend {
  const dim = daysInMonth(ym);
  const isCurrent = ym === currentYM();
  const todayDay = isCurrent ? Number(todayISO().slice(8, 10)) : dim;
  const days = Array.from({ length: dim }, (_, i) => i + 1);
  const daily = new Array(dim).fill(0);

  for (const t of txnsInMonth(txns, ym)) {
    if (!isSpend(t)) continue;
    const day = Number(t.date.slice(8, 10));
    daily[day - 1] += spendOf(t);
  }

  let running = 0;
  const values = daily.map((v, i) => {
    if (i + 1 > todayDay) return null;
    running += v;
    return running;
  });
  return { days, values };
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

// ---- Fixed vs. variable spend (§4.8: which spend is committed vs. discretionary) ----

export interface FixedVariableSplit { fixed: number; variable: number; total: number; fixedPct: number }

/**
 * Splits a month's spend into "fixed" (charged by a merchant `detectRecurring` recognizes as a
 * recurring commitment) vs. "variable" (everything else). Pass `recurringMerchants` when the
 * caller already has a `detectRecurring` result (e.g. looping over several months) to avoid
 * recomputing it; otherwise it's derived fresh from `txns`.
 */
export function fixedVsVariableSpend(txns: Transaction[], ym: string, recurringMerchants?: Set<string>): FixedVariableSplit {
  const fixedMerchants = recurringMerchants ?? new Set(detectRecurring(txns).map(r => r.merchant));
  let fixed = 0;
  let variable = 0;
  for (const t of txnsInMonth(txns, ym)) {
    const amt = spendOf(t);
    if (fixedMerchants.has(t.merchantNormalized)) fixed += amt;
    else variable += amt;
  }
  const total = fixed + variable;
  return { fixed, variable, total, fixedPct: total > 0.005 ? fixed / total : 0 };
}

// ---- Forecasting: known fixed remainder + statistical projection of variable spend (§4.8) ----

export interface Forecast { projected: number; confident: boolean; low: number; high: number; knownFixedRemaining: number }

export function forecastMonthSpend(txns: Transaction[], ym: string, categoryId?: string): Forecast {
  const today = todayISO();
  const isCurrent = ym === currentYM();
  const dim = daysInMonth(ym);
  const dayOfMonth = isCurrent ? Number(today.slice(8, 10)) : dim;

  const sofar = categoryId ? categorySpend(txns, categoryId, ym) : monthlySpend(txns, ym);
  if (!isCurrent) return { projected: sofar, confident: true, low: sofar, high: sofar, knownFixedRemaining: 0 };

  const elapsed = Math.min(Math.max(dayOfMonth / dim, 0.03), 1);

  if (categoryId) {
    // Category-scoped forecasts don't separate fixed/variable — keep the original blended run-rate model.
    const hist: number[] = [];
    for (let i = 1; i <= 6; i++) {
      const v = categorySpend(txns, categoryId, addMonths(ym, -i));
      if (v > 0) hist.push(v);
    }
    const histAvg = hist.length ? hist.reduce((a, b) => a + b, 0) / hist.length : 0;
    const runRate = sofar / elapsed;
    const projected = hist.length
      ? runRate * elapsed + histAvg * (1 - elapsed) * 0.9 + (runRate - histAvg) * elapsed * 0.1
      : runRate;
    const clamped = Math.max(projected, sofar);
    const band = clamped * 0.175;
    return { projected: clamped, confident: hist.length >= 3, low: Math.max(sofar, clamped - band), high: clamped + band, knownFixedRemaining: 0 };
  }

  // Whole-month forecast: known fixed charges still due this month, plus a statistical
  // projection of variable (discretionary) spend, instead of blending one rate over everything.
  const recurring = detectRecurring(txns);
  const fixedMerchants = new Set(recurring.map(r => r.merchant));
  const endOfMonth = `${ym}-${String(dim).padStart(2, '0')}`;
  const knownFixedRemaining = recurring.reduce((a, r) => a + (r.nextDate > today && r.nextDate <= endOfMonth ? r.avgAmount : 0), 0);

  const variableSoFar = fixedVsVariableSpend(txns, ym, fixedMerchants).variable;
  const runRate = variableSoFar / elapsed;

  const histVariable: number[] = [];
  for (let i = 1; i <= 6; i++) {
    const v = fixedVsVariableSpend(txns, addMonths(ym, -i), fixedMerchants).variable;
    if (v > 0.005) histVariable.push(v);
  }
  const histAvg = histVariable.length ? histVariable.reduce((a, b) => a + b, 0) / histVariable.length : 0;
  const variableProjectedFull = histVariable.length
    ? runRate * elapsed + histAvg * (1 - elapsed) * 0.9 + (runRate - histAvg) * elapsed * 0.1
    : runRate;
  const variableRemaining = Math.max(variableProjectedFull - variableSoFar, 0);

  const base = sofar + knownFixedRemaining;
  const projected = base + variableRemaining;
  const confident = histVariable.length >= 3;
  const spread = confident
    ? median(histVariable.map(v => Math.abs(v - median(histVariable)))) * (1 - elapsed)
    : variableRemaining * 0.3;

  return {
    projected,
    confident,
    low: Math.max(base, projected - spread),
    high: projected + spread,
    knownFixedRemaining,
  };
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

// ---- Merchant identity: local fuzzy clustering (§ recommendation #10) ----

/**
 * Canonical merchant identity per distinct `merchantNormalized` value, via local fuzzy string
 * clustering (`lib/merchantCluster.ts`) — display/aggregation only, never written back to a
 * transaction, so rules, learned categorization, and subscription dismissal (all keyed on the
 * stored `merchantNormalized`) are unaffected. Built from the *full* transaction list passed in,
 * not whatever narrower window a caller is about to filter to, so the same canonical name is
 * chosen everywhere regardless of which analytic is asking.
 */
export function merchantCanonicalMap(txns: Transaction[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const t of txns) {
    if (!isSpend(t)) continue;
    counts.set(t.merchantNormalized, (counts.get(t.merchantNormalized) ?? 0) + 1);
  }
  return clusterMerchants(counts);
}

// ---- Top merchants ----

export interface MerchantAgg { name: string; amount: number; count: number; categoryId: string | null }

export function topMerchants(txns: Transaction[], sinceYM: string, limit: number): MerchantAgg[] {
  const canon = merchantCanonicalMap(txns);
  const map = new Map<string, MerchantAgg>();
  for (const t of txns) {
    if (!isSpend(t) || toYM(t.date) < sinceYM) continue;
    const key = canon.get(t.merchantNormalized) ?? t.merchantNormalized;
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
  recentLastDate: string | null;
  priorAmount: number;
  priorCount: number;
  priorLastDate: string | null;
  amountDelta: number;
  countDelta: number;
}

/**
 * Recent vs. prior window per merchant. A merchant's total can hold steady while its frequency
 * changes underneath it (fewer, bigger trips vs. more, smaller ones) — invisible from a plain
 * top-merchants-by-amount ranking, which is why this tracks count alongside amount.
 */
export function merchantTrends(txns: Transaction[], ym: string, windowMonths = 3): MerchantTrend[] {
  const canon = merchantCanonicalMap(txns);
  const recentStart = addMonths(ym, -(windowMonths - 1));
  const priorEnd = addMonths(recentStart, -1);
  const priorStart = addMonths(priorEnd, -(windowMonths - 1));

  const bucket = (fromYm: string, toYm: string) => {
    const map = new Map<string, { amount: number; count: number; categoryId: string | null; lastDate: string }>();
    for (const t of txns) {
      if (!isSpend(t)) continue;
      const tym = toYM(t.date);
      if (tym < fromYm || tym > toYm) continue;
      const key = canon.get(t.merchantNormalized) ?? t.merchantNormalized;
      const cur = map.get(key) ?? { amount: 0, count: 0, categoryId: t.categoryId, lastDate: t.date };
      cur.amount += spendOf(t);
      if (t.amount < 0) cur.count += 1; // count charges, not refunds
      if (t.categoryId) cur.categoryId = t.categoryId;
      if (t.date > cur.lastDate) cur.lastDate = t.date;
      map.set(key, cur);
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
      recentLastDate: r?.lastDate ?? null,
      priorAmount: p?.amount ?? 0,
      priorCount: p?.count ?? 0,
      priorLastDate: p?.lastDate ?? null,
      amountDelta: (r?.amount ?? 0) - (p?.amount ?? 0),
      countDelta: (r?.count ?? 0) - (p?.count ?? 0),
    });
  }
  return out.sort((a, b) => Math.abs(b.amountDelta) - Math.abs(a.amountDelta));
}

/**
 * Merchants with meaningful prior-window activity but zero charges in the recent window — the
 * mirror of merchantTrends' rising/falling list. "You stopped going to X" is the same computation
 * as the up/down trend, just filtered and re-sorted for that specific story, which is often the
 * more actionable one (a still-frequent merchant creeping up in price is background noise; a
 * merchant that quietly disappeared is either a forgotten cancellation or a deliberate change
 * worth noticing).
 */
export function merchantChurn(txns: Transaction[], ym: string, windowMonths = 3): MerchantTrend[] {
  return merchantTrends(txns, ym, windowMonths)
    .filter(m => m.recentCount === 0 && m.priorCount >= 2)
    .sort((a, b) => b.priorAmount - a.priorAmount);
}

/** All spend transactions belonging to a merchant's canonical cluster — the "all variants" view
 * behind the merchant detail modal. `canonicalName` should come from `merchantCanonicalMap`. */
export function merchantTransactions(txns: Transaction[], canon: Map<string, string>, canonicalName: string): Transaction[] {
  return txns
    .filter(t => isSpend(t) && (canon.get(t.merchantNormalized) ?? t.merchantNormalized) === canonicalName)
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
}

// ---- Recurring / subscription detection (§4.8: merchant + amount + interval clustering) ----

export interface PriceChange { fromAmount: number; toAmount: number; changedAt: string }

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
  priceChange: PriceChange | null;  // most recent step up/down in a non-variable merchant's charge amount
}

/**
 * Detects a step change in a stable (non-variable) merchant's charge amount — e.g. a subscription
 * price increase. Walks back from the most recent charge while it matches, then compares the most
 * recent value against the median of everything before the step; a <5% move isn't reported as a
 * "price change" since that's within normal noise for this merchant.
 */
function detectPriceChange(sorted: Transaction[]): PriceChange | null {
  if (sorted.length < 4) return null;
  const amounts = sorted.map(t => -t.amount);
  const last = amounts[amounts.length - 1];
  let i = amounts.length - 1;
  while (i > 0 && Math.abs(amounts[i - 1] - last) <= Math.max(0.5, last * 0.03)) i--;
  if (i === 0) return null;
  const priorAmounts = amounts.slice(0, i);
  const priorMedian = median(priorAmounts);
  if (priorMedian <= 0.005) return null;
  const diffPct = (last - priorMedian) / priorMedian;
  if (Math.abs(diffPct) < 0.05) return null;
  return { fromAmount: priorMedian, toAmount: last, changedAt: sorted[i].date };
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
      priceChange: variable ? null : detectPriceChange(sorted),
    });
  }
  return out.sort((a, b) => b.monthlyCost - a.monthlyCost);
}

export interface UpcomingCharge {
  merchant: string;
  categoryId: string | null;
  subcategoryId: string | null;
  amount: number;
  date: string;
  cadence: RecurringCharge['cadence'];
}

/** Recurring charges predicted to land within `withinDays` of today, soonest first. */
export function upcomingCharges(recurring: RecurringCharge[], withinDays = 30): UpcomingCharge[] {
  const cutoff = addDaysISO(todayISO(), withinDays);
  return recurring
    .filter(r => r.nextDate <= cutoff)
    .map(r => ({ merchant: r.merchant, categoryId: r.categoryId, subcategoryId: r.subcategoryId, amount: r.avgAmount, date: r.nextDate, cadence: r.cadence }))
    .sort((a, b) => a.date.localeCompare(b.date));
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
  currentShare: number;   // this category's fraction of *total* spend this month (0 when total is 0)
  previousShare: number;  // same, for the prior month
  shareDelta: number;     // currentShare - previousShare, in share points (0.09 = +9pp)
}

/**
 * Month-over-month movement per top-level category, biggest absolute change first.
 * Answers "what changed?" rather than "did I stay under a limit?".
 *
 * `delta`/`pctChange` are dollar-denominated and answer "did this category grow?" — but a month
 * where *everything* went up (a big trip, a slow month elsewhere) moves every category's dollars
 * without changing what your spend actually goes to. `currentShare`/`previousShare`/`shareDelta`
 * answer the complementary question — "did this category take a bigger slice of the pie?" — by
 * normalizing against each month's own total, so it survives an overall spend swing that would
 * otherwise drag every category's dollar delta in the same direction.
 */
export function categoryMovers(txns: Transaction[], categories: Category[], ym: string): CategoryMove[] {
  const prevYm = addMonths(ym, -1);
  const totalCurrent = monthlySpend(txns, ym);
  const totalPrevious = monthlySpend(txns, prevYm);

  return categories
    .filter(c => !c.parentId)
    .map(category => {
      const current = categorySpend(txns, category.id, ym);
      const previous = categorySpend(txns, category.id, prevYm);
      const delta = current - previous;
      const currentShare = totalCurrent > 0.005 ? current / totalCurrent : 0;
      const previousShare = totalPrevious > 0.005 ? previous / totalPrevious : 0;
      return {
        category,
        current,
        previous,
        delta,
        pctChange: previous > 0.005 ? delta / previous : 0,
        isNew: previous <= 0.005 && current > 0.005,
        currentShare,
        previousShare,
        shareDelta: currentShare - previousShare,
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

// ---- Transaction-size distribution (§ recommendation #8) ----

/** Linear-interpolated percentile over an already-ascending-sorted array (p in [0,1]). */
function percentile(sortedAsc: number[], p: number): number {
  if (!sortedAsc.length) return 0;
  const idx = p * (sortedAsc.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}

export interface Distribution {
  count: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  p25: number;
  p75: number;
  /** Transactions above the classic Tukey upper fence (p75 + 1.5×IQR) — a standard, threshold-free
   * definition of "unusually large for this set," biggest first. */
  outliers: Transaction[];
}

const EMPTY_DISTRIBUTION: Distribution = { count: 0, min: 0, max: 0, mean: 0, median: 0, p25: 0, p75: 0, outliers: [] };

/**
 * Spend-size distribution over a set of transactions the caller has already selected (a
 * merchant's history, a category's trips this window, …). Totals answer "how much" — this
 * answers "what does a typical one of these look like, and which ones didn't." Reused as-is for
 * both the merchant detail view and the per-category trip-size panel on Trends, since both are
 * the same statistical question over a different slice of transactions.
 */
export function spendDistribution(txns: Transaction[]): Distribution {
  const withAmt = txns
    .filter(isSpend)
    .map(t => ({ t, amt: spendOf(t) }))
    .filter(x => x.amt > 0.005);
  if (!withAmt.length) return EMPTY_DISTRIBUTION;

  const amounts = withAmt.map(x => x.amt).sort((a, b) => a - b);
  const p25 = percentile(amounts, 0.25);
  const p75 = percentile(amounts, 0.75);
  const upperFence = p75 + 1.5 * (p75 - p25);
  const outliers = withAmt.filter(x => x.amt > upperFence).sort((a, b) => b.amt - a.amt).map(x => x.t);

  return {
    count: amounts.length,
    min: amounts[0],
    max: amounts[amounts.length - 1],
    mean: amounts.reduce((a, b) => a + b, 0) / amounts.length,
    median: median(amounts),
    p25,
    p75,
    outliers,
  };
}

/** True when a transaction (or any of its splits) touches the given category/subcategory —
 * whole-transaction inclusion, not a fractional dollar share, since a "trip" is one event. */
function touchesCategory(t: Transaction, categoryId: string, subcategoryId: string | null): boolean {
  if (subcategoryId) {
    if (t.subcategoryId === subcategoryId) return true;
    return !!t.splits?.some(s => s.subcategoryId === subcategoryId);
  }
  if (t.categoryId === categoryId) return true;
  return !!t.splits?.some(s => s.categoryId === categoryId);
}

/** Every spend transaction in a category (optionally a specific subcategory) from `sinceYM` on —
 * the "trips" `spendDistribution` measures the size of. */
export function txnsInCategoryWindow(txns: Transaction[], categoryId: string, subcategoryId: string | null, sinceYM: string): Transaction[] {
  return txns.filter(t => isSpend(t) && toYM(t.date) >= sinceYM && touchesCategory(t, categoryId, subcategoryId));
}
