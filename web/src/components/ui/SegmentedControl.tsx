import * as React from 'react';
import { StatusDot, type StatusKind } from './StatusDot';
import './segmented-control.css';

export interface Segment<T extends string> {
  value: T;
  label: React.ReactNode;
  count?: number;
  /** A status dot before the label, in that state's colour (e.g. device filters). */
  tone?: StatusKind;
  /** Unavailable for now; `title` should say why. */
  disabled?: boolean;
  /** Tooltip. A string label stays the accessible name. */
  title?: string;
  /** Announced shortcut, e.g. "Escape" (aria-keyshortcuts). */
  keyShortcuts?: string;
}

export interface SegmentedControlProps<T extends string> {
  segments: Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
}

export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
  size = 'md',
}: SegmentedControlProps<T>) {
  return (
    <div className={`seg seg-${size}`} role="tablist">
      {segments.map((s) => (
        <button
          key={s.value}
          role="tab"
          aria-selected={s.value === value}
          aria-label={s.title && typeof s.label === 'string' ? s.label : undefined}
          aria-keyshortcuts={s.keyShortcuts}
          title={s.title}
          disabled={s.disabled}
          className={`seg-btn${s.value === value ? ' seg-btn-active' : ''}`}
          onClick={() => {
            if (!s.disabled) onChange(s.value);
          }}
          type="button"
        >
          {s.tone && <StatusDot kind={s.tone} />}
          <span>{s.label}</span>
          {typeof s.count === 'number' && (
            <span className={`seg-count${s.count === 0 ? ' seg-count-zero' : ''}`}>{s.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}
