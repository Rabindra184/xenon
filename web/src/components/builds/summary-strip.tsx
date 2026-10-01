import React from 'react';
import type { ISessionSummary } from '../../interfaces/ISessionSummary';
import { compactDuration, passRate, passRateDelta } from './derive';

interface Props {
  /** null until the first answer: every tile shows a dash. */
  summary: ISessionSummary | null;
  /** The period in words ("7 days") for the comparison; null with none. */
  periodLabel: string | null;
}

type Tone = 'neutral' | 'good' | 'bad';

const toneCls: Record<Tone, string> = {
  neutral: 'text-[var(--text-muted)]',
  good: 'text-[var(--color-success)]',
  bad: 'text-[var(--color-danger)]',
};

const Tile: React.FC<{
  label: string;
  value: React.ReactNode;
  valueCls?: string;
  note?: React.ReactNode;
  noteTone?: Tone;
}> = ({ label, value, valueCls = 'text-[var(--text)]', note, noteTone = 'neutral' }) => (
  <div className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
    <div className="text-xs text-[var(--text-muted)]">{label}</div>
    <div className={`mt-1 text-2xl font-semibold tabular-nums leading-tight ${valueCls}`}>{value}</div>
    <div className={`mt-0.5 text-[11px] truncate ${toneCls[noteTone]}`}>{note ?? ' '}</div>
  </div>
);

/** A change in points, as people write it: "+2 pts", "−14 pts", "No change". */
function deltaText(points: number, periodLabel: string): { text: string; tone: Tone } {
  const rounded = Math.round(points);
  if (rounded === 0) return { text: `No change vs prior ${periodLabel}`, tone: 'neutral' };
  return rounded > 0
    ? { text: `+${rounded} pts vs prior ${periodLabel}`, tone: 'good' }
    : { text: `−${-rounded} pts vs prior ${periodLabel}`, tone: 'bad' };
}

/**
 * The Sessions page's headline numbers for the chosen period (or build):
 * pass rate and its change, failures, what runs now, and how long sessions
 * take.
 */
export const SummaryStrip: React.FC<Props> = ({ summary, periodLabel }) => {
  if (!summary) {
    return (
      <div className="grid grid-cols-4 gap-3 px-6 py-4 border-b border-[var(--border)]">
        <Tile label="Pass rate" value="—" />
        <Tile label="Failed" value="—" />
        <Tile label="Running now" value="—" />
        <Tile label="Median duration" value="—" />
      </div>
    );
  }

  const { current, previous, runningNow } = summary;
  const rate = passRate(current);
  const rated = current.passed + current.failed;
  const delta = periodLabel ? passRateDelta(current, previous) : null;
  const rateNote =
    delta !== null
      ? deltaText(delta, periodLabel as string)
      : rated > 0
        ? { text: `${current.passed} of ${rated} passed`, tone: 'neutral' as Tone }
        : { text: 'No finished sessions', tone: 'neutral' as Tone };

  return (
    <div className="grid grid-cols-4 gap-3 px-6 py-4 border-b border-[var(--border)]">
      <Tile
        label="Pass rate"
        value={rate === null ? '—' : `${Math.round(rate)}%`}
        note={rateNote.text}
        noteTone={rateNote.tone}
      />
      <Tile
        label="Failed"
        value={current.failed}
        valueCls={current.failed > 0 ? 'text-[var(--color-danger)]' : 'text-[var(--text)]'}
        note={`of ${current.total} session${current.total === 1 ? '' : 's'}`}
      />
      <Tile
        label="Running now"
        value={runningNow.sessions}
        note={
          runningNow.sessions > 0
            ? `on ${runningNow.devices} device${runningNow.devices === 1 ? '' : 's'}`
            : 'Nothing running'
        }
      />
      <Tile
        label="Median duration"
        value={compactDuration(current.medianMs)}
        note={current.p90Ms === null ? 'No finished sessions' : `p90 ${compactDuration(current.p90Ms)}`}
      />
    </div>
  );
};
