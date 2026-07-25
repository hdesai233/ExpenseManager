import { useMemo, useState } from 'react';
import {
  categoryAnomalies, categoryMovers, categorySpend, dayOfWeekSpend, monthlySeries,
  rollingAverage, spendStats, unusualCharges,
} from '../lib/analytics';
import { currentYM, monthLabel, monthShort, shortDate, usd } from '../lib/format';
import { categoryName, useStore } from '../store';
import { BarChartH, StackedBarChart, TrendChart } from '../components/ui';

// ---- Expense trends: what changed, what's drifting, what's unusual ----
// Replaces the old Budgets & Goals screen. Nothing here compares against a target — every panel
// compares spend against its own history instead.

const WINDOWS = [6, 12, 24];
const CAT_COLORS = ['#1f6f5c', '#4a9d86', '#c8892b', '#86b8a5', '#d9a441', '#7c6f9c', '#b0736a', '#9aa06b', '#5a7f9c', '#cdc7bb'];

export default function Trends() {
  const { state } = useStore();
  const [months, setMonths] = useState(12);
  const ym = currentYM();
  const txns = state.transactions;

  const series = useMemo(() => monthlySeries(txns, months, ym), [txns, months, ym]);
  const stats = useMemo(() => spendStats(series), [series]);
  const rolling = useMemo(() => rollingAverage(series, 3), [series]);
  const movers = useMemo(() => categoryMovers(txns, state.categories, ym), [txns, state.categories, ym]);
  const outliers = useMemo(() => unusualCharges(txns, ym), [txns, ym]);
  const weekdays = useMemo(() => dayOfWeekSpend(txns, months, ym), [txns, months, ym]);
  const catAnomalies = useMemo(() => categoryAnomalies(txns, state.categories, ym), [txns, state.categories, ym]);

  // Per-category totals across the window, biggest first — the "where does it all go" view.
  const topCategories = useMemo(() => {
    const windowMonths = series.map(s => s.ym);
    return state.categories
      .filter(c => !c.parentId)
      .map(category => ({
        category,
        total: windowMonths.reduce((a, m) => a + categorySpend(txns, category.id, m), 0),
      }))
      .filter(c => c.total > 0.005)
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);
  }, [state.categories, series, txns]);

  const stackSeries = useMemo(() => topCategories.slice(0, 6).map((c, i) => ({
    label: c.category.name,
    color: c.category.color || CAT_COLORS[i % CAT_COLORS.length],
    values: series.map(s => categorySpend(txns, c.category.id, s.ym)),
  })), [topCategories, series, txns]);

  // spendStats ignores months with no activity, so label the average with that count rather than
  // the selected window — otherwise "across 24 months" would describe an average over 6.
  const activeCount = series.filter(m => m.spend > 0.005).length;
  const trendPoints = series.map(m => ({ label: monthShort(m.ym), value: m.spend }));
  const rising = movers.filter(m => m.delta > 0).slice(0, 5);
  const falling = movers.filter(m => m.delta < 0).slice(0, 5);
  const hasHistory = series.some(m => m.spend > 0.005);

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 18 }}>
        <div>
          <div className="page-title">Trends</div>
          <div className="page-sub">How your spending is moving over time — no targets, just what actually happened</div>
        </div>
        <div className="seg" style={{ flex: 'none' }}>
          {WINDOWS.map(w => (
            <button key={w} className={'seg-item' + (months === w ? ' active' : '')} onClick={() => setMonths(w)}>
              {w}m
            </button>
          ))}
        </div>
      </div>

      {!hasHistory ? (
        <div className="card" style={{ padding: '40px 22px', textAlign: 'center', fontSize: 13, color: 'var(--muted-2)' }}>
          No spending in the last {months} months yet. Import a statement to start building a trend.
        </div>
      ) : (
        <>
          {/* headline stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 14 }}>
            <StatTile
              label="Average month"
              value={usd(stats.average)}
              sub={activeCount === months ? `across ${months} months` : `across ${activeCount} month${activeCount === 1 ? '' : 's'} with spend`}
            />
            <StatTile label="Median month" value={usd(stats.median)} sub="typical, ignoring spikes" />
            <StatTile
              label="Highest month"
              value={stats.highest ? usd(stats.highest.spend) : '—'}
              sub={stats.highest ? monthLabel(stats.highest.ym) : ''}
              color="var(--red)"
            />
            <StatTile
              label="Lowest month"
              value={stats.lowest ? usd(stats.lowest.spend) : '—'}
              sub={stats.lowest ? monthLabel(stats.lowest.ym) : ''}
              color="var(--green-ok)"
            />
          </div>

          {/* spend over time with a 3-month rolling average */}
          <div className="card" style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div className="card-title">Monthly spend</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <Legend color="var(--green)" label="Actual" />
                <Legend color="#c9c4ba" label="3-month average" />
              </div>
            </div>
            <TrendChart
              width={900}
              height={220}
              series={trendPoints}
              compare={rolling}
              forecastIndex={trendPoints.length}
              yTicks
            />
          </div>

          {/* movers */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <MoverCard title="Spending more" subtitle="vs. last month" movers={rising} up />
            <MoverCard title="Spending less" subtitle="vs. last month" movers={falling} />
          </div>

          {/* category mix over time + ranked totals */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 14, marginBottom: 14 }}>
            <div className="card">
              <div className="card-title" style={{ marginBottom: 14 }}>Category mix by month</div>
              <StackedBarChart
                width={620}
                height={230}
                labels={series.map(s => monthShort(s.ym))}
                series={stackSeries}
              />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 10 }}>
                {stackSeries.map(s => <Legend key={s.label} color={s.color} label={s.label} />)}
              </div>
            </div>

            <div className="card">
              <div className="card-title" style={{ marginBottom: 14 }}>Total by category</div>
              <BarChartH
                width={420}
                items={topCategories.map((c, i) => ({
                  label: c.category.name,
                  value: c.total,
                  color: c.category.color || CAT_COLORS[i % CAT_COLORS.length],
                }))}
              />
            </div>
          </div>

          {/* day-of-week pattern + category-level anomalies */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.3fr', gap: 14, marginBottom: 14 }}>
            <div className="card">
              <div className="card-title" style={{ marginBottom: 4 }}>Spend by day of week</div>
              <div style={{ fontSize: 11.5, color: 'var(--muted-2)', marginBottom: 16 }}>
                Average spend per weekday, not the raw total — so a window with, say, five Fridays
                and four Sundays doesn't make Fridays look artificially bigger.
              </div>
              <WeekdayBars rows={weekdays} />
            </div>

            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <div className="card-title">Unusual category spend this month</div>
                {catAnomalies.length > 0 && <span className="pill-count">{catAnomalies.length}</span>}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--muted-2)', marginBottom: 12 }}>
                Categories spending well above their own 6-month median — steadier than "vs. last
                month" alone, since one unusually cheap or pricey prior month can't swing it.
              </div>
              {catAnomalies.length === 0 ? (
                <div style={{ fontSize: 12.5, color: 'var(--muted-2)', padding: '16px 0', textAlign: 'center' }}>
                  Nothing out of the ordinary this month.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {catAnomalies.slice(0, 8).map(a => (
                    <div key={a.category.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 2px', borderTop: '1px solid #f2efe8' }}>
                      <span className="dot" style={{ width: 8, height: 8, background: a.category.color, flex: 'none' }} />
                      <div className="ellip" style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--ink-3)', fontWeight: 500 }}>
                        {a.category.name}
                      </div>
                      <div style={{ textAlign: 'right', fontSize: 11.5, color: 'var(--muted-2)', flex: 'none' }}>
                        usually {usd(a.typicalAmount)}
                      </div>
                      <div style={{ width: 70, textAlign: 'right', fontSize: 13.5, fontWeight: 600, color: 'var(--red)', flex: 'none' }}>
                        {usd(a.amount)}
                      </div>
                      <span className="tag-badge" style={{ flex: 'none', color: 'var(--amber)', background: 'var(--amber-bg)' }}>
                        {a.ratio.toFixed(1)}×
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* unusual charges */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <div className="card-title">Unusual charges this month</div>
              {outliers.length > 0 && <span className="pill-count">{outliers.length}</span>}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--muted-2)', marginBottom: 12 }}>
              Individual charges well above what that merchant usually costs. A merchant needs at
              least three prior charges before it can be flagged, so new merchants never show up here.
            </div>
            {outliers.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--muted-2)', padding: '16px 0', textAlign: 'center' }}>
                Nothing out of the ordinary this month.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {outliers.slice(0, 8).map(o => (
                  <div key={o.txn.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 2px', borderTop: '1px solid #f2efe8' }}>
                    <div style={{ width: 52, fontSize: 11.5, color: 'var(--muted-2)', flex: 'none' }}>{shortDate(o.txn.date)}</div>
                    <div className="ellip" style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--ink-3)', fontWeight: 500 }}>
                      {o.txn.merchantNormalized}
                    </div>
                    <span className="chip" style={{ fontSize: 11.5, color: 'var(--muted)', flex: 'none' }}>
                      {categoryName(state, o.txn.subcategoryId ?? o.txn.categoryId)}
                    </span>
                    <div style={{ width: 130, textAlign: 'right', fontSize: 11.5, color: 'var(--muted-2)', flex: 'none' }}>
                      usually {usd(o.merchantMedian)}
                    </div>
                    <div style={{ width: 78, textAlign: 'right', fontSize: 13.5, fontWeight: 600, color: 'var(--red)', flex: 'none' }}>
                      {usd(-o.txn.amount)}
                    </div>
                    <span className="tag-badge" style={{ flex: 'none', color: 'var(--amber)', background: 'var(--amber-bg)' }}>
                      {o.ratio.toFixed(1)}×
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function WeekdayBars({ rows }: { rows: Array<{ weekday: number; label: string; average: number; occurrences: number }> }) {
  const max = Math.max(...rows.map(r => r.average), 1);
  const peak = rows.reduce((a, r) => (r.average > a.average ? r : a), rows[0]);
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', height: 110, gap: 10 }}>
        {rows.map(r => (
          <div key={r.weekday} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', height: 96 }}>
              <div
                title={`${usd(r.average)} avg over ${r.occurrences} ${r.label}s`}
                style={{
                  width: 22, borderRadius: '3px 3px 0 0', height: `${Math.max(r.average / max * 96, 2).toFixed(0)}px`,
                  background: r.weekday === peak.weekday ? 'var(--green)' : 'var(--green-2)',
                }}
              />
            </div>
            <span style={{ fontSize: 10.5, color: 'var(--muted-2)' }}>{r.label}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #f2efe8', fontSize: 11.5, color: 'var(--muted)' }}>
        Highest: {peak.label} · {usd(peak.average)} avg
      </div>
    </>
  );
}

function StatTile({ label, value, sub, color }: { label: string; value: string; sub: string; color?: string }) {
  return (
    <div className="card" style={{ padding: '16px 17px' }}>
      <div className="kicker">{label}</div>
      <div className="big-num" style={{ margin: '9px 0 3px', color: color ?? 'var(--ink)' }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{sub}</div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--muted)' }}>
      <span className="dot" style={{ width: 9, height: 9, background: color }} />{label}
    </span>
  );
}

function MoverCard({ title, subtitle, movers, up }: {
  title: string; subtitle: string; up?: boolean;
  movers: Array<{ category: { id: string; name: string; color: string }; current: number; previous: number; delta: number; pctChange: number; isNew: boolean }>;
}) {
  const accent = up ? 'var(--red)' : 'var(--green-ok)';
  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 14 }}>
        <div className="card-title">{title}</div>
        <span style={{ fontSize: 11.5, color: 'var(--muted-2)' }}>{subtitle}</span>
      </div>
      {movers.length === 0 ? (
        <div style={{ fontSize: 12.5, color: 'var(--muted-2)', padding: '16px 0', textAlign: 'center' }}>
          Nothing {up ? 'went up' : 'came down'} this month.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {movers.map(m => (
            <div key={m.category.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="dot" style={{ width: 8, height: 8, background: m.category.color, flex: 'none' }} />
              <span className="ellip" style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--ink-3)', fontWeight: 500 }}>
                {m.category.name}
              </span>
              <span style={{ fontSize: 11.5, color: 'var(--muted-2)', flex: 'none' }}>
                {m.isNew ? 'new' : `${usd(m.previous)} → ${usd(m.current)}`}
              </span>
              <span style={{ width: 74, textAlign: 'right', fontSize: 12.5, fontWeight: 600, color: accent, flex: 'none' }}>
                {m.delta > 0 ? '+' : ''}{usd(m.delta)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
