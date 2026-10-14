import React, { useState } from 'react';

/**
 * Dependency-free SVG charts for the dashboard and reports. Every chart accepts an `onSelect`
 * so a slice / bar / point can navigate somewhere, and renders legibly in both themes.
 */
export const CHART_COLORS = ['var(--brand)', 'var(--accent)', '#3b82f6', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#14b8a6', '#64748b'];

export interface Datum { label: string; value: number; color?: string; key?: string; hint?: string }

export function BarChart({ data, height = 160, horizontal = false, onSelect, valueFormat = (v) => String(v), showValues = true, maxBars }: { data: Datum[]; height?: number; horizontal?: boolean; onSelect?: (d: Datum) => void; valueFormat?: (v: number) => string; showValues?: boolean; maxBars?: number }) {
  const items = maxBars ? data.slice(0, maxBars) : data;
  const max = Math.max(1, ...items.map((d) => d.value));
  const [hover, setHover] = useState<number | null>(null);
  if (!items.length) return <div className="chart-empty">No data</div>;
  if (horizontal) {
    return (
      <div className="hbar-chart" role="img" aria-label="Bar chart">
        {items.map((d, i) => (
          <div key={d.key ?? d.label} className={`hbar-row ${onSelect ? 'clickable' : ''}`} onClick={() => onSelect?.(d)} title={d.hint || `${d.label}: ${valueFormat(d.value)}`}>
            <span className="hbar-label">{d.label}</span>
            <span className="hbar-track"><span className="hbar-fill" style={{ width: `${(d.value / max) * 100}%`, background: d.color || CHART_COLORS[i % CHART_COLORS.length] }} /></span>
            {showValues ? <span className="hbar-value num">{valueFormat(d.value)}</span> : null}
          </div>
        ))}
      </div>
    );
  }
  const w = 100, gap = 2, bw = (w - gap * (items.length - 1)) / items.length;
  return (
    <div className="vbar-chart" style={{ height }}>
      <svg viewBox={`0 0 ${w} 60`} preserveAspectRatio="none" className="vbar-svg" role="img" aria-label="Bar chart">
        {items.map((d, i) => {
          const h = (d.value / max) * 54;
          return (
            <rect key={d.key ?? d.label} x={i * (bw + gap)} y={58 - h} width={bw} height={Math.max(h, 0.5)} rx={0.8} fill={d.color || CHART_COLORS[i % CHART_COLORS.length]} opacity={hover === null || hover === i ? 1 : 0.45}
              className={onSelect ? 'clickable' : ''} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => onSelect?.(d)}>
              <title>{d.hint || `${d.label}: ${valueFormat(d.value)}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="vbar-labels">
        {items.map((d, i) => (
          <span key={d.key ?? d.label} className={`vbar-label ${hover === i ? 'active' : ''}`} style={{ width: `${100 / items.length}%` }} title={d.label}>
            {showValues ? <strong className="num">{valueFormat(d.value)}</strong> : null}
            <small>{d.label}</small>
          </span>
        ))}
      </div>
    </div>
  );
}

export function DonutChart({ data, size = 140, thickness = 22, onSelect, centerLabel, valueFormat = (v) => String(v) }: { data: Datum[]; size?: number; thickness?: number; onSelect?: (d: Datum) => void; centerLabel?: React.ReactNode; valueFormat?: (v: number) => string }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div className="donut">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Donut chart">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={thickness} />
        {total > 0 && data.map((d, i) => {
          const len = (d.value / total) * c;
          const el = (
            <circle key={d.key ?? d.label} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={d.color || CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={hover === i ? thickness + 4 : thickness}
              strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} transform={`rotate(-90 ${size / 2} ${size / 2})`} className={onSelect ? 'clickable' : ''}
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => onSelect?.(d)}>
              <title>{d.hint || `${d.label}: ${valueFormat(d.value)} (${Math.round((d.value / total) * 100)}%)`}</title>
            </circle>
          );
          offset += len;
          return el;
        })}
        <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" className="donut-center">{hover !== null ? valueFormat(data[hover].value) : (centerLabel ?? valueFormat(total))}</text>
      </svg>
      <ul className="legend">
        {data.map((d, i) => (
          <li key={d.key ?? d.label} className={onSelect ? 'clickable' : ''} onClick={() => onSelect?.(d)} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <span className="swatch" style={{ background: d.color || CHART_COLORS[i % CHART_COLORS.length] }} />
            <span className="legend-label">{d.label}</span>
            <span className="legend-value num">{valueFormat(d.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LineChart({ series, labels, height = 140, onSelect, valueFormat = (v) => String(v), area = true }: { series: { name: string; values: number[]; color?: string }[]; labels: string[]; height?: number; onSelect?: (index: number) => void; valueFormat?: (v: number) => string; area?: boolean }) {
  const all = series.flatMap((s) => s.values);
  const max = Math.max(1, ...all);
  const min = Math.min(0, ...all);
  const n = labels.length;
  const w = 100, h = 50, pad = 2;
  const x = (i: number) => pad + (i * (w - pad * 2)) / Math.max(1, n - 1);
  const y = (v: number) => h - pad - ((v - min) / (max - min || 1)) * (h - pad * 2);
  const [hover, setHover] = useState<number | null>(null);
  if (!n) return <div className="chart-empty">No data</div>;
  return (
    <div className="line-chart" style={{ height }}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="line-svg" role="img" aria-label="Line chart">
        {[0.25, 0.5, 0.75].map((g) => <line key={g} x1={0} x2={w} y1={h * g} y2={h * g} stroke="var(--border)" strokeWidth={0.3} />)}
        {series.map((s, si) => {
          const color = s.color || CHART_COLORS[si % CHART_COLORS.length];
          const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
          return (
            <g key={s.name}>
              {area ? <polygon points={`${x(0)},${h - pad} ${pts} ${x(s.values.length - 1)},${h - pad}`} fill={color} opacity={0.12} /> : null}
              <polyline points={pts} fill="none" stroke={color} strokeWidth={1.2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            </g>
          );
        })}
        {labels.map((_, i) => (
          <rect key={i} x={x(i) - (w / n) / 2} y={0} width={w / n} height={h} fill="transparent" className={onSelect ? 'clickable' : ''} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => onSelect?.(i)} />
        ))}
        {hover !== null ? <line x1={x(hover)} x2={x(hover)} y1={0} y2={h} stroke="var(--muted)" strokeWidth={0.4} strokeDasharray="1 1" /> : null}
        {hover !== null && series.map((s, si) => <circle key={s.name} cx={x(hover)} cy={y(s.values[hover] ?? 0)} r={1.6} fill={s.color || CHART_COLORS[si % CHART_COLORS.length]} />)}
      </svg>
      <div className="line-footer">
        <span className="muted">{labels[0]}</span>
        <span className="line-tip">{hover !== null ? <><strong>{labels[hover]}</strong> {series.map((s) => `${s.name}: ${valueFormat(s.values[hover] ?? 0)}`).join(' · ')}</> : series.map((s, si) => <span key={s.name} className="legend-inline"><span className="swatch" style={{ background: s.color || CHART_COLORS[si % CHART_COLORS.length] }} />{s.name}</span>)}</span>
        <span className="muted">{labels[n - 1]}</span>
      </div>
    </div>
  );
}

export function Sparkline({ values, color = 'var(--brand)', width = 90, height = 28 }: { values: number[]; color?: string; width?: number; height?: number }) {
  const max = Math.max(1, ...values), min = Math.min(0, ...values);
  const pts = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * width},${height - ((v - min) / (max - min || 1)) * (height - 2) - 1}`).join(' ');
  return <svg width={width} height={height} className="sparkline" aria-hidden><polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" /></svg>;
}

export function Gauge({ value, max = 100, label, color = 'var(--brand)', size = 120 }: { value: number; max?: number; label?: string; color?: string; size?: number }) {
  const pct = Math.max(0, Math.min(1, value / (max || 1)));
  const r = size / 2 - 10, c = Math.PI * r;
  return (
    <div className="gauge" style={{ width: size }}>
      <svg width={size} height={size / 2 + 12} viewBox={`0 0 ${size} ${size / 2 + 12}`} aria-hidden>
        <path d={`M10 ${size / 2} A ${r} ${r} 0 0 1 ${size - 10} ${size / 2}`} fill="none" stroke="var(--border)" strokeWidth={10} strokeLinecap="round" />
        <path d={`M10 ${size / 2} A ${r} ${r} 0 0 1 ${size - 10} ${size / 2}`} fill="none" stroke={color} strokeWidth={10} strokeLinecap="round" strokeDasharray={`${pct * c} ${c}`} />
        <text x="50%" y={size / 2 - 2} textAnchor="middle" className="gauge-value">{Math.round(pct * 100)}%</text>
      </svg>
      {label ? <div className="gauge-label">{label}</div> : null}
    </div>
  );
}

export function Heatmap({ rows, cols, values, onSelect, colorFor }: { rows: string[]; cols: string[]; values: number[][]; onSelect?: (r: number, c: number) => void; colorFor?: (v: number) => string }) {
  const max = Math.max(1, ...values.flat());
  const def = (v: number) => `color-mix(in srgb, var(--brand) ${Math.round((v / max) * 85)}%, var(--surface-2))`;
  return (
    <div className="heatmap" style={{ gridTemplateColumns: `auto repeat(${cols.length}, 1fr)` }}>
      <span />
      {cols.map((c) => <span key={c} className="heat-col">{c}</span>)}
      {rows.map((r, ri) => (
        <React.Fragment key={r}>
          <span className="heat-row">{r}</span>
          {cols.map((c, ci) => (
            <span key={c} className={`heat-cell ${onSelect ? 'clickable' : ''}`} style={{ background: (colorFor || def)(values[ri]?.[ci] ?? 0) }} title={`${r} · ${c}: ${values[ri]?.[ci] ?? 0}`} onClick={() => onSelect?.(ri, ci)}>{values[ri]?.[ci] ?? ''}</span>
          ))}
        </React.Fragment>
      ))}
    </div>
  );
}
