import type { ComponentProps, ReactNode } from 'react';
import { HealthPanel } from '../components/HealthPanel';

interface Props {
  /** "Xenon 2.17.0 is installed", or null while it is being read. */
  versionLine: string | null;
  /** Why Start is off, when it is (ReadinessBlockers), or null. */
  blockers: ReactNode;
  health: ComponentProps<typeof HealthPanel>;
}

/** Setup, until its own screen (B4): the installed Xenon, why Start is off, and Part A's checks. */
export function Setup({ versionLine, blockers, health }: Props) {
  return (
    <div className="space-y-4">
      {versionLine && (
        <p data-testid="plugin-version" className="text-sm font-medium text-ink">
          {versionLine}
        </p>
      )}
      {blockers}
      <HealthPanel {...health} />
    </div>
  );
}
