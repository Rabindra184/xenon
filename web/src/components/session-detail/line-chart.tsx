import React, { useMemo, useRef, useState } from 'react';
import { formatElapsed } from './performance';

export interface ChartSeries {
  key: string;
  label: string;
  /** A design token, e.g. `var(--color-info)`; never a literal colour. */
  color: string;
  values: Array<number | null>;
  dashed?: boolean;
}

export interface LineChartProps {
  /** Milliseconds from the first sample, one per value. */
  times: number[];
  series: ChartSeries[];
  /** Top of the y axis; the data's own maximum, rounded up, when absent. */
  yMax?: number;
  formatValue: (v: number) => string;
  ariaLabel: string;
  height?: number;
}

/** The viewBox is this wide; the svg stretches to its box and strokes keep their width. */
const VIEW_W = 1000;
/** A long session draws at most this many points per line. */
export const MAX_POINTS = 600;

/** A round number at or above `max`, for the top of the axis. */
export function niceMax(max: number): number {
  if (!(max > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (m * p >= max) return m * p;
  }
  return 10 * p;
}

/** The index of the time nearest `t` in ascending `times`; -1 when empty. */
export function nearestIndex(times: number[], t: number): number {
  if (times.length === 0) return -1;
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && t - times[lo - 1] <= times[lo] - t) return lo - 1;
  return lo;
}

/** Evenly spread indexes, at most `max`, always including the first and the last. */
export function sampleIndexes(n: number, max = MAX_POINTS): number[] {
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  const step = Math.ceil((n - 1) / (max - 1));
  const out: number[] = [];
  for (let i = 0; i < n - 1; i += step) out.push(i);
  out.push(n - 1);
  return out;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** An SVG path through the values at `indexes`; a missing value breaks the line. */
export function linePath(
  values: Array<number | null>,
  times: number[],
  indexes: number[],
  tMax: number,
  yMax: number,
  width: number,
  height: number,
): string {
  const parts: string[] = [];
  let pen = false;
  for (const i of indexes) {
    const v = values[i];
    if (v === null || v === undefined) {
      pen = false;
      continue;
    }
    const x = (times[i] / tMax) * width;
    const y = height - (Math.min(v, yMax) / yMax) * height;
    parts.push(`${pen ? 'L' : 'M'}${r2(x)} ${r2(y)}`);
    pen = true;
  }
  return parts.join(' ');
}

export const LineChart: React.FC<LineChartProps> = ({
  times,
  series,
  yMax,
  formatValue,
  ariaLabel,
  height = 140,
}) => {
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const tMax = Math.max(times.length ? times[times.length - 1] : 0, 1);
  const top = useMemo(() => {
    if (yMax !== undefined) return yMax;
    let max = 0;
    for (const s of series) for (const v of s.values) if (v !== null && v > max) max = v;
    return niceMax(max);
  }, [series, yMax]);
  const indexes = useMemo(() => sampleIndexes(times.length), [times.length]);

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || r.width <= 0 || times.length === 0) return;
    const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    setHover(nearestIndex(times, frac * tMax));
  };

  const hoverPct = hover !== null ? (times[hover] / tMax) * 100 : 0;
  return (
    <div className="flex gap-2">
      <div
        className="flex w-14 flex-col justify-between text-right text-[10px] tabular-nums text-[var(--text-dim)]"
        style={{ height }}
      >
        <span>{formatValue(top)}</span>
        <span>{formatValue(0)}</span>
      </div>
      <div
        ref={box}
        data-testid="line-chart"
        className="relative min-w-0 flex-1"
        style={{ height }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <svg
          role="img"
          aria-label={ariaLabel}
          viewBox={`0 0 ${VIEW_W} ${height}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full overflow-visible"
        >
          {[0, 0.5, 1].map((g) => (
            <line
              key={g}
              x1={0}
              x2={VIEW_W}
              y1={g * height}
              y2={g * height}
              stroke="var(--border)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {series.map((s) => (
            <path
              key={s.key}
              data-series={s.key}
              d={linePath(s.values, times, indexes, tMax, top, VIEW_W, height)}
              fill="none"
              stroke={s.color}
              strokeWidth={1.5}
              strokeLinejoin="round"
              strokeDasharray={s.dashed ? '4 3' : undefined}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {hover !== null && (
            <line
              x1={(hoverPct / 100) * VIEW_W}
              x2={(hoverPct / 100) * VIEW_W}
              y1={0}
              y2={height}
              stroke="var(--text-muted)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        {hover !== null && (
          <div
            role="tooltip"
            className="pointer-events-none absolute top-1 z-10 whitespace-nowrap rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-2 py-1 text-[11px] text-[var(--text)]"
            style={
              hoverPct > 60
                ? { right: `${100 - hoverPct}%`, marginRight: 8 }
                : { left: `${hoverPct}%`, marginLeft: 8 }
            }
          >
            <div className="tabular-nums text-[var(--text-dim)]">{formatElapsed(times[hover])}</div>
            {series.map((s) => {
              const v = s.values[hover];
              return (
                <div key={s.key} className="flex items-center gap-1.5 tabular-nums">
                  <span className="inline-block h-0.5 w-3" style={{ background: s.color }} />
                  <span className="text-[var(--text-muted)]">{s.label}</span>
                  <span className="ml-auto pl-3">
                    {v === null || v === undefined ? '—' : formatValue(v)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
