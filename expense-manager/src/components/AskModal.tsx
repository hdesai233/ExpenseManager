import { useState } from 'react';
import { AI_PROVIDERS, modelFor, providerDef, queryToFilterSpec } from '../lib/api';
import { applyFilterSpec, type FilterResult } from '../lib/nlquery';
import { shortDate, signedUsd2, usd2 } from '../lib/format';
import { isDesktop } from '../lib/persist';
import { accountName, categoryColor, txnCategoryLabel, useStore } from '../store';
import type { AppData } from '../types';
import { Modal } from './ui';

// ---- Natural-language spending queries (§ "recommendation #11") ----
// The question is sent to the configured AI provider only to be translated into a FilterSpec
// (lib/nlquery.ts) — matching that spec against real transactions happens entirely on this
// device via applyFilterSpec, so the answer and the underlying data never leave it. Reuses the
// same opt-in API key as AI categorization; there is no separate toggle for this feature.

const EXAMPLES = [
  'How much did I spend on coffee last month?',
  'Restaurant charges over $50 in the last 90 days',
  'How many times did I use DoorDash this year?',
  'What was my average Amazon purchase last month?',
];

export default function AskModal({ onClose }: { onClose: () => void }) {
  const { state } = useStore();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ intent: string; r: FilterResult } | null>(null);

  const provider = state.settings.aiProvider;
  const providerInfo = providerDef(provider);
  const activeModel = modelFor(provider, state.settings.aiModels);
  const aiOn = isDesktop && state.settings.apiFallbackEnabled;

  const ask = async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || !window.ledgerApi) return;
    setLoading(true); setError(null); setResult(null);
    try {
      const apiKey = await window.ledgerApi.secretsGetApiKeyForUse(provider);
      if (!apiKey) { setError(`No ${providerInfo.label} API key set — add one in Settings.`); return; }
      const spec = await queryToFilterSpec(provider, apiKey, trimmed, state.categories, state.accounts, activeModel);
      setResult({ intent: spec.intent, r: applyFilterSpec(spec, state.transactions) });
    } catch (e) {
      setError(`${providerInfo.label} call failed: ` + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal wide title="Ask about your spending" onClose={onClose}>
      <div style={{ fontSize: 12, color: 'var(--muted-2)', marginBottom: 16 }}>
        Your question is sent to {providerInfo.label} to turn into a filter. Matching it against
        your transactions happens entirely on this device — the results are never sent anywhere.
      </div>

      {!aiOn ? (
        <div style={{ padding: '22px 20px', textAlign: 'center', fontSize: 13, color: 'var(--muted-2)', background: 'var(--soft)', borderRadius: 10, border: '1px solid var(--soft-border)' }}>
          {!isDesktop
            ? 'This requires the desktop app — API keys are stored in your OS keychain, not available in this browser preview.'
            : <>This reuses the AI categorization key. Enable "AI categorization" in Settings and add a{' '}
                {AI_PROVIDERS.map(p => p.label).join(' or ')} API key to use it.</>}
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <input
              className="input" style={{ flex: 1 }} autoFocus
              placeholder="e.g. how much did I spend on coffee last month?"
              value={query} onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') ask(query); }}
            />
            <button className="btn" disabled={!query.trim() || loading} onClick={() => ask(query)}>
              {loading ? 'Asking…' : 'Ask'}
            </button>
          </div>

          {!result && !error && !loading && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {EXAMPLES.map(ex => (
                <button key={ex} className="chip clickable" style={{ border: '1px solid var(--card-border)', fontSize: 11.5, color: 'var(--muted)' }}
                  onClick={() => { setQuery(ex); ask(ex); }}>
                  {ex}
                </button>
              ))}
            </div>
          )}

          {error && <div style={{ color: 'var(--red)', fontSize: 12.5, margin: '10px 0' }}>{error}</div>}
          {result && <ResultView intent={result.intent} r={result.r} state={state} />}
        </>
      )}
    </Modal>
  );
}

function ResultView({ intent, r, state }: { intent: string; r: FilterResult; state: AppData }) {
  const headline =
    intent === 'sum' ? usd2(r.sum)
    : intent === 'count' ? `${r.count} charge${r.count === 1 ? '' : 's'}`
    : intent === 'average' ? `${usd2(r.average)} average`
    : `${r.count} matching transaction${r.count === 1 ? '' : 's'}`;

  const rangeLabel = r.from && r.to ? `${shortDate(r.from)} – ${shortDate(r.to)}` : r.from ? `since ${shortDate(r.from)}` : r.to ? `through ${shortDate(r.to)}` : 'all time';
  const showTotalAside = intent !== 'sum' && r.count > 0;

  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ fontSize: 28, fontWeight: 300, color: 'var(--ink)', marginBottom: 2 }}>{headline}</div>
      <div style={{ fontSize: 12, color: 'var(--muted-2)', marginBottom: 14 }}>
        {r.count} transaction{r.count === 1 ? '' : 's'} · {rangeLabel}{showTotalAside ? ` · total ${usd2(r.sum)}` : ''}
      </div>

      {r.matches.length === 0 ? (
        <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 13, color: 'var(--muted-2)' }}>No matching transactions.</div>
      ) : (
        <div style={{ border: '1px solid var(--card-border)', borderRadius: 10, overflow: 'auto', maxHeight: 340 }}>
          {r.matches.slice(0, 200).map(t => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderBottom: '1px solid var(--row-border)' }}>
              <span className="dot" style={{ width: 8, height: 8, background: categoryColor(state, t.categoryId), flex: 'none' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="ellip" style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-2)' }}>{t.merchantNormalized}</div>
                <div className="ellip" style={{ fontSize: 11, color: 'var(--muted-2)' }}>{shortDate(t.date)} · {accountName(state, t.accountId)} · {txnCategoryLabel(state, t)}</div>
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: t.amount > 0 ? 'var(--green-ok)' : 'var(--ink)', flex: 'none' }}>{signedUsd2(t.amount)}</div>
            </div>
          ))}
          {r.matches.length > 200 && (
            <div style={{ padding: '8px 14px', fontSize: 11.5, color: 'var(--muted-2)' }}>Showing first 200 of {r.matches.length.toLocaleString()}.</div>
          )}
        </div>
      )}
    </div>
  );
}
