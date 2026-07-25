import type { Account, Transaction } from '../types';

// ---- Transaction type classification: purchases vs. returns vs. card payments/transfers (§4.2a) ----

const PAYMENT_PATTERNS = [
  /PAYMENT\s*THANK\s*YOU/i,
  /AUTOPAY/i,
  /ONLINE\s*PMT/i,
  /ONLINE\s*PAYMENT/i,
  /CARD\s*PAYMENT/i,
  /E-?PAYMENT/i,
  /CRCARDPMT/i,
  /EPAY/i,
  /BILL\s*PAY.*CARD/i,
  /MOBILE\s*PAYMENT/i,
  /PYMT/i,
];

const TRANSFER_PATTERNS = [
  /ONLINE\s*TRANSFER/i,
  /TRANSFER\s*(TO|FROM)/i,
  /XFER/i,
  /ZELLE\s*(TO|FROM)?\s*SELF/i,
  /INTERNAL\s*TRANSFER/i,
];

const REFUND_PATTERNS = [/REFUND/i, /RETURN/i, /CREDIT\s*MEMO/i, /REVERSAL/i];

export function looksLikeCardPayment(raw: string, bankNames: string[]): boolean {
  if (PAYMENT_PATTERNS.some(re => re.test(raw))) return true;
  // "[BANK NAME] ... PAYMENT" phrasing (needs issuing banks from account setup)
  const upper = raw.toUpperCase();
  return bankNames.some(b => b && upper.includes(b.toUpperCase()) && /PAY|PMT/i.test(raw));
}

export function looksLikeInternalTransfer(raw: string): boolean {
  return TRANSFER_PATTERNS.some(re => re.test(raw));
}

export function looksLikeRefund(raw: string): boolean {
  return REFUND_PATTERNS.some(re => re.test(raw));
}

export interface SuggestedPair {
  a: Transaction;   // debit leg (checking/savings)
  b: Transaction;   // credit leg (credit card)
  subtype: 'credit_card_payment' | 'internal_transfer';
}

/**
 * Cross-account matching (§4.2a detection preference 1):
 * a debit on checking/savings + a credit on a credit card, near-equal absolute
 * amount, within ±3 days.
 */
export function findTransferPairs(txns: Transaction[], accounts: Account[]): SuggestedPair[] {
  const acct = (id: string) => accounts.find(a => a.id === id);
  const pairs: SuggestedPair[] = [];
  const used = new Set<string>();

  const debits = txns.filter(t => t.amount < 0 && acct(t.accountId)?.accountType !== 'credit_card');
  const credits = txns.filter(t => t.amount > 0);

  for (const d of debits) {
    if (used.has(d.id)) continue;
    for (const c of credits) {
      if (used.has(c.id) || c.accountId === d.accountId) continue;
      const amountClose = Math.abs(Math.abs(d.amount) - c.amount) < 0.05;
      if (!amountClose) continue;
      const dayDiff = Math.abs(new Date(d.date).getTime() - new Date(c.date).getTime()) / 86400000;
      if (dayDiff > 3) continue;
      const cAcct = acct(c.accountId);
      const subtype = cAcct?.accountType === 'credit_card' ? 'credit_card_payment' as const : 'internal_transfer' as const;
      pairs.push({ a: d, b: c, subtype });
      used.add(d.id);
      used.add(c.id);
      break;
    }
  }
  return pairs;
}

/**
 * Classify flow type for one transaction using description patterns + merchant history.
 * `merchantHistory` maps normalized merchant (upper) → categoryId with past expense history.
 */
export function classifyFlow(
  t: { amount: number; merchantRaw: string; merchantNormalized: string; accountId: string },
  accounts: Account[],
  merchantHistory: Map<string, { categoryId: string | null; subcategoryId: string | null }>,
): { flowType: Transaction['flowType']; transferSubtype?: Transaction['transferSubtype']; creditCategory?: { categoryId: string | null; subcategoryId: string | null } } {
  const bankNames = accounts.map(a => a.issuingBank).filter(Boolean);
  const account = accounts.find(a => a.id === t.accountId);

  // Transfers first — either sign
  if (looksLikeInternalTransfer(t.merchantRaw)) {
    return { flowType: 'transfer', transferSubtype: 'internal_transfer' };
  }
  if (looksLikeCardPayment(t.merchantRaw, bankNames)) {
    return { flowType: 'transfer', transferSubtype: 'credit_card_payment' };
  }

  if (t.amount <= 0) return { flowType: 'expense' };

  // Positive amount on a credit card that isn't a payment → merchant credit (refund/return),
  // which nets against spend in that category.
  const hist = merchantHistory.get(t.merchantNormalized.toUpperCase());
  if (hist || looksLikeRefund(t.merchantRaw)) {
    return { flowType: 'merchant_credit', creditCategory: hist ?? { categoryId: null, subcategoryId: null } };
  }
  if (account?.accountType === 'credit_card') {
    // Unrecognized credit on a card — treat as merchant credit, leave for categorization pipeline
    return { flowType: 'merchant_credit', creditCategory: { categoryId: null, subcategoryId: null } };
  }
  // A positive amount on a non-card account (this app imports card statements, so this is rare):
  // there's no income concept to file it under, and guessing "refund" would wrongly reduce spend.
  // Park it as a transfer, which is excluded from spend entirely.
  return { flowType: 'transfer', transferSubtype: 'internal_transfer' };
}
