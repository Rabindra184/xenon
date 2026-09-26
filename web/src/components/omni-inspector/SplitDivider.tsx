import React, { useRef, useState } from 'react';
import { DIVIDER_PX, SPLIT_STEP, type SplitLimits } from './splitPane';

interface SplitDividerProps {
  share: number;
  limits: SplitLimits;
  containerRef: React.RefObject<HTMLElement>;
  onChange: (share: number) => void;
  onCommit: (share: number) => void;
  onReset: () => void;
}

/** The handle between the tree and the details: drag it, or focus it and use ← → Home End. */
export default function SplitDivider({
  share,
  limits,
  containerRef,
  onChange,
  onCommit,
  onReset,
}: SplitDividerProps) {
  const [dragging, setDragging] = useState(false);
  const latest = useRef(share);
  latest.current = share;
  const clamp = (s: number) => Math.min(limits.max, Math.max(limits.min, s));
  const pct = (s: number) => Math.round(s * 100);

  const fromPointer = (clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= DIVIDER_PX) return latest.current;
    return clamp((clientX - rect.left - DIVIDER_PX / 2) / (rect.width - DIVIDER_PX));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const next =
      e.key === 'ArrowLeft'
        ? share - SPLIT_STEP
        : e.key === 'ArrowRight'
          ? share + SPLIT_STEP
          : e.key === 'Home'
            ? limits.min
            : e.key === 'End'
              ? limits.max
              : null;
    if (next === null) return;
    e.preventDefault();
    // Rounded so repeated steps don't drift (0.4 - 0.02 - 0.02 = 0.36000000000000004).
    onCommit(clamp(Math.round(next * 1000) / 1000));
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize element tree"
      aria-valuenow={pct(share)}
      aria-valuemin={pct(limits.min)}
      aria-valuemax={pct(limits.max)}
      tabIndex={0}
      className={`omni-split-divider${dragging ? ' is-dragging' : ''}`}
      onKeyDown={onKeyDown}
      onDoubleClick={onReset}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        setDragging(true);
      }}
      onPointerMove={(e) => {
        if (dragging) onChange(fromPointer(e.clientX));
      }}
      onPointerUp={(e) => {
        if (!dragging) return;
        e.currentTarget.releasePointerCapture?.(e.pointerId);
        setDragging(false);
        onCommit(latest.current);
      }}
    >
      <span className="omni-split-divider__grip" aria-hidden="true" />
    </div>
  );
}
