import { useState } from 'react';
import { detectRecurring, fixedVsVariableSpend, upcomingCharges } from '../lib/analytics';
import { currentYM, shortDate, usd, usd2 } from '../lib/format';
import { categoryColor, useStore } from '../store';

export default function Subscriptions() {
  const { state, dispatch } = useStore();
  const [showDismissed, setShowDismissed] = useState(false);
  const dismissed = state.settings.dismissedSubscriptions;

  const allDetected = detectRecurring(state.transactions);
  const recurring = allDetected.filter(s => !dismissed.includes(s.merchant));
  const monthlyTotal = recurring.reduce((a, r) => a + r.monthlyCost, 0);

  const recurringMerchants = new Set(recurring.map(r => r.merchant));
  const split = fixedVsVariableSpend(state.transactions, currentYM(), recurringMerchants);
  const upcoming = upcomingCharges(recurring, 30);
  const upcomingTotal = upcoming.reduce((a, u) => a + u.amount, 0);

  const cols = '1fr 140px 120px 120px 120px 34px';

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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 18 }}>
        <div style={{ background: '#fff', border: '1px solid var(--card-border)', borderRadius: 14, padding: '14px 16px' }}>
          <div className="kicker">Fixed spend this month</div>
          <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--ink)', margin: '5px 0 2px' }}>{usd(split.fixed)}</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted-2)' }}>{Math.round(split.fixedPct * 100)}% of this month's spend</div>
        </div>
        <div style={{ background: '#fff', border: '1px solid var(--card-border)', borderRadius: 14, padding: '14px 16px' }}>
          <div className="kicker">Variable spend this month</div>
          <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--ink)', margin: '5px 0 2px' }}>{usd(split.variable)}</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted-2)' }}>Everything outside recurring merchants</div>
        </div>
        <div style={{ background: '#fff', border: '1px solid var(--card-border)', borderRadius: 14, padding: '14px 16px' }}>
          <div className="kicker">Due in next 30 days</div>
          <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--ink)', margin: '5px 0 2px' }}>{usd(upcomingTotal)}</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted-2)' }}>{upcoming.length} charge{upcoming.length === 1 ? '' : 's'} coming up</div>
        </div>
      </div>

      <div style={{ background: '#fff', border: '1px solid var(--card-border)', borderRadius: 14, overflow: 'hidden' }}>
        <div className="thead" style={{ display: 'grid', gridTemplateColumns: cols, padding: '11px 20px' }}>
          <div>Service</div><div>Cadence</div><div>Next charge</div><div style={{ textAlign: 'right' }}>Monthly</div><div style={{ textAlign: 'right' }}>Per year</div><div />
        </div>
        {recurring.length === 0 && (
          <div style={{ padding: '28px 20px', textAlign: 'center', fontSize: 13, color: 'var(--muted-2)' }}>
            {allDetected.length > 0
              ? "Nothing left — everything detected has been marked \"not a subscription.\""
              : 'No recurring charges detected yet — import a few months of history so patterns can emerge.'}
          </div>
        )}
        {recurring.map(s => (
          <div key={s.merchant} className="hover-row" style={{ display: 'grid', gridTemplateColumns: cols, padding: '13px 20px', borderBottom: '1px solid var(--row-border)', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <span className="dot" style={{ width: 9, height: 9, background: categoryColor(state, s.categoryId) }} />
              <span className="ellip" style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink-2)' }}>{s.merchant}</span>
              {s.unused && <span className="tag-badge" style={{ color: 'var(--amber)', background: 'var(--amber-bg)' }}>UNUSED 60D?</span>}
              {s.variable && <span className="tag-badge" style={{ color: 'var(--blue)', background: 'var(--blue-bg)' }}>VARIABLE</span>}
              {s.priceChange && (
                <span
                  className="tag-badge"
                  title={`${shortDate(s.priceChange.changedAt)}: ${usd2(s.priceChange.fromAmount)} → ${usd2(s.priceChange.toAmount)}`}
                  style={{ color: s.priceChange.toAmount > s.priceChange.fromAmount ? 'var(--red)' : 'var(--green-conf)', background: s.priceChange.toAmount > s.priceChange.fromAmount ? 'var(--red-bg)' : 'var(--green-bg)' }}
                >
                  {s.priceChange.toAmount > s.priceChange.fromAmount ? '▲' : '▼'} {usd2(s.priceChange.fromAmount)}→{usd2(s.priceChange.toAmount)}
                </span>
              )}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'capitalize' }}>
              {s.cadence}{s.variable ? ' · variable' : ''}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{shortDate(s.nextDate)}</div>
            <div style={{ textAlign: 'right', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{usd2(s.monthlyCost)}/mo</div>
            <div style={{ textAlign: 'right', fontSize: 13, color: '#6b6862' }}>{usd(s.monthlyCost * 12)}</div>
            <div style={{ textAlign: 'right' }}>
              <button
                title="Not a subscription — remove from this list"
                onClick={() => dispatch({ type: 'dismissSubscription', merchant: s.merchant })}
                style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--muted-2)', fontSize: 16, lineHeight: 1, padding: 4 }}
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>
      {recurring.length > 0 && (
        <div style={{ fontSize: 11.5, color: 'var(--muted-2)', marginTop: 12 }}>
          Detected by clustering merchant + amount + interval (weekly / monthly / annual) — variable-amount bills like utilities are caught too.
          Not actually a subscription? Click the × to remove it from this list.
        </div>
      )}

      {upcoming.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 8 }}>Upcoming charges (next 30 days)</div>
          <div style={{ background: '#fff', border: '1px solid var(--card-border)', borderRadius: 14, overflow: 'hidden' }}>
            {upcoming.map((u, i) => (
              <div key={u.merchant + i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 20px', borderBottom: '1px solid var(--row-border)' }}>
                <span className="dot" style={{ width: 9, height: 9, background: categoryColor(state, u.categoryId) }} />
                <span className="ellip" style={{ flex: 1, fontSize: 13, color: 'var(--ink-2)' }}>{u.merchant}</span>
                <span style={{ fontSize: 12, color: 'var(--muted-2)', width: 90 }}>{shortDate(u.date)}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', width: 80, textAlign: 'right' }}>{usd2(u.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {dismissed.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <button className="link-sm" onClick={() => setShowDismissed(v => !v)}>
            {showDismissed ? 'Hide' : 'Show'} not-a-subscription list ({dismissed.length})
          </button>
          {showDismissed && (
            <div style={{ background: '#fff', border: '1px solid var(--card-border)', borderRadius: 14, marginTop: 10, overflow: 'hidden' }}>
              {dismissed.map(merchant => (
                <div key={merchant} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 20px', borderBottom: '1px solid var(--row-border)' }}>
                  <span className="ellip" style={{ flex: 1, fontSize: 13, color: 'var(--ink-3)' }}>{merchant}</span>
                  <button className="link-sm" onClick={() => dispatch({ type: 'restoreSubscription', merchant })}>
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
