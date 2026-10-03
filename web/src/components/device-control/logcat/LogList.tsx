import * as React from 'react';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { defaultRangeExtractor, elementScroll, useVirtualizer } from '@tanstack/react-virtual';
import { Button } from '../../ui/button';
import { LogRow } from './LogRow';
import { formatCount } from './logFormat';
import { clickSelection, moveSelection, type LogSelection } from './logSelection';
import type { BufferedLogcatRecord } from './useLogcatStream';

/** Within this of the bottom the list follows; scrolling further up pauses it. */
export const FOLLOW_SLACK_PX = 24;
/** How long after a wheel, touch, scroll key or scrollbar press a scroll is the user's. */
export const USER_INTENT_MS = 1000;

const ONE_LINE_PX = 20;
const TWO_LINE_PX = 38;
/** The panel width where a row becomes one line (`@container` in logcat.css). */
const WIDE_PX = 720;
const SCROLL_KEYS = ['PageUp', 'PageDown', 'Home', ' '];

export interface LogListHandle {
  /** Scrolls a shown line into the middle of the list (Find). */
  reveal(index: number): void;
  focus(): void;
}

export interface LogListProps {
  /** The shown lines. */
  records: readonly BufferedLogcatRecord[];
  /** The buffer's oldest line, shown or not: older than it means dropped. */
  oldestSeq: number | null;
  wrap: boolean;
  find: string;
  caseSensitive: boolean;
  /** Find's hits, as indexes into `records`. */
  hits: ReadonlySet<number>;
  activeHit: number | null;
  following: boolean;
  /** Shown lines that arrived since the list paused. */
  newLines: number;
  onPause(): void;
  onFollow(): void;
  selection: LogSelection;
  onSelect(next: LogSelection, active: BufferedLogcatRecord | null, via: 'click' | 'key'): void;
  onOpenDetails(record: BufferedLogcatRecord): void;
  onCopy(): void;
}

let lists = 0;

/**
 * Whether the list is wide enough for one-line rows. Only the size estimate
 * for rows not yet measured depends on it; the layout itself is CSS.
 */
function useWide(ref: React.RefObject<HTMLElement>): boolean {
  const [wide, setWide] = useState(true);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWide(el.offsetWidth >= WIDE_PX);
    const RO = (window as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    if (!RO) return;
    const observer = new RO((entries) => setWide(entries[0].contentRect.width >= WIDE_PX));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return wide;
}

/**
 * The log lines: only the rows on screen exist (`@tanstack/react-virtual`),
 * measured as they render, since wrapping makes their heights vary.
 *
 * Following: while `following`, every update scrolls to the newest line. A
 * scroll by the user that leaves the bottom more than 24 px away pauses it
 * (`onPause`); while paused, a scroll back to within 24 px follows again
 * (`onFollow`). Xenon's own scrolls never do either: see `onScroll` below.
 *
 * Paused, the virtualizer anchors to the first line on screen
 * (`anchorTo: 'end'`), so the buffer dropping its oldest lines doesn't move
 * what you are reading.
 */
export const LogList = forwardRef<LogListHandle, LogListProps>(function LogList(props, ref) {
  const { records, wrap, find, caseSensitive, hits, activeHit, following, newLines } = props;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [listId] = useState(() => `log-lines-${++lists}`);

  // Where Xenon last scrolled the list to. A scroll event that lands there
  // is Xenon's own.
  const ownTarget = useRef<number | null>(null);
  const followingRef = useRef(following);
  followingRef.current = following;
  const callbacks = useRef(props);
  callbacks.current = props;

  const wide = useWide(scrollerRef);

  // The keyboard's line, by index. Always rendered (see rangeExtractor), so
  // aria-activedescendant never names a row that doesn't exist.
  const active = props.selection.active;
  const activeIndex = useMemo(
    () => (active === null ? -1 : records.findIndex((r) => r.seq === active)),
    [records, active],
  );

  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: records.length,
    getScrollElement: () => scrollerRef.current,
    estimateSize: () => (wide ? ONE_LINE_PX : TWO_LINE_PX),
    getItemKey: (i) => records[i].seq,
    overscan: 10,
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range);
      if (activeIndex >= 0 && indexes.indexOf(activeIndex) < 0) {
        indexes.push(activeIndex);
        indexes.sort((a, b) => a - b);
      }
      return indexes;
    },
    anchorTo: following ? 'start' : 'end',
    scrollToFn: (offset, options, instance) => {
      const el = instance.scrollElement;
      const target = offset + (options.adjustments ?? 0);
      // The browser clamps; so does the target, or a clamped scroll of ours
      // would look like someone else's.
      ownTarget.current = el
        ? Math.max(0, Math.min(target, el.scrollHeight - el.clientHeight))
        : target;
      elementScroll(offset, options, instance);
    },
  });

  // Wrapping, or the switch between one- and two-line rows, changes every
  // row's height: drop the measurements and measure the rendered rows again.
  // (A ResizeObserver would catch the rendered rows, but not the cached
  // sizes of rows off screen, nor a row whose size happens not to change.)
  const measuredFor = useRef(`${wrap}|${wide}`);
  useLayoutEffect(() => {
    const mode = `${wrap}|${wide}`;
    if (measuredFor.current === mode) return;
    measuredFor.current = mode;
    virtualizer.measure();
    scrollerRef.current
      ?.querySelectorAll<HTMLDivElement>('[data-index]')
      .forEach((row) => virtualizer.measureElement(row));
  }, [wrap, wide, virtualizer]);

  const total = virtualizer.getTotalSize();
  const lastSeq = records.length ? records[records.length - 1].seq : -1;

  // The first line on screen, by seq, as of the last render or scroll. When
  // the buffer drops it while paused, the virtualizer has nothing to anchor
  // to: say so, and show the oldest line left, which is where it was.
  const recordsRef = useRef(records);
  recordsRef.current = records;
  const firstOnScreen = useRef<number | null>(null);
  const [dropped, setDropped] = useState(false);
  const noteFirstOnScreen = useRef(() => {});
  noteFirstOnScreen.current = () => {
    const el = scrollerRef.current;
    const shown = recordsRef.current;
    const item = el && shown.length ? virtualizer.getVirtualItemForOffset(el.scrollTop) : undefined;
    firstOnScreen.current = item && shown[item.index] ? shown[item.index].seq : null;
  };

  useLayoutEffect(() => {
    const was = firstOnScreen.current;
    const oldest = props.oldestSeq;
    if (!followingRef.current && was !== null && oldest !== null && was < oldest) {
      setDropped(true);
      virtualizer.scrollToOffset(0);
    }
    noteFirstOnScreen.current();
  }, [records, props.oldestSeq, virtualizer]);

  useEffect(() => {
    if (following) setDropped(false);
  }, [following]);

  // Follow: to the newest line on every update, and again when measuring
  // changes the total height.
  useLayoutEffect(() => {
    if (!following || !records.length) return;
    virtualizer.scrollToOffset(total);
  }, [following, lastSeq, records.length, total, virtualizer]);

  // Who scrolled. A scroll is the user's only if it isn't where Xenon last
  // scrolled to, and the user has just wheeled, touched, pressed a scroll key
  // or the scrollbar. Anything else (Xenon's follow and anchor scrolls, the
  // browser clamping after the list shrank) neither pauses nor resumes.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let intentAt = 0;
    let pointerDown = false;
    const intent = () => {
      intentAt = Date.now();
    };
    const onPointerDown = (e: Event) => {
      // The list itself, not a row: its scrollbar.
      if (e.target !== el) return;
      pointerDown = true;
      intent();
    };
    const onPointerUp = () => {
      if (pointerDown) intent();
      pointerDown = false;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (SCROLL_KEYS.indexOf(e.key) >= 0) intent();
    };
    const onScroll = () => {
      noteFirstOnScreen.current();
      const scrollTop = el.scrollTop;
      if (ownTarget.current !== null && Math.abs(scrollTop - ownTarget.current) < 2) return;
      ownTarget.current = null;
      if (!pointerDown && Date.now() - intentAt > USER_INTENT_MS) return;
      const fromBottom = el.scrollHeight - el.clientHeight - scrollTop;
      if (followingRef.current && fromBottom > FOLLOW_SLACK_PX) callbacks.current.onPause();
      else if (!followingRef.current && fromBottom <= FOLLOW_SLACK_PX) callbacks.current.onFollow();
    };
    const passive = { passive: true } as AddEventListenerOptions;
    el.addEventListener('wheel', intent, passive);
    el.addEventListener('touchstart', intent, passive);
    el.addEventListener('touchmove', intent, passive);
    el.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    el.addEventListener('keydown', onKeyDown);
    el.addEventListener('scroll', onScroll, passive);
    return () => {
      el.removeEventListener('wheel', intent);
      el.removeEventListener('touchstart', intent);
      el.removeEventListener('touchmove', intent);
      el.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('keydown', onKeyDown);
      el.removeEventListener('scroll', onScroll);
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      reveal: (index: number) => virtualizer.scrollToIndex(index, { align: 'center' }),
      focus: () => scrollerRef.current?.focus({ preventScroll: true }),
    }),
    [virtualizer],
  );

  const optionId = (seq: number) => `${listId}-${seq}`;

  const onClick = (e: React.MouseEvent) => {
    const row = (e.target as Element).closest('[data-seq]');
    if (!row || !scrollerRef.current?.contains(row)) return;
    // A click that ends a drag across text was selecting text, not a line.
    if ((window.getSelection?.()?.toString() ?? '') !== '') return;
    const seq = Number(row.getAttribute('data-seq'));
    const next = clickSelection(
      props.selection,
      seq,
      records.map((r) => r.seq),
      { range: e.shiftKey, toggle: e.metaKey || e.ctrlKey },
    );
    props.onSelect(next, records.find((r) => r.seq === seq) ?? null, 'click');
    if (e.shiftKey) scrollerRef.current?.focus({ preventScroll: true });
  };

  // Shift+click would extend the browser's text selection instead; that
  // also skips the focus a click gives the list, so onClick gives it back.
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.shiftKey) e.preventDefault();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !mod && !e.altKey) {
      e.preventDefault();
      const order = records.map((r) => r.seq);
      if (!order.length) return;
      const next = moveSelection(props.selection, order, e.key === 'ArrowDown' ? 1 : -1, e.shiftKey);
      const index = next.active === null ? -1 : order.indexOf(next.active);
      props.onSelect(next, index >= 0 ? records[index] : null, 'key');
      if (index < 0) return;
      // Off the newest line, following would pull the list away from it.
      if (index !== order.length - 1 && followingRef.current) props.onPause();
      virtualizer.scrollToIndex(index, { align: 'auto' });
    } else if (e.key === 'Enter' && !mod) {
      const record = activeIndex >= 0 ? records[activeIndex] : undefined;
      if (!record) return;
      e.preventDefault();
      props.onOpenDetails(record);
    } else if (e.key === 'End' && !mod) {
      e.preventDefault();
      props.onFollow();
      virtualizer.scrollToOffset(total);
    } else if (mod && !e.altKey && (e.key === 'c' || e.key === 'C')) {
      // Text the user selected is the browser's to copy.
      if (!props.selection.selected.size) return;
      if ((window.getSelection?.()?.toString() ?? '') !== '') return;
      e.preventDefault();
      props.onCopy();
    }
  };

  return (
    <div className="log-list-wrap">
      {dropped && !following && (
        <div className="log-dropped-note">Older lines were dropped while paused</div>
      )}
      <div
        ref={scrollerRef}
        role="listbox"
        aria-label="Log lines"
        aria-multiselectable="true"
        tabIndex={0}
        aria-activedescendant={activeIndex >= 0 ? optionId(records[activeIndex].seq) : undefined}
        className={`log-list${wrap ? '' : ' is-nowrap'}`}
        onClick={onClick}
        onMouseDown={onMouseDown}
        onKeyDown={onKeyDown}
      >
        <div className="log-list-sizer" style={{ height: total }}>
          {virtualizer.getVirtualItems().map((item) => {
            const record = records[item.index];
            return (
              <LogRow
                key={record.seq}
                record={record}
                index={item.index}
                setSize={records.length}
                start={item.start}
                id={optionId(record.seq)}
                selected={props.selection.selected.has(record.seq)}
                active={props.selection.active === record.seq}
                hit={hits.has(item.index)}
                activeHit={activeHit === item.index}
                find={find}
                caseSensitive={caseSensitive}
                measureRef={virtualizer.measureElement}
              />
            );
          })}
        </div>
      </div>
      {!following && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="log-new-pill"
          onClick={() => callbacks.current.onFollow()}
        >
          {newLines > 0
            ? `${formatCount(newLines)} new line${newLines === 1 ? '' : 's'} · Jump to latest`
            : 'Jump to latest'}
        </Button>
      )}
    </div>
  );
});
