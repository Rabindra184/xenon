import React, { useMemo, useRef, useState } from 'react';
import { formatElapsed } from './performance';

export interface ChartSeries {
  key: string;
  label: string;
  /** A design token, e.g. `var(--color-info)`; never a literal colour. */
  color: string;
  values: Array<number | null>;
  dashed?: boolean;
  /** A label per point, shown in the tooltip in place of `label` (the app of each sample). */
  pointLabels?: Array<string | null>;
}

export interface LineChartProps {
  /** Milliseconds from the first sample, one per value. */
  times: number[];
  series: ChartSeries[];
  /** Top of the y axis; the data's own maximum, rounded up, when absent. */
  yMax?: number;
  formatValue: (v: number) => string;
  /** The tooltip's time label; elapsed time from the first sample when absent. */
  formatTime?: (t: number) => string;
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

/**
 * The indexes to draw for one series, at most `max`: the first and the last,
 * and in each of about max / 3 buckets its lowest and highest point, plus a
 * gap so a break in the line survives. Thinning to every n-th sample dropped
 * the spikes the legend's peak still reported.
 */
export function peakIndexes(values: Array<number | null>, max = MAX_POINTS): number[] {
  const n = values.length;
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  const buckets = Math.floor((max - 2) / 3);
  const size = n / buckets;
  const keep = new Set<number>([0, n - 1]);
  for (let b = 0; b < buckets; b += 1) {
    const to = Math.min(n, Math.floor((b + 1) * size));
    let lo = -1;
    let hi = -1;
    let gap = -1;
    for (let i = Math.floor(b * size); i < to; i += 1) {
      const v = values[i];
      if (v === null || v === undefined) {
        if (gap < 0) gap = i;
        continue;
      }
      if (lo < 0 || v < (values[lo] as number)) lo = i;
      if (hi < 0 || v > (values[hi] as number)) hi = i;
    }
    for (const i of [lo, hi, gap]) if (i >= 0) keep.add(i);
  }
  return Array.from(keep).sort((a, b) => a - b);
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
  formatTime,
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
  const indexes = useMemo(() => series.map((s) => peakIndexes(s.values)), [series]);

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
          {series.map((s, k) => (
            <path
              key={s.key}
              data-series={s.key}
              d={linePath(s.values, times, indexes[k], tMax, top, VIEW_W, height)}
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
            <div className="tabular-nums text-[var(--text-dim)]">
              {(formatTime ?? formatElapsed)(times[hover])}
            </div>
            {series.map((s) => {
              const v = s.values[hover];
              return (
                <div key={s.key} className="flex items-center gap-1.5 tabular-nums">
                  <span className="inline-block h-0.5 w-3" style={{ background: s.color }} />
                  <span className="text-[var(--text-muted)]">
                    {s.pointLabels?.[hover] ?? s.label}
                  </span>
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
