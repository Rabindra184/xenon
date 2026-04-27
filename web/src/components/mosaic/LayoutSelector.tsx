import * as React from 'react';
import type { Layout } from './recording-group-store';

const LAYOUTS: Layout[] = ['1', '2x1', '2x2', '3x2'];

interface Props {
  value: Layout;
  onChange: (l: Layout) => void;
}

export function LayoutSelector({ value, onChange }: Props) {
  return (
    <div role="tablist" className="inline-flex border border-[var(--border)] rounded overflow-hidden text-xs">
      {LAYOUTS.map((l) => (
        <button
          key={l}
          role="tab"
          aria-selected={value === l}
          onClick={() => onChange(l)}
          className={`px-2 py-1 ${
            value === l
              ? 'bg-[var(--surface-2,#222)] text-[var(--text)]'
              : 'text-[var(--text-dim)] hover:bg-[var(--surface-2,#1a1a1a)]'
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
