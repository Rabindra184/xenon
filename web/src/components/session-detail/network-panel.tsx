import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card } from '../ui/Card';
import { Pill } from '../ui/Pill';
import { EmptyState } from '../ui/EmptyState';
import { Table, THead, TBody, TR, TH, TD } from '../ui/Table';
import { Network, Download } from 'lucide-react';
import { useSocket } from '../../hooks/useSocket';
import {
  CapturedRequest,
  InterceptorActiveStatus,
  fetchSessionRequests,
  fetchRequestDetail,
  harDownloadUrl,
  shortFailureLabel,
} from '../../api-service/interceptor';
import { NetworkRequestModal } from './network-request-modal';

interface Props {
  sessionId: string;
  sessionEnded: boolean;
}

function formatTime(ts: number): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour12: false });
}

function statusTone(status: number): 'ready' | 'busy' | 'error' | 'neutral' {
  if (status >= 200 && status < 300) return 'ready';
  if (status >= 300 && status < 400) return 'neutral';
  if (status >= 400 && status < 500) return 'busy';
  if (status >= 500) return 'error';
  return 'neutral';
}

export const NetworkPanel: React.FC<Props> = ({ sessionId, sessionEnded }) => {
  const [active, setActive] = useState<boolean | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requests, setRequests] = useState<CapturedRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<CapturedRequest | null>(null);
  const seenIds = useRef<Set<string>>(new Set());
  const { on, isConnected } = useSocket();

  const apply = useCallback((res: InterceptorActiveStatus) => {
    setForbidden(!!res.forbidden);
    setActive(res.active);
    setError(res.error || null);
    const list = res.requests || [];
    setRequests(list);
    seenIds.current = new Set(list.map((r) => r.id));
  }, []);

  // Initial load
  useEffect(() => {
    let mounted = true;
    setLoading(true);
    fetchSessionRequests(sessionId)
      .then((res) => {
        if (mounted) apply(res);
      })
      .catch(() => {
        if (mounted) apply({ active: false, error: 'the server could not be reached' });
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [sessionId, apply]);

  // Live updates — only meaningful while session is running
  useEffect(() => {
    if (sessionEnded) return;
    let live = true;
    const offRequest = on('interceptor_request', (payload: CapturedRequest) => {
      if (!payload || payload.sessionId !== sessionId) return;
      if (seenIds.current.has(payload.id)) return;
      seenIds.current.add(payload.id);
      setRequests((prev) => [payload, ...prev]);
      setActive(true);
    });
    const offStarted = on('interceptor_session_started', (p: { sessionId: string }) => {
      if (p?.sessionId === sessionId) setActive(true);
    });
    // The capture is saved when the session ends; read it back, so the list
    // (and the HAR link) stays rather than turning into "no capture".
    const offStopped = on('interceptor_session_stopped', (p: { sessionId: string }) => {
      if (p?.sessionId !== sessionId) return;
      fetchSessionRequests(sessionId)
        .then((res) => {
          if (live) apply(res);
        })
        .catch(() => undefined);
    });
    return () => {
      live = false;
      offRequest();
      offStarted();
      offStopped();
    };
  }, [on, sessionId, sessionEnded, isConnected, apply]);

  const sortedRequests = useMemo(
    () => [...requests].sort((a, b) => b.ts - a.ts),
    [requests],
  );

  const openDetail = async (row: CapturedRequest) => {
    // Open immediately with the row data, then enrich with full detail (includes resBody from disk)
    setSelected(row);
    if (active) {
      const full = await fetchRequestDetail(sessionId, row.id);
      if (full) setSelected(full);
    }
  };

  const action = active && requests.length > 0 ? (
    <a
      href={harDownloadUrl(sessionId)}
      className="inline-flex items-center gap-1 text-xs text-[var(--text-dim)] hover:text-[var(--text)]"
      title="Download HAR"
    >
      <Download className="h-3 w-3" />
      HAR
    </a>
  ) : null;

  const header = (
    <div className="flex items-center gap-2">
      <Network className="h-3.5 w-3.5 text-[var(--text-dim)]" />
      <span>Network</span>
      {active && requests.length > 0 && (
        <span className="text-xs text-[var(--text-dim)]">({requests.length})</span>
      )}
    </div>
  );

  let body: React.ReactNode;
  // A 404 says there is no capture; any other failure is an error to show.
  const noCapture = active === false && (!error || error === 'interceptor inactive');
  if (loading) {
    body = <div className="p-4 text-xs text-[var(--text-dim)]">Loading…</div>;
  } else if (forbidden) {
    body = (
      <EmptyState
        title="Only admins can see network requests"
        description="Captured requests can carry sign-in details and personal data, so only admins can open them. Ask an admin to look at this session's requests."
      />
    );
  } else if (noCapture && sessionEnded) {
    body = (
      <EmptyState
        title="No network capture"
        description="This session didn't capture its network requests."
      />
    );
  } else if (noCapture) {
    body = (
      <EmptyState
        title="Network capture is off"
        description="This session isn't capturing its network requests. Android sessions capture them when the test turns network capture on in its capabilities, or when it is on for every session in the server settings."
      />
    );
  } else if (error) {
    body = (
      <div className="p-4 text-xs text-[var(--red)]">Failed to load requests: {error}</div>
    );
  } else if (sortedRequests.length === 0) {
    body = (
      <EmptyState
        title="Waiting for requests"
        description={
          sessionEnded
            ? 'No HTTP traffic was captured during this session.'
            : 'Captured requests will appear here as the device makes calls.'
        }
      />
    );
  } else {
    body = (
      <div className="overflow-auto max-h-96">
        <Table>
          <THead>
            <TR>
              <TH style={{ width: 80 }}>Time</TH>
              <TH style={{ width: 70 }}>Method</TH>
              <TH style={{ width: 70 }}>Status</TH>
              <TH>Host</TH>
              <TH>Path</TH>
              <TH style={{ width: 80 }}>Duration</TH>
              <TH style={{ width: 90 }}>Flags</TH>
            </TR>
          </THead>
          <TBody>
            {sortedRequests.map((r) => (
              <TR
                key={r.id}
                onClick={() => openDetail(r)}
                style={{ cursor: 'pointer' }}
                title={r.failed ? r.failureReason : undefined}
              >
                <TD className="font-mono text-[11px]">{formatTime(r.ts)}</TD>
                <TD>
                  <Pill tone="accent">{r.method}</Pill>
                </TD>
                <TD>
                  {r.failed ? (
                    <Pill tone="error">{shortFailureLabel(r.failureKind)}</Pill>
                  ) : (
                    <Pill tone={statusTone(r.resStatus)}>{r.resStatus || '—'}</Pill>
                  )}
                </TD>
                <TD className="font-mono text-[11px] truncate" title={r.host}>
                  {r.host}
                </TD>
                <TD className="font-mono text-[11px] truncate" title={r.path}>
                  {r.failed ? '—' : r.path}
                </TD>
                <TD className="font-mono text-[11px]">{r.failed ? '—' : `${r.durationMs}ms`}</TD>
                <TD>
                  <div className="flex gap-1">
                    {r.mocked && <Pill tone="accent">mock</Pill>}
                    {r.modified && <Pill tone="busy">mod</Pill>}
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
    );
  }

  return (
    <>
      <Card header={header} action={action} padded={false}>
        {body}
      </Card>
      <NetworkRequestModal request={selected} onClose={() => setSelected(null)} />
    </>
  );
};
