import { useMemo, useRef, useState } from 'react';

export interface Series { name: string; color: string; data: number[]; dashed?: boolean }

const W = 640;

/** Line chart with axis, gridlines, zero line and a hover readout of every series. Data are real game series. */
export function LineChart({ series, height = 200, format = (n: number) => n.toFixed(2), xLabel, xFormat }: { series: Series[]; height?: number; format?: (n: number) => string; xLabel?: string; xFormat?: (i: number, n: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const n = Math.max(0, ...series.map((s) => s.data.length));
  const { lo, hi } = useMemo(() => {
    const all = series.flatMap((s) => s.data).filter(Number.isFinite);
    if (!all.length) return { lo: 0, hi: 1 };
    let lo = Math.min(...all), hi = Math.max(...all);
    if (lo === hi) (lo -= Math.abs(lo) * 0.1 || 1), (hi += Math.abs(hi) * 0.1 || 1);
    const pad = (hi - lo) * 0.08;
    return { lo: lo - pad, hi: hi + pad };
  }, [series]);
  const H = height, L = 64, R = 10, T = 8, B = 22;
  const x = (i: number) => L + (n <= 1 ? 0 : (i / (n - 1)) * (W - L - R));
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => lo + t * (hi - lo));
  if (n < 2) return <div className="empty">Not enough history yet — check back after a few in-game days.</div>;
  const onMove = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(n - 1, Math.round(((px - L) / (W - L - R)) * (n - 1)))));
  };
  return (
    <div className="chart">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label={series.map((s) => `${s.name}: latest ${format(s.data[s.data.length - 1])}`).join('; ')}>
        <g className="grid">{ticks.map((t, i) => <line key={i} x1={L} x2={W - R} y1={y(t)} y2={y(t)} />)}</g>
        <g className="axis">
          {ticks.map((t, i) => <text key={i} x={L - 6} y={y(t) + 3} textAnchor="end">{format(t)}</text>)}
          {xLabel && <text x={W - R} y={H - 4} textAnchor="end">{xLabel}</text>}
          {xFormat && <text x={L} y={H - 4}>{xFormat(0, n)}</text>}
        </g>
        {lo < 0 && hi > 0 && <line className="zero" x1={L} x2={W - R} y1={y(0)} y2={y(0)} />}
        {series.map((s) => (
          <polyline key={s.name} fill="none" stroke={s.color} strokeWidth={1.8} strokeLinejoin="round" strokeDasharray={s.dashed ? '5 4' : undefined}
            points={s.data.map((v, i) => `${x(i + (n - s.data.length))},${y(v)}`).join(' ')} />
        ))}
        {hover !== null && (
          <g>
            <line className="hover-line" x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} />
            {series.map((s) => {
              const v = s.data[hover - (n - s.data.length)];
              return v === undefined ? null : <circle key={s.name} cx={x(hover)} cy={y(v)} r={3.5} fill={s.color} />;
            })}
          </g>
        )}
      </svg>
      <div className="legend">
        {series.map((s) => {
          const v = hover !== null ? s.data[hover - (n - s.data.length)] : s.data[s.data.length - 1];
          return <span key={s.name}><i className="swatch" style={{ background: s.color }} />{s.name} <b className="mono">{v === undefined ? '—' : format(v)}</b></span>;
        })}
        {hover !== null && xFormat && <span className="faint">{xFormat(hover, n)}</span>}
      </div>
    </div>
  );
}

export function Sparkline({ data, color, w = 110, h = 30 }: { data: number[]; color: string; w?: number; h?: number }) {
  if (data.length < 2) return <svg width={w} height={h} aria-hidden />;
  const lo = Math.min(...data), hi = Math.max(...data), span = hi - lo || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - 3 - ((v - lo) / span) * (h - 6)}`).join(' ');
  return (
    <svg width={w} height={h} className="spark" role="img" aria-label={`Range ${lo.toFixed(2)} to ${hi.toFixed(2)}`}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" />
    </svg>
  );
}

/** Horizontal bars for comparisons (crop profitability, divisions…). */
export function Bars({ rows, format }: { rows: { label: string; value: number; color?: string; sub?: string }[]; format: (n: number) => string }) {
  const max = Math.max(1e-9, ...rows.map((r) => Math.abs(r.value)));
  return (
    <div className="stack s">
      {rows.map((r) => (
        <div key={r.label} style={{ display: 'grid', gridTemplateColumns: '130px 1fr 90px', gap: 10, alignItems: 'center', fontSize: 13 }}>
          <span>{r.label}{r.sub && <span className="faint small"> {r.sub}</span>}</span>
          <div className="bar"><div style={{ width: `${(Math.abs(r.value) / max) * 100}%`, background: r.value < 0 ? 'var(--down)' : r.color ?? 'var(--accent)' }} /></div>
          <span className={`mono ${r.value < 0 ? 'down' : ''}`} style={{ textAlign: 'right' }}>{format(r.value)}</span>
        </div>
      ))}
    </div>
  );
}
