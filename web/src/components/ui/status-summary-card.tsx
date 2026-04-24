import React from 'react';
import { CheckCircle2, XCircle, Activity, type LucideIcon } from 'lucide-react';

export type SummaryKind = 'passed' | 'failed' | 'running';

interface Props {
  kind: SummaryKind;
  value: number;
}

const map: Record<SummaryKind, { Icon: LucideIcon; label: string; tint: string }> = {
  passed:  { Icon: CheckCircle2, label: 'PASSED',  tint: 'text-[var(--green)]' },
  failed:  { Icon: XCircle,      label: 'FAILED',  tint: 'text-[var(--red)]'   },
  running: { Icon: Activity,     label: 'RUNNING', tint: 'text-[var(--amber)]' },
};

export const StatusSummaryCard: React.FC<Props> = ({ kind, value }) => {
  const { Icon, label, tint } = map[kind];
  return (
    <div className="flex-1 flex flex-col items-center gap-1 py-2 rounded-md border border-[var(--border)] bg-[var(--bg)]">
      <Icon className={`h-3.5 w-3.5 ${tint}`} />
      <span className={`text-[9px] font-mono font-semibold tracking-wider ${tint}`}>{label}</span>
      <span className="text-sm font-semibold text-[var(--text)] tabular-nums">{value}</span>
    </div>
  );
};
