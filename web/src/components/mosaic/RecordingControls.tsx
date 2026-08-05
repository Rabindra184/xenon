import * as React from 'react';
import { formatElapsed, useMosaic } from './recording-group-store';
import {
  startRecording,
  stopRecording,
  addBookmark,
  videosZipUrl,
  videoMp4Url,
  compositeMp4Url,
  RecordingConflict,
} from '../../api-service/recordings';

interface Props {
  /** UDIDs currently in the mosaic (Record targets every tile). */
  selectedUdids: string[];
}

function recordButtonLabel(count: number, phase: string): string {
  if (phase === 'starting') return 'Starting…';
  if (count <= 0) return 'Record';
  if (count === 1) return '● Record';
  return `● Record ${count} devices`;
}

export function RecordingControls({ selectedUdids }: Props) {
  const { state, dispatch } = useMosaic();
  const [now, setNow] = React.useState(() => Date.now());

  // Live elapsed timer while recording / stopping.
  React.useEffect(() => {
    if (state.recordingPhase !== 'recording' && state.recordingPhase !== 'stopping') {
      return;
    }
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [state.recordingPhase]);

  const elapsedMs =
    state.startedAt && (state.recordingPhase === 'recording' || state.recordingPhase === 'stopping')
      ? now - state.startedAt
      : 0;

  const busy =
    state.recordingPhase === 'starting' || state.recordingPhase === 'stopping';
  const canStart =
    state.recordingPhase === 'idle' && selectedUdids.length > 0 && !busy;
  const canStopOrMark = state.recordingPhase === 'recording' && !busy;
  const showDownload = !!state.groupId && state.recordingPhase === 'idle';
  const multiDevice = selectedUdids.length > 1 || state.downloadableVideoCount > 1;
  const showCompositeDownload = showDownload && state.compositeEnabled;
  // Single playable video → direct mp4; otherwise videos-only zip.
  const useDirectMp4 =
    showDownload &&
    !state.compositeEnabled &&
    (state.downloadableVideoCount === 1 ||
      (state.downloadableVideoCount === 0 && selectedUdids.length <= 1));

  const onStart = async () => {
    if (!canStart) return;
    dispatch({ type: 'SET_RECORDING_PHASE', phase: 'starting' });
    dispatch({ type: 'SET_BANNER', banner: null });
    try {
      const out = await startRecording(selectedUdids);
      if (!out.recordings?.length) {
        dispatch({ type: 'SET_RECORDING_PHASE', phase: 'idle' });
        dispatch({
          type: 'SET_BANNER',
          banner: {
            tone: 'error',
            message:
              'Recording did not start. Check that live preview is working, then try again.',
          },
        });
        return;
      }
      const map: Record<string, string> = {};
      for (const r of out.recordings) map[r.udid] = r.id;
      const failedCount = selectedUdids.length - out.recordings.length;
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
            message: `Recording started on ${out.recordings.length} of ${selectedUdids.length} devices (${failedCount} failed).`,
          },
        });
      } else {
        dispatch({ type: 'SET_BANNER', banner: null });
      }
    } catch (e: any) {
      dispatch({ type: 'SET_RECORDING_PHASE', phase: 'idle' });
      if (e instanceof RecordingConflict) {
        if (e.body.error === 'device_busy') {
          const list = (e.body.busyDevices ?? [])
            .map((b) => `${b.udid} (${b.reason})`)
            .join(', ');
          dispatch({
            type: 'SET_BANNER',
            banner: {
              tone: 'error',
              message: `Cannot start — these devices are busy: ${list}`,
            },
          });
        } else {
          dispatch({
            type: 'SET_BANNER',
            banner: {
              tone: 'error',
              message: `Server-wide recording cap reached (${e.body.active}/${e.body.limit}).`,
            },
          });
        }
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
            message: `${ok.length} video(s) ready · ${failed.length} failed. Use Download below.`,
          },
        });
      } else {
        dispatch({
          type: 'SET_BANNER',
          banner: {
            tone: 'info',
            message:
              ok.length === 1
                ? 'Video ready — download below.'
                : `${ok.length} videos ready — download below.`,
          },
        });
      }
    } catch (e: any) {
      // Leave groupId intact so a partial file may still download; clear REC UI.
      dispatch({ type: 'STOP_RECORDING' });
      dispatch({
        type: 'SET_BANNER',
        banner: { tone: 'error', message: `Stop failed: ${e.message}` },
      });
    }
  };

  const onBookmark = async () => {
    if (!state.groupId || state.recordingPhase !== 'recording') return;
    const label = window.prompt('Bookmark label?');
    if (!label) return;
    const elapsed = state.startedAt ? Date.now() - state.startedAt : 0;
    const firstId = state.tiles.find((t) => t.recordingId)?.recordingId;
    if (!firstId) return;
    try {
      await addBookmark(state.groupId, firstId, elapsed, label);
    } catch (e: any) {
      dispatch({
        type: 'SET_BANNER',
        banner: { tone: 'error', message: `Bookmark failed: ${e.message}` },
      });
    }
  };

  const toggleAnnotate = () => {
    if (state.recordingPhase !== 'recording') return;
    dispatch({ type: 'SET_ANNOTATE_MODE', enabled: !state.annotateMode });
  };

  return (
    <div className="flex items-center gap-2 flex-wrap justify-end">
      {(state.recordingPhase === 'recording' || state.recordingPhase === 'stopping') && (
        <span
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-mono tabular-nums bg-red-600/20 text-red-200 border border-red-500/40"
          title="Recording elapsed time"
        >
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
          REC {formatElapsed(elapsedMs)}
          {state.recordingPhase === 'stopping' ? ' · Stopping…' : ''}
        </span>
      )}

      <button
        type="button"
        onClick={onStart}
        disabled={!canStart}
        title={
          selectedUdids.length === 0
            ? 'Add a device to the mosaic first'
            : 'Record every device currently in the mosaic'
        }
        className="px-3 py-1.5 text-sm rounded bg-red-600 text-white disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {recordButtonLabel(selectedUdids.length, state.recordingPhase)}
      </button>
      <button
        type="button"
        onClick={onStop}
        disabled={!canStopOrMark}
        className="px-3 py-1.5 text-sm rounded border border-[var(--border)] disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {state.recordingPhase === 'stopping' ? 'Stopping…' : '⏹ Stop'}
      </button>
      <button
        type="button"
        onClick={onBookmark}
        disabled={!canStopOrMark}
        className="px-3 py-1.5 text-sm rounded border border-[var(--border)] disabled:opacity-40 disabled:cursor-not-allowed"
      >
        🔖 Bookmark
      </button>
      <button
        type="button"
        onClick={toggleAnnotate}
        disabled={state.recordingPhase !== 'recording'}
        className={`px-3 py-1.5 text-sm rounded border ${
          state.annotateMode
            ? 'bg-[var(--accent,#3b82f6)] text-white border-transparent'
            : 'border-[var(--border)]'
        } disabled:opacity-40 disabled:cursor-not-allowed`}
      >
        ✎ Annotate
      </button>

      {showDownload && useDirectMp4 && (
        <a
          href={videoMp4Url(state.groupId!)}
          className="ml-1 px-3 py-1.5 text-sm rounded border border-[var(--border)] hover:bg-[var(--surface-2,#1a1a1a)]"
          download
        >
          ⤓ Download video
        </a>
      )}
      {showDownload && !useDirectMp4 && (
        <a
          href={videosZipUrl(state.groupId!)}
          className="ml-1 px-3 py-1.5 text-sm rounded border border-[var(--border)] hover:bg-[var(--surface-2,#1a1a1a)]"
          download={`videos-${state.groupId}.zip`}
          title="ZIP of mp4 files only (no JSON extras)"
        >
          ⤓ Download {multiDevice ? 'videos' : 'video'}
        </a>
      )}
      {showCompositeDownload && (
        <a
          href={compositeMp4Url(state.groupId!)}
          className="px-3 py-1.5 text-sm rounded border border-[var(--border)] hover:bg-[var(--surface-2,#1a1a1a)]"
          download={`side-by-side-${state.groupId}.mp4`}
          title="All devices in one side-by-side video"
        >
          ⤓ Side-by-side
        </a>
      )}
    </div>
  );
}
