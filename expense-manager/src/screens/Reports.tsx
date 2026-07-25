import { Fragment, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  applyTransactionFilter, buildReport, defaultRangeFor, REPORT_TEMPLATES, transactionsInCategory,
  type CategoryDetailRow, type ReportData, type ReportSections, type ReportTemplateKey, type TransactionFilter,
} from '../lib/report';
import { currentYM, shortDate, usd, usd2 } from '../lib/format';
import { isDesktop } from '../lib/persist';
import { accountName, categoryName, useStore } from '../store';
import { BarChartH, Modal, PieChartSvg, StackedBarChart, TrendChart, Toggle, downloadSvgAsImage } from '../components/ui';
import type { AppData } from '../types';

const CAT_COLORS = ['#1f6f5c', '#4a9d86', '#c8892b', '#86b8a5', '#d9a441', '#7c6f9c', '#b0736a', '#9aa06b', '#5a7f9c', '#cdc7bb'];

export default function Reports() {
  const { state } = useStore();
  const [template, setTemplate] = useState<ReportTemplateKey>('monthly');
  const [anchorYM, setAnchorYM] = useState(currentYM());
  const [customStart, setCustomStart] = useState(`${currentYM()}-01`);
  const [customEnd, setCustomEnd] = useState(currentYM() + '-' + String(new Date(+currentYM().slice(0, 4), +currentYM().slice(5, 7), 0).getDate()));
  const [sections, setSections] = useState<ReportSections>(REPORT_TEMPLATES[0].defaultSections);
  const [expenseMonths, setExpenseMonths] = useState(6);
  const [pdfStatus, setPdfStatus] = useState<string | null>(null);
  const [drilldown, setDrilldown] = useState<{ categoryId: string; subcategoryId?: string | null } | null>(null);

  const pieRef = useRef<HTMLDivElement>(null);
  const trendRef = useRef<HTMLDivElement>(null);
  const barsRef = useRef<HTMLDivElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);

  const templateDef = REPORT_TEMPLATES.find(t => t.key === template)!;

  const range = useMemo(() => {
    if (template === 'custom') return { start: customStart, end: customEnd, label: `${shortDate(customStart)} – ${shortDate(customEnd)}` };
    return defaultRangeFor(template, anchorYM, expenseMonths);
  }, [template, anchorYM, customStart, customEnd, expenseMonths]);

  const report: ReportData = useMemo(
    () => buildReport(state, range, templateDef.label),
    [state, range, templateDef.label],
  );

  const selectTemplate = (key: ReportTemplateKey) => {
    setTemplate(key);
    setSections(REPORT_TEMPLATES.find(t => t.key === key)!.defaultSections);
  };

  const toggleSection = (key: keyof ReportSections) => setSections(s => ({ ...s, [key]: !s[key] }));

  const doPrint = () => window.print();

  const savePdf = async () => {
    const filename = `ledger-${template}-${range.start}`;
    if (window.ledgerApi) {
      setPdfStatus('Rendering PDF…');
      const result = await window.ledgerApi.exportPdf(filename);
      setPdfStatus(result.ok ? `Saved to ${result.path}` : null);
    } else {
      window.print();
    }
  };

  const CHART_REFS = { pie: pieRef, trend: trendRef, bars: barsRef, stack: stackRef };
  const exportChart = (which: keyof typeof CHART_REFS, format: 'svg' | 'png') => {
    const svg = CHART_REFS[which].current?.querySelector('svg');
    if (svg) downloadSvgAsImage(svg, `ledger-${which}-${range.start}`, format);
  };

  const catColor = (c: { category: { id: string; color: string } }, i: number) => c.category.color || CAT_COLORS[i % CAT_COLORS.length];
  const donutSlices = report.categories.slice(0, 9).map((c, i) => ({ color: catColor(c, i), pct: c.pct, label: c.category.name }));
  const trendPoints = report.trend.map(m => ({ label: m.label, value: m.spend }));
  const barItems = report.categoryDetail.slice(0, 10).map((r, i) => ({ label: r.category.name, value: r.amount, color: catColor(r, i) }));
  const stackSeries = report.categoryTrend.map((s, i) => ({ label: s.category.name, color: catColor(s, i), values: s.values }));

  return (
    <div className="page">
      <div className="no-print" style={{ marginBottom: 18 }}>
        <div className="page-title">Reports &amp; Export</div>
        <div className="page-sub">Generate a PDF report, export filtered data, or back up everything — all built and rendered on this device.</div>
      </div>

      {/* ---- report builder controls ---- */}
      <div className="no-print card" style={{ padding: '18px 20px', marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: 10, marginBottom: 16 }}>
          {REPORT_TEMPLATES.map(t => (
            <button key={t.key} onClick={() => selectTemplate(t.key)}
              style={{
                textAlign: 'left', padding: '12px 13px', borderRadius: 11, cursor: 'pointer',
                border: '1px solid ' + (template === t.key ? 'var(--green-2)' : 'var(--card-border)'),
                background: template === t.key ? '#f2f7f4' : '#fff',
              }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 3 }}>{t.label}</div>
              <div style={{ fontSize: 11, color: 'var(--muted-2)', lineHeight: 1.4 }}>{t.description}</div>
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap', paddingTop: 14, borderTop: '1px solid var(--row-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {templateDef.fixedRange ? (
              template === 'annual' ? (
                <>
                  <label className="field" style={{ marginBottom: 0 }}>Year</label>
                  <input className="input" type="number" style={{ width: 90 }} value={anchorYM.slice(0, 4)}
                    onChange={e => setAnchorYM(`${e.target.value}-01`)} />
                </>
              ) : template === 'expense' ? (
                <>
                  <label className="field" style={{ marginBottom: 0 }}>Through</label>
                  <input className="input" type="month" value={anchorYM} onChange={e => setAnchorYM(e.target.value)} />
                  <label className="field" style={{ marginBottom: 0, marginLeft: 6 }}>Covering</label>
                  <select className="input" value={expenseMonths} onChange={e => setExpenseMonths(Number(e.target.value))}>
                    <option value={1}>1 month</option>
                    <option value={3}>3 months</option>
                    <option value={6}>6 months</option>
                    <option value={12}>12 months</option>
                  </select>
                </>
              ) : (
                <>
                  <label className="field" style={{ marginBottom: 0 }}>Month</label>
                  <input className="input" type="month" value={anchorYM} onChange={e => setAnchorYM(e.target.value)} />
                </>
              )
            ) : (
              <>
                <label className="field" style={{ marginBottom: 0 }}>From</label>
                <input className="input" type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} />
                <label className="field" style={{ marginBottom: 0 }}>to</label>
                <input className="input" type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} />
              </>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            {([
              ['summary', 'Summary'], ['categoryBreakdown', 'Categories'], ['categoryDetail', 'Category detail'],
              ['categoryTrend', 'Category trend'],
              ['topMerchants', 'Top merchants'], ['trend', 'Trend'], ['transactions', 'Itemized transactions'],
            ] as Array<[keyof ReportSections, string]>).map(([key, label]) => (
              <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-3)', cursor: 'pointer' }}>
                <input type="checkbox" checked={sections[key]} onChange={() => toggleSection(key)} />
                {label}
              </label>
            ))}
          </div>

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button className="btn-ghost" onClick={doPrint}>Print</button>
            <button className="btn" onClick={savePdf}>Save as PDF</button>
          </div>
        </div>
        {pdfStatus && <div style={{ fontSize: 11.5, color: 'var(--green-conf)', marginTop: 10 }}>{pdfStatus}</div>}
      </div>

      {/* ---- report preview / print target ---- */}
      <div className="report-print-area">
        <div className="card" style={{ padding: '26px 28px', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 22, paddingBottom: 16, borderBottom: '1px solid var(--row-border)' }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--ink-2)' }}>{report.title}</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 3 }}>{report.range.label} · {state.settings.householdName}</div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted-2)', textAlign: 'right' }}>Generated {shortDate(report.generatedAt)}<br />Local · private</div>
          </div>

          {sections.summary && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 22 }}>
              <SummaryTile label="Total spent" value={usd(report.expense)} />
              <SummaryTile label="Charges" value={report.transactionCount.toLocaleString()} />
              <SummaryTile label="Daily average" value={usd(report.dailyAverage)} />
              <SummaryTile label="Categories" value={String(report.categoryDetail.length)} />
            </div>
          )}

          {sections.categoryBreakdown && report.categories.length > 0 && (
            <ReportSection title="Spending by category">
              <div style={{ display: 'flex', gap: 26, alignItems: 'center' }}>
                <div className="no-print-inline" style={{ position: 'relative' }}>
                  <div ref={pieRef}><PieChartSvg size={150} slices={donutSlices} /></div>
                  <ChartExportButtons onExport={f => exportChart('pie', f)} />
                </div>
                <div style={{ flex: 1 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                    <tbody>
                      {report.categories.slice(0, 12).map((c, i) => (
                        <tr
                          key={c.category.id}
                          className="hover-row"
                          style={{ borderBottom: '1px solid var(--row-border)', cursor: 'pointer' }}
                          title="View transactions in this category"
                          onClick={() => setDrilldown({ categoryId: c.category.id })}
                        >
                          <td style={{ padding: '5px 0', width: 16 }}><span className="dot" style={{ width: 9, height: 9, background: c.category.color || CAT_COLORS[i % CAT_COLORS.length] }} /></td>
                          <td style={{ padding: '5px 8px', color: 'var(--ink-3)' }}>{c.category.name}</td>
                          <td style={{ padding: '5px 0', textAlign: 'right', color: 'var(--muted-2)' }}>{Math.round(c.pct * 100)}%</td>
                          <td style={{ padding: '5px 0 5px 12px', textAlign: 'right', fontWeight: 600, color: 'var(--ink)' }}>{usd(c.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </ReportSection>
          )}

          {sections.categoryDetail && report.categoryDetail.length > 0 && (
            <ReportSection title="Expenses by category">
              <div className="no-print-inline" style={{ position: 'relative', marginBottom: 16 }}>
                <div ref={barsRef}><BarChartH width={640} items={barItems} /></div>
                <ChartExportButtons onExport={f => exportChart('bars', f)} />
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--soft-border)' }}>
                    <Th align="left">Category</Th>
                    <Th align="right">Txns</Th>
                    {report.monthCount > 1 && <Th align="right">Avg / mo</Th>}
                    <Th align="right">Share</Th>
                    <Th align="right">Total</Th>
                  </tr>
                </thead>
                <tbody>
                  {report.categoryDetail.map((r, i) => (
                    <Fragment key={r.category.id}>
                      <tr
                        className="hover-row"
                        style={{ borderBottom: '1px solid var(--row-border)', cursor: 'pointer' }}
                        title="View transactions in this category"
                        onClick={() => setDrilldown({ categoryId: r.category.id })}
                      >
                        <td style={{ padding: '7px 0', color: 'var(--ink-2)', fontWeight: 600 }}>
                          <span className="dot" style={{ width: 9, height: 9, background: catColor(r, i), marginRight: 8 }} />
                          {r.category.name}
                        </td>
                        <td style={{ padding: '7px 0', textAlign: 'right', color: 'var(--muted-2)' }}>{r.count}</td>
                        {report.monthCount > 1 && <td style={{ padding: '7px 0', textAlign: 'right', color: 'var(--muted-2)' }}>{usd(r.avgPerMonth)}</td>}
                        <td style={{ padding: '7px 0', textAlign: 'right', color: 'var(--muted-2)' }}>{Math.round(r.pct * 100)}%</td>
                        <td style={{ padding: '7px 0 7px 12px', textAlign: 'right', fontWeight: 600, color: 'var(--ink)' }}>{usd(r.amount)}</td>
                      </tr>
                      {/* a lone "(no subcategory)" row just restates its parent — only break out real splits */}
                      {!(r.subs.length === 1 && r.subs[0].direct) && r.subs.map(s => (
                        <tr
                          key={s.category.id}
                          className="hover-row"
                          style={{ borderBottom: '1px solid var(--row-border)', cursor: 'pointer' }}
                          title="View transactions in this subcategory"
                          onClick={() => setDrilldown({ categoryId: r.category.id, subcategoryId: s.direct ? null : s.category.id })}
                        >
                          <td style={{ padding: '5px 0 5px 22px', color: s.direct ? 'var(--muted-2)' : 'var(--ink-3)', fontStyle: s.direct ? 'italic' : undefined }}>
                            {s.category.name}
                          </td>
                          <td style={{ padding: '5px 0', textAlign: 'right', color: 'var(--muted-2)' }}>{s.count}</td>
                          {report.monthCount > 1 && <td />}
                          <td style={{ padding: '5px 0', textAlign: 'right', color: 'var(--muted-3)' }}>{Math.round(s.pct * 100)}%</td>
                          <td style={{ padding: '5px 0 5px 12px', textAlign: 'right', color: 'var(--ink-3)' }}>{usd(s.amount)}</td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                  <tr>
                    <td style={{ padding: '9px 0', fontWeight: 600, color: 'var(--ink-2)' }}>Total expenses</td>
                    <td />
                    {report.monthCount > 1 && <td />}
                    <td />
                    <td style={{ padding: '9px 0 9px 12px', textAlign: 'right', fontWeight: 600, color: 'var(--ink)' }}>{usd(report.expense)}</td>
                  </tr>
                </tbody>
              </table>
            </ReportSection>
          )}

          {sections.categoryTrend && report.categoryTrend.length > 0 && report.trend.length > 1 && (
            <ReportSection title="Category spend by month">
              <div className="no-print-inline" style={{ position: 'relative' }}>
                <div ref={stackRef}>
                  <StackedBarChart width={640} height={210} labels={report.trend.map(t => t.label)} series={stackSeries} />
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 10 }}>
                  {stackSeries.map(s => (
                    <span key={s.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--muted)' }}>
                      <span className="dot" style={{ width: 9, height: 9, background: s.color }} />{s.label}
                    </span>
                  ))}
                </div>
                <ChartExportButtons onExport={f => exportChart('stack', f)} />
              </div>
            </ReportSection>
          )}

          {sections.trend && report.trend.length > 1 && (
            <ReportSection title="Monthly spend trend">
              <div className="no-print-inline" style={{ position: 'relative' }}>
                <div ref={trendRef}><TrendChart width={640} height={180} series={trendPoints} forecastIndex={trendPoints.length} yTicks /></div>
                <ChartExportButtons onExport={f => exportChart('trend', f)} />
              </div>
            </ReportSection>
          )}

          {sections.topMerchants && report.merchants.length > 0 && (
            <ReportSection title="Top merchants">
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <tbody>
                  {report.merchants.map(m => (
                    <tr key={m.name} style={{ borderBottom: '1px solid var(--row-border)' }}>
                      <td style={{ padding: '5px 0', color: 'var(--ink-3)' }}>{m.name}</td>
                      <td style={{ padding: '5px 0', textAlign: 'right', color: 'var(--muted-2)' }}>{m.count}×</td>
                      <td style={{ padding: '5px 0 5px 12px', textAlign: 'right', fontWeight: 600, color: 'var(--ink)' }}>{usd(m.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ReportSection>
          )}

          {sections.transactions && (
            <ReportSection title={`Itemized transactions (${report.transactions.length})`}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--soft-border)' }}>
                    <th style={{ textAlign: 'left', padding: '5px 0', color: 'var(--muted-3)', fontWeight: 600, fontSize: 10, textTransform: 'uppercase' }}>Date</th>
                    <th style={{ textAlign: 'left', padding: '5px 8px', color: 'var(--muted-3)', fontWeight: 600, fontSize: 10, textTransform: 'uppercase' }}>Merchant</th>
                    <th style={{ textAlign: 'left', padding: '5px 8px', color: 'var(--muted-3)', fontWeight: 600, fontSize: 10, textTransform: 'uppercase' }}>Category</th>
                    <th style={{ textAlign: 'left', padding: '5px 8px', color: 'var(--muted-3)', fontWeight: 600, fontSize: 10, textTransform: 'uppercase' }}>Account</th>
                    <th style={{ textAlign: 'right', padding: '5px 0', color: 'var(--muted-3)', fontWeight: 600, fontSize: 10, textTransform: 'uppercase' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {report.transactions.map(t => (
                    <tr key={t.id} style={{ borderBottom: '1px solid var(--row-border)' }}>
                      <td style={{ padding: '4px 0', color: 'var(--muted)' }}>{shortDate(t.date)}</td>
                      <td style={{ padding: '4px 8px', color: 'var(--ink-3)' }}>{t.merchantNormalized}</td>
                      <td style={{ padding: '4px 8px', color: 'var(--muted-2)' }}>{categoryName(state, t.subcategoryId ?? t.categoryId)}</td>
                      <td style={{ padding: '4px 8px', color: 'var(--muted-2)' }}>{accountName(state, t.accountId)}</td>
                      <td style={{ padding: '4px 0', textAlign: 'right', fontWeight: 600, color: t.amount > 0 ? 'var(--green-ok)' : 'var(--ink)' }}>{usd2(t.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ReportSection>
          )}
        </div>
      </div>

      <div className="no-print">
        <FilteredExportCard />
        <TaxExportCard report={report} />
        <ScheduledReportsCard />
      </div>

      {drilldown && (
        <CategoryDrilldownModal
          report={report}
          state={state}
          categoryId={drilldown.categoryId}
          initialSubcategoryId={drilldown.subcategoryId}
          onClose={() => setDrilldown(null)}
        />
      )}
    </div>
  );
}

function SummaryTile({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ background: 'var(--soft)', border: '1px solid var(--soft-border)', borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted-2)' }}>{label}</div>
      <div style={{ fontSize: 21, fontWeight: 300, color: color ?? 'var(--ink)', marginTop: 4 }}>{value}</div>
    </div>
  );
}

/** Drill-down from a category (or subcategory) row: its breakdown plus every underlying transaction. */
function CategoryDrilldownModal({ report, state, categoryId, initialSubcategoryId, onClose }: {
  report: ReportData; state: AppData; categoryId: string; initialSubcategoryId?: string | null; onClose: () => void;
}) {
  const detail: CategoryDetailRow | undefined = report.categoryDetail.find(r => r.category.id === categoryId);
  // undefined = all subcategories, null = the "no subcategory" bucket, string = one specific subcategory.
  const [subFilter, setSubFilter] = useState<string | null | undefined>(initialSubcategoryId);

  const txns = useMemo(
    () => transactionsInCategory(report.transactions, state.categories, categoryId, subFilter)
      .sort((a, b) => b.date.localeCompare(a.date)),
    [report.transactions, state.categories, categoryId, subFilter],
  );
  const shownTotal = txns.reduce((a, t) => a + -t.amount, 0);

  const hasRealSubs = !!detail && !(detail.subs.length === 1 && detail.subs[0].direct);
  const activeSubLabel = subFilter === undefined
    ? null
    : detail?.subs.find(s => (s.direct ? s.category.id === `${categoryId}:direct` : s.category.id === subFilter))?.category.name;

  const exportCSV = () => {
    const header = 'date,merchant,raw_description,amount,account,tags,notes';
    const esc = (s: string) => '"' + s.replace(/"/g, '""') + '"';
    const rows = txns.map(t => [
      t.date, esc(t.merchantNormalized), esc(t.merchantRaw), t.amount.toFixed(2),
      esc(state.accounts.find(a => a.id === t.accountId)?.name ?? ''), esc(t.tags.join(';')), esc(t.notes),
    ].join(','));
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ledger-${(detail?.category.name ?? categoryId).toLowerCase().replace(/\s+/g, '-')}-${report.range.start}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span className="dot" style={{ width: 11, height: 11, background: detail?.category.color ?? '#cdc7bb' }} />
          {detail?.category.name ?? 'Category'}{activeSubLabel ? <> · {activeSubLabel}</> : null}
        </div>
      }
      onClose={onClose}
      wide
      footer={
        <>
          <span style={{ fontSize: 11.5, color: 'var(--muted-2)' }}>{report.range.label}</span>
          <button className="btn-ghost" onClick={exportCSV} disabled={txns.length === 0}>Export CSV</button>
        </>
      }
    >
      <div style={{ display: 'flex', gap: 24, marginBottom: 16 }}>
        <div>
          <div className="kicker">Total</div>
          <div className="big-num" style={{ margin: '4px 0' }}>{usd(shownTotal)}</div>
        </div>
        <div>
          <div className="kicker">Transactions</div>
          <div className="big-num" style={{ margin: '4px 0' }}>{txns.length}</div>
        </div>
        {detail && subFilter === undefined && (
          <div>
            <div className="kicker">Share of total spend</div>
            <div className="big-num" style={{ margin: '4px 0' }}>{Math.round(detail.pct * 100)}%</div>
          </div>
        )}
      </div>

      {hasRealSubs && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
          <button
            className={'chip clickable' + (subFilter === undefined ? ' active' : '')}
            style={{ border: subFilter === undefined ? '1px solid var(--green-2)' : undefined }}
            onClick={() => setSubFilter(undefined)}
          >
            All
          </button>
          {detail!.subs.map(s => {
            const value = s.direct ? null : s.category.id;
            const active = subFilter === value;
            return (
              <button
                key={s.category.id}
                className={'chip clickable' + (active ? ' active' : '')}
                style={{ border: active ? '1px solid var(--green-2)' : undefined, fontStyle: s.direct ? 'italic' : undefined }}
                onClick={() => setSubFilter(value)}
              >
                {s.category.name} · {usd(s.amount)}
              </button>
            );
          })}
        </div>
      )}

      <div style={{ maxHeight: 400, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--soft-border)' }}>
              <Th align="left">Date</Th>
              <Th align="left">Merchant</Th>
              <Th align="left">Account</Th>
              <Th align="right">Amount</Th>
            </tr>
          </thead>
          <tbody>
            {txns.length === 0 && (
              <tr><td colSpan={4} style={{ padding: '20px 0', textAlign: 'center', color: 'var(--muted-2)' }}>No transactions.</td></tr>
            )}
            {txns.map(t => (
              <tr key={t.id} style={{ borderBottom: '1px solid var(--row-border)' }}>
                <td style={{ padding: '6px 0', color: 'var(--muted)' }}>{shortDate(t.date)}</td>
                <td style={{ padding: '6px 8px', color: 'var(--ink-3)' }}>
                  {t.merchantNormalized}
                  {t.splits && t.splits.length > 1 && <span style={{ marginLeft: 6, fontSize: 10.5, color: 'var(--muted-3)' }}>split</span>}
                </td>
                <td style={{ padding: '6px 8px', color: 'var(--muted-2)' }}>{accountName(state, t.accountId)}</td>
                <td style={{ padding: '6px 0', textAlign: 'right', fontWeight: 600, color: 'var(--ink)' }}>{usd2(t.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

function Th({ align, children }: { align: 'left' | 'right'; children: React.ReactNode }) {
  return (
    <th style={{ textAlign: align, padding: '6px 0', color: 'var(--muted-3)', fontWeight: 600, fontSize: 10.5, textTransform: 'uppercase' }}>
      {children}
    </th>
  );
}

function ReportSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 22 }}>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

function ChartExportButtons({ onExport }: { onExport: (format: 'svg' | 'png') => void }) {
  return (
    <div className="no-print" style={{ display: 'flex', gap: 6, marginTop: 8 }}>
      <button className="link-sm" onClick={() => onExport('png')}>Export PNG</button>
      <button className="link-sm" onClick={() => onExport('svg')}>Export SVG</button>
    </div>
  );
}

function FilteredExportCard() {
  const { state } = useStore();
  const [filter, setFilter] = useState<TransactionFilter>({ flow: 'all' });
  const [status, setStatus] = useState<string | null>(null);

  const filtered = useMemo(() => applyTransactionFilter(state.transactions, filter), [state.transactions, filter]);
  const topCats = state.categories.filter(c => !c.parentId);

  const download = (name: string, content: BlobPart, type: string) => {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const exportCSV = () => {
    const header = 'date,merchant,raw_description,amount,currency,account,category,flow_type,tags,notes';
    const esc = (s: string) => '"' + s.replace(/"/g, '""') + '"';
    const rows = filtered.map(t => [
      t.date, esc(t.merchantNormalized), esc(t.merchantRaw), t.amount.toFixed(2), t.currency,
      esc(state.accounts.find(a => a.id === t.accountId)?.name ?? ''),
      esc(categoryName(state, t.subcategoryId ?? t.categoryId)),
      t.flowType, esc(t.tags.join(';')), esc(t.notes),
    ].join(','));
    download('ledger-filtered.csv', [header, ...rows].join('\n'), 'text/csv');
    setStatus(`Exported ${filtered.length} transactions to CSV.`);
  };

  const exportExcel = () => {
    const rows = filtered.map(t => ({
      Date: t.date, Merchant: t.merchantNormalized, 'Raw description': t.merchantRaw, Amount: t.amount,
      Account: state.accounts.find(a => a.id === t.accountId)?.name ?? '',
      Category: categoryName(state, t.subcategoryId ?? t.categoryId),
      'Flow type': t.flowType, Tags: t.tags.join('; '), Notes: t.notes,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Transactions');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    download('ledger-filtered.xlsx', buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    setStatus(`Exported ${filtered.length} transactions to Excel.`);
  };

  return (
    <div className="card" style={{ padding: '20px 22px', marginBottom: 14 }}>
      <div className="card-title" style={{ fontSize: 15, marginBottom: 4 }}>Filtered export</div>
      <div style={{ fontSize: 11.5, color: 'var(--muted-2)', marginBottom: 14 }}>Export exactly the transactions you filter for below — CSV or Excel.</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, marginBottom: 14 }}>
        <div>
          <label className="field">From</label>
          <input className="input" style={{ width: '100%' }} type="date" value={filter.start ?? ''} onChange={e => setFilter(f => ({ ...f, start: e.target.value || undefined }))} />
        </div>
        <div>
          <label className="field">To</label>
          <input className="input" style={{ width: '100%' }} type="date" value={filter.end ?? ''} onChange={e => setFilter(f => ({ ...f, end: e.target.value || undefined }))} />
        </div>
        <div>
          <label className="field">Account</label>
          <select className="input" style={{ width: '100%' }} value={filter.accountId ?? ''} onChange={e => setFilter(f => ({ ...f, accountId: e.target.value || undefined }))}>
            <option value="">All accounts</option>
            {state.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div>
          <label className="field">Category</label>
          <select className="input" style={{ width: '100%' }} value={filter.categoryId ?? ''} onChange={e => setFilter(f => ({ ...f, categoryId: e.target.value || undefined }))}>
            <option value="">All categories</option>
            {topCats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="field">Type</label>
          <select className="input" style={{ width: '100%' }} value={filter.flow ?? 'all'} onChange={e => setFilter(f => ({ ...f, flow: e.target.value as TransactionFilter['flow'] }))}>
            <option value="all">All</option>
            <option value="spending">Spending</option>
            <option value="transfers">Transfers</option>
          </select>
        </div>
        <div>
          <label className="field">Tag</label>
          <input className="input" style={{ width: '100%' }} placeholder="e.g. Japan Trip" value={filter.tag ?? ''} onChange={e => setFilter(f => ({ ...f, tag: e.target.value || undefined }))} />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 12, color: 'var(--muted-2)' }}>{filtered.length.toLocaleString()} transactions match</span>
        <button className="btn-ghost" style={{ marginLeft: 'auto' }} onClick={exportCSV} disabled={filtered.length === 0}>Export CSV</button>
        <button className="btn-ghost" onClick={exportExcel} disabled={filtered.length === 0}>Export Excel</button>
      </div>
      {status && <div style={{ fontSize: 11.5, color: 'var(--green-conf)', marginTop: 10 }}>{status}</div>}
    </div>
  );
}

function TaxExportCard({ report }: { report: ReportData }) {
  const { state } = useStore();
  const hasAny = state.categories.some(c => c.taxDeductible);

  const exportTax = () => {
    const header = 'category,amount';
    const esc = (s: string) => '"' + s.replace(/"/g, '""') + '"';
    const rows = report.taxRows.map(r => [esc(r.category.name), r.amount.toFixed(2)].join(','));
    const total = report.taxRows.reduce((a, r) => a + r.amount, 0);
    rows.push([esc('Total'), total.toFixed(2)].join(','));
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ledger-tax-deductible-${report.range.start}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="card" style={{ padding: '20px 22px', marginBottom: 14 }}>
      <div className="card-title" style={{ fontSize: 15, marginBottom: 4 }}>Tax-relevant export</div>
      <div style={{ fontSize: 11.5, color: 'var(--muted-2)', marginBottom: 14 }}>
        Category totals for whatever's marked tax-deductible (set the flag per category in Categories &amp; Rules), for the report period above — a simple handoff for your accountant, not tax-prep.
      </div>
      {!hasAny ? (
        <div style={{ fontSize: 12.5, color: 'var(--muted-2)' }}>No categories are marked tax-deductible yet. Go to Categories &amp; Rules to flag any that apply.</div>
      ) : report.taxRows.length === 0 ? (
        <div style={{ fontSize: 12.5, color: 'var(--muted-2)' }}>No tax-deductible spend in the current report period.</div>
      ) : (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, marginBottom: 12 }}>
            <tbody>
              {report.taxRows.map(r => (
                <tr key={r.category.id} style={{ borderBottom: '1px solid var(--row-border)' }}>
                  <td style={{ padding: '5px 0', color: 'var(--ink-3)' }}>{r.category.name}</td>
                  <td style={{ padding: '5px 0', textAlign: 'right', fontWeight: 600 }}>{usd(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="btn-ghost" onClick={exportTax}>Export tax summary (CSV)</button>
        </>
      )}
    </div>
  );
}

function ScheduledReportsCard() {
  const { state, dispatch } = useStore();
  const [status, setStatus] = useState<string | null>(null);

  const pickFolder = async () => {
    if (!window.ledgerApi) return;
    const result = await window.ledgerApi.pickFolder();
    if (result.ok && result.path) dispatch({ type: 'updateSettings', patch: { autoReportFolder: result.path } });
  };

  const generateNow = async () => {
    if (!window.ledgerApi || !state.settings.autoReportFolder) return;
    setStatus('Generating…');
    const ym = currentYM();
    const result = await window.ledgerApi.savePdfToFolder(state.settings.autoReportFolder, `ledger-monthly-summary-${ym}.pdf`);
    if (result.ok) {
      dispatch({ type: 'updateSettings', patch: { autoReportLastYM: ym } });
      setStatus(`Saved to ${result.path}`);
    } else {
      setStatus('Could not save: ' + (result.error ?? 'unknown error'));
    }
  };

  if (!isDesktop) return null;

  return (
    <div className="card" style={{ padding: '20px 22px' }}>
      <div className="card-title" style={{ fontSize: 15, marginBottom: 4 }}>Scheduled reports</div>
      <div style={{ fontSize: 11.5, color: 'var(--muted-2)', marginBottom: 14 }}>
        When enabled, Ledger offers to save a Monthly Summary PDF to this folder the first time you open the app in a new month.
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--row-border)' }}>
        <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>Auto-generate monthly summary</div>
        <Toggle on={state.settings.autoReportEnabled} onChange={v => dispatch({ type: 'updateSettings', patch: { autoReportEnabled: v } })} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 0' }}>
        <span style={{ fontSize: 12.5, color: 'var(--muted-2)', flex: 1 }}>{state.settings.autoReportFolder || 'No folder selected'}</span>
        <button className="btn-ghost" onClick={pickFolder}>Choose folder…</button>
        <button className="btn-ghost" onClick={generateNow} disabled={!state.settings.autoReportFolder}>Generate now</button>
      </div>
      {status && <div style={{ fontSize: 11.5, color: 'var(--green-conf)' }}>{status}</div>}
    </div>
  );
}
