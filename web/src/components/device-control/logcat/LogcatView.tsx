import * as React from 'react';
import { memo, useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { AlertTriangle, Download, RotateCw, Trash2, Wifi } from 'lucide-react';
import { Select } from '../../ui/select';
import { useLogcatStream, type BufferedLogcatRecord } from './useLogcatStream';
import { matches, parseQuery, setLevelTerm, LEVEL_ORDER } from './logcatFilter';
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
 * One log row, memoized on the record. `visible` is a fresh array on every
 * flush, so without this the parent's re-render walks every row's render
 * function even when the row's own data is unchanged. With a stable `seq` key
 * (see BufferedLogcatRecord) React can also *move* a row's DOM node through a
 * front-trim instead of repatching every row after the trim point.
 */
const LogcatRow = memo(function LogcatRow({ record }: { record: BufferedLogcatRecord }) {
  return (
    <div className={`logcat-row ${record.synthetic ? 'is-synthetic' : ''}`}>
      <span className="logcat-time">{TIME_FORMAT.format(record.ts)}</span>
      <span className="logcat-pid">
        {record.pid}-{record.tid}
      </span>
      <span className="logcat-pkg" title={record.pkg}>
        {record.pkg ?? ''}
      </span>
      <span className={`logcat-level lvl-${record.level}`}>{record.level}</span>
      <span className="logcat-tag" title={record.tag}>
        {record.tag}
      </span>
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
  const endRef = useRef<HTMLDivElement>(null);

  const parsed = useMemo(() => parseQuery(query), [query]);
  const visible = useMemo(() => records.filter((r) => matches(r, parsed)), [records, parsed]);

  // A level the dropdown cannot represent — a typo'd `level:X`, or `level:V`
  // which filters nothing — shows as "All levels". That is not a disagreement:
  // `matches` ignores an unrecognized level entirely, and V admits every
  // record, so in both cases no level filtering is in effect and "All levels"
  // is the honest reading of the query.
  const levelValue = LEVEL_OPTIONS.some((o) => o.value === parsed.minLevel)
    ? (parsed.minLevel as string)
    : '';

  const onExport = useCallback(() => {
    const text = visible
      .map((r) => `${new Date(r.ts).toISOString()} ${r.pid} ${r.level}/${r.tag}: ${r.message}`)
      .join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `logcat-${udid}-${Date.now()}.txt`;
    // Firefox ignores a click on an anchor that is not in the document, so
    // the anchor has to be attached for the duration of the click.
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoking in the same task can cancel a download that has not started
    // reading the blob yet (Firefox, Safari). Defer to the next task.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [visible, udid]);

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
          <input
            type="text"
            className="type-input-field tiny logcat-query"
            placeholder="tag:Wifi package:com.android.systemui free text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Filter logs"
          />
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
          <button className="btn-premium btn-sm" disabled={visible.length === 0} onClick={onExport}>
            <Download size={14} /> EXPORT
          </button>
          <button className="btn-secondary btn-sm" onClick={clear}>
            <Trash2 size={14} /> CLEAR
          </button>
        </div>
      </div>

      <div className="logcat-rows">
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
        {visible.map((r) => (
          <LogcatRow key={r.seq} record={r} />
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
