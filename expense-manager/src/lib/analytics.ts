import type { Budget, Category, Goal, Transaction } from '../types';
import { addMonths, currentYM, daysInMonth, todayISO, toYM } from './format';

// ---- Aggregations, forecasting, recurring detection (§4.5, §4.8) ----

/** True spending amount for analytics: expenses net of merchant credits; transfers excluded. */
export function isSpend(t: Transaction): boolean {
  return t.flowType === 'expense' || t.flowType === 'merchant_credit';
}

/** Positive number = spend. Merchant credits net against it (they're positive amounts). */
export function spendOf(t: Transaction): number {
  return isSpend(t) ? -t.amount : 0;
}

export function incomeOf(t: Transaction): number {
  return t.flowType === 'income' ? t.amount : 0;
}

export function txnsInMonth(txns: Transaction[], ym: string): Transaction[] {
  return txns.filter(t => toYM(t.date) === ym);
}

export function monthlySpend(txns: Transaction[], ym: string): number {
  return txnsInMonth(txns, ym).reduce((a, t) => a + spendOf(t), 0);
}

export function monthlyIncome(txns: Transaction[], ym: string): number {
  return txnsInMonth(txns, ym).reduce((a, t) => a + incomeOf(t), 0);
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

export interface MonthPoint { ym: string; spend: number; income: number }

export function monthlySeries(txns: Transaction[], months: number, anchorYm?: string): MonthPoint[] {
  const anchor = anchorYm ?? currentYM();
  const out: MonthPoint[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const ym = addMonths(anchor, -i);
    out.push({ ym, spend: monthlySpend(txns, ym), income: monthlyIncome(txns, ym) });
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

// ---- Budget pacing ----

export interface BudgetPace {
  budget: Budget;
  category: Category;
  spent: number;
  projected: number;
  overPace: boolean;
}

export function budgetPacing(budgets: Budget[], txns: Transaction[], categories: Category[], ym: string): BudgetPace[] {
  return budgets
    .map(b => {
      const category = categories.find(c => c.id === b.categoryId);
      if (!category) return null;
      const spent = categorySpend(txns, b.categoryId, ym);
      const { projected } = forecastMonthSpend(txns, ym, b.categoryId);
      return { budget: b, category, spent, projected, overPace: projected > b.monthlyLimit * 1.02 };
    })
    .filter((x): x is BudgetPace => x !== null)
    .sort((a, b) => (b.spent / b.budget.monthlyLimit) - (a.spent / a.budget.monthlyLimit));
}

// ---- Goal feasibility (§4.8) ----

export interface GoalProjection {
  goal: Goal;
  monthsToTarget: number;      // months until target date
  monthsNeeded: number;        // months at current contribution
  feasible: boolean;
  extraMonthlyNeeded: number;  // to hit the date
}

export function projectGoal(goal: Goal): GoalProjection {
  const now = new Date(todayISO());
  const tgt = new Date(goal.targetDate);
  const monthsToTarget = Math.max(0, (tgt.getFullYear() - now.getFullYear()) * 12 + tgt.getMonth() - now.getMonth());
  const remaining = Math.max(0, goal.targetAmount - goal.currentAmount);
  const monthsNeeded = goal.monthlyContribution > 0 ? Math.ceil(remaining / goal.monthlyContribution) : Infinity;
  const feasible = monthsNeeded <= monthsToTarget;
  const extraMonthlyNeeded = feasible || monthsToTarget === 0
    ? 0
    : Math.ceil(remaining / monthsToTarget - goal.monthlyContribution);
  return { goal, monthsToTarget, monthsNeeded, feasible, extraMonthlyNeeded };
}
