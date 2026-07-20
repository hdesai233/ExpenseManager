import type { Rule, Transaction } from '../types';

// ---- Rule-based categorization engine (requirements §4.4) ----

export interface RuleMatch {
  rule: Rule;
  confidence: number;
}

/** Try to match a transaction's merchant against the rule set. User-learned rules win over seeds. */
export function matchRules(rules: Rule[], merchantNormalized: string, merchantRaw: string): RuleMatch | null {
  const norm = merchantNormalized.toUpperCase();
  const raw = merchantRaw.toUpperCase();
  let best: RuleMatch | null = null;

  for (const rule of rules) {
    const pat = rule.merchantPattern.toUpperCase();
    let hit = false;
    switch (rule.matchType) {
      case 'exact':
        hit = norm === pat;
        break;
      case 'contains':
        hit = norm.includes(pat) || raw.includes(pat);
        break;
      case 'regex':
        try { hit = new RegExp(rule.merchantPattern, 'i').test(merchantNormalized) || new RegExp(rule.merchantPattern, 'i').test(merchantRaw); }
        catch { hit = false; }
        break;
    }
    if (!hit) continue;
    const confidence = rule.createdFrom === 'user' ? 0.98 : 0.95;
    if (!best || confidence > best.confidence) best = { rule, confidence };
  }
  return best;
}

/**
 * Create a learned rule from a manual correction (§4.4 step 2).
 * Returns the new/updated rule list.
 */
export function learnRule(rules: Rule[], merchantNormalized: string, categoryId: string, subcategoryId: string | null): Rule[] {
  const existing = rules.find(r => r.matchType === 'exact' && r.merchantPattern.toUpperCase() === merchantNormalized.toUpperCase());
  if (existing) {
    return rules.map(r => r.id === existing.id
      ? { ...r, categoryId, subcategoryId, createdFrom: 'user' as const }
      : r);
  }
  return [...rules, {
    id: 'learned-' + Math.random().toString(36).slice(2, 10),
    merchantPattern: merchantNormalized,
    matchType: 'exact',
    categoryId,
    subcategoryId,
    createdFrom: 'user',
    createdAt: new Date().toISOString(),
  }];
}

/** Threshold below which an auto-categorization is flagged for review. */
export const REVIEW_THRESHOLD = 0.7;

export function needsReview(t: Transaction): boolean {
  if (t.reviewed) return false;
  if (t.flowType === 'transfer') return false;
  if (!t.categoryId) return true;
  return t.confidence < REVIEW_THRESHOLD;
}
