// ---- Local fuzzy merchant clustering — no AI, no network (§ recommendation #10) ----
// normalize.ts's regex list unifies the merchants it knows about; this catches variants it
// doesn't ("Coffee Bar" vs "Coffee Bar Downtown" vs "The Coffee Bar Roastery") by clustering
// merchantNormalized strings that are close enough to plausibly be the same place, entirely
// on-device. Used to derive a *display/aggregation* identity for merchant-level analytics — it
// never rewrites `Transaction.merchantNormalized` itself, so rules, learned categorization, and
// subscription dismissal (all keyed on the stored name) are completely unaffected.

function trigrams(s: string): Set<string> {
  const padded = `  ${s}  `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  return out;
}

function trigramSimilarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const g of ta) if (tb.has(g)) shared++;
  return shared / (ta.size + tb.size - shared); // Jaccard
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j], cur[j - 1], prev[j - 1]);
    }
    prev = cur;
  }
  return prev[n];
}

function levenshteinRatio(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

/** Lowercase, alphanumeric-only (spaces collapsed) — punctuation/case shouldn't affect matching. */
function fold(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

/** True when `short` appears inside `long` at word boundaries — "coffee bar" inside "the coffee
 * bar downtown", but not "art" inside "kmart". Both inputs must already be `fold`ed. */
function containsWholeWord(long: string, short: string): boolean {
  return ` ${long} `.includes(` ${short} `);
}

const TRIGRAM_THRESHOLD = 0.5;
const LEVENSHTEIN_THRESHOLD = 0.55;
const MIN_LENGTH = 4;       // below this, short names collide too easily (e.g. "CVS" vs "CVX")
const MIN_LENGTH_RATIO = 0.5; // guards against merging "Coffee Bar" into "Coffee Bar Roastery Downtown Oakland"

/**
 * Two names are considered the same merchant only when *both* similarity metrics clear their
 * threshold — trigram overlap alone can be fooled by short/common substrings, edit-distance
 * alone can be fooled by transpositions; requiring both cuts the false-merge rate substantially
 * versus either one alone, since a false positive on one axis rarely repeats on the other.
 */
function isSameMerchant(a: string, b: string): boolean {
  const fa = fold(a);
  const fb = fold(b);
  if (fa === fb) return true;
  const shorter = Math.min(fa.length, fb.length);
  const longer = Math.max(fa.length, fb.length);
  if (shorter < MIN_LENGTH || longer === 0) return false;
  if (shorter / longer < MIN_LENGTH_RATIO) return false;
  // A whole-word containment ("coffee bar" inside "the coffee bar downtown") is a strong,
  // low-false-positive signal for a brand+prefix/suffix variant that plain trigram/edit-distance
  // similarity under-scores, since it penalizes the length difference between the two strings.
  if (containsWholeWord(fa, fb) || containsWholeWord(fb, fa)) return true;
  return trigramSimilarity(fa, fb) >= TRIGRAM_THRESHOLD && levenshteinRatio(fa, fb) >= LEVENSHTEIN_THRESHOLD;
}

class UnionFind {
  private parent = new Map<string, string>();
  add(x: string) { if (!this.parent.has(x)) this.parent.set(x, x); }
  find(x: string): string {
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    let cur = x;
    while (this.parent.get(cur) !== root) { const next = this.parent.get(cur)!; this.parent.set(cur, root); cur = next; }
    return root;
  }
  union(a: string, b: string) {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

/**
 * Clusters merchant names that are likely the same real-world merchant, using only local string
 * similarity (no AI, no network). `counts` should be each distinct `merchantNormalized` value
 * mapped to how many transactions used it — used to pick the most-frequent variant as each
 * cluster's canonical display name. Returns a map from every input name to its canonical name
 * (a name with no cluster-mate maps to itself).
 */
export function clusterMerchants(counts: Map<string, number>): Map<string, string> {
  const names = [...counts.keys()];
  const uf = new UnionFind();
  for (const n of names) uf.add(n);

  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      if (isSameMerchant(names[i], names[j])) uf.union(names[i], names[j]);
    }
  }

  const groups = new Map<string, string[]>();
  for (const n of names) {
    const root = uf.find(n);
    const arr = groups.get(root);
    if (arr) arr.push(n); else groups.set(root, [n]);
  }

  const canonical = new Map<string, string>();
  for (const members of groups.values()) {
    const best = [...members].sort((a, b) =>
      (counts.get(b)! - counts.get(a)!) || (a.length - b.length) || a.localeCompare(b),
    )[0];
    for (const m of members) canonical.set(m, best);
  }
  return canonical;
}
