import * as React from 'react';
import type { Layout } from './recording-group-store';

const LAYOUTS: Array<{ id: Layout; label: string; icon: React.ReactNode }> = [
  { id: '1', label: '1', icon: <SoloIcon /> },
  { id: '2x1', label: '2×1', icon: <Grid2x1Icon /> },
  { id: '2x2', label: '2×2', icon: <Grid2x2Icon /> },
  { id: '3x2', label: '3×2', icon: <Grid3x2Icon /> },
  { id: 'auto', label: 'Auto', icon: <AutoIcon /> },
];

interface Props {
  value: Layout;
  onChange: (l: Layout) => void;
}

export function LayoutSelector({ value, onChange }: Props) {
  return (
    <div
      role="tablist"
      className="inline-flex border border-[var(--border)] rounded-md overflow-hidden text-xs bg-[var(--surface-1,rgba(255,255,255,0.02))]"
    >
      {LAYOUTS.map((l) => {
        const active = value === l.id;
        return (
          <button
            key={l.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(l.id)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 border-r border-[var(--border)] last:border-r-0 transition-colors ${
              active
                ? 'bg-[var(--surface-2,#2a2a2a)] text-white'
                : 'text-[var(--text-dim)] hover:bg-[var(--surface-2,rgba(255,255,255,0.04))] hover:text-white'
            }`}
            title={`Layout: ${l.label}`}
          >
            <span className="w-3.5 h-3.5 inline-flex items-center justify-center">
              {l.icon}
            </span>
            <span>{l.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// Tiny inline SVG icons — lightweight, no extra dependency.
function rect(props: React.SVGProps<SVGRectElement>) {
  return <rect rx={1.2} ry={1.2} fill="currentColor" {...props} />;
}

function SoloIcon() {
  return (
    <svg viewBox="0 0 14 14" className="w-3.5 h-3.5">
      {rect({ x: 2, y: 2, width: 10, height: 10 })}
    </svg>
  );
}
function Grid2x1Icon() {
  return (
    <svg viewBox="0 0 14 14" className="w-3.5 h-3.5">
      {rect({ x: 1.5, y: 3, width: 5, height: 8 })}
      {rect({ x: 7.5, y: 3, width: 5, height: 8 })}
    </svg>
  );
}
function Grid2x2Icon() {
  return (
    <svg viewBox="0 0 14 14" className="w-3.5 h-3.5">
      {rect({ x: 1.5, y: 1.5, width: 5, height: 5 })}
      {rect({ x: 7.5, y: 1.5, width: 5, height: 5 })}
      {rect({ x: 1.5, y: 7.5, width: 5, height: 5 })}
      {rect({ x: 7.5, y: 7.5, width: 5, height: 5 })}
    </svg>
  );
}
function Grid3x2Icon() {
  return (
    <svg viewBox="0 0 14 14" className="w-3.5 h-3.5">
      {rect({ x: 1, y: 1.5, width: 3.3, height: 5 })}
      {rect({ x: 5.35, y: 1.5, width: 3.3, height: 5 })}
      {rect({ x: 9.7, y: 1.5, width: 3.3, height: 5 })}
      {rect({ x: 1, y: 7.5, width: 3.3, height: 5 })}
      {rect({ x: 5.35, y: 7.5, width: 3.3, height: 5 })}
      {rect({ x: 9.7, y: 7.5, width: 3.3, height: 5 })}
    </svg>
  );
}
function AutoIcon() {
  return (
    <svg viewBox="0 0 14 14" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="2" y="2" width="10" height="10" rx="1.5" />
      <circle cx="7" cy="7" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}
