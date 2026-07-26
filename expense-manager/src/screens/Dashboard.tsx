import { useMemo, useState } from 'react';
import { categoryMovers, forecastMonthSpend, isSpend, monthlySeries, monthlySpend, spendByCategory, spendOf, spendStats } from '../lib/analytics';
import { needsReview } from '../lib/categorize';
import { addMonths, currentYM, daysInMonth, monthShort, monthYearFull, shortDate, signedUsd2, usd } from '../lib/format';
import { accountName, categoryColor, txnCategoryLabel, useStore } from '../store';
import type { ViewKey } from '../types';
import { Donut, TrendChart } from '../components/ui';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function Dashboard({ go }: { go: (v: ViewKey) => void }) {
  const { state, dispatch } = useStore();
  const [ym, setYm] = useState(currentYM());
  const isCurrentMonth = ym === currentYM();
  const txns = state.transactions;

  const earliestYm = useMemo(() => txns.reduce((min, t) => t.date.slice(0, 7) < min ? t.date.slice(0, 7) : min, currentYM()), [txns]);
  const years = useMemo(() => {
    const start = Number(earliestYm.slice(0, 4));
    const end = Number(currentYM().slice(0, 4));
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }, [earliestYm]);
  const [selYear, selMonth] = ym.split('-');

  const jumpTo = (year: string, month: string) => {
    const next = `${year}-${month}`;
    setYm(next > currentYM() ? currentYM() : next);
  };

  const spent = monthlySpend(txns, ym);
  const { projected, confident, low, high, knownFixedRemaining } = forecastMonthSpend(txns, ym);

  const series = monthlySeries(txns, 6, ym);
  const stats = spendStats(series.slice(0, -1)); // prior months only — the current one is partial
  const vsAverage = stats.average > 0 ? (isCurrentMonth ? projected : spent) - stats.average : 0;

  const txnCount = txns.filter(t => t.date.slice(0, 7) === ym && isSpend(t)).length;
  const movers = categoryMovers(txns, state.categories, ym);
  const topMover = movers[0] ?? null;

  const cats = spendByCategory(txns, state.categories, ym);
  const review = txns.filter(needsReview).sort((a, b) => b.date.localeCompare(a.date));
  const monthTxns = txns.filter(t => t.date.slice(0, 7) === ym);
  const recent = [...monthTxns].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)).slice(0, 6);
  const largest = monthTxns.filter(t => spendOf(t) > 0.005).sort((a, b) => spendOf(b) - spendOf(a)).slice(0, 6);
  const [txnView, setTxnView] = useState<'recent' | 'largest'>('recent');
  const shownTxns = txnView === 'largest' ? largest : recent;

  const trendPoints = isCurrentMonth
    ? [...series.map(m => ({ label: monthShort(m.ym), value: m.spend })), { label: 'proj', value: projected }]
    : series.map(m => ({ label: monthShort(m.ym), value: m.spend }));

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 22 }}>
        <div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 3 }}>{greeting}, {state.settings.householdName}</div>
          <div className="page-title">
            {isCurrentMonth ? `Here's your ${monthYearFull(ym)} so far` : `Here's how ${monthYearFull(ym)} went`}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            title="Previous month"
            onClick={() => setYm(addMonths(ym, -1))}
            disabled={ym <= earliestYm}
            style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--ink-4)', cursor: ym <= earliestYm ? 'default' : 'pointer', opacity: ym <= earliestYm ? .4 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <select className="input" value={selMonth} onChange={e => jumpTo(selYear, e.target.value)} style={{ height: 32, fontSize: 13, fontWeight: 600, padding: '0 8px' }}>
            {MONTH_NAMES.map((m, i) => <option key={m} value={String(i + 1).padStart(2, '0')}>{m}</option>)}
          </select>
          <select className="input" value={selYear} onChange={e => jumpTo(e.target.value, selMonth)} style={{ height: 32, fontSize: 13, fontWeight: 600, padding: '0 8px' }}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button
            title="Next month"
            onClick={() => setYm(addMonths(ym, 1))}
            disabled={isCurrentMonth}
            style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--ink-4)', cursor: isCurrentMonth ? 'default' : 'pointer', opacity: isCurrentMonth ? .4 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
          </button>
          {!isCurrentMonth && <button className="link-sm" style={{ fontSize: 12, marginLeft: 4 }} onClick={() => setYm(currentYM())}>Today</button>}
        </div>
      </div>

      {/* stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 14 }}>
        <div className="card" style={{ padding: '16px 17px' }}>
          <div className="kicker">{isCurrentMonth ? 'Spent this month' : 'Spent'}</div>
          <div className="big-num" style={{ margin: '9px 0 3px' }}>{usd(spent)}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            across {txnCount.toLocaleString()} charge{txnCount === 1 ? '' : 's'}
          </div>
        </div>
        <div className="card" style={{ padding: '16px 17px' }}>
          <div className="kicker">vs. 5-month average</div>
          <div className="big-num" style={{ margin: '9px 0 3px', color: vsAverage > 0 ? 'var(--red)' : 'var(--green-ok)' }}>
            {stats.average === 0 ? '—' : `${vsAverage > 0 ? '+' : ''}${usd(vsAverage)}`}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            {stats.average === 0 ? 'Not enough history yet' : `Typical month ${usd(stats.average)}`}
          </div>
        </div>
        <div className="card" style={{ padding: '16px 17px' }}>
          <div className="kicker">Biggest change</div>
          {topMover ? (
            <>
              <div className="big-num" style={{ margin: '9px 0 3px', color: topMover.delta > 0 ? 'var(--red)' : 'var(--green-ok)' }}>
                {topMover.delta > 0 ? '+' : ''}{usd(topMover.delta)}
              </div>
              <div className="ellip" style={{ fontSize: 12, color: 'var(--muted)' }}>
                {topMover.category.name} · {topMover.isNew ? 'new this month' : 'vs. last month'}
              </div>
            </>
          ) : (
            <>
              <div className="big-num" style={{ margin: '9px 0 3px' }}>—</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>No month-over-month change</div>
            </>
          )}
        </div>
        {isCurrentMonth ? (
          <div style={{ background: '#fdf7ee', border: '1px solid #ecdcbf', borderRadius: 14, padding: '16px 17px' }}>
            <div className="kicker" style={{ color: 'var(--amber-text)' }}>Projected month-end</div>
            <div className="big-num" style={{ margin: '9px 0 3px', color: 'var(--amber-deep)', fontSize: Math.round(low) === Math.round(high) ? undefined : 26 }}>
              {Math.round(low) === Math.round(high) ? `~${usd(projected)}` : `${usd(low)}–${usd(high)}`}
            </div>
            <div style={{ fontSize: 12, color: 'var(--amber-text)' }}>
              {!confident ? 'Low confidence — under 3 months of history'
                : stats.average === 0 ? 'At the current pace'
                : vsAverage > 0 ? `⚠ Tracking ${usd(vsAverage)} above typical`
                : `Tracking ${usd(Math.abs(vsAverage))} below typical`}
              {knownFixedRemaining > 0.5 && ` · ${usd(knownFixedRemaining)} in known bills still due`}
            </div>
          </div>
        ) : (
          <div className="card" style={{ padding: '16px 17px' }}>
            <div className="kicker">Daily average</div>
            <div className="big-num" style={{ margin: '9px 0 3px' }}>{usd(spent / daysInMonth(ym))}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>per day across {monthYearFull(ym)}</div>
          </div>
        )}
      </div>

      {/* donut + month-over-month movers */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 1fr', gap: 14, marginBottom: 14 }}>
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div className="card-title">Spending by category</div>
            <div style={{ fontSize: 11.5, color: 'var(--muted-2)' }}>{isCurrentMonth ? 'This month' : monthYearFull(ym)}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
            <Donut
              size={150}
              slices={cats.map(c => ({ color: c.category.color, pct: c.pct }))}
              centerLabel="TOTAL"
              centerValue={usd(cats.reduce((a, c) => a + c.amount, 0))}
            />
            <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 14px' }}>
              {cats.slice(0, 10).map(c => (
                <div key={c.category.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="dot" style={{ width: 9, height: 9, background: c.category.color }} />
                  <span className="ellip" style={{ fontSize: 12, color: '#5c584f', flex: 1 }}>{c.category.name}</span>
                  <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>{Math.round(c.pct * 100)}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div className="card-title">What changed vs. last month</div>
            <button className="link-sm" onClick={() => go('trends')}>View trends</button>
          </div>
          {movers.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--muted-2)', padding: '16px 0', textAlign: 'center' }}>
              Nothing moved compared with last month.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              {movers.slice(0, 6).map(m => {
                const scale = Math.max(...movers.slice(0, 6).map(x => Math.abs(x.delta)), 1);
                const barW = Math.abs(m.delta) / scale * 100;
                const up = m.delta > 0;
                return (
                  <div key={m.category.id}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <span className="dot" style={{ width: 8, height: 8, background: m.category.color, flex: 'none' }} />
                        <span className="ellip" style={{ fontSize: 12.5, color: 'var(--ink-3)', fontWeight: 500 }}>{m.category.name}</span>
                      </div>
                      <span style={{ fontSize: 11.5, fontWeight: 600, flex: 'none', color: up ? 'var(--red)' : 'var(--green-ok)' }}>
                        {up ? '+' : ''}{usd(m.delta)}
                      </span>
                    </div>
                    <div style={{ height: 5, background: 'var(--track)', borderRadius: 4 }}>
                      <div style={{ height: '100%', width: `${barW}%`, background: up ? 'var(--red)' : 'var(--green-ok)', borderRadius: 4, opacity: .75 }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
                      <span style={{ fontSize: 11, color: 'var(--muted-2)' }}>
                        {m.isNew ? 'New this month' : `${usd(m.previous)} → ${usd(m.current)}`}
                      </span>
                      <span title="Share of that month's total spend" style={{ fontSize: 11, color: 'var(--muted-2)' }}>
                        {Math.round(m.previousShare * 100)}%→{Math.round(m.currentShare * 100)}% of spend
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* trend + review */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 1fr', gap: 14 }}>
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <div className="card-title">Spend trend{isCurrentMonth ? ' & forecast' : ''}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--muted)' }}>
                <span style={{ width: 14, height: 2, background: 'var(--green)', borderRadius: 2 }} />Actual
              </span>
              {isCurrentMonth && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--muted)' }}>
                  <span style={{ width: 14, height: 0, borderTop: '2px dashed var(--amber)' }} />Forecast
                </span>
              )}
            </div>
          </div>
          <TrendChart width={560} height={190} series={trendPoints} forecastIndex={isCurrentMonth ? series.length - 1 : trendPoints.length} />
        </div>

        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className="card-title">Needs your review</div>
              {review.length > 0 && <span className="pill-count">{review.length}</span>}
            </div>
            <button className="link-sm" onClick={() => go('transactions')}>Review all</button>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--muted-2)', marginBottom: 12 }}>
            Low-confidence auto-categories — confirming teaches a rule
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {review.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--muted-2)', padding: '16px 0', textAlign: 'center' }}>All caught up — nothing needs review.</div>}
            {review.slice(0, 4).map(r => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 10px', background: 'var(--soft)', border: '1px solid #eeeae2', borderRadius: 10 }}>
                <span style={{
                  fontSize: 10.5, fontWeight: 700, padding: '4px 6px', borderRadius: 6, flex: 'none', minWidth: 34, textAlign: 'center',
                  color: !r.categoryId ? 'var(--red)' : r.confidence < 0.55 ? 'var(--red)' : 'var(--amber)',
                  background: !r.categoryId ? 'var(--red-bg)' : r.confidence < 0.55 ? 'var(--red-bg)' : 'var(--amber-bg)',
                }}>
                  {r.categoryId ? `${Math.round(r.confidence * 100)}%` : '—'}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="ellip" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-3)' }}>{r.merchantNormalized}</div>
                  <div className="ellip" style={{ fontSize: 11, color: 'var(--muted-2)' }}>
                    → {r.categoryId ? txnCategoryLabel(state, r) : 'Needs a category'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 5, flex: 'none' }}>
                  {r.categoryId && (
                    <button
                      title="Confirm categorization"
                      onClick={() => dispatch({ type: 'confirmTxn', txnId: r.id })}
                      style={{ width: 26, height: 26, borderRadius: 7, border: '1px solid #cfe3d8', background: '#eaf3ee', color: 'var(--green)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-11" /></svg>
                    </button>
                  )}
                  <button
                    title="Edit in Transactions"
                    onClick={() => go('transactions')}
                    style={{ width: 26, height: 26, borderRadius: 7, border: '1px solid #e6e2d9', background: '#fff', color: 'var(--muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* recent / largest transactions */}
      <div className="card" style={{ marginTop: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div className="card-title">
            {txnView === 'largest' ? 'Largest expenses' : isCurrentMonth ? 'Recent transactions' : `Transactions in ${monthYearFull(ym)}`}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="seg">
              <button className={'seg-item' + (txnView === 'recent' ? ' active' : '')} onClick={() => setTxnView('recent')}>Recent</button>
              <button className={'seg-item' + (txnView === 'largest' ? ' active' : '')} onClick={() => setTxnView('largest')}>Largest</button>
            </div>
            <button className="link-sm" onClick={() => go('transactions')}>See all</button>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {shownTxns.length === 0 && (
            <div style={{ fontSize: 12.5, color: 'var(--muted-2)', padding: '16px 0', textAlign: 'center' }}>
              {txnView === 'largest' ? 'No expenses this month.' : 'No transactions this month.'}
            </div>
          )}
          {shownTxns.map(t => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 2px', borderTop: '1px solid #f2efe8' }}>
              <span className="dot" style={{ width: 9, height: 9, background: t.flowType === 'transfer' ? '#b6b2a8' : categoryColor(state, t.categoryId) }} />
              <div style={{ width: 52, fontSize: 11.5, color: 'var(--muted-2)', flex: 'none' }}>{shortDate(t.date)}</div>
              <div className="ellip" style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--ink-3)', fontWeight: 500 }}>{t.merchantNormalized}</div>
              <span className="chip" style={{ fontSize: 11.5, color: 'var(--muted)' }}>{txnCategoryLabel(state, t)}</span>
              <div style={{ width: 120, textAlign: 'right', fontSize: 11.5, color: 'var(--muted-2)', flex: 'none' }}>{accountName(state, t.accountId)}</div>
              <div style={{
                width: 96, textAlign: 'right', fontSize: 13.5, fontWeight: 600, flex: 'none',
                color: t.flowType === 'transfer' ? '#9b968c' : t.amount > 0 ? 'var(--green-ok)' : 'var(--ink)',
              }}>{signedUsd2(t.amount)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
