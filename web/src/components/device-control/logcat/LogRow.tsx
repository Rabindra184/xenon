import * as React from 'react';
import { memo } from 'react';
import { splitMatches } from './findHighlight';
import { formatTime } from './logFormat';
import { tagColor } from './tagColor';
import type { BufferedLogcatRecord } from './useLogcatStream';

export interface LogRowProps {
  record: BufferedLogcatRecord;
  /** Position among the shown lines, from 0. */
  index: number;
  /** How many lines are shown. */
  setSize: number;
  /** Pixels from the top of the list. */
  start: number;
  id: string;
  selected: boolean;
  /** The line the keyboard is on. */
  active: boolean;
  hit: boolean;
  activeHit: boolean;
  find: string;
  caseSensitive: boolean;
  /** The virtualizer's measuring ref: rows vary in height once they wrap. */
  measureRef: (el: Element | null) => void;
}

/** Text with each Find match in a `<mark>`. */
function Marked({ text, find, caseSensitive }: { text: string; find: string; caseSensitive: boolean }) {
  if (!find) return <>{text}</>;
  const parts = splitMatches(text, find, caseSensitive);
  if (parts.length === 1 && !parts[0].hit) return <>{text}</>;
  return (
    <>
      {parts.map((p, i) =>
        p.hit ? (
          <mark key={i} className="log-mark">
            {p.text}
          </mark>
        ) : (
          <React.Fragment key={i}>{p.text}</React.Fragment>
        ),
      )}
    </>
  );
}

/**
 * One log line. Memoized: the list re-renders on every update (20 a second at
 * full flow), and a row's own data rarely changes.
 *
 * The cells are positional: `logcat.css` lays them out as one line of five
 * columns when the panel is 720 px or wider and as two lines below that, so
 * their order here is the column order there. PID and TID are in the details
 * panel, not the row. Xenon's own records (dropped lines, end of stream) have
 * no tag or package cells; their message spans the row.
 */
export const LogRow = memo(function LogRow({
  record: r,
  index,
  setSize,
  start,
  id,
  selected,
  active,
  hit,
  activeHit,
  find,
  caseSensitive,
  measureRef,
}: LogRowProps) {
  const className = [
    'log-row',
    `lvl-${r.level}`,
    r.synthetic ? 'is-synthetic' : '',
    hit ? 'is-hit' : '',
    activeHit ? 'is-active-hit' : '',
    active ? 'is-active' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div
      ref={measureRef}
      role="option"
      id={id}
      aria-selected={selected}
      aria-setsize={setSize}
      aria-posinset={index + 1}
      data-index={index}
      data-seq={r.seq}
      className={className}
      style={{ transform: `translateY(${start}px)` }}
    >
      <span className="log-time">{formatTime(r.ts)}</span>
      <span className="log-badge">{r.level}</span>
      {!r.synthetic && (
        <>
          <span className="log-tag" title={r.tag} style={{ color: tagColor(r.tag) }}>
            <Marked text={r.tag} find={find} caseSensitive={caseSensitive} />
          </span>
          <span className="log-pkg" title={r.pkg}>
            {r.pkg ?? ''}
          </span>
        </>
      )}
      <span className="log-msg">
        <Marked text={r.message} find={find} caseSensitive={caseSensitive} />
      </span>
    </div>
  );
});
