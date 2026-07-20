import type { Account, Rule, Transaction } from '../types';
import { matchRules } from './categorize';
import { classifyFlow, findTransferPairs } from './classify';
import { uid } from './format';
import { normalizeMerchant } from './normalize';

// ---- Shared ingest pipeline: normalize → classify flow → categorize (§4.2, §4.2a, §4.4) ----

export interface IngestRow {
  date: string;          // ISO
  merchantRaw: string;
  amount: number;
  accountId: string;
}

/** Offline keyword heuristics — produce medium-confidence guesses that get flagged for review. */
const HEURISTICS: Array<[RegExp, string, string | null, number]> = [
  [/DINER|GRILL|KITCHEN|RESTAURANT|PIZZA|SUSHI|TACO|BBQ|BISTRO|RAMEN|THAI|CANTINA/i, 'food', 'restaurants', 0.62],
  [/COFFEE|ESPRESSO|ROASTER|CAFE/i, 'food', 'coffee', 0.6],
  [/MARKET|GROCER|FOODS/i, 'food', 'groceries', 0.58],
  [/GYM|FITNESS|YOGA|CLIMB|CROSSFIT/i, 'health', 'fitness', 0.6],
  [/PARKING|GARAGE/i, 'transport', 'parking', 0.64],
  [/HOTEL|INN\b|RESORT/i, 'travel', 'lodging', 0.6],
  [/AIRLINE|AIRWAYS/i, 'travel', 'flights', 0.6],
  [/PHARMACY|\bRX\b/i, 'health', 'pharmacy', 0.6],
  [/PADDLE|GUMROAD|LEMON\s*SQUEEZY|FASTSPRING/i, 'subscriptions', 'software', 0.55],
  [/BOOKS|BOOKSTORE/i, 'shopping', null, 0.55],
];

export function heuristicGuess(merchantNorm: string, raw: string): { categoryId: string; subcategoryId: string | null; confidence: number } | null {
  for (const [re, cat, sub, conf] of HEURISTICS) {
    if (re.test(merchantNorm) || re.test(raw)) return { categoryId: cat, subcategoryId: sub, confidence: conf };
  }
  return null;
}

/** Build merchant → category history map from prior expense transactions (for merchant-credit attribution). */
export function merchantHistoryMap(txns: Transaction[]): Map<string, { categoryId: string | null; subcategoryId: string | null }> {
  const map = new Map<string, { categoryId: string | null; subcategoryId: string | null }>();
  for (const t of txns) {
    if (t.amount < 0 && t.flowType === 'expense' && t.categoryId) {
      map.set(t.merchantNormalized.toUpperCase(), { categoryId: t.categoryId, subcategoryId: t.subcategoryId });
    }
  }
  return map;
}

export function ingestRows(
  rows: IngestRow[],
  accounts: Account[],
  rules: Rule[],
  existing: Transaction[],
  batchId: string,
): Transaction[] {
  const history = merchantHistoryMap(existing);
  const out: Transaction[] = [];

  for (const row of rows) {
    const merchantNormalized = normalizeMerchant(row.merchantRaw);
    const flow = classifyFlow(
      { amount: row.amount, merchantRaw: row.merchantRaw, merchantNormalized, accountId: row.accountId },
      accounts,
      history,
    );

    let categoryId: string | null = null;
    let subcategoryId: string | null = null;
    let confidence = 0;
    let source: Transaction['categorizationSource'] = 'none';

    if (flow.flowType === 'transfer') {
      confidence = 1;
      source = 'rule';
    } else if (flow.flowType === 'merchant_credit' && flow.creditCategory?.categoryId) {
      categoryId = flow.creditCategory.categoryId;
      subcategoryId = flow.creditCategory.subcategoryId;
      confidence = 0.9;
      source = 'rule';
    } else {
      const match = matchRules(rules, merchantNormalized, row.merchantRaw);
      if (match) {
        categoryId = match.rule.categoryId;
        subcategoryId = match.rule.subcategoryId;
        confidence = match.confidence;
        source = 'rule';
      } else {
        const guess = heuristicGuess(merchantNormalized, row.merchantRaw);
        if (guess) {
          categoryId = guess.categoryId;
          subcategoryId = guess.subcategoryId;
          confidence = guess.confidence;
          source = 'rule';
        }
      }
    }

    const txn: Transaction = {
      id: uid(),
      date: row.date,
      merchantRaw: row.merchantRaw,
      merchantNormalized,
      amount: row.amount,
      currency: 'USD',
      accountId: row.accountId,
      categoryId,
      subcategoryId,
      confidence,
      categorizationSource: source,
      flowType: flow.flowType,
      transferSubtype: flow.transferSubtype,
      tags: [],
      notes: '',
      importBatchId: batchId,
      reviewed: false,
    };
    out.push(txn);

    // expenses categorized in this batch also become history for later credits in the same batch
    if (txn.amount < 0 && txn.flowType === 'expense' && txn.categoryId) {
      history.set(txn.merchantNormalized.toUpperCase(), { categoryId: txn.categoryId, subcategoryId: txn.subcategoryId });
    }
  }

  // Cross-account transfer pairing across new + existing
  const pairs = findTransferPairs([...existing, ...out], accounts);
  const byId = new Map(out.map(t => [t.id, t]));
  for (const p of pairs) {
    for (const [leg, other] of [[p.a, p.b], [p.b, p.a]] as const) {
      const t = byId.get(leg.id);
      if (t && t.flowType !== 'transfer') {
        t.flowType = 'transfer';
        t.transferSubtype = p.subtype;
        t.categoryId = null;
        t.subcategoryId = null;
        t.confidence = 0.9;
        t.categorizationSource = 'rule';
      }
      if (t) t.linkedTransactionId = other.id;
    }
  }

  return out;
}
