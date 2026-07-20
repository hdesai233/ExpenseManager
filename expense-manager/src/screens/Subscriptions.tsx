import { detectRecurring } from '../lib/analytics';
import { shortDate, usd, usd2 } from '../lib/format';
import { categoryColor, useStore } from '../store';

export default function Subscriptions() {
  const { state } = useStore();
  const recurring = detectRecurring(state.transactions);
  const monthlyTotal = recurring.reduce((a, r) => a + r.monthlyCost, 0);

  const cols = '1fr 140px 120px 120px 120px';

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 18 }}>
        <div>
          <div className="page-title">Subscriptions</div>
          <div className="page-sub">
            {recurring.length} recurring charges detected · {usd2(monthlyTotal)}/mo
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: 'var(--muted-2)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600 }}>Annualized</div>
          <div style={{ fontSize: 24, fontWeight: 300, color: 'var(--ink)' }}>{usd(monthlyTotal * 12)}</div>
        </div>
      </div>

      <div style={{ background: '#fff', border: '1px solid var(--card-border)', borderRadius: 14, overflow: 'hidden' }}>
        <div className="thead" style={{ display: 'grid', gridTemplateColumns: cols, padding: '11px 20px' }}>
          <div>Service</div><div>Cadence</div><div>Next charge</div><div style={{ textAlign: 'right' }}>Monthly</div><div style={{ textAlign: 'right' }}>Per year</div>
        </div>
        {recurring.length === 0 && (
          <div style={{ padding: '28px 20px', textAlign: 'center', fontSize: 13, color: 'var(--muted-2)' }}>
            No recurring charges detected yet — import a few months of history so patterns can emerge.
          </div>
        )}
        {recurring.map(s => (
          <div key={s.merchant} style={{ display: 'grid', gridTemplateColumns: cols, padding: '13px 20px', borderBottom: '1px solid var(--row-border)', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <span className="dot" style={{ width: 9, height: 9, background: categoryColor(state, s.categoryId) }} />
              <span className="ellip" style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink-2)' }}>{s.merchant}</span>
              {s.unused && <span className="tag-badge" style={{ color: 'var(--amber)', background: 'var(--amber-bg)' }}>UNUSED 60D?</span>}
              {s.variable && <span className="tag-badge" style={{ color: 'var(--blue)', background: 'var(--blue-bg)' }}>VARIABLE</span>}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'capitalize' }}>
              {s.cadence}{s.variable ? ' · variable' : ''}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{shortDate(s.nextDate)}</div>
            <div style={{ textAlign: 'right', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{usd2(s.monthlyCost)}/mo</div>
            <div style={{ textAlign: 'right', fontSize: 13, color: '#6b6862' }}>{usd(s.monthlyCost * 12)}</div>
          </div>
        ))}
      </div>
      {recurring.length > 0 && (
        <div style={{ fontSize: 11.5, color: 'var(--muted-2)', marginTop: 12 }}>
          Detected by clustering merchant + amount + interval (weekly / monthly / annual) — variable-amount bills like utilities are caught too.
        </div>
      )}
    </div>
  );
}
