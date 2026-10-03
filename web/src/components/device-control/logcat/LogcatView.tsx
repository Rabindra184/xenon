import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { Button } from '../../ui/button';
import { EmptyState } from '../../ui/EmptyState';
import { useToast } from '../../ui/toast';
import { copyText } from '../actions/copyText';
import { useLogcatStream, type BufferedLogcatRecord } from './useLogcatStream';
import { matches, parseQuery, setLevelTerm, withExclusion, withTerm } from './logcatFilter';
import { iosSourceFilter } from './iosSourceFilter';
import { countLevels, type LogPlatform } from './levelCounts';
import { NO_SELECTION, selectedLines, type LogSelection } from './logSelection';
import { formatCount } from './logFormat';
import {
  appendToRecording,
  formatLine,
  recordingFilename,
  serializeRecording,
  startRecording,
  type RecordingState,
} from './logcatRecording';
import { LogToolbar, type StreamStatus } from './LogToolbar';
import { LevelBar } from './LevelBar';
import { LogList, type LogListHandle } from './LogList';
import { LogDetails } from './LogDetails';
import './logcat.css';

interface Props {
  udid: string;
  platform?: string;
}

/**
 * Save text as a file. Both browser workarounds below were established by the
 * original Export and are shared rather than duplicated for Record.
 */
function download(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  // Firefox ignores a click on an anchor that is not in the document, so the
  // anchor has to be attached for the duration of the click.
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoking in the same task can cancel a download that has not started
  // reading the blob yet (Firefox, Safari). Defer to the next task.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Put text on the user's clipboard. The clipboard API exists only on secure
 * origins, and a lab dashboard on plain http://<lan address> has none, so
 * fall back to the old copy command, which works there inside a click or a
 * key press. Focus goes back where it was.
 */
async function copyToClipboard(text: string): Promise<boolean> {
  if (await copyText(text)) return true;
  if (typeof document.execCommand !== 'function') return false;
  const before = document.activeElement as HTMLElement | null;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  try {
    area.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(area);
    before?.focus?.({ preventScroll: true });
  }
}

const isTyping = (el: HTMLElement) =>
  el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;

/**
 * The device control Logs tab: the phone's live log, Android (logcat) and iOS
 * (os_trace) alike.
 *
 * It owns the one source of truth, the filter text: the level bar writes its
 * `level:` term into it and reads its pressed level back out of it, and the
 * details panel's buttons write terms into it, so no control can disagree
 * with the text box. It also owns the stream (`useLogcatStream`), recording,
 * following and the selection, and puts the toolbar, the level bar, the list
 * and the details panel together.
 */
export default function LogcatView({ udid, platform }: Props) {
  const os = (platform || '').toLowerCase();
  const isIOS = os === 'ios';
  const supported = os === 'android' || isIOS;
  const logPlatform: LogPlatform = isIOS ? 'ios' : 'android';
  const { toast } = useToast();

  const [query, setQuery] = useState('');

  // On iOS the same query ALSO narrows the device-side stream: os_trace at
  // Debug is 5,485 lines/sec device-wide, so the level and a `package:` term
  // are pushed down to the device rather than applied only in the browser.
  // Android streams everything and filters here. Either way the records are
  // still filtered locally below, so the pane shows the same thing on both.
  const sourceFilter = useMemo(() => (isIOS ? iosSourceFilter(query) : undefined), [isIOS, query]);
  const { records, connected, clear, deniedReason, exhausted, retry } = useLogcatStream(
    udid,
    supported,
    sourceFilter,
  );

  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wrap, setWrap] = useState(true);
  // Find is deliberately NOT the filter. The filter hides non-matches; find
  // keeps every line and walks between hits, which is what you want when the
  // lines around a hit are the point. Android Studio has both for the same
  // reason.
  const [find, setFind] = useState('');
  const [hitIndex, setHitIndex] = useState(0);
  const [selection, setSelection] = useState<LogSelection>(NO_SELECTION);
  // The line the details panel shows, kept as a copy so the panel can go on
  // showing it after the buffer drops it. Null when the panel is closed.
  const [details, setDetails] = useState<BufferedLogcatRecord | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<LogListHandle>(null);
  const recordsRef = useRef(records);
  recordsRef.current = records;

  // Following, and the newest line of the buffer when it stopped: lines
  // after that one are the pill's "new lines".
  const [following, setFollowing] = useState(true);
  const [pausedAfter, setPausedAfter] = useState<number | null>(null);
  const followingRef = useRef(following);
  followingRef.current = following;
  const pause = useCallback(() => {
    if (!followingRef.current) return;
    followingRef.current = false;
    const buffer = recordsRef.current;
    setPausedAfter(buffer.length ? buffer[buffer.length - 1].seq : -1);
    setFollowing(false);
  }, []);
  const follow = useCallback(() => {
    followingRef.current = true;
    setPausedAfter(null);
    setFollowing(true);
  }, []);

  // Recording. The state object is mutated in place by appendToRecording (it
  // grows to hundreds of thousands of lines; copying it per flush would be the
  // most expensive thing on the page), so it lives in a ref. `recLines` exists
  // purely to drive the counter in the toolbar — rendering off the ref would
  // never update.
  const recordingRef = useRef<RecordingState | null>(null);
  const [recording, setRecording] = useState(false);
  const [recLines, setRecLines] = useState(0);
  // Highest `seq` already captured. Appending `records` wholesale on every
  // change would re-capture the entire buffer each flush; seq is monotonic per
  // stream, so it is the cheap and exact way to take only what is new.
  const lastSeqRef = useRef(-1);

  const parsed = useMemo(() => parseQuery(query, { caseSensitive }), [query, caseSensitive]);
  const visible = useMemo(() => records.filter((r) => matches(r, parsed)), [records, parsed]);
  const counts = useMemo(() => countLevels(records, parsed), [records, parsed]);

  // Positions within `visible`, not record ids: the list is what the user is
  // looking at and scrolling through, so a hit is a position in it.
  const hits = useMemo(() => {
    if (!find) return [] as number[];
    const needle = caseSensitive ? find : find.toLowerCase();
    const out: number[] = [];
    visible.forEach((r, i) => {
      const hay = caseSensitive ? `${r.tag} ${r.message}` : `${r.tag} ${r.message}`.toLowerCase();
      if (hay.includes(needle)) out.push(i);
    });
    return out;
  }, [visible, find, caseSensitive]);

  // Clamp rather than reset: rows stream in constantly, so recomputing hits
  // must not keep yanking the user back to the first match while they are
  // stepping through.
  const activeHit = hits.length ? Math.min(hitIndex, hits.length - 1) : 0;
  // Set, not Array#includes per row.
  const hitSet = useMemo(() => new Set(hits), [hits]);

  const jump = useCallback(
    (delta: 1 | -1) => {
      if (!hits.length) return;
      const next = (activeHit + delta + hits.length) % hits.length;
      setHitIndex(next);
      pause(); // stepping through history and following fight
      listRef.current?.reveal(hits[next]);
    },
    [hits, activeHit, pause],
  );

  const newLines = useMemo(() => {
    if (pausedAfter === null) return 0;
    let n = 0;
    for (let i = visible.length - 1; i >= 0 && visible[i].seq > pausedAfter; i--) n++;
    return n;
  }, [visible, pausedAfter]);

  const onExport = useCallback(() => {
    // The filtered view on purpose — Export saves what you are looking at.
    // Record is the one that captures unfiltered.
    if (!visible.length) {
      toast('No lines to export', 'info');
      return;
    }
    download(visible.map(formatLine).join('\n'), `logcat-${udid}-${Date.now()}.txt`);
  }, [visible, udid, toast]);

  // Capture on arrival, from `records` (unfiltered) rather than `visible`: a
  // capture can always be filtered afterwards, never unfiltered.
  useEffect(() => {
    const state = recordingRef.current;
    if (!state || !records.length) return;

    const fresh = records.filter((r) => r.seq > lastSeqRef.current);
    if (!fresh.length) return;

    // A gap means records were evicted from the 5000-record display buffer
    // between two flushes — only possible if a burst outran the flush, but if
    // it happens the capture is incomplete and must say so rather than look
    // whole. Same rule as the cap.
    const expectedFirst = lastSeqRef.current + 1;
    if (lastSeqRef.current >= 0 && fresh[0].seq > expectedFirst) {
      state.dropped += fresh[0].seq - expectedFirst;
    }

    appendToRecording(state, fresh);
    lastSeqRef.current = fresh[fresh.length - 1].seq;
    setRecLines(state.lines.length);
  }, [records]);

  const toggleRecording = useCallback(() => {
    const state = recordingRef.current;
    if (!state) {
      // Start from the newest record already in the buffer, not from -1: the
      // buffer holds history from before you pressed Record, and a recording
      // is the window you asked for, not everything that happened to be open.
      lastSeqRef.current = records.length ? records[records.length - 1].seq : -1;
      recordingRef.current = startRecording(Date.now());
      setRecLines(0);
      setRecording(true);
      return;
    }

    const text = serializeRecording(state, Date.now(), udid);
    recordingRef.current = null;
    setRecording(false);
    setRecLines(0);
    download(text, recordingFilename(udid, state.startedAt));
  }, [records, udid]);

  const copy = useCallback(
    async (text: string, done: string) => {
      if (await copyToClipboard(text)) toast(done, 'success');
      else toast('Your browser blocked copying here.', 'error');
    },
    [toast],
  );

  // Only selected lines the filter shows are copied (and counted).
  const selectedShown = useMemo(() => {
    if (!selection.selected.size) return 0;
    let n = 0;
    for (let i = 0; i < visible.length; i++) if (selection.selected.has(visible[i].seq)) n++;
    return n;
  }, [visible, selection.selected]);

  const copySelected = useCallback(() => {
    const { text, count } = selectedLines(visible, selection.selected);
    if (!count) return;
    copy(text, `Copied ${formatCount(count)} line${count === 1 ? '' : 's'}`);
  }, [visible, selection.selected, copy]);

  const onSelect = useCallback(
    (next: LogSelection, active: BufferedLogcatRecord | null, via: 'click' | 'key') => {
      setSelection(next);
      // A click opens the line; the arrows move an open panel along with them.
      if (via === 'click') setDetails(active);
      else setDetails((open) => (open && active ? active : open));
    },
    [],
  );

  const clearLines = useCallback(() => {
    clear();
    setSelection(NO_SELECTION);
  }, [clear]);

  // Keys anywhere in the pane. Not for a popover's own keys: the menu and the
  // syntax help render outside the pane's DOM, and their Esc is theirs.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!rootRef.current?.contains(e.target as Node)) return;
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === '/' && !mod && !isTyping(e.target as HTMLElement)) {
      e.preventDefault();
      filterRef.current?.focus();
    } else if (mod && !e.altKey && (e.key === 'f' || e.key === 'F')) {
      // The browser's find can't see rows that aren't rendered; this one can.
      e.preventDefault();
      findRef.current?.focus();
      findRef.current?.select();
    } else if (e.key === 'Escape') {
      if (details) {
        e.preventDefault();
        setDetails(null);
      } else if (selection.selected.size) {
        e.preventDefault();
        setSelection(NO_SELECTION);
      }
    }
  };

  if (!supported) {
    return (
      <div className="logcat-root">
        <EmptyState
          title="Live logs are not available here"
          description="Live logs work on Android and iOS phones."
        />
      </div>
    );
  }

  const status: StreamStatus = deniedReason
    ? 'Denied'
    : exhausted
      ? 'Offline'
      : connected
        ? 'Live'
        : 'Connecting';

  const inBuffer =
    !!details &&
    records.length > 0 &&
    details.seq >= records[0].seq &&
    details.seq <= records[records.length - 1].seq;

  let state: React.ReactNode = null;
  if (!visible.length) {
    if (records.length) {
      state = (
        <div className="log-state">
          <p>
            No lines match <code>{query}</code>
          </p>
          <Button type="button" variant="secondary" size="sm" onClick={() => setQuery('')}>
            Clear filter
          </Button>
        </div>
      );
    } else if (status === 'Connecting') {
      state = (
        <div className="log-state">
          <p>Waiting for the phone’s first log line…</p>
        </div>
      );
    } else if (status === 'Live') {
      state = (
        <div className="log-state">
          <p>Connected. Lines appear here as the phone logs them.</p>
        </div>
      );
    }
  }

  const reconnect = (
    <Button type="button" variant="secondary" size="sm" onClick={retry}>
      <RotateCw size={13} aria-hidden="true" /> Reconnect
    </Button>
  );

  return (
    <div className="logcat-root" ref={rootRef} onKeyDown={onKeyDown}>
      <LogToolbar
        status={status}
        statusDetail={deniedReason}
        query={query}
        onQueryChange={setQuery}
        filterRef={filterRef}
        find={find}
        onFindChange={(f) => {
          setFind(f);
          setHitIndex(0);
        }}
        findRef={findRef}
        hitCount={hits.length}
        activeHit={activeHit}
        onStep={jump}
        following={following}
        onTogglePause={following ? pause : follow}
        recording={recording}
        recordedLines={recLines}
        onToggleRecording={toggleRecording}
        onExport={onExport}
        caseSensitive={caseSensitive}
        onToggleCase={() => setCaseSensitive((on) => !on)}
        wrap={wrap}
        onToggleWrap={() => setWrap((on) => !on)}
        canCopySelected={selectedShown > 0}
        onCopySelected={copySelected}
        onClearLines={clearLines}
      />
      <LevelBar
        platform={logPlatform}
        counts={counts}
        minLevel={parsed.minLevel}
        shown={visible.length}
        total={records.length}
        onChoose={(level) => setQuery(setLevelTerm(query, level))}
      />
      <div className="log-body theme-dark">
        {deniedReason && (
          <div className="log-banner is-denied" role="alert">
            <AlertTriangle size={14} aria-hidden="true" />
            <span>Access denied — {deniedReason}</span>
            {reconnect}
          </div>
        )}
        {!deniedReason && exhausted && (
          <div className="log-banner is-exhausted" role="alert">
            <AlertTriangle size={14} aria-hidden="true" />
            <span>Connection lost after repeated attempts. Use Reconnect to try again.</span>
            {reconnect}
          </div>
        )}
        <div className="log-main">
          <LogList
            ref={listRef}
            records={visible}
            oldestSeq={records.length ? records[0].seq : null}
            wrap={wrap}
            find={find}
            caseSensitive={caseSensitive}
            hits={hitSet}
            activeHit={hits.length ? hits[activeHit] : null}
            following={following}
            newLines={newLines}
            onPause={pause}
            onFollow={follow}
            selection={selection}
            onSelect={onSelect}
            onOpenDetails={setDetails}
            onCopy={copySelected}
          />
          {state}
        </div>
        {details && (
          <LogDetails
            record={details}
            platform={logPlatform}
            inBuffer={inBuffer}
            onCopyLine={() => copy(formatLine(details), 'Copied the line')}
            onCopyMessage={() => copy(details.message, 'Copied the message')}
            onShowOnlyTag={() => setQuery(withTerm(query, 'tag', details.tag))}
            onHideTag={() => setQuery(withExclusion(query, 'tag', details.tag))}
            onShowOnlyApp={() => setQuery(withTerm(query, 'package', details.pkg ?? ''))}
            onClose={() => setDetails(null)}
          />
        )}
      </div>
    </div>
  );
}
