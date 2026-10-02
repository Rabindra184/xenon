import React, { useMemo } from 'react';
import { Card } from '../ui/Card';
import { ChartSeries, LineChart, niceMax } from '../session-detail/line-chart';
import { IHealingTrendDay } from '../../interfaces/IHealingEvent';
import { formatDay } from './format';

const ALL = 'var(--color-info)';
const AI = 'var(--color-warning)';

interface Props {
  /** null while the summary loads. */
  trend: IHealingTrendDay[] | null;
  days: number;
}

const Legend: React.FC<{ color: string; label: string; total: number }> = ({
  color,
  label,
  total,
}) => (
  <span className="flex items-center gap-1.5">
    <span className="inline-block h-0.5 w-3" style={{ background: color }} />
    <span>{label}</span>
    <span className="tabular-nums text-[var(--text)]">{total.toLocaleString()}</span>
  </span>
);

/** Heals per day over the period, with a second line for the heals that used AI. */
export const TrendChart: React.FC<Props> = ({ trend, days }) => {
  const list = useMemo(() => trend ?? [], [trend]);
  const start = list[0]?.t ?? 0;
  const total = list.reduce((s, d) => s + d.heals, 0);
  const ai = list.reduce((s, d) => s + d.aiHeals, 0);
  const times = useMemo(() => list.map((d) => d.t - start), [list, start]);
  const series: ChartSeries[] = useMemo(
    () => [
      { key: 'heals', label: 'All heals', color: ALL, values: list.map((d) => d.heals) },
      { key: 'ai', label: 'Heals that used AI', color: AI, values: list.map((d) => d.aiHeals) },
    ],
    [list],
  );
  const peak = list.reduce((m, d) => Math.max(m, d.heals), 0);

  let body: React.ReactNode;
  if (trend === null) {
    body = <div className="text-xs text-[var(--text-dim)]">Loading…</div>;
  } else if (total === 0) {
    body = <div className="text-xs text-[var(--text-dim)]">No heals in the last {days} days.</div>;
  } else {
    body = (
      <>
        <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--text-muted)]">
          <Legend color={ALL} label="All heals" total={total} />
          <Legend color={AI} label="Heals that used AI" total={ai} />
        </div>
        <LineChart
          times={times}
          series={series}
          yMax={niceMax(peak)}
          formatValue={(v) => String(Math.round(v))}
          formatTime={(t) => formatDay(start + t)}
          ariaLabel="Heals per day"
          height={120}
        />
      </>
    );
  }
  return <Card header="Heals per day">{body}</Card>;
};
