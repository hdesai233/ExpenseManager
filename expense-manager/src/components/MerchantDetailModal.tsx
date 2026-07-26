import { useMemo } from 'react';
import { merchantCanonicalMap, merchantTransactions, spendDistribution, spendOf } from '../lib/analytics';
import { shortDate, usd, usd2 } from '../lib/format';
import { accountName, categoryColor, categoryName, txnCategoryLabel, useStore } from '../store';
import { Modal } from './ui';

// ---- Merchant detail (§ recommendation #6) ----
// Categories have a drill-down (CategoryDrilldownModal in Reports.tsx); merchants didn't. Every
// charge from one merchant over time, clustered variants included (lib/merchantCluster.ts),
// basket-size distribution, frequency, first/last seen, and how its spend maps to categories.

export default function MerchantDetailModal({ canonicalName, onClose }: { canonicalName: string; onClose: () => void }) {
  const { state } = useStore();

  const canon = useMemo(() => merchantCanonicalMap(state.transactions), [state.transactions]);
  const txns = useMemo(() => merchantTransactions(state.transactions, canon, canonicalName), [state.transactions, canon, canonicalName]);
  const variants = useMemo(
    () => [...new Set(txns.map(t => t.merchantNormalized))].filter(v => v !== canonicalName).sort(),
    [txns, canonicalName],
  );
  const dist = useMemo(() => spendDistribution(txns), [txns]);

  // Net every charge against its refunds unconditionally — same convention monthlySpend/
  // spendByCategory use — rather than summing only the positive amounts spendDistribution kept.
  const total = txns.reduce((a, t) => a + spendOf(t), 0);
  const firstDate = txns.length ? txns[txns.length - 1].date : null;
  const lastDate = txns.length ? txns[0].date : null;

  const categoryBreakdown = useMemo(() => {
    const map = new Map<string, { label: string; color: string; amount: number; count: number }>();
    for (const t of txns) {
      const key = t.subcategoryId ?? t.categoryId ?? 'uncategorized';
      const label = txnCategoryLabel(state, t);
      const cur = map.get(key) ?? { label, color: categoryColor(state, t.categoryId), amount: 0, count: 0 };
      cur.amount += spendOf(t);
      cur.count += 1;
      map.set(key, cur);
    }
    return [...map.values()].filter(c => c.amount > 0.005).sort((a, b) => b.amount - a.amount);
  }, [txns, state]);

  return (
    <Modal
      wide
      title={
        <div>
          <div>{canonicalName}</div>
          {variants.length > 0 && (
            <div style={{ fontSize: 11.5, fontWeight: 400, color: 'var(--muted-2)', marginTop: 2 }}>
              Also matched: <span className="mono">{variants.join(', ')}</span>
            </div>
          )}
        </div>
      }
      onClose={onClose}
    >
      {txns.length === 0 ? (
        <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 13, color: 'var(--muted-2)' }}>No transactions found.</div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 18 }}>
            <Stat label="Total spend" value={usd(total)} />
            <Stat label="Charges" value={String(dist.count)} />
            <Stat label="First seen" value={firstDate ? shortDate(firstDate) : '—'} />
            <Stat label="Last seen" value={lastDate ? shortDate(lastDate) : '—'} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 18 }}>
            <div className="card" style={{ padding: '14px 16px' }}>
              <div className="card-title" style={{ fontSize: 13, marginBottom: 10 }}>Basket size</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>
                <span>Median</span><strong style={{ color: 'var(--ink)' }}>{usd2(dist.median)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>
                <span>Typical range</span><span style={{ color: 'var(--ink-3)' }}>{usd2(dist.p25)} – {usd2(dist.p75)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)' }}>
                <span>Min – Max</span><span style={{ color: 'var(--ink-3)' }}>{usd2(dist.min)} – {usd2(dist.max)}</span>
              </div>
              {dist.outliers.length > 0 && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #f2efe8', fontSize: 11.5, color: 'var(--amber-text)' }}>
                  {dist.outliers.length} charge{dist.outliers.length === 1 ? '' : 's'} well above the usual size (over {usd2(dist.p75 + 1.5 * (dist.p75 - dist.p25))})
                </div>
              )}
            </div>

            <div className="card" style={{ padding: '14px 16px' }}>
              <div className="card-title" style={{ fontSize: 13, marginBottom: 10 }}>Category mapping</div>
              {categoryBreakdown.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--muted-2)' }}>No categorized charges.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {categoryBreakdown.slice(0, 4).map(c => (
                    <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="dot" style={{ width: 8, height: 8, background: c.color, flex: 'none' }} />
                      <span className="ellip" style={{ flex: 1, fontSize: 12, color: 'var(--ink-3)' }}>{c.label}</span>
                      <span style={{ fontSize: 11.5, color: 'var(--muted-2)', flex: 'none' }}>{c.count}× · {usd(c.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="card-title" style={{ fontSize: 13, marginBottom: 8 }}>All charges</div>
          <div style={{ border: '1px solid var(--card-border)', borderRadius: 10, overflow: 'auto', maxHeight: 320 }}>
            {txns.slice(0, 200).map(t => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderBottom: '1px solid var(--row-border)' }}>
                <span style={{ fontSize: 11.5, color: 'var(--muted-2)', width: 62, flex: 'none' }}>{shortDate(t.date)}</span>
                <span className="ellip" style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--ink-3)' }}>{categoryName(state, t.subcategoryId ?? t.categoryId)}</span>
                <span style={{ fontSize: 11.5, color: 'var(--muted-2)', flex: 'none' }}>{accountName(state, t.accountId)}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: t.amount > 0 ? 'var(--green-ok)' : 'var(--ink)', flex: 'none', width: 78, textAlign: 'right' }}>
                  {usd2(t.amount)}
                </span>
              </div>
            ))}
            {txns.length > 200 && (
              <div style={{ padding: '8px 14px', fontSize: 11.5, color: 'var(--muted-2)' }}>Showing first 200 of {txns.length.toLocaleString()}.</div>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card" style={{ padding: '12px 14px' }}>
      <div className="kicker">{label}</div>
      <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--ink)', marginTop: 5 }}>{value}</div>
    </div>
  );
}
