import * as React from 'react';
import { memo, useCallback, useMemo, useRef, useState, useEffect } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CaseSensitive,
  Circle,
  Download,
  RotateCw,
  Square,
  Trash2,
  Wifi,
  WrapText,
  X,
} from 'lucide-react';
import { Select } from '../../ui/select';
import { useLogcatStream, type BufferedLogcatRecord } from './useLogcatStream';
import { matches, parseQuery, setLevelTerm, LEVEL_ORDER } from './logcatFilter';
import { tagColor } from './tagColor';
import {
  appendToRecording,
  formatLine,
  recordingFilename,
  serializeRecording,
  startRecording,
  type RecordingState,
} from './logcatRecording';
// This view renders four classes it does not own: `.type-input-field`,
// `.btn-sm` and `.btn-premium` (device-control.css) and `.btn-secondary`
// (ui/button.css). It used to get them only because its parent happened to
// import device-control.css — the view was one refactor away from rendering
// unstyled, with nothing to point at. Both sheets are already in the bundle
// and Rollup dedupes a repeated module import, so these cost nothing.
// Imported BEFORE ./logcat.css so its overrides still win.
import '../device-control.css';
import '../../ui/button.css';
import './logcat.css';

interface Props {
  udid: string;
  platform?: string;
}

/**
 * Level choices offered by the dropdown.
 *
 * 'V' is deliberately absent: V is the lowest level, so "V and above" selects
 * every record — which is what "All levels" already says, only twice. 'F' is
 * the highest, so "and above" would be a lie about a set with nothing above
 * it; it is labelled for what it is.
 */
const LEVEL_OPTIONS = LEVEL_ORDER.filter((l) => l !== 'V').map((l) => ({
  value: l as string,
  label: l === 'F' ? 'F only' : `${l} and above`,
}));

/**
 * Built once, not per row. `new Date(ts).toLocaleTimeString(...)` constructs a
 * Date AND a fresh Intl formatter on every call; at a full 5000-record buffer
 * flushing every 50ms that is the single most expensive thing in the render
 * path. `Intl.DateTimeFormat#format` takes the epoch millis directly.
 */
const TIME_FORMAT = new Intl.DateTimeFormat([], {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/**
 * Save text as a file. Both browser workarounds below were established by the
 * original EXPORT and are shared rather than duplicated for RECORD.
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
 * One log row, memoized on the record. `visible` is a fresh array on every
 * flush, so without this the parent's re-render walks every row's render
 * function even when the row's own data is unchanged. With a stable `seq` key
 * (see BufferedLogcatRecord) React can also *move* a row's DOM node through a
 * front-trim instead of repatching every row after the trim point.
 */
const LogcatRow = memo(function LogcatRow({
  record,
  index,
  isHit,
  isActiveHit,
}: {
  record: BufferedLogcatRecord;
  index: number;
  isHit: boolean;
  isActiveHit: boolean;
}) {
  return (
    <div
      data-row-index={index}
      className={`logcat-row ${record.synthetic ? 'is-synthetic' : ''} ${
        isHit ? 'is-hit' : ''
      } ${isActiveHit ? 'is-active-hit' : ''}`}
    >
      <span className="logcat-time">{TIME_FORMAT.format(record.ts)}</span>
      <span className="logcat-pid">
        {record.pid}-{record.tid}
      </span>
      {/* Tag before package, matching Android Studio's column order: the tag
          is the field you scan by, so it sits closest to the identifiers. */}
      <span className="logcat-tag" title={record.tag} style={{ color: tagColor(record.tag) }}>
        {record.tag}
      </span>
      <span className="logcat-pkg" title={record.pkg}>
        {record.pkg ?? ''}
      </span>
      <span className={`logcat-level lvl-${record.level}`}>{record.level}</span>
      <span className="logcat-msg">{record.message}</span>
    </div>
  );
});

export default function LogcatView({ udid, platform }: Props) {
  const isAndroid = (platform || '').toLowerCase() === 'android';
  const { records, connected, clear, deniedReason, exhausted, retry } = useLogcatStream(
    udid,
    isAndroid,
  );
  // The query string is the ONE source of truth for filtering. The level
  // dropdown does not hold its own state: it writes a `level:` term into this
  // string via setLevelTerm and reads its displayed value back out of it via
  // parseQuery. Two independent states reconciled at filter time is what made
  // the documented `level:` grammar unreachable from the text box (a falsy
  // dropdown value made setLevelTerm strip the term the user had just typed)
  // and let the two controls display contradicting levels.
  const [query, setQuery] = useState('');
  const [following, setFollowing] = useState(true);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wrap, setWrap] = useState(true);
  // Find is deliberately NOT the filter. The filter hides non-matches; find
  // keeps every row and walks between hits, which is what you want when the
  // lines around a hit are the point. Android Studio has both for the same
  // reason.
  const [find, setFind] = useState('');
  const [hitIndex, setHitIndex] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);

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
  // Set, not Array#includes per row: at a 5000-row buffer the linear scan runs
  // 5000 times per flush, 20 flushes a second.
  const hitSet = useMemo(() => new Set(hits), [hits]);

  const jump = useCallback(
    (delta: number) => {
      if (!hits.length) return;
      const next = (activeHit + delta + hits.length) % hits.length;
      setHitIndex(next);
      setFollowing(false); // stepping through history and auto-scrolling fight
      rowsRef.current
        ?.querySelector(`[data-row-index="${hits[next]}"]`)
        ?.scrollIntoView({ block: 'center' });
    },
    [hits, activeHit],
  );

  // A level the dropdown cannot represent — a typo'd `level:X`, or `level:V`
  // which filters nothing — shows as "All levels". That is not a disagreement:
  // `matches` ignores an unrecognized level entirely, and V admits every
  // record, so in both cases no level filtering is in effect and "All levels"
  // is the honest reading of the query.
  const levelValue = LEVEL_OPTIONS.some((o) => o.value === parsed.minLevel)
    ? (parsed.minLevel as string)
    : '';

  const onExport = useCallback(() => {
    // The filtered view on purpose — EXPORT saves what you are looking at.
    // RECORD is the one that captures unfiltered.
    download(visible.map(formatLine).join('\n'), `logcat-${udid}-${Date.now()}.txt`);
  }, [visible, udid]);

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
      // buffer holds history from before you pressed RECORD, and a recording
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

  useEffect(() => {
    if (following) endRef.current?.scrollIntoView({ block: 'end' });
  }, [visible.length, following]);

  if (!isAndroid) {
    return (
      <div className="log-empty-state">
        <p className="log-empty-title">Live logs are Android only</p>
        <p className="log-empty-subtitle">
          logcat streaming is not available for this device&apos;s platform.
        </p>
      </div>
    );
  }

  const statusLabel = deniedReason
    ? 'DENIED'
    : exhausted
      ? 'OFFLINE'
      : connected
        ? 'LIVE'
        : 'CONNECTING';
  const isErrorStatus = !connected && (!!deniedReason || exhausted);

  return (
    <div className="logcat-root">
      <div className="log-toolbar">
        <div className="log-filter-group">
          <div className="log-stat-pill" title={deniedReason ?? undefined}>
            <span
              className={`log-live-dot ${connected ? 'active' : ''} ${isErrorStatus ? 'is-error' : ''}`}
            />
            {statusLabel}
          </div>
          <div className="log-stat-pill logcat-count">
            {visible.length} / {records.length}
          </div>
          <Select
            selectSize="sm"
            value={levelValue}
            onChange={(e) => setQuery(setLevelTerm(query, e.target.value))}
            aria-label="Minimum log level"
          >
            <option value="">All levels</option>
            {LEVEL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <div className="logcat-input-wrap">
            <input
              type="text"
              className="type-input-field tiny logcat-query"
              placeholder="tag:Wifi package:com.android.systemui free text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Filter logs"
            />
            {query && (
              <button
                type="button"
                className="logcat-input-btn"
                onClick={() => setQuery('')}
                aria-label="Clear filter"
                title="Clear filter"
              >
                <X size={12} />
              </button>
            )}
          </div>
          <div className="logcat-input-wrap">
            <input
              type="text"
              className="type-input-field tiny logcat-find"
              placeholder="Find…"
              value={find}
              onChange={(e) => {
                setFind(e.target.value);
                setHitIndex(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  jump(e.shiftKey ? -1 : 1);
                }
              }}
              aria-label="Find in logs"
            />
            {find && (
              <span className="logcat-hit-count" aria-live="polite">
                {hits.length ? `${activeHit + 1}/${hits.length}` : '0/0'}
              </span>
            )}
          </div>
          <button
            type="button"
            className="btn-secondary btn-sm logcat-icon-btn"
            onClick={() => jump(-1)}
            disabled={!hits.length}
            aria-label="Previous match"
            title="Previous match (Shift+Enter)"
          >
            <ArrowUp size={14} />
          </button>
          <button
            type="button"
            className="btn-secondary btn-sm logcat-icon-btn"
            onClick={() => jump(1)}
            disabled={!hits.length}
            aria-label="Next match"
            title="Next match (Enter)"
          >
            <ArrowDown size={14} />
          </button>
          <button
            type="button"
            className={`btn-secondary btn-sm logcat-icon-btn ${caseSensitive ? 'active' : ''}`}
            onClick={() => setCaseSensitive(!caseSensitive)}
            aria-pressed={caseSensitive}
            aria-label="Match case"
            title="Match case"
          >
            <CaseSensitive size={15} />
          </button>
          <button
            type="button"
            className={`btn-secondary btn-sm logcat-icon-btn ${wrap ? 'active' : ''}`}
            onClick={() => setWrap(!wrap)}
            aria-pressed={wrap}
            aria-label="Soft wrap"
            title="Soft wrap long messages"
          >
            <WrapText size={14} />
          </button>
        </div>
        <div className="log-actions-group">
          {(deniedReason || exhausted) && (
            <button className="btn-secondary btn-sm" onClick={retry}>
              <RotateCw size={14} /> RECONNECT
            </button>
          )}
          <button
            className={`btn-secondary btn-sm ${following ? 'active' : ''}`}
            onClick={() => setFollowing(!following)}
          >
            <Wifi size={14} /> {following ? 'FREEZE' : 'FOLLOW'}
          </button>
          {/* Distinct from EXPORT: EXPORT saves the filtered view you are
              looking at right now; RECORD captures the raw stream between an
              explicit start and stop, independent of the filter and of the
              5000-record display cap. */}
          <button
            className={`btn-secondary btn-sm ${recording ? 'is-recording' : ''}`}
            onClick={toggleRecording}
            aria-pressed={recording}
            title={
              recording
                ? 'Stop recording and download the capture'
                : 'Record the raw log stream to a file'
            }
          >
            {recording ? <Square size={12} /> : <Circle size={12} />}{' '}
            {recording ? `STOP · ${recLines.toLocaleString()}` : 'RECORD'}
          </button>
          <button className="btn-premium btn-sm" disabled={visible.length === 0} onClick={onExport}>
            <Download size={14} /> EXPORT
          </button>
          <button className="btn-secondary btn-sm" onClick={clear}>
            <Trash2 size={14} /> CLEAR
          </button>
        </div>
      </div>

      <div className={`logcat-rows ${wrap ? '' : 'no-wrap'}`} ref={rowsRef}>
        {deniedReason && (
          <div className="logcat-status-banner is-denied" role="alert">
            <AlertTriangle size={14} />
            <span>Access denied — {deniedReason}</span>
          </div>
        )}
        {!deniedReason && exhausted && (
          <div className="logcat-status-banner is-exhausted" role="alert">
            <AlertTriangle size={14} />
            <span>Connection lost after repeated attempts. Use Reconnect above to try again.</span>
          </div>
        )}
        {visible.map((r, i) => (
          <LogcatRow
            key={r.seq}
            record={r}
            index={i}
            isHit={hitSet.has(i)}
            isActiveHit={hits.length > 0 && hits[activeHit] === i}
          />
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
