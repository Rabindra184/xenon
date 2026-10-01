import React from 'react';
import type { ISession } from '../../interfaces/ISession';
import { StatTile } from '../ui/stat-tile';
import { compactDuration, sessionDurationMs } from '../builds/derive';
import { humanizeFailureCategory } from './derive';
import { commandStats, formatCommandDuration, type CommandLog } from './commands';
import { sessionStatusView } from './outcome-header';

interface Props {
  session: ISession;
  /** The session's command log (GET /session/:id/session_log). */
  commands: CommandLog[];
}

/** How the session ended, its commands, its self-healing and its slowest command. */
export const OutcomeTiles: React.FC<Props> = ({ session, commands }) => {
  const status = sessionStatusView(session.status);
  const stats = commandStats(commands);
  const ran = compactDuration(sessionDurationMs(session));
  const resultNote =
    status.bucket === 'failed'
      ? humanizeFailureCategory(session.failure_category) || 'No category recorded'
      : status.bucket === 'running'
        ? `Running for ${ran}`
        : `Ran ${ran}`;

  return (
    <div className="grid grid-cols-4 gap-3">
      <StatTile
        label="Result"
        value={status.label}
        valueCls={status.cls}
        note={resultNote}
        noteTone={status.bucket === 'failed' ? 'bad' : 'neutral'}
      />
      <StatTile
        label="Commands"
        value={stats.total}
        note={stats.failed > 0 ? `${stats.failed} failed` : 'None failed'}
        noteTone={stats.failed > 0 ? 'bad' : 'neutral'}
      />
      <StatTile
        label="Self-healing"
        value={stats.healed > 0 ? `${stats.healed} healed` : 'None'}
        note={
          stats.healed > 0
            ? stats.healedTiers.join(', ') || 'Tier not recorded'
            : 'No selector needed healing'
        }
      />
      <StatTile
        label="Slowest command"
        value={formatCommandDuration(stats.slowest?.ms)}
        note={stats.slowest?.name ?? 'No timings recorded'}
      />
    </div>
  );
};
