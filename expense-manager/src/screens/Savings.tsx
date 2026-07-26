import { useMemo, useState } from 'react';
import { generateInsights, type SavingsInsight } from '../lib/insights';
import { AI_PROVIDERS, generateSavingsAdvice, modelFor, providerDef } from '../lib/api';
import { isDesktop } from '../lib/persist';
import { currentYM, usd } from '../lib/format';
import { categoryColor, useStore } from '../store';

// ---- Savings: rule-based spending-reduction suggestions, no AI required ----
// Every card here is a re-ranking of a detector the rest of the app already computes (category
// share drift, subscription price changes, category/charge anomalies, spend-distribution
// outliers, merchant frequency) — see lib/insights.ts. The optional "Get AI coaching" action below
// is the only part of this screen that ever sends anything anywhere, and only when the user has
// already turned AI on elsewhere.

const KIND_LABELS: Record<SavingsInsight['kind'], string> = {
  category_share_up: 'Category drift',
  subscription_price_up: 'Price increase',
  unused_subscription: 'Unused subscription',
  category_anomaly: 'Category anomaly',
  unusual_charge: 'Unusual charge',
  distribution_outliers: 'Large purchases',
  frequency_increase: 'Visiting more often',
};

export default function Savings() {
  const { state } = useStore();
  const ym = currentYM();
  const insights = useMemo(
    () => generateInsights(state.transactions, state.categories, ym),
    [state.transactions, state.categories, ym],
  );

  const recurringTotal = insights.filter(i => i.recurring).reduce((a, i) => a + i.potentialSavings, 0);
  const oneTimeTotal = insights.filter(i => !i.recurring).reduce((a, i) => a + i.potentialSavings, 0);

  const provider = state.settings.aiProvider;
  const providerInfo = providerDef(provider);
  const activeModel = modelFor(provider, state.settings.aiModels);
  const aiOn = isDesktop && state.settings.apiFallbackEnabled;

  const [advice, setAdvice] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getAdvice = async () => {
    if (!window.ledgerApi) return;
    setLoading(true); setError(null); setAdvice(null);
    try {
      const apiKey = await window.ledgerApi.secretsGetApiKeyForUse(provider);
      if (!apiKey) { setError(`No ${providerInfo.label} API key set — add one in Settings.`); return; }
      const result = await generateSavingsAdvice(provider, apiKey, insights, activeModel);
      setAdvice(result);
    } catch (e) {
      setError(`${providerInfo.label} call failed: ` + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page">
      <div style={{ marginBottom: 18 }}>
        <div className="page-title">Savings</div>
        <div className="page-sub">Where your spending has room to give — computed entirely on this device, no AI required.</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 18 }}>
        <div className="card" style={{ padding: '16px 17px' }}>
          <div className="kicker">Opportunities found</div>
          <div className="big-num" style={{ margin: '9px 0 3px' }}>{insights.length}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>this month</div>
        </div>
        <div className="card" style={{ padding: '16px 17px' }}>
          <div className="kicker">Recurring, monthly</div>
          <div className="big-num" style={{ margin: '9px 0 3px', color: 'var(--green-ok)' }}>{usd(recurringTotal)}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>saved every month if addressed</div>
        </div>
        <div className="card" style={{ padding: '16px 17px' }}>
          <div className="kicker">One-time, this period</div>
          <div className="big-num" style={{ margin: '9px 0 3px' }}>{usd(oneTimeTotal)}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>historical overspend flagged</div>
        </div>
      </div>

      {insights.length === 0 ? (
        <div className="card" style={{ padding: '40px 22px', textAlign: 'center', fontSize: 13, color: 'var(--muted-2)', marginBottom: 18 }}>
          Nothing stands out this month — nice.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 18 }}>
          {insights.map((ins, i) => (
            <div key={i} className="card" style={{ padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
                    {ins.categoryId && <span className="dot" style={{ width: 8, height: 8, background: categoryColor(state, ins.categoryId), flex: 'none' }} />}
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-2)' }}>{ins.title}</span>
                    <span className="tag-badge" style={{ color: 'var(--muted)', background: 'var(--soft)' }}>{KIND_LABELS[ins.kind]}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted-2)', lineHeight: 1.5 }}>{ins.detail}</div>
                </div>
                <div style={{ textAlign: 'right', flex: 'none' }}>
                  <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--green-ok)' }}>{usd(ins.potentialSavings)}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--muted-3)', textTransform: 'uppercase', letterSpacing: '.03em' }}>
                    {ins.recurring ? 'per month' : 'one-time'}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card" style={{ padding: '20px 22px' }}>
        <div className="card-title" style={{ fontSize: 15, marginBottom: 4 }}>Get personalized coaching</div>
        <div style={{ fontSize: 11.5, color: 'var(--muted-2)', marginBottom: 14 }}>
          Sends the {insights.length} insight{insights.length === 1 ? '' : 's'} above — titles and
          numbers only, never a transaction, date, or account — to {providerInfo.label} to turn
          into a short set of written suggestions.
        </div>
        {!aiOn ? (
          <div style={{ padding: '16px 18px', textAlign: 'center', fontSize: 13, color: 'var(--muted-2)', background: 'var(--soft)', borderRadius: 10, border: '1px solid var(--soft-border)' }}>
            {!isDesktop
              ? 'This requires the desktop app — API keys are stored in your OS keychain, not available in this browser preview.'
              : <>This reuses the AI categorization key. Enable "AI categorization" in Settings and add a{' '}
                  {AI_PROVIDERS.map(p => p.label).join(' or ')} API key to use it.</>}
          </div>
        ) : (
          <>
            <button className="btn" disabled={loading || insights.length === 0} onClick={getAdvice}>
              {loading ? 'Asking…' : 'Get AI coaching'}
            </button>
            {insights.length === 0 && <div style={{ fontSize: 11.5, color: 'var(--muted-2)', marginTop: 8 }}>Nothing to coach on yet — no opportunities found this month.</div>}
            {error && <div style={{ fontSize: 12.5, color: 'var(--red)', marginTop: 12 }}>{error}</div>}
            {advice && (
              <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {advice.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: 'var(--muted-2)' }}>No suggestions came back — try again in a moment.</div>
                ) : advice.map((a, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, padding: '11px 14px', background: '#f2f7f4', border: '1px solid #cfe3d8', borderRadius: 10 }}>
                    <span style={{ color: 'var(--green)', fontWeight: 700, flex: 'none' }}>{i + 1}.</span>
                    <span style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.5 }}>{a}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
