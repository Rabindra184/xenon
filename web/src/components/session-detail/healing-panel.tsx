import React from 'react';
import { Sparkles, ArrowRight } from 'lucide-react';
import { healedCommands, type CommandLog } from './commands';
import { logTimestamp } from './log-derive';

interface Props {
  commands: CommandLog[];
}

/**
 * Every selector self-healing fixed in this session: what the test asked
 * for, what it healed to, by which tier and how sure. Nothing when no
 * command was healed.
 */
export const HealingPanel: React.FC<Props> = ({ commands }) => {
  const heals = healedCommands(commands);
  if (heals.length === 0) return null;

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)]">
        <Sparkles className="h-4 w-4 text-[var(--color-warning)]" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-[var(--text)]">Self-healing</h2>
        <span className="text-[11px] text-[var(--text-muted)]">
          {heals.length} selector{heals.length === 1 ? '' : 's'} healed. Update the test so the next
          run doesn't need to.
        </span>
      </header>
      <table className="w-full table-fixed text-left">
        <thead>
          <tr className="border-b border-[var(--border)] text-[11px] text-[var(--text-dim)]">
            <th className="px-4 py-2 font-medium w-[88px]">Time</th>
            <th className="px-3 py-2 font-medium w-[128px]">Command</th>
            <th className="px-3 py-2 font-medium">Asked for</th>
            <th className="w-[28px]">
              <span className="sr-only">healed to</span>
            </th>
            <th className="px-3 py-2 font-medium">Healed to</th>
            <th className="px-3 py-2 font-medium w-[112px]">Tier</th>
            <th className="px-4 py-2 font-medium w-[96px] text-right">Confidence</th>
          </tr>
        </thead>
        <tbody>
          {heals.map((h, i) => (
            <tr
              key={h.id ?? i}
              className="border-b border-[var(--border)] last:border-b-0 align-top"
            >
              <td className="px-4 py-2 text-xs text-[var(--text-muted)] tabular-nums">
                {logTimestamp({ timestamp: h.at ?? null })}
              </td>
              <td className="px-3 py-2 text-xs text-[var(--text)] truncate">{h.command}</td>
              <td className="px-3 py-2 font-mono text-[11px] text-[var(--text-muted)] break-all">
                {h.original ?? '—'}
              </td>
              <td className="py-2 text-[var(--text-dim)]">
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </td>
              <td className="px-3 py-2 font-mono text-[11px] text-[var(--text)] break-all">
                {h.healed ?? '—'}
              </td>
              <td className="px-3 py-2 text-xs text-[var(--text)]">{h.tier ?? '—'}</td>
              <td className="px-4 py-2 text-xs text-[var(--text)] tabular-nums text-right">
                {h.confidence === null ? '—' : `${h.confidence}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
};
