import { useMemo, useState } from 'react';
import { addMonths, currentYM, monthShort, monthYearFull, usd } from '../lib/format';
import { categorySpend, dailySpendByAccount, forecastMonthSpend, monthlySeries, monthlySpend, topMerchants } from '../lib/analytics';
import { categoryName, useStore } from '../store';
import { StackedBarChart, TrendChart } from '../components/ui';

export default function Analytics() {
  const { state } = useStore();
  const [range, setRange] = useState<6 | 12>(12);
  const [cutCat, setCutCat] = useState('food');
  const [cutPct, setCutPct] = useState(20);

  const ym = currentYM();
  const txns = state.transactions;

  const months = Math.min(range, 12);
  const series = useMemo(() => monthlySeries(txns, months), [txns, months]);
  const activeSeries = series.filter(m => m.spend > 0);
  const { projected } = forecastMonthSpend(txns, ym);

  const trendPoints = [
    ...activeSeries.map(m => ({ label: monthShort(m.ym), value: m.spend })),
    { label: 'proj', value: projected },
  ];
  const yoy = [...activeSeries.map(m => {
    const prior = monthlySpend(txns, addMonths(m.ym, -12));
    return prior > 0 ? prior : null;
  }), null];
  const hasYoy = yoy.some(v => v !== null);

  const recentMonths = activeSeries.slice(-6);
  const maxSpend = Math.max(...recentMonths.map(m => m.spend), 1);

  const sinceYM = addMonths(ym, -(months - 1));
  const top = topMerchants(txns, sinceYM, 6);
  const topMax = top[0]?.amount ?? 1;

  // ---- what-if simulator ----
  const recent3 = [addMonths(ym, -1), addMonths(ym, -2), addMonths(ym, -3)];
  const baseMonthly = recent3.reduce((a, m) => a + categorySpend(txns, cutCat, m), 0) / 3;
  const whatMonthly = Math.round(baseMonthly * cutPct / 100);
  const whatAnnual = whatMonthly * 12;
  // Share of a typical month's spend that this category represents, before and after the cut.
  const typicalMonth = recent3.reduce((a, m) => a + monthlySpend(txns, m), 0) / 3;
  const shareBefore = typicalMonth > 0 ? baseMonthly / typicalMonth : 0;
  const shareAfter = typicalMonth > 0 ? (baseMonthly - whatMonthly) / Math.max(typicalMonth - whatMonthly, 1) : 0;

  const cutOptions = state.categories.filter(c => !c.parentId && !['other', 'fees', 'housing'].includes(c.id));

  // ---- daily spend by account, one month at a time ----
  const [dailyYm, setDailyYm] = useState(ym);
  const earliestYm = useMemo(
    () => txns.reduce((min, t) => t.date.slice(0, 7) < min ? t.date.slice(0, 7) : min, ym),
    [txns, ym],
  );
  const { days, series: accountSeries } = useMemo(() => dailySpendByAccount(txns, state.accounts, dailyYm), [txns, state.accounts, dailyYm]);
  const dailyTotal = accountSeries.reduce((a, s) => a + s.values.reduce((x, y) => x + y, 0), 0);
  const dailyLabels = days.map(String);

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 18 }}>
        <div>
          <div className="page-title">Analytics</div>
          <div className="page-sub">Trends, forecasts, and a what-if simulator · all computed on-device</div>
        </div>
        <div className="seg">
          <button className={'seg-item' + (range === 6 ? ' active' : '')} onClick={() => setRange(6)}>6M</button>
          <button className={'seg-item' + (range === 12 ? ' active' : '')} onClick={() => setRange(12)}>1Y</button>
        </div>
      </div>

      <div className="card" style={{ padding: '20px 22px', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div className="card-title" style={{ fontSize: 15 }}>Monthly spend with forecast</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--muted)' }}><span style={{ width: 14, height: 2, background: 'var(--green)', borderRadius: 2 }} />This year</span>
            {hasYoy && <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--muted)' }}><span style={{ width: 14, height: 2, background: '#c9c4ba', borderRadius: 2 }} />Last year</span>}
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--muted)' }}><span style={{ width: 14, height: 0, borderTop: '2px dashed var(--amber)' }} />Forecast</span>
          </div>
        </div>
        <TrendChart width={720} height={300} series={trendPoints} compare={hasYoy ? yoy : undefined} forecastIndex={activeSeries.length - 1} yTicks />
      </div>

      <div className="card" style={{ padding: '20px 22px', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div className="card-title" style={{ fontSize: 15 }}>Daily spend by account</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              title="Previous month"
              onClick={() => setDailyYm(addMonths(dailyYm, -1))}
              disabled={dailyYm <= earliestYm}
              style={{ width: 26, height: 26, borderRadius: 7, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--ink-4)', cursor: dailyYm <= earliestYm ? 'default' : 'pointer', opacity: dailyYm <= earliestYm ? .4 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            </button>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-4)', width: 118, textAlign: 'center' }}>{monthYearFull(dailyYm)}</span>
            <button
              title="Next month"
              onClick={() => setDailyYm(addMonths(dailyYm, 1))}
              disabled={dailyYm >= ym}
              style={{ width: 26, height: 26, borderRadius: 7, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--ink-4)', cursor: dailyYm >= ym ? 'default' : 'pointer', opacity: dailyYm >= ym ? .4 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
            </button>
          </div>
        </div>
        {accountSeries.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--muted-2)', padding: '20px 0', textAlign: 'center' }}>No spending in {monthYearFull(dailyYm)}.</div>
        ) : (
          <>
            <div style={{ fontSize: 11.5, color: 'var(--muted-2)', marginBottom: 14 }}>{usd(dailyTotal)} total across {days.length} days</div>
            <StackedBarChart
              width={900}
              height={220}
              labels={dailyLabels}
              series={accountSeries.map(s => ({ label: s.accountName, color: s.color, values: s.values }))}
            />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 10 }}>
              {accountSeries.map(s => (
                <span key={s.accountId} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--muted)' }}>
                  <span className="dot" style={{ width: 9, height: 9, background: s.color }} />{s.accountName}
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
        <div className="card" style={{ padding: '20px 22px' }}>
          <div className="card-title" style={{ fontSize: 15, marginBottom: 16 }}>Spend by month</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', height: 110, gap: 14 }}>
            {recentMonths.map(m => (
              <div key={m.ym} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'flex-end', height: 96 }}>
                  <div title={`${usd(m.spend)}`} style={{ width: 22, background: 'var(--green)', borderRadius: '3px 3px 0 0', height: `${(m.spend / maxSpend * 96).toFixed(0)}px` }} />
                </div>
                <span style={{ fontSize: 10.5, color: 'var(--muted-2)' }}>{monthShort(m.ym)}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #f2efe8', fontSize: 11.5, color: 'var(--muted)' }}>
            Highest bar {usd(maxSpend)} · last {recentMonths.length} active months
          </div>
        </div>

        <div className="card" style={{ padding: '20px 22px' }}>
          <div className="card-title" style={{ fontSize: 15, marginBottom: 16 }}>Top merchants</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {top.map(m => (
              <div key={m.name}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                  <span style={{ fontSize: 12.5, color: 'var(--ink-3)', fontWeight: 500 }}>{m.name}</span>
                  <span style={{ fontSize: 12.5, color: 'var(--ink)', fontWeight: 600 }}>{usd(m.amount)}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <div className="bar-track" style={{ flex: 1 }}>
                    <div className="bar-fill" style={{ width: `${(m.amount / topMax * 100).toFixed(0)}%`, background: 'var(--green-2)' }} />
                  </div>
                  <span style={{ fontSize: 10.5, color: 'var(--muted-2)', width: 110, textAlign: 'right' }} className="ellip">
                    {m.count}× · {categoryName(state, m.categoryId)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* what-if simulator */}
      <div style={{ background: 'linear-gradient(180deg,#f3f7f4,#fbfbf9)', border: '1px solid #d9e6df', borderRadius: 14, padding: '22px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 4 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1f6f5c" strokeWidth="1.8" strokeLinecap="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#1c5647' }}>What-if simulator</div>
        </div>
        <div style={{ fontSize: 12.5, color: '#6b8078', marginBottom: 18 }}>Model a spending change and see how much it would free up.</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.15fr', gap: 28, alignItems: 'center' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
              <span style={{ fontSize: 13.5, color: 'var(--ink-3)' }}>Cut</span>
              <select className="input" value={cutCat} onChange={e => setCutCat(e.target.value)}
                style={{ fontWeight: 600, color: 'var(--green)', border: '1px solid #cfe0d8' }}>
                {cutOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <span style={{ fontSize: 13.5, color: 'var(--ink-3)' }}>by</span>
              <span style={{ fontSize: 18, fontWeight: 600, color: 'var(--green)' }}>{cutPct}%</span>
            </div>
            <input type="range" min={0} max={40} step={5} value={cutPct} onChange={e => setCutPct(+e.target.value)} style={{ width: '100%' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 7 }}>
              <span style={{ fontSize: 10.5, color: '#9aa79f' }}>0%</span>
              <span style={{ fontSize: 10.5, color: '#9aa79f' }}>40%</span>
            </div>
            <div style={{ fontSize: 11, color: '#9aa79f', marginTop: 10 }}>
              Based on your 3-month average of {usd(baseMonthly)}/mo in {categoryName(state, cutCat)}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div style={{ background: '#fff', border: '1px solid #e2ece6', borderRadius: 11, padding: '14px 15px' }}>
              <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: '#9aa79f' }}>Monthly</div>
              <div style={{ fontSize: 22, fontWeight: 300, color: 'var(--green-ok)', marginTop: 6 }}>+{usd(whatMonthly)}</div>
              <div style={{ fontSize: 11, color: '#9aa79f', marginTop: 2 }}>freed up</div>
            </div>
            <div style={{ background: '#fff', border: '1px solid #e2ece6', borderRadius: 11, padding: '14px 15px' }}>
              <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: '#9aa79f' }}>Per year</div>
              <div style={{ fontSize: 22, fontWeight: 300, color: 'var(--green-ok)', marginTop: 6 }}>+{usd(whatAnnual)}</div>
              <div style={{ fontSize: 11, color: '#9aa79f', marginTop: 2 }}>saved</div>
            </div>
            <div style={{ background: '#fff', border: '1px solid #e2ece6', borderRadius: 11, padding: '14px 15px' }}>
              <div className="ellip" style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: '#9aa79f' }}>Share of spend</div>
              <div style={{ fontSize: 22, fontWeight: 300, color: '#1c5647', marginTop: 6 }}>{Math.round(shareAfter * 100)}%</div>
              <div style={{ fontSize: 11, color: '#9aa79f', marginTop: 2 }}>
                {shareBefore > 0 ? `was ${Math.round(shareBefore * 100)}%` : 'of a typical month'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
