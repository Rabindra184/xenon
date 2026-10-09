import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CircleX, Copy, Download, Eraser, FolderOpen, Play, Search, TriangleAlert } from 'lucide-react';
import { parseAnsi } from '../ansi';
import { cn } from '../cn';
import { LOGS } from '../copy/logs';
import type { LogLine } from '@shared/types';
import {
  emptyReason,
  formatTime,
  lineLevel,
  logFileText,
  logsAsText,
  nearEnd,
  visibleLines,
  type LogLevel,
  type LogsEmpty,
  type LogViewOptions
} from '@shared/logView';
import type { LogsFocus } from '../hooks/useLogsFocus';
import { Button } from '../components/ui/Button';
import { Segmented } from '../components/ui/Segmented';
import { toast } from '../components/ui/toastStore';

type Show = LogViewOptions['show'];

interface Props {
  logs: LogLine[];
  onClear: () => void;
  /** Offered while the server is stopped, when there is no output to show. */
  onStart?: () => void;
  /** With technical details on, the app's own system lines show, and the log folder can be opened. */
  technicalDetails: boolean;
  /** Where Home's "See what happened" sent Logs: its line, or none; null when Logs was opened otherwise. */
  focus: LogsFocus | null;
  /** The person changed Show, typed a search or pressed Clear: Logs is no longer at that line. */
  onFocusEnd: () => void;
}

/** How long the line Logs was sent to stays marked. */
const HIGHLIGHT_MS = 2000;

const SHOW_OPTIONS = [
  { value: 'everything', label: LOGS.everything },
  { value: 'problems', label: LOGS.problemsOnly }
] as const;

const EMPTY_WORDS: Record<LogsEmpty, string> = {
  'no-output': LOGS.empty.text,
  'no-problems': LOGS.empty.noProblems,
  'no-match': LOGS.empty.noMatch
};

/**
 * Logs: what the server printed, each line with its time, warnings and errors
 * coloured and marked by an icon. Show picks Everything or Problems only; the
 * search narrows either. Copy and Save as… take the lines shown, with their
 * times. The app's own system lines show with technical details on, except the
 * ones that say how the server ended (logView).
 *
 * Logs is drawn afresh each time it opens (only the open place is in the
 * page). Sent from Home's "See what happened" (`focus`) to a line, it opens on
 * Problems only at that line, kept in view whatever Show and the search say
 * (R59), and marks it for a moment with a bar at its start (not the focus
 * ring); otherwise on Everything, at the end. Sent from there at all, the
 * keyboard picks up at the lines. The list follows new lines while it is at
 * its end, and stays put while the person reads higher up; once the jump ends
 * (a change of Show, a search, Clear, a new start) it follows the end again.
 * When nothing is in view because of Problems only or a search, it says so
 * politely; the line count, which changes with every line, is never announced.
 */
export function Logs({ logs, onClear, onStart, technicalDetails, focus, onFocusEnd }: Props) {
  const keepId = focus?.lineId ?? undefined;
  const [show, setShow] = useState<Show>(keepId === undefined ? 'everything' : 'problems');
  const [query, setQuery] = useState('');
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const showLabelId = useId();
  const list = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  // At the end of the list: new lines keep it there.
  const following = useRef(true);

  const visible = useMemo(
    () => visibleLines(logs, { show, technical: technicalDetails, query, keepId }),
    [logs, show, technicalDetails, query, keepId]
  );
  const empty = emptyReason(logs.length, visible.length, { show, query });
  // Lines are there, but Problems only or the search leaves them all out: said politely.
  const allLeftOut = empty === 'no-problems' || empty === 'no-match' ? EMPTY_WORDS[empty] : null;

  // The jump has ended (the person changed what Logs shows or cleared it, or a new start began): no
  // mark, and the end is followed again. Before the scroll below, so it goes to the end at once.
  useLayoutEffect(() => {
    if (keepId !== undefined) return;
    setHighlightId(null);
    following.current = true;
  }, [keepId]);

  // New lines, or other lines shown: to the end, if the list was there.
  useLayoutEffect(() => {
    const el = list.current;
    if (el && following.current) el.scrollTop = el.scrollHeight;
  }, [visible]);

  // A row out of view is laid out at an estimated height (log-row) until it is drawn, and a wrapped
  // line is drawn taller. So the end moves as the rows near it are drawn, after the scroll above, and
  // when the window is resized: while following, go to the end again, a frame later (scrolling from
  // inside the observer would make it report again in the same frame).
  useEffect(() => {
    const el = list.current;
    const inner = content.current;
    if (!el || !inner) return;
    let frame: number | null = null;
    const observer = new ResizeObserver(() => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        if (following.current) el.scrollTop = el.scrollHeight;
      });
    });
    observer.observe(el);
    observer.observe(inner);
    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, []);

  // Sent to a line: scroll the list (and only the list) to put it in the middle, and mark it. Once:
  // Logs is drawn afresh each time it opens, and nothing sends it to a line while it is open. The
  // line's words come from main's state (R67), which can be in the window before the line itself:
  // a line still on its way (none at or after its id is here yet) is waited for, and jumped to when
  // it comes in. A line that has left the buffer (cleared, or rolled past: later lines are here and
  // it is not) has no row: Logs stays at the end, unmarked (R60). At once, never gliding: a glide
  // sets off from the end, where the list opened, and the scroll events it sends from there would
  // have it follow the end again (and the lines that come in just after a crash would then pull it
  // back there). The mark shows where the line is.
  const jumped = useRef(false);
  useLayoutEffect(() => {
    const el = list.current;
    if (!el || keepId === undefined || jumped.current) return;
    const row = el.querySelector<HTMLElement>(`[data-line-id="${keepId}"]`);
    if (!row) {
      const newest = logs.length === 0 ? -Infinity : logs[logs.length - 1].id;
      if (newest >= keepId) jumped.current = true;
      return;
    }
    jumped.current = true;
    following.current = false;
    el.scrollTop = Math.max(0, row.offsetTop - (el.clientHeight - row.offsetHeight) / 2);
    setHighlightId(keepId);
  }, [keepId, logs, visible]);

  // Sent by "See what happened", with a line or without, still there or gone: the button that sent
  // the person here went with Home, so the keyboard picks up at the lines (minor 5).
  const sentHere = focus !== null;
  useLayoutEffect(() => {
    const el = list.current;
    if (el && sentHere && (document.activeElement === null || document.activeElement === document.body)) {
      el.focus({ preventScroll: true });
    }
    // Only when Logs opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (highlightId === null) return;
    const timer = setTimeout(() => setHighlightId(null), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlightId]);

  // Changing what Logs shows ends the jump (R60) and its mark at once, and goes back to following the end.
  const endJump = () => {
    setHighlightId(null);
    following.current = true;
    onFocusEnd();
  };
  const changeShow = (value: string) => {
    setShow(value === 'problems' ? 'problems' : 'everything');
    endJump();
  };
  const changeQuery = (value: string) => {
    setQuery(value);
    endJump();
  };

  const nothingShown = visible.length === 0;

  const copy = async () => {
    if (nothingShown) return;
    try {
      await window.xenon.share.copy(logsAsText(visible));
      toast(LOGS.copied);
    } catch {
      toast(LOGS.copyFailed, 'error');
    }
  };

  // A header line first (R70): what Logs showed, and how many of the lines Everything would show
  // (with the same technical details) are in the file. Cancel (false) says nothing; a file that
  // can't be written says so (R61).
  const saveAs = async () => {
    if (nothingShown) return;
    const header = LOGS.fileHeader({
      date: new Date(),
      show,
      query,
      shown: visible.length,
      total: visibleLines(logs, { show: 'everything', technical: technicalDetails, query: '' }).length
    });
    try {
      await window.xenon.logs.saveAs(logFileText(header, visible));
    } catch (err) {
      console.error('[Xenon Control] could not save the log:', err);
      toast(LOGS.saveFailed, 'error');
    }
  };

  const clear = () => {
    if (logs.length === 0) return;
    onClear();
    endJump();
  };

  // The Start button goes once the server starts: the keyboard carries on at the lines that come.
  const start =
    onStart &&
    (() => {
      list.current?.focus({ preventScroll: true });
      onStart();
    });

  return (
    <>
      <div className="mb-3 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center gap-2">
          <span id={showLabelId} className="text-xs font-medium text-muted">
            {LOGS.show}
          </span>
          <Segmented aria-labelledby={showLabelId} options={SHOW_OPTIONS} value={show} onChange={changeShow} />
        </div>
        <div className="relative min-w-0 flex-1 basis-48">
          <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-2.5 text-dim" />
          <input
            type="search"
            value={query}
            onChange={(e) => changeQuery(e.target.value)}
            placeholder={LOGS.search}
            aria-label={LOGS.search}
            className="focus-ring h-8 w-full rounded-md border border-dim bg-surface2 pl-8 pr-2 text-sm text-ink placeholder:text-dim"
          />
        </div>
        <span className="whitespace-nowrap text-xs text-muted">{LOGS.lines(visible.length)}</span>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            aria-disabled={nothingShown || undefined}
            onClick={() => void copy()}
            icon={<Copy size={14} aria-hidden="true" />}
          >
            {LOGS.copy}
          </Button>
          <Button
            size="sm"
            aria-disabled={nothingShown || undefined}
            onClick={() => void saveAs()}
            icon={<Download size={14} aria-hidden="true" />}
          >
            {LOGS.saveAs}
          </Button>
          <Button
            size="sm"
            aria-disabled={logs.length === 0 || undefined}
            onClick={clear}
            icon={<Eraser size={14} aria-hidden="true" />}
          >
            {LOGS.clear}
          </Button>
          {technicalDetails && (
            <Button
              size="sm"
              onClick={() => window.xenon.server.openPath('logs')}
              icon={<FolderOpen size={14} aria-hidden="true" />}
            >
              {LOGS.openLogFolder}
            </Button>
          )}
        </div>
      </div>
      {/* Focusable, so the keyboard can scroll it. Positioned, so a row's offsetTop is measured from it.
          data-kept-line: the line Logs was sent to, while it is kept in view. */}
      <div
        ref={list}
        role="region"
        aria-label={LOGS.listLabel}
        tabIndex={0}
        data-kept-line={keepId}
        onScroll={() => {
          if (list.current) following.current = nearEnd(list.current);
        }}
        className="focus-ring relative min-h-0 flex-1 overflow-auto rounded-lg border border-line bg-app p-3 font-mono text-xs leading-relaxed"
      >
        <div ref={content}>
          {/* Always in the page, empty while lines are shown, so the words that come into it when the
              view empties are announced (a live region that arrives with its words may not be). */}
          <p role="status" className={allLeftOut === null ? 'sr-only' : 'mb-2 font-sans text-sm text-muted'}>
            {allLeftOut}
          </p>
          {empty === 'no-output' ? (
            <div className="flex flex-col items-start gap-2 font-sans">
              <p className="text-sm text-muted">{EMPTY_WORDS[empty]}</p>
              {start && (
                <Button size="sm" variant="primary" onClick={start} icon={<Play size={14} aria-hidden="true" />}>
                  {LOGS.empty.startServer}
                </Button>
              )}
            </div>
          ) : (
            visible.map((l) => <LogRow key={l.id} line={l} highlighted={l.id === highlightId} />)
          )}
        </div>
      </div>
    </>
  );
}

/** A line's colour: its level for a warning or an error, else the app's own system lines in their own colour. */
function rowColour(line: LogLine, level: LogLevel): string {
  if (level === 'error') return 'text-danger';
  if (level === 'warn') return 'text-warn';
  return line.stream === 'system' ? 'text-info' : 'text-ink';
}

/**
 * One line: its time, an icon for a warning or an error, and its words with
 * their colours. Memoised and keyed by a stable id, so a new line draws only
 * itself. `log-row` carries content-visibility, letting the browser skip layout
 * and paint for rows out of view, which handles wrapped lines of any height.
 * data-raw: the server's words, quoted, not the app's own (the no-jargon check
 * skips them).
 */
const LogRow = memo(function LogRow({ line, highlighted }: { line: LogLine; highlighted: boolean }) {
  const segments = useMemo(() => parseAnsi(line.text), [line.text]);
  const level = useMemo(() => lineLevel(line), [line]);
  return (
    <div
      data-raw
      data-line-id={line.id}
      data-highlighted={highlighted || undefined}
      // The mark is a bar in the accent colour at the line's start, never the focus ring, so it is
      // not taken for keyboard focus (minor 11). The background stays the list's, so every log colour
      // keeps its contrast (R11).
      className={cn(
        'log-row flex gap-2 rounded-sm border-l-2 px-1 transition-colors duration-500 motion-reduce:transition-none',
        rowColour(line, level),
        highlighted ? 'border-accent' : 'border-transparent'
      )}
    >
      <span className="shrink-0 text-muted">{formatTime(line.ts)}</span>
      <span className="flex h-5 w-4 shrink-0 items-center">
        <LevelIcon level={level} />
      </span>
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
        {segments.map((seg, i) =>
          seg.color ? (
            <span key={i} style={{ color: seg.color }}>
              {seg.text}
            </span>
          ) : (
            seg.text
          )
        )}
      </span>
    </div>
  );
});

/** A warning's or an error's icon, named for a screen reader; nothing for an ordinary line. */
function LevelIcon({ level }: { level: LogLevel }) {
  if (level === 'info') return null;
  const Icon = level === 'error' ? CircleX : TriangleAlert;
  return (
    <span role="img" aria-label={LOGS.level[level]} className="inline-flex">
      <Icon size={14} aria-hidden="true" />
    </span>
  );
}
