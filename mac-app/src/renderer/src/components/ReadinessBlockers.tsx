import type { PreflightResult } from '@shared/types';
import { OctagonAlert } from 'lucide-react';
import { SHELL } from '../copy/shell';
import { blockerLines } from '../readiness';

/** Part A's list of why Start is off, on Home and on Setup. */
export function ReadinessBlockers({ readiness }: { readiness: PreflightResult }) {
  return (
    <div
      data-testid="readiness-blockers"
      className="flex items-start gap-3 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-ink"
    >
      <OctagonAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
      <div className="min-w-0 flex-1">
        <strong>{SHELL.home.whyStartIsOff}</strong>
        <ul className="mt-1 list-disc pl-5">
          {blockerLines(readiness).map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
