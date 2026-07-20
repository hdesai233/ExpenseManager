import { budgetPacing, forecastMonthSpend, monthlyIncome, monthlySeries, monthlySpend, spendByCategory } from '../lib/analytics';
import { needsReview } from '../lib/categorize';
import { currentYM, monthFull, monthLabel, monthShort, shortDate, signedUsd2, usd } from '../lib/format';
import { accountName, categoryColor, txnCategoryLabel, useStore } from '../store';
import type { ViewKey } from '../types';
import { Donut, TrendChart } from '../components/ui';

export default function Dashboard({ go }: { go: (v: ViewKey) => void }) {
  const { state, dispatch } = useStore();
  const ym = currentYM();
  const txns = state.transactions;

  const spent = monthlySpend(txns, ym);
  const income = monthlyIncome(txns, ym);
  const saved = income - spent;
  const totalBudget = state.budgets.reduce((a, b) => a + b.monthlyLimit, 0);
  const { projected, confident } = forecastMonthSpend(txns, ym);
  const overBudget = projected - totalBudget;

  const cats = spendByCategory(txns, state.categories, ym);
  const pacing = budgetPacing(state.budgets, txns, state.categories, ym).slice(0, 5);
  const review = txns.filter(needsReview).sort((a, b) => b.date.localeCompare(a.date));
  const recent = [...txns].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)).slice(0, 6);

  const series = monthlySeries(txns, 6);
  const trendPoints = [
    ...series.map(m => ({ label: monthShort(m.ym), value: m.spend })),
    { label: 'proj', value: projected },
  ];

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 22 }}>
        <div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 3 }}>{greeting}, {state.settings.householdName}</div>
          <div className="page-title">Here's your {monthFull(ym)} so far</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 32, padding: '0 12px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 9, fontSize: 13, fontWeight: 600, color: 'var(--ink-4)' }}>
          {monthLabel(ym)}
        </div>
      </div>

      {/* stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 14 }}>
        <div className="card" style={{ padding: '16px 17px' }}>
          <div className="kicker">Spent this month</div>
          <div className="big-num" style={{ margin: '9px 0 3px' }}>{usd(spent)}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 9 }}>
            of {usd(totalBudget)} budget · {totalBudget ? Math.round(spent / totalBudget * 100) : 0}%
          </div>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${Math.min(totalBudget ? spent / totalBudget * 100 : 0, 100)}%` }} />
          </div>
        </div>
        <div className="card" style={{ padding: '16px 17px' }}>
          <div className="kicker">Income</div>
          <div className="big-num" style={{ margin: '9px 0 3px' }}>{usd(income)}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Payroll + interest · net of transfers</div>
        </div>
        <div className="card" style={{ padding: '16px 17px' }}>
          <div className="kicker">Net saved</div>
          <div className="big-num" style={{ margin: '9px 0 3px', color: saved >= 0 ? 'var(--green-ok)' : 'var(--red)' }}>
            {saved >= 0 ? '+' : ''}{usd(saved)}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{income ? Math.round(saved / income * 100) : 0}% savings rate this month</div>
        </div>
        <div style={{ background: '#fdf7ee', border: '1px solid #ecdcbf', borderRadius: 14, padding: '16px 17px' }}>
          <div className="kicker" style={{ color: 'var(--amber-text)' }}>Projected month-end</div>
          <div className="big-num" style={{ margin: '9px 0 3px', color: 'var(--amber-deep)' }}>~{usd(projected)}</div>
          <div style={{ fontSize: 12, color: 'var(--amber-text)', display: 'flex', alignItems: 'center', gap: 5 }}>
            {!confident ? 'Low confidence — under 3 months of history'
              : overBudget > 0 ? <>⚠ On pace to exceed budget by {usd(overBudget)}</>
              : 'On pace to stay within budget'}
          </div>
        </div>
      </div>

      {/* donut + budgets on pace */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 1fr', gap: 14, marginBottom: 14 }}>
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div className="card-title">Spending by category</div>
            <div style={{ fontSize: 11.5, color: 'var(--muted-2)' }}>This month</div>
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
            <div className="card-title">Budgets on pace</div>
            <button className="link-sm" onClick={() => go('budgets')}>View all</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
            {pacing.map(b => {
              const barW = Math.min(b.spent / b.budget.monthlyLimit, 1) * 100;
              const projLeft = Math.min(b.projected / b.budget.monthlyLimit, 1.35) * 100;
              return (
                <div key={b.budget.id}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="dot" style={{ width: 8, height: 8, background: b.category.color }} />
                      <span style={{ fontSize: 12.5, color: 'var(--ink-3)', fontWeight: 500 }}>{b.category.name}</span>
                    </div>
                    <span style={{ fontSize: 11.5, color: b.overPace ? 'var(--amber)' : 'var(--muted)', fontWeight: 500 }}>
                      {b.overPace ? `Projected ${usd(b.projected)}` : 'On track'}
                    </span>
                  </div>
                  <div style={{ position: 'relative', height: 6, background: 'var(--track)', borderRadius: 4 }}>
                    <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${barW}%`, background: b.spent > b.budget.monthlyLimit ? 'var(--red)' : b.category.color, borderRadius: 4 }} />
                    <div style={{ position: 'absolute', top: -2, height: 10, width: 2, background: 'var(--muted)', left: `${projLeft}%` }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                    <span style={{ fontSize: 11, color: 'var(--muted-2)' }}>{usd(b.spent)} spent</span>
                    <span style={{ fontSize: 11, color: 'var(--muted-2)' }}>{usd(b.budget.monthlyLimit)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* trend + review */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 1fr', gap: 14 }}>
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <div className="card-title">Spend trend &amp; forecast</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--muted)' }}>
                <span style={{ width: 14, height: 2, background: 'var(--green)', borderRadius: 2 }} />Actual
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--muted)' }}>
                <span style={{ width: 14, height: 0, borderTop: '2px dashed var(--amber)' }} />Forecast
              </span>
            </div>
          </div>
          <TrendChart width={560} height={190} series={trendPoints} forecastIndex={series.length - 1} />
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

      {/* recent transactions */}
      <div className="card" style={{ marginTop: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div className="card-title">Recent transactions</div>
          <button className="link-sm" onClick={() => go('transactions')}>See all</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {recent.map(t => (
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
