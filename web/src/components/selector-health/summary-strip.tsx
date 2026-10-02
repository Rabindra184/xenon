import React from 'react';
import { StatTile } from '../ui/stat-tile';
import { IHealingSummaryResponse } from '../../interfaces/IHealingEvent';
import { compareNote, formatDuration } from './format';

interface Props {
  summary: IHealingSummaryResponse | null;
  days: number;
}

const count = (n: number) => n.toLocaleString();

/** The period's four numbers, each compared with the period before it. */
export const SummaryStrip: React.FC<Props> = ({ summary, days }) => {
  const cur = summary?.current;
  const prior = summary?.prior;
  const tiles = [
    {
      label: 'Selectors that needed healing',
      value: cur?.distinctSelectors,
      before: prior?.distinctSelectors,
      kind: 'count' as const,
      show: count,
    },
    {
      label: 'Heals',
      value: cur?.totalHeals,
      before: prior?.totalHeals,
      kind: 'percent' as const,
      show: count,
    },
    {
      label: 'Sessions affected',
      value: cur?.sessionsTouched,
      before: prior?.sessionsTouched,
      kind: 'percent' as const,
      show: count,
    },
    {
      label: 'Time spent healing',
      value: cur?.timeSpentMs,
      before: prior?.timeSpentMs,
      kind: 'duration' as const,
      show: formatDuration,
    },
  ];
  return (
    <div className="grid grid-cols-4 gap-3">
      {tiles.map((t) => {
        const note =
          t.value !== undefined && t.before !== undefined
            ? compareNote(t.value, t.before, days, t.kind)
            : null;
        return (
          <StatTile
            key={t.label}
            label={t.label}
            value={t.value !== undefined ? t.show(t.value) : '—'}
            note={note?.text}
            noteTone={note?.tone ?? 'neutral'}
          />
        );
      })}
    </div>
  );
};
