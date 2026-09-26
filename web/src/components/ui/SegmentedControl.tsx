import * as React from 'react';
import { StatusDot, type StatusKind } from './StatusDot';
import './segmented-control.css';

export interface Segment<T extends string> {
  value: T;
  label: React.ReactNode;
  count?: number;
  /** A status dot before the label, in that state's colour (e.g. device filters). */
  tone?: StatusKind;
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
          className={`seg-btn${s.value === value ? ' seg-btn-active' : ''}`}
          onClick={() => onChange(s.value)}
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
