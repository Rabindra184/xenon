import * as React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Circle, Download, Film, Square } from 'lucide-react';
import { SegmentedControl } from '../ui/SegmentedControl';
import {
  formatElapsed,
  isRecording,
  recordingIdsByPhone,
  useMosaic,
} from './recording-group-store';
import {
  getActiveRecordings,
  getRecording,
  startRecording,
  stopRecording,
  videosZipUrl,
  videoMp4Url,
  RecordingConflict,
  type ConflictBody,
} from '../../api-service/recordings';
import { COMPOSITE_ENDED_EARLY, compositeItems } from '../recordings/recordingActions';
import { samePhone, serverLabel, udidRepeats, type PhoneRef } from '../../lib/phone';

type GridPhone = PhoneRef & { name?: string };

interface Props {
  /** The phones on the grid (Record targets every tile), with their names. */
  phones: GridPhone[];
  /** Clears the marks from the preview and, in order with the marks, from the recording. */
  onClearMarks: () => void;
}

function recordButtonLabel(count: number, phase: string): string {
  if (phase === 'starting') return 'Starting…';
  if (count <= 1) return 'Record';
  return `Record ${count} devices`;
}

const BUSY_REASON: Record<string, string> = {
  automation: 'running a test',
  manual_other: 'in use by another user',
  leased: 'leased',
  recording_other_group: 'recording in another group',
};

/**
 * What a refused start says, by the server's `error`. Only `concurrency_cap`
 * is the cap: an `ambiguous_phone` used to read "cap reached
 * (undefined/undefined)".
 */
function refusalMessage(body: ConflictBody, phones: GridPhone[]): string {
  switch (body.error) {
    case 'device_busy': {
      const list = (body.busyDevices ?? [])
        .map((b) => {
          const host = b.host;
          const tile = host ? phones.find((p) => samePhone(p, { udid: b.udid, host })) : undefined;
          const name = tile?.name || b.udid;
          const reason = BUSY_REASON[b.reason] ?? 'busy';
          // The server only tells phones apart when two of the grid's share the udid.
          if (!udidRepeats(phones, b.udid)) return `${name} (${reason})`;
          return `${name} on ${host ? serverLabel(host) : 'an unknown server'} (${reason})`;
        })
        .join(', ');
      return `Cannot start — these devices are busy: ${list}`;
    }
    case 'concurrency_cap':
      return `Server-wide recording cap reached (${body.active}/${body.limit}).`;
    case 'duplicate_phone':
      return 'That phone is in the list twice.';
    default:
      return body.message || 'Recording did not start.';
  }
}

// Icons are decorative: the button's text names it.
const icon = { 'aria-hidden': true, size: 14, className: 'shrink-0' } as const;

export function RecordingControls({ phones, onClearMarks }: Props) {
  const { state, dispatch } = useMosaic();
  const [now, setNow] = React.useState(() => Date.now());

  const running = isRecording(state);

  // Live elapsed timer while recording / stopping.
  React.useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [running]);

  const elapsedMs = state.startedAt && running ? now - state.startedAt : 0;

  const canStart = state.recordingPhase === 'idle' && phones.length > 0;
  const canStopOrMark = state.recordingPhase === 'recording';
  const canAnnotate = canStopOrMark;
  const canDraw = canAnnotate && state.annotateMode;
  const showDownload = !!state.groupId && state.recordingPhase === 'idle';
  const multiDevice = phones.length > 1 || state.downloadableVideoCount > 1;
  // Every part of the side-by-side video, as Recordings offers them.
  const sideBySide =
    showDownload && state.groupId
      ? compositeItems({
          groupId: state.groupId,
          hasComposite: state.compositeEnabled,
          compositeParts: state.compositeParts,
        })
      : [];
  // Single playable video → direct mp4; otherwise videos-only zip.
  const useDirectMp4 =
    showDownload &&
    sideBySide.length === 0 &&
    (state.downloadableVideoCount === 1 ||
      (state.downloadableVideoCount === 0 && phones.length <= 1));

  const onStart = async () => {
    if (!canStart) return;
    dispatch({ type: 'SET_RECORDING_PHASE', phase: 'starting' });
    dispatch({ type: 'SET_BANNER', banner: null });
    try {
      const out = await startRecording(phones);
      if (!out.recordings?.length) {
        dispatch({ type: 'SET_RECORDING_PHASE', phase: 'idle' });
        dispatch({
          type: 'SET_BANNER',
          banner: {
            tone: 'error',
            message: 'Recording did not start. Check that live preview is working, then try again.',
          },
        });
        return;
      }
      const map = recordingIdsByPhone(out.recordings);
      const failedCount = phones.length - out.recordings.length;
      dispatch({
        type: 'START_RECORDING',
        groupId: out.groupId,
        startedAt: Date.now(),
        tileIds: map,
        compositeEnabled: out.compositeEnabled === true,
      });
      if (failedCount > 0) {
        dispatch({
          type: 'SET_BANNER',
          banner: {
            tone: 'error',
            message: `Recording started on ${out.recordings.length} of ${phones.length} devices (${failedCount} failed).`,
          },
        });
      } else {
        dispatch({ type: 'SET_BANNER', banner: null });
      }
    } catch (e: any) {
      dispatch({ type: 'SET_RECORDING_PHASE', phase: 'idle' });
      if (e instanceof RecordingConflict) {
        dispatch({
          type: 'SET_BANNER',
          banner: { tone: 'error', message: refusalMessage(e.body, phones) },
        });
      } else {
        dispatch({
          type: 'SET_BANNER',
          banner: {
            tone: 'error',
            message: `Recording failed: ${(e as Error).message}`,
          },
        });
      }
    }
  };

  // The stopped group's side-by-side parts. Through 2.36 the start's answer
  // decided alone: a one-phone group that gained a phone (and so a side-by-side
  // video) offered none, and a group with two parts offered only the first.
  // Unreadable, the start's answer stands.
  const readComposite = async (groupId: string) => {
    try {
      const { summary } = await getRecording(groupId);
      dispatch({
        type: 'SET_COMPOSITE',
        groupId,
        hasComposite: summary.hasComposite,
        parts: summary.compositeParts,
        endedEarly: summary.compositeEndedEarly === true,
      });
    } catch {
      /* keep what the start said */
    }
  };

  const onStop = async () => {
    if (!state.groupId || state.recordingPhase !== 'recording') return;
    dispatch({ type: 'SET_RECORDING_PHASE', phase: 'stopping' });
    try {
      const out = await stopRecording(state.groupId);
      const ok = (out.recordings ?? []).filter(
        (r) => r.status === 'STOPPED' && (r.sizeBytes ?? 0) >= 1024,
      );
      const failed = (out.recordings ?? []).filter((r) => r.status !== 'STOPPED');
      dispatch({
        type: 'STOP_RECORDING',
        downloadableVideoCount: ok.length,
        compositeEnabled: state.compositeEnabled,
      });
      void readComposite(state.groupId);
      if (ok.length === 0) {
        dispatch({
          type: 'SET_BANNER',
          banner: {
            tone: 'error',
            message:
              failed.length > 0
                ? `Recording failed on ${failed.length} device(s). Nothing to download.`
                : 'Recording stopped but no playable video was produced.',
          },
        });
      } else if (failed.length > 0) {
        dispatch({
          type: 'SET_BANNER',
          banner: {
            tone: 'info',
            message: `${ok.length} ready, ${failed.length} failed. Download with the button above.`,
          },
        });
      } else {
        dispatch({
          type: 'SET_BANNER',
          banner: {
            tone: 'info',
            message:
              ok.length === 1
                ? 'Video ready. Download it with the button above.'
                : `${ok.length} videos ready. Download them with the button above.`,
          },
        });
      }
    } catch (e: any) {
      // Ask whether the group still runs. Through 2.36 a failed stop always
      // went back to idle: Record came back while the server kept recording,
      // and only a reload brought Stop back. Not knowing counts as running,
      // since Stop can be pressed again and a stray idle can't be undone.
      const groupId = state.groupId;
      const stillRunning = await getActiveRecordings()
        .then(({ groups }) => groups.some((g) => g.groupId === groupId))
        .catch(() => true);
      if (stillRunning) {
        dispatch({ type: 'STOP_FAILED' });
        dispatch({
          type: 'SET_BANNER',
          banner: {
            tone: 'error',
            message: `Stop failed: ${e.message}. The devices are still recording. Try Stop again.`,
          },
        });
      } else {
        // Ended anyway; groupId stays so a partial file may still download.
        dispatch({ type: 'STOP_RECORDING' });
        if (groupId) void readComposite(groupId);
        dispatch({
          type: 'SET_BANNER',
          banner: { tone: 'error', message: `Stop failed: ${e.message}` },
        });
      }
    }
  };

  const setMode = (mode: 'interact' | 'annotate') => {
    const enabled = mode === 'annotate';
    if (enabled && !canAnnotate) return;
    if (enabled !== state.annotateMode) dispatch({ type: 'SET_ANNOTATE_MODE', enabled });
  };

  // Esc returns to Interact, only while annotating: in Interact mode a
  // focused Android tile sends Esc to the phone as Back.
  React.useEffect(() => {
    if (!state.annotateMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest?.('input, textarea, select') || t.isContentEditable)) return;
      dispatch({ type: 'SET_ANNOTATE_MODE', enabled: false });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.annotateMode, dispatch]);

  const clearAnnotations = () => {
    if (!canAnnotate) return;
    onClearMarks();
  };

  const hasOverlayAnnotations = Object.values(state.overlayAnnotations).some(
    (list) => (list?.length ?? 0) > 0,
  );

  const shapes: Array<{ id: typeof state.shape; label: string }> = [
    { id: 'RECT', label: 'Rect' },
    { id: 'CIRCLE', label: 'Circle' },
    { id: 'ARROW', label: 'Arrow' },
    { id: 'FREEHAND', label: 'Draw' },
  ];

  return (
    <div className="flex items-center gap-2 flex-wrap justify-end">
      {/* While recording, the timer takes Record's place: a greyed-out Record
          button beside it said nothing the timer didn't. Same slot, so nothing
          to its right moves. */}
      {running ? (
        <span
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-mono tabular-nums bg-[rgb(var(--rgb-red-600)/0.2)] text-[var(--red-200)] border border-[rgb(var(--rgb-red)/0.4)]"
          title="Recording elapsed time"
        >
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--red)] animate-pulse" />
          REC {formatElapsed(elapsedMs)}
          {state.recordingPhase === 'stopping' ? ' · Stopping…' : ''}
        </span>
      ) : (
        <button
          type="button"
          onClick={onStart}
          disabled={!canStart}
          title={
            phones.length === 0
              ? 'Add a device to the grid first'
              : 'Record every device on the grid'
          }
          // In light, 40% of a red fill is a pink block that reads as an alert.
          // Disabled, it takes the outlined look of the Stop button beside it;
          // the ring is inset so enabling it doesn't change its size.
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded bg-[var(--red-600)] text-white disabled:opacity-40 disabled:cursor-not-allowed light:disabled:bg-transparent light:disabled:text-[var(--text)] light:disabled:ring-1 light:disabled:ring-inset light:disabled:ring-[color:var(--border)]"
        >
          <Circle {...icon} size={10} fill="currentColor" />
          {recordButtonLabel(phones.length, state.recordingPhase)}
        </button>
      )}
      <button
        type="button"
        onClick={onStop}
        disabled={!canStopOrMark}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border border-[var(--border)] disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Square {...icon} size={12} />
        {state.recordingPhase === 'stopping' ? 'Stopping…' : 'Stop'}
      </button>
      {/* Always rendered: controls that appear in this row slide others under
          the cursor. Annotate only works inside a recording. */}
      <SegmentedControl<'interact' | 'annotate'>
        size="sm"
        value={state.annotateMode ? 'annotate' : 'interact'}
        onChange={setMode}
        segments={[
          {
            value: 'interact',
            label: 'Interact',
            title: 'Tap, swipe and type on the devices (Esc)',
            keyShortcuts: 'Escape',
          },
          {
            value: 'annotate',
            label: 'Annotate',
            title: canAnnotate ? 'Draw marks on the recording' : 'Start recording to annotate',
            disabled: !canAnnotate,
          },
        ]}
      />

      {/* Rendered for the whole recording and disabled rather than hidden:
          controls appearing in this right-aligned row slid every button under
          the cursor. */}
      {running && (
        <div className="flex items-center gap-1 ml-1 pl-2 border-l border-[var(--border)]">
          {shapes.map((s) => (
            <button
              key={s.id}
              type="button"
              disabled={!canDraw}
              aria-pressed={state.shape === s.id}
              onClick={() => dispatch({ type: 'SET_SHAPE', shape: s.id })}
              className={`px-2 py-1 text-xs rounded border disabled:opacity-40 disabled:cursor-not-allowed ${
                state.shape === s.id
                  ? 'bg-[var(--surface-2)] border-[var(--color-info)] text-[rgb(var(--rgb-fg))]'
                  : 'border-[var(--border)] opacity-80 hover:opacity-100'
              }`}
            >
              {s.label}
            </button>
          ))}
          <input
            type="color"
            value={state.color}
            disabled={!canDraw}
            onChange={(e) => dispatch({ type: 'SET_COLOR', color: e.target.value })}
            title="Annotation color"
            aria-label="Annotation color"
            className="w-7 h-7 rounded border border-[var(--border)] bg-transparent cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          />
          <button
            type="button"
            onClick={clearAnnotations}
            disabled={!canAnnotate || !hasOverlayAnnotations}
            title="Clear marks from the preview and the recording"
            className="px-2 py-1 text-xs rounded border border-[var(--border)] hover:bg-[var(--surface-2)] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Clear marks
          </button>
        </div>
      )}

      {showDownload && useDirectMp4 && (
        <a
          href={videoMp4Url(state.groupId!)}
          className="ml-1 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border border-[var(--border)] hover:bg-[var(--surface-2)]"
          download
        >
          <Download {...icon} />
          Download video
        </a>
      )}
      {showDownload && !useDirectMp4 && (
        <a
          href={videosZipUrl(state.groupId!)}
          className="ml-1 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border border-[var(--border)] hover:bg-[var(--surface-2)]"
          download={`videos-${state.groupId}.zip`}
          title="ZIP of mp4 files only (no JSON extras)"
        >
          <Download {...icon} />
          Download {multiDevice ? 'videos' : 'video'}
        </a>
      )}
      {sideBySide.map((item) => (
        <a
          key={item.key}
          href={item.url}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border border-[var(--border)] hover:bg-[var(--surface-2)]"
          // `composite` (part 1) or `composite-<part>`.
          download={`${item.key.replace('composite', `side-by-side-${state.groupId}`)}.mp4`}
          title="All devices in one side-by-side video"
        >
          <Download {...icon} />
          {item.label}
        </a>
      ))}
      {sideBySide.length > 0 && state.compositeEndedEarly && (
        <span role="note" className="inline-flex items-center gap-1.5 text-xs text-[var(--text)]">
          <AlertTriangle {...icon} className="shrink-0 text-[var(--color-warning)]" />
          {COMPOSITE_ENDED_EARLY}
        </span>
      )}
      {showDownload && state.groupId && (
        <Link
          to={`/recordings/${encodeURIComponent(state.groupId)}`}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border border-[var(--border)] hover:bg-[var(--surface-2)]"
        >
          <Film {...icon} />
          Open in Recordings
        </Link>
      )}
    </div>
  );
}
