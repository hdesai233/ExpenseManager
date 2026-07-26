import type { Category, Transaction } from '../types';
import {
  categoryAnomalies, categorySpend, detectRecurring, merchantTrends, monthlySpend,
  spendDistribution, txnsInCategoryWindow, txnsInMonth, unusualCharges,
} from './analytics';
import { addMonths } from './format';

// ---- Rule-based savings insights — no AI, no ML model (§ "add intelligence to reduce expenses") ----
// Every insight here is a re-ranking of a detector analytics.ts already computes elsewhere in the
// app (category drift, subscription price changes, category/charge anomalies, spend distribution
// outliers, merchant frequency) into a single "here's where to cut back" list with a dollar
// estimate attached. There's no new pattern-detection logic and nothing leaves the device to
// produce this list — see lib/api.ts's generateSavingsAdvice for the optional, opt-in layer that
// asks an LLM to turn these into a written suggestion, which is the only part of this feature that
// ever sends anything anywhere.

export type InsightKind =
  | 'category_share_up'
  | 'subscription_price_up'
  | 'unused_subscription'
  | 'category_anomaly'
  | 'unusual_charge'
  | 'distribution_outliers'
  | 'frequency_increase';

export interface SavingsInsight {
  kind: InsightKind;
  title: string;
  detail: string;
  /** Dollar estimate of what addressing this would save. */
  potentialSavings: number;
  /**
   * true = an ongoing monthly cost if left unaddressed (a subscription, a category that's
   * permanently taking a bigger slice of spend) — these compound every month it's left alone.
   * false = a one-time or historical signal (a specific overpriced charge, an unusually large
   * batch of purchases this month, a 3-month frequency comparison) — real money, but not an
   * ongoing monthly rate, so it shouldn't be added into a "per month" total.
   */
  recurring: boolean;
  categoryId: string | null;
  merchant: string | null;
}

const MIN_SAVINGS = 4; // below this, not worth a card — noise, not a lever

/**
 * Computes and ranks savings opportunities for `ym`, purely from transactions already imported.
 * Every number shown is directly traceable to a detector already used elsewhere in the app
 * (Trends' category anomalies/unusual charges, Subscriptions' price-change badge, Analytics'
 * merchant trend arrows, Trends' spend-distribution outliers) — this just collects and ranks them.
 */
export function generateInsights(txns: Transaction[], categories: Category[], ym: string): SavingsInsight[] {
  const out: SavingsInsight[] = [];
  const totalCurrent = monthlySpend(txns, ym);
  const monthTxns = txnsInMonth(txns, ym);

  // ---- category taking a growing share of total spend ----
  // Computed directly (not via categoryMovers) on purpose: categoryMovers filters out anything
  // whose *dollar* delta is ~0, which would silently hide exactly the case this insight exists to
  // catch — a category whose own spend held flat while its share climbed because everything else
  // fell faster. That's still "this category now dominates more of your spending," just not a
  // dollar-driven story, so it needs its own unfiltered pass over categorySpend/monthlySpend.
  const prevYm = addMonths(ym, -1);
  const totalPrevious = monthlySpend(txns, prevYm);
  for (const category of categories.filter(c => !c.parentId)) {
    const current = categorySpend(txns, category.id, ym);
    const previous = categorySpend(txns, category.id, prevYm);
    if (previous <= 0.005 || current < 20) continue; // no baseline share to compare against, or too small to matter
    const currentShare = totalCurrent > 0.005 ? current / totalCurrent : 0;
    const previousShare = totalPrevious > 0.005 ? previous / totalPrevious : 0;
    const shareDelta = currentShare - previousShare;
    if (shareDelta <= 0.03) continue;
    const potentialSavings = shareDelta * totalCurrent;
    if (potentialSavings < MIN_SAVINGS) continue;
    out.push({
      kind: 'category_share_up',
      title: `${category.name} is taking a bigger share of your spend`,
      detail: `${Math.round(previousShare * 100)}% → ${Math.round(currentShare * 100)}% of total spend this month (${signed(current - previous)} in dollars). Holding it to its old share would have saved about ${money(potentialSavings)}.`,
      potentialSavings,
      recurring: true,
      categoryId: category.id,
      merchant: null,
    });
  }

  // ---- subscriptions / recurring charges that got more expensive ----
  const recurring = detectRecurring(txns);
  for (const r of recurring) {
    if (!r.priceChange || r.priceChange.toAmount <= r.priceChange.fromAmount) continue;
    const potentialSavings = r.priceChange.toAmount - r.priceChange.fromAmount;
    if (potentialSavings < MIN_SAVINGS) continue;
    out.push({
      kind: 'subscription_price_up',
      title: `${r.merchant} got more expensive`,
      detail: `Went from ${money(r.priceChange.fromAmount)} to ${money(r.priceChange.toAmount)} per charge as of ${r.priceChange.changedAt}. Worth checking if you're still getting the same thing for it.`,
      potentialSavings,
      recurring: true,
      categoryId: r.categoryId,
      merchant: r.merchant,
    });
  }

  // ---- recurring charges that look forgotten ----
  for (const r of recurring) {
    if (!r.unused || r.monthlyCost < MIN_SAVINGS) continue;
    out.push({
      kind: 'unused_subscription',
      title: `${r.merchant} hasn't been used in a while`,
      detail: `Still costing ${money(r.monthlyCost)}/mo, but no charge in over 60 days beyond its usual ${r.cadence} cadence — the kind of thing that's easy to forget you're paying for.`,
      potentialSavings: r.monthlyCost,
      recurring: true,
      categoryId: r.categoryId,
      merchant: r.merchant,
    });
  }

  // ---- categories running well above their own 6-month history ----
  for (const a of categoryAnomalies(txns, categories, ym)) {
    const potentialSavings = a.amount - a.typicalAmount;
    if (potentialSavings < MIN_SAVINGS) continue;
    out.push({
      kind: 'category_anomaly',
      title: `${a.category.name} is running ${a.ratio.toFixed(1)}× above usual this month`,
      detail: `${money(a.amount)} so far vs. a typical ${money(a.typicalAmount)} (median of the last ${a.monthsCompared} months). About ${money(potentialSavings)} above your normal pace.`,
      potentialSavings,
      recurring: false,
      categoryId: a.category.id,
      merchant: null,
    });
  }

  // ---- specific charges well above what that merchant normally costs ----
  for (const o of unusualCharges(txns, ym)) {
    const amt = -o.txn.amount;
    const potentialSavings = amt - o.merchantMedian;
    if (potentialSavings < MIN_SAVINGS) continue;
    out.push({
      kind: 'unusual_charge',
      title: `${o.txn.merchantNormalized} charged ${o.ratio.toFixed(1)}× more than usual`,
      detail: `${money(amt)} on ${o.txn.date} vs. a typical ${money(o.merchantMedian)} from this merchant — about ${money(potentialSavings)} more than expected for one charge.`,
      potentialSavings,
      recurring: false,
      categoryId: o.txn.categoryId,
      merchant: o.txn.merchantNormalized,
    });
  }

  // ---- a category with several unusually large trips this month ----
  for (const category of categories.filter(c => !c.parentId)) {
    const dist = spendDistribution(txnsInCategoryWindow(monthTxns, category.id, null, ym));
    if (dist.outliers.length < 2) continue;
    const potentialSavings = dist.outliers.reduce((a, t) => a + (-t.amount - dist.median), 0);
    if (potentialSavings < MIN_SAVINGS) continue;
    out.push({
      kind: 'distribution_outliers',
      title: `${dist.outliers.length} unusually large ${category.name} purchases this month`,
      detail: `Your typical ${category.name} charge is ${money(dist.median)}, but ${dist.outliers.length} of them this month were well above that — about ${money(potentialSavings)} more than a typical batch that size would cost.`,
      potentialSavings,
      recurring: false,
      categoryId: category.id,
      merchant: null,
    });
  }

  // ---- visiting a merchant notably more often than the prior 3-month window ----
  for (const t of merchantTrends(txns, ym, 3)) {
    // priorCount === 0 means this merchant is brand new this window, not visited "more often" —
    // that's a different, less actionable story (already covered by category_anomaly/distribution
    // outliers if the spend itself is unusual) than an established habit that intensified.
    if (t.countDelta < 2 || t.amountDelta <= 0 || t.priorCount === 0) continue;
    if (t.amountDelta < MIN_SAVINGS) continue;
    out.push({
      kind: 'frequency_increase',
      title: `Visiting ${t.name} a lot more often`,
      detail: `${t.recentCount}× in the last 3 months vs. ${t.priorCount}× before — ${signed(t.amountDelta)} over that window. Not necessarily a problem, just a habit shift worth noticing.`,
      potentialSavings: t.amountDelta,
      recurring: false,
      categoryId: t.categoryId,
      merchant: t.name,
    });
  }

  return out.sort((a, b) => b.potentialSavings - a.potentialSavings);
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

function signed(n: number): string {
  return `${n > 0 ? '+' : ''}${money(n)}`;
}
