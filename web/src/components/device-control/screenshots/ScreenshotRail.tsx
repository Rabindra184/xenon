import * as React from 'react';
import { Camera, Loader2, PenLine } from 'lucide-react';
import { Button } from '../../ui/button';
import { captureLabel, timeText } from './captureMeta';
import type { Capture } from './useScreenshots';

interface Props {
  captures: Capture[];
  /** The highlighted capture: the selected one, or the right side while comparing. */
  activeId: string | null;
  /** While comparing: the two sides, shown as A and B. */
  compare?: { a: string; b: string | null };
  taking: boolean;
  onTake: () => void;
  onPick: (id: string) => void;
  onDelete: (id: string) => void;
}

/**
 * The Take screenshot button and the captures, newest first. A listbox: the
 * arrow keys move through it, Home and End go to the newest and the oldest,
 * Delete removes the selected one.
 */
export function ScreenshotRail({
  captures,
  activeId,
  compare,
  taking,
  onTake,
  onPick,
  onDelete,
}: Props) {
  const listRef = React.useRef<HTMLDivElement>(null);
  const now = Date.now();

  const focusOption = (id: string) => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-capture="${id}"]`);
    el?.focus();
    el?.scrollIntoView?.({ block: 'nearest' });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!captures.length) return;
    const i = Math.max(
      0,
      captures.findIndex((c) => c.id === activeId),
    );
    let next: number | null = null;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight')
      next = Math.min(captures.length - 1, i + 1);
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = Math.max(0, i - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = captures.length - 1;
    else if ((e.key === 'Delete' || e.key === 'Backspace') && activeId && !compare) {
      e.preventDefault();
      onDelete(activeId);
      return;
    }
    if (next === null) return;
    e.preventDefault();
    onPick(captures[next].id);
    focusOption(captures[next].id);
  };

  const sideOf = (id: string) =>
    compare ? (compare.a === id ? 'A' : compare.b === id ? 'B' : null) : null;

  return (
    <div className="shots-rail">
      <Button className="shots-take" size="md" onClick={onTake} disabled={taking}>
        {taking ? (
          <Loader2 className="animate-spin" size={14} aria-hidden="true" />
        ) : (
          <Camera size={14} aria-hidden="true" />
        )}
        {taking ? 'Taking screenshot…' : 'Take screenshot'}
      </Button>
      <div
        ref={listRef}
        className="shots-list"
        role="listbox"
        aria-label={compare ? 'Screenshots, pick the right side' : 'Screenshots'}
        onKeyDown={onKeyDown}
      >
        {taking && <div className="shots-thumb is-pending" aria-hidden="true" />}
        {captures.map((c) => {
          const active = c.id === activeId;
          const side = sideOf(c.id);
          return (
            <div
              key={c.id}
              data-capture={c.id}
              role="option"
              aria-selected={active}
              tabIndex={active || (!activeId && c === captures[0]) ? 0 : -1}
              className={`shots-thumb${active ? ' is-active' : ''}${side ? ' is-compared' : ''}`}
              aria-label={`${captureLabel(c)}${
                c.markedFrom !== undefined ? `, marked copy of ${c.markedFrom}` : ''
              }, ${timeText(c.takenAt, now)}${side ? `, side ${side}` : ''}`}
              onClick={() => onPick(c.id)}
            >
              <img src={c.thumbUrl} alt="" draggable={false} />
              {side && <span className="shots-thumb-side">{side}</span>}
              <span className="shots-thumb-label">
                <span className="shots-thumb-n">
                  {c.markedFrom !== undefined && <PenLine size={10} aria-hidden="true" />}
                  {c.n}
                </span>
                <span className="shots-thumb-time">
                  {timeText(c.takenAt, now).replace('Today ', '')}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
