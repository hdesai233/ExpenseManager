import type { ReactNode } from 'react';
import type { Transaction } from '../types';
import { REVIEW_THRESHOLD } from '../lib/categorize';
import { usd } from '../lib/format';

export function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button className={'toggle' + (on ? ' on' : '')} onClick={() => onChange(!on)} aria-pressed={on}>
      <span />
    </button>
  );
}

export function Modal({ title, onClose, children, footer, wide }: {
  title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={wide ? { width: 860 } : undefined}>
        <div className="modal-head">
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-2)' }}>{title}</div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 18, lineHeight: 1 }}>×</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Confidence badge matching design: "Rule · 98%", "You", "AI · 62%". */
export function ConfidenceBadge({ t }: { t: Transaction }) {
  if (t.flowType === 'transfer') return null;
  let label: string, color: string, bg: string;
  if (t.categorizationSource === 'manual') {
    label = 'You'; color = 'var(--blue)'; bg = 'var(--blue-bg)';
  } else if (!t.categoryId) {
    label = 'Unmatched'; color = 'var(--red)'; bg = 'var(--red-bg)';
  } else {
    const pct = Math.round(t.confidence * 100);
    const src = t.categorizationSource === 'api' ? 'AI' : 'Rule';
    label = `${src} · ${pct}%`;
    if (t.confidence >= REVIEW_THRESHOLD) { color = 'var(--green-conf)'; bg = 'var(--green-bg)'; }
    else if (t.confidence >= 0.55) { color = 'var(--amber)'; bg = 'var(--amber-bg)'; }
    else { color = 'var(--red)'; bg = 'var(--red-bg)'; }
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color, background: bg, padding: '3px 8px', borderRadius: 6 }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
      {label}
    </span>
  );
}

export interface TrendPoint { label: string; value: number | null }

/**
 * Line chart with optional forecast tail and comparison line, matching the design's SVG style.
 */
export function TrendChart({ width, height, series, compare, forecastIndex, yTicks }: {
  width: number; height: number;
  series: TrendPoint[];
  compare?: Array<number | null>;
  forecastIndex?: number;        // index from which the line is dashed amber
  yTicks?: boolean;
}) {
  const padT = 16, padB = 26, padL = yTicks ? 34 : 8, padR = 10;
  const vals = [
    ...series.map(s => s.value).filter((v): v is number => v !== null),
    ...(compare ?? []).filter((v): v is number => v !== null),
  ];
  const rawMin = Math.min(...vals), rawMax = Math.max(...vals);
  const span = Math.max(rawMax - rawMin, 1);
  const min = Math.max(0, rawMin - span * 0.25), max = rawMax + span * 0.15;
  const n = series.length;
  const xAt = (i: number) => padL + i * (width - padL - padR) / Math.max(n - 1, 1);
  const yAt = (v: number) => padT + (1 - (v - min) / (max - min)) * (height - padT - padB);

  const pts = (arr: Array<number | null>, from = 0, to = arr.length - 1) =>
    arr.map((v, i) => (v !== null && i >= from && i <= to ? `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}` : null))
      .filter(Boolean).join(' ');

  const fi = forecastIndex ?? series.length;
  const mainVals = series.map(s => s.value);
  const solid = pts(mainVals, 0, fi);
  const dashed = pts(mainVals, Math.max(fi, 0), series.length - 1);
  const lastSolidIdx = Math.min(fi, series.length - 1);
  const lastSolid = mainVals[lastSolidIdx];
  const lastVal = mainVals[series.length - 1];

  const gridYs = [0.18, 0.5, 0.82].map(f => padT + f * (height - padT - padB));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {gridYs.map((y, i) => <line key={i} x1={padL} y1={y} x2={width - padR} y2={y} stroke="#f0ede6" strokeWidth="1" />)}
      {yTicks && gridYs.map((y, i) => {
        const v = min + (1 - (y - padT) / (height - padT - padB)) * (max - min);
        return <text key={'t' + i} x={2} y={y + 3} fill="#c2bdb2" fontSize="10">${(v / 1000).toFixed(1)}k</text>;
      })}
      {compare && <polyline points={pts(compare)} fill="none" stroke="#c9c4ba" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
      <polyline points={solid} fill="none" stroke="#1f6f5c" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      {dashed && fi < series.length && (
        <polyline points={dashed} fill="none" stroke="#c8892b" strokeWidth="2.4" strokeDasharray="5 5" strokeLinecap="round" />
      )}
      {lastSolid !== null && lastSolid !== undefined && (
        <circle cx={xAt(lastSolidIdx)} cy={yAt(lastSolid)} r="3.4" fill="#1f6f5c" />
      )}
      {fi < series.length && lastVal !== null && lastVal !== undefined && (
        <circle cx={xAt(series.length - 1)} cy={yAt(lastVal)} r="4" fill="#fff" stroke="#c8892b" strokeWidth="2.2" />
      )}
      {series.map((s, i) => (
        <text key={'l' + i} x={xAt(i)} y={height - 8} fill="#a09c92" fontSize="10.5" textAnchor="middle">{s.label}</text>
      ))}
      {/* Invisible, generously-sized hover targets — a native <title> gives a tooltip with the
          exact value for free, with no extra state or hover-tracking JS. */}
      {series.map((s, i) => s.value === null ? null : (
        // i === fi is the last *actual* point — it's the anchor the dashed forecast segment
        // starts from (drawn as the solid filled dot above), not itself a projection.
        <circle key={'h' + i} cx={xAt(i)} cy={yAt(s.value)} r={10} fill="transparent" style={{ cursor: 'default' }}>
          <title>{`${s.label}: ${usd(s.value)}${i > fi ? ' (projected)' : ''}`}</title>
        </circle>
      ))}
    </svg>
  );
}

/** Conic-gradient donut matching the design. */
export function Donut({ slices, size, centerLabel, centerValue }: {
  slices: Array<{ color: string; pct: number }>;
  size: number;
  centerLabel: string;
  centerValue: string;
}) {
  let deg = 0;
  const stops: string[] = [];
  for (const s of slices) {
    const d = s.pct * 360;
    stops.push(`${s.color} ${deg.toFixed(2)}deg ${(deg + d).toFixed(2)}deg`);
    deg += d;
  }
  if (deg < 360) stops.push(`#efece5 ${deg.toFixed(2)}deg 360deg`);
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
      <div style={{ width: size, height: size, borderRadius: '50%', background: `conic-gradient(${stops.join(', ')})` }} />
      <div style={{ position: 'absolute', inset: size * 0.173, borderRadius: '50%', background: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: 10.5, color: 'var(--muted-2)', letterSpacing: '.04em' }}>{centerLabel}</div>
        <div style={{ fontSize: 20, fontWeight: 300, color: 'var(--ink)' }}>{centerValue}</div>
      </div>
    </div>
  );
}

/** Real SVG pie chart — unlike Donut (a CSS conic-gradient div), this can be exported as an image. */
export function PieChartSvg({ slices, size, id }: {
  slices: Array<{ color: string; pct: number; label: string }>;
  size: number;
  id?: string;
}) {
  const r = size / 2 - 2;
  const cx = size / 2, cy = size / 2;
  let angle = -90;
  const arcs = slices.filter(s => s.pct > 0.0005).map(s => {
    const start = angle;
    const sweep = s.pct * 360;
    angle += sweep;
    const end = angle;
    const large = sweep > 180 ? 1 : 0;
    const toXY = (deg: number) => {
      const rad = (deg * Math.PI) / 180;
      return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
    };
    if (sweep >= 359.999) {
      return <circle key={s.label} cx={cx} cy={cy} r={r} fill={s.color} />;
    }
    const [x1, y1] = toXY(start);
    const [x2, y2] = toXY(end);
    return <path key={s.label} d={`M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} Z`} fill={s.color} />;
  });
  return (
    <svg id={id} viewBox={`0 0 ${size} ${size}`} width={size} height={size} style={{ display: 'block' }}>
      <rect x="0" y="0" width={size} height={size} fill="#ffffff" />
      {arcs}
    </svg>
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function compactUsd(n: number): string {
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${Math.round(n)}`;
}

/**
 * Ranked horizontal bars — the clearest read on "which categories cost the most".
 * Real SVG (not divs) so it survives print and the PNG/SVG export path.
 */
export function BarChartH({ width, items, labelWidth = 116 }: {
  width: number;
  items: Array<{ label: string; value: number; color: string }>;
  labelWidth?: number;
}) {
  const rowH = 24, gap = 6, padT = 6, padB = 6, valueW = 62;
  const height = padT + padB + items.length * rowH + Math.max(items.length - 1, 0) * gap;
  const barMax = Math.max(width - labelWidth - valueW - 12, 20);
  const max = Math.max(...items.map(i => i.value), 1);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} style={{ width: '100%', height: 'auto', display: 'block' }}>
      <rect x="0" y="0" width={width} height={height} fill="#ffffff" />
      {items.map((it, i) => {
        const y = padT + i * (rowH + gap);
        const w = Math.max((it.value / max) * barMax, 2);
        return (
          <g key={it.label}>
            <text x={0} y={y + rowH / 2 + 4} fill="#5c584f" fontSize="11.5">{truncate(it.label, 18)}</text>
            <rect x={labelWidth} y={y + 3} width={barMax} height={rowH - 6} rx="4" fill="#f4f2ec" />
            <rect x={labelWidth} y={y + 3} width={w} height={rowH - 6} rx="4" fill={it.color} />
            <text x={width} y={y + rowH / 2 + 4} fill="#3a3730" fontSize="11.5" fontWeight="600" textAnchor="end">
              {compactUsd(it.value)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Monthly stacked bars by category — shows both total spend per month and its category mix.
 * `series[].values` are index-aligned with `labels`.
 */
export function StackedBarChart({ width, height, labels, series, onBarClick }: {
  width: number; height: number;
  labels: string[];
  series: Array<{ label: string; color: string; values: number[] }>;
  /** Optional drill-down hook. `seriesIndex` is -1 when the click landed on the day's empty
   * background rather than a specific segment (i.e. "this whole day", not "this one account"). */
  onBarClick?: (labelIndex: number, seriesIndex: number) => void;
}) {
  const padT = 12, padB = 24, padL = 38, padR = 8;
  const plotW = width - padL - padR, plotH = height - padT - padB;
  const totals = labels.map((_, i) => series.reduce((a, s) => a + (s.values[i] ?? 0), 0));
  const max = Math.max(...totals, 1);
  const n = Math.max(labels.length, 1);
  const slot = plotW / n;
  const barW = Math.min(slot * 0.62, 46);
  const yAt = (v: number) => padT + plotH - (v / max) * plotH;
  const gridYs = [0, 0.5, 1].map(f => padT + plotH * f);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} style={{ width: '100%', height: 'auto', display: 'block' }}>
      <rect x="0" y="0" width={width} height={height} fill="#ffffff" />
      {gridYs.map((y, i) => (
        <g key={i}>
          <line x1={padL} y1={y} x2={width - padR} y2={y} stroke="#f0ede6" strokeWidth="1" />
          <text x={padL - 5} y={y + 3} fill="#c2bdb2" fontSize="9.5" textAnchor="end">
            {compactUsd(max * (1 - i * 0.5))}
          </text>
        </g>
      ))}
      {labels.map((label, i) => {
        const cx = padL + slot * i + slot / 2;
        let cursor = 0;
        return (
          <g key={label + i}>
            {onBarClick && (
              <rect
                x={cx - slot / 2} y={padT} width={slot} height={plotH}
                fill="transparent" style={{ cursor: 'pointer' }}
                onClick={() => onBarClick(i, -1)}
              />
            )}
            {series.map((s, si) => {
              const v = s.values[i] ?? 0;
              if (v <= 0) return null;
              const h = (v / max) * plotH;
              const y = yAt(cursor + v);
              cursor += v;
              return (
                <rect
                  key={s.label} x={cx - barW / 2} y={y} width={barW} height={Math.max(h, 0.5)} fill={s.color}
                  style={onBarClick ? { cursor: 'pointer' } : undefined}
                  onClick={onBarClick ? () => onBarClick(i, si) : undefined}
                />
              );
            })}
            <text x={cx} y={height - 8} fill="#a09c92" fontSize="10.5" textAnchor="middle">{label}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** Serialize an <svg> element and trigger a download as .svg or .png (rasterized via canvas). */
export function downloadSvgAsImage(svg: SVGSVGElement, filename: string, format: 'svg' | 'png') {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const svgStr = new XMLSerializer().serializeToString(clone);

  if (format === 'svg') {
    const blob = new Blob([svgStr], { type: 'image/svg+xml' });
    triggerBlobDownload(blob, filename + '.svg');
    return;
  }
  const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  const img = new Image();
  img.onload = () => {
    const scale = 2;
    const w = svg.viewBox.baseVal.width || svg.clientWidth || 400;
    const h = svg.viewBox.baseVal.height || svg.clientHeight || 300;
    const canvas = document.createElement('canvas');
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    canvas.toBlob(blob => { if (blob) triggerBlobDownload(blob, filename + '.png'); }, 'image/png');
  };
  img.src = url;
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function TransferIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9b968c" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}><path d="M7 7h11l-3-3M17 17H6l3 3" /></svg>;
}

export function CreditIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#2f8f5b" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}><path d="M9 14l-4-4 4-4M5 10h9a5 5 0 0 1 5 5v3" /></svg>;
}
