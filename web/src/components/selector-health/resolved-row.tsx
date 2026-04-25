import React from 'react';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { formatStrategy } from '../../utils/strategy-labels';
import { formatRelative } from '../../utils/time';
import type { IHealingHotspot } from '../../interfaces/IHealingEvent';

interface Props {
  hotspot: IHealingHotspot;
  onMute: (h: IHealingHotspot) => void;
  onOpen: (selector: string) => void;
}

// Per-row layout for the Resolved tab. Resolved selectors stay here
// indefinitely until either: (a) the user mutes them, or (b) a heal
// arrives, in which case the regression hook flips them back to Active
// with `regression_count++` (institutional memory: once a selector
// regresses we don't forget). The badge surfaces that count so a
// previously-unstable selector reads visibly different from one that
// resolved cleanly the first time.
export function ResolvedRow({ hotspot, onMute, onOpen }: Props) {
  const state = hotspot.state ?? null;
  const fixedAt = state?.fixed_at ?? null;
  const resolvedAt = state?.resolved_at ?? null;
  const cleanCount = state?.clean_builds_count ?? 0;
  const regressionCount = state?.regression_count ?? 0;

  return (
    <div
      className="sh-table__row sh-table__row--resolved"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(hotspot.originalSelector)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(hotspot.originalSelector);
        }
      }}
    >
      <div className="sh-resolved-row">
        <div className="sh-resolved-row__head">
          <CheckCircle2 size={14} className="sh-resolved-row__icon" />
          <span className="sh-strategy-badge">{formatStrategy(hotspot.originalStrategy)}</span>
          <code className="sh-resolved-row__selector" title={hotspot.originalSelector}>
            {hotspot.originalSelector}
          </code>
          {regressionCount > 0 && (
            <span
              className="sh-resolved-row__regression"
              title="This selector regressed at least once before being resolved again"
            >
              <AlertCircle size={11} /> Previously regressed {regressionCount}×
            </span>
          )}
        </div>
        <div className="sh-resolved-row__meta">
          Resolved {formatRelative(resolvedAt)} • {cleanCount} clean build{cleanCount === 1 ? '' : 's'} since fix
        </div>
        <div className="sh-resolved-row__history">
          Marked fixed {formatRelative(fixedAt)} • Verified {formatRelative(resolvedAt)}
        </div>
        <div className="sh-resolved-row__actions">
          <button
            type="button"
            className="sh-action-btn"
            onClick={(e) => {
              e.stopPropagation();
              onMute(hotspot);
            }}
            title="Hide this selector entirely (e.g. if it regresses again later)"
          >
            Mute
          </button>
        </div>
      </div>
    </div>
  );
}
