import React from 'react';
import { Hourglass, X } from 'lucide-react';
import { formatStrategy } from '../../utils/strategy-labels';
import { formatRelative } from '../../utils/time';
import type { IHealingHotspot } from '../../interfaces/IHealingEvent';

interface Props {
  hotspot: IHealingHotspot;
  onCancel: (h: IHealingHotspot) => void;
  onMute: (h: IHealingHotspot) => void;
  onOpen: (selector: string) => void;
}

// One row in the Pending Verification tab. The progress dots come from
// `clean_builds_count` on the SelectorState overlay; once it hits 3, the
// SelectorVerificationJob promotes the row to Resolved on its next pass
// and emits SELECTOR_RESOLVED so the dashboard can move it.
export function PendingRow({ hotspot, onCancel, onMute, onOpen }: Props) {
  const state = hotspot.state ?? null;
  const cleanCount = state?.clean_builds_count ?? 0;
  const fixedAt = state?.fixed_at ?? null;
  const fixedBy = state?.fixed_by_api_key ?? null;

  return (
    <div
      className="sh-table__row sh-table__row--pending"
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
      <div className="sh-pending-row">
        <div className="sh-pending-row__head">
          <Hourglass size={14} className="sh-pending-row__icon" />
          <span className="sh-strategy-badge">{formatStrategy(hotspot.originalStrategy)}</span>
          <code className="sh-pending-row__selector" title={hotspot.originalSelector}>
            {hotspot.originalSelector}
          </code>
        </div>
        <div className="sh-pending-row__meta">
          Marked fixed {formatRelative(fixedAt)}
          {fixedBy ? ` by ${fixedBy}` : ''} • verifying…
        </div>
        <div className="sh-pending-progress">
          <div className="sh-pending-progress__dots" aria-label={`${cleanCount} of 3 clean builds`}>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className={`sh-pending-progress__dot ${
                  i < cleanCount ? 'sh-pending-progress__dot--filled' : ''
                }`}
              />
            ))}
          </div>
          <div className="sh-pending-progress__legend">
            {cleanCount} of 3 clean CI builds since fix
          </div>
          <div className="sh-pending-progress__hint">
            Only sessions with a build_id count toward verification — local runs do not.
          </div>
        </div>
        <div className="sh-pending-row__actions">
          <button
            type="button"
            className="sh-action-btn"
            onClick={(e) => {
              e.stopPropagation();
              onCancel(hotspot);
            }}
            title="Revert to Active without waiting for verification"
          >
            <X size={11} /> Cancel verification
          </button>
          <button
            type="button"
            className="sh-action-btn"
            onClick={(e) => {
              e.stopPropagation();
              onMute(hotspot);
            }}
            title="Mute this selector instead of verifying it"
          >
            Mute
          </button>
        </div>
      </div>
    </div>
  );
}
