import * as React from 'react';
import { useMemo, useRef, useState, useEffect } from 'react';
import { AlertTriangle, Download, RotateCw, Trash2, Wifi } from 'lucide-react';
import { Select } from '../../ui/select';
import { useLogcatStream } from './useLogcatStream';
import { matches, parseQuery, setLevelTerm, LEVEL_ORDER } from './logcatFilter';
import './logcat.css';

interface Props {
  udid: string;
  platform?: string;
}

export default function LogcatView({ udid, platform }: Props) {
  const isAndroid = (platform || '').toLowerCase() === 'android';
  const { records, connected, clear, deniedReason, exhausted, retry } = useLogcatStream(
    udid,
    isAndroid,
  );
  const [query, setQuery] = useState('');
  const [minLevel, setMinLevel] = useState('');
  const [following, setFollowing] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);

  // setLevelTerm keeps the dropdown authoritative over a stray level: term
  // the user typed by hand — a naive `level:${minLevel} ${query}` prepend
  // does not, because parseQuery is last-token-wins and a user-typed level:
  // term later in the string would silently out-vote the dropdown.
  const effectiveQuery = useMemo(
    () => parseQuery(setLevelTerm(query, minLevel)),
    [minLevel, query],
  );
  const visible = useMemo(
    () => records.filter((r) => matches(r, effectiveQuery)),
    [records, effectiveQuery],
  );

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
            value={minLevel}
            onChange={(e) => setMinLevel(e.target.value)}
            aria-label="Minimum log level"
          >
            <option value="">All levels</option>
            {LEVEL_ORDER.map((l) => (
              <option key={l} value={l}>
                {l} and above
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
          <button
            className="btn-premium btn-sm"
            disabled={visible.length === 0}
            onClick={() => {
              const text = visible
                .map(
                  (r) =>
                    `${new Date(r.ts).toISOString()} ${r.pid} ${r.level}/${r.tag}: ${r.message}`,
                )
                .join('\n');
              const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
              const a = document.createElement('a');
              a.href = url;
              a.download = `logcat-${udid}-${Date.now()}.txt`;
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            <Download size={14} /> EXPORT
          </button>
          <button className="btn-secondary btn-sm" onClick={clear}>
            <Trash2 size={14} /> CLEAR
          </button>
        </div>
      </div>

      <div className="logcat-rows">
        {deniedReason && (
          <div className="logcat-status-banner is-denied">
            <AlertTriangle size={14} />
            <span>Access denied — {deniedReason}</span>
          </div>
        )}
        {!deniedReason && exhausted && (
          <div className="logcat-status-banner is-exhausted">
            <AlertTriangle size={14} />
            <span>Connection lost after repeated attempts. Use Reconnect above to try again.</span>
          </div>
        )}
        {visible.map((r, i) => (
          <div className={`logcat-row ${r.synthetic ? 'is-synthetic' : ''}`} key={i}>
            <span className="logcat-time">
              {new Date(r.ts).toLocaleTimeString([], { hour12: false })}
            </span>
            <span className="logcat-pid">
              {r.pid}-{r.tid}
            </span>
            <span className="logcat-pkg" title={r.pkg}>
              {r.pkg ?? ''}
            </span>
            <span className={`logcat-level lvl-${r.level}`}>{r.level}</span>
            <span className="logcat-tag" title={r.tag}>
              {r.tag}
            </span>
            <span className="logcat-msg">{r.message}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
