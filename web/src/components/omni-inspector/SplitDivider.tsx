import React, { useRef, useState } from 'react';
import { DIVIDER_PX, SPLIT_STEP, type SplitLimits } from './splitPane';

/** How far the pointer travels before a press is a drag, not a click. */
const DRAG_THRESHOLD_PX = 3;

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
  // Guards against ending (and committing) the same drag twice: pointerup
  // calls releasePointerCapture, which fires its own lostpointercapture right
  // behind it, and a drag can also end via pointercancel (a competing
  // touch/pen gesture — touch-action: none makes touch drags possible here —
  // or the browser simply dropping capture) instead of pointerup. Whichever
  // fires first wins; the rest are no-ops.
  const ended = useRef(true);
  // Whether this drag changed the share. A press and release that didn't
  // commits nothing: the shown share may be clamped to a narrow window, and
  // committing it would overwrite a wider stored preference. Nor does a
  // click's jitter count: the pointer must first travel DRAG_THRESHOLD_PX
  // from where it went down.
  const moved = useRef(false);
  // Where the pointer went down, and the share then: a drag moves the share
  // by the pointer's travel, so grabbing the 12px handle off-centre doesn't
  // make it jump to centre itself under the pointer.
  const startX = useRef(0);
  const startShare = useRef(share);
  const clamp = (s: number) => Math.min(limits.max, Math.max(limits.min, s));
  const pct = (s: number) => Math.round(s * 100);

  const endDrag = () => {
    if (ended.current) return;
    ended.current = true;
    setDragging(false);
    if (moved.current) onCommit(latest.current);
  };

  const fromPointer = (clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= DIVIDER_PX) return latest.current;
    return clamp(startShare.current + (clientX - startX.current) / (rect.width - DIVIDER_PX));
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
        ended.current = false;
        moved.current = false;
        startX.current = e.clientX;
        startShare.current = latest.current;
        setDragging(true);
      }}
      onPointerMove={(e) => {
        if (!dragging) return;
        if (!moved.current && Math.abs(e.clientX - startX.current) < DRAG_THRESHOLD_PX) return;
        const next = fromPointer(e.clientX);
        if (next === latest.current) return;
        moved.current = true;
        onChange(next);
      }}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture?.(e.pointerId);
        endDrag();
      }}
      onPointerCancel={(e) => {
        e.currentTarget.releasePointerCapture?.(e.pointerId);
        endDrag();
      }}
      onLostPointerCapture={endDrag}
    >
      <span className="omni-split-divider__grip" aria-hidden="true" />
    </div>
  );
}
