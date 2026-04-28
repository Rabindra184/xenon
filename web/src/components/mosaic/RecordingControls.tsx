import * as React from 'react';
import { useMosaic } from './recording-group-store';
import {
  startRecording,
  stopRecording,
  addBookmark,
  bundleZipUrl,
  compositeMp4Url,
  RecordingConflict,
} from '../../api-service/recordings';

interface Props {
  selectedUdids: string[];
}

export function RecordingControls({ selectedUdids }: Props) {
  const { state, dispatch } = useMosaic();

  const onStart = async () => {
    if (state.recording || selectedUdids.length === 0) return;
    try {
      const out = await startRecording(selectedUdids);
      const map: Record<string, string> = {};
      for (const r of out.recordings) map[r.udid] = r.id;
      dispatch({
        type: 'START_RECORDING',
        groupId: out.groupId,
        startedAt: Date.now(),
        tileIds: map,
      });
      dispatch({ type: 'SET_ERROR_BANNER', message: null });
    } catch (e: any) {
      if (e instanceof RecordingConflict) {
        if (e.body.error === 'device_busy') {
          const list = (e.body.busyDevices ?? [])
            .map((b) => `${b.udid} (${b.reason})`)
            .join(', ');
          dispatch({
            type: 'SET_ERROR_BANNER',
            message: `Cannot start — these devices are busy: ${list}`,
          });
        } else {
          dispatch({
            type: 'SET_ERROR_BANNER',
            message: `Server-wide recording cap reached (${e.body.active}/${e.body.limit}).`,
          });
        }
      } else {
        dispatch({
          type: 'SET_ERROR_BANNER',
          message: `Recording failed: ${(e as Error).message}`,
        });
      }
    }
  };

  const onStop = async () => {
    if (!state.groupId) return;
    try {
      await stopRecording(state.groupId);
    } catch (e: any) {
      dispatch({ type: 'SET_ERROR_BANNER', message: `Stop failed: ${e.message}` });
    } finally {
      dispatch({ type: 'STOP_RECORDING' });
    }
  };

  const onBookmark = async () => {
    if (!state.groupId || !state.recording) return;
    const label = window.prompt('Bookmark label?');
    if (!label) return;
    const elapsed = state.startedAt ? Date.now() - state.startedAt : 0;
    // Phase 1: bookmark attaches to the first tile's recording.
    const firstId = state.tiles.find((t) => t.recordingId)?.recordingId;
    if (!firstId) return;
    try {
      await addBookmark(state.groupId, firstId, elapsed, label);
    } catch (e: any) {
      dispatch({ type: 'SET_ERROR_BANNER', message: `Bookmark failed: ${e.message}` });
    }
  };

  const toggleAnnotate = () =>
    dispatch({ type: 'SET_ANNOTATE_MODE', enabled: !state.annotateMode });

  const canStart = !state.recording && selectedUdids.length > 0;
  const canStopOrMark = state.recording;
  const showDownload = state.groupId && !state.recording;
  // The composite mp4 only exists when the group had ≥2 devices. We use the
  // tile count at stop-time as the proxy — single-device groups don't get
  // a composite (the per-device mp4 already shows the whole screen).
  const showCompositeDownload = showDownload && state.tiles.length >= 2;

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onStart}
        disabled={!canStart}
        className="px-3 py-1.5 text-sm rounded bg-red-600 text-white disabled:opacity-40 disabled:cursor-not-allowed"
      >
        ● {selectedUdids.length > 1 ? 'Record All' : 'Record'}
      </button>
      <button
        onClick={onStop}
        disabled={!canStopOrMark}
        className="px-3 py-1.5 text-sm rounded border border-[var(--border)] disabled:opacity-40 disabled:cursor-not-allowed"
      >
        ⏹ Stop
      </button>
      <button
        onClick={onBookmark}
        disabled={!canStopOrMark}
        className="px-3 py-1.5 text-sm rounded border border-[var(--border)] disabled:opacity-40 disabled:cursor-not-allowed"
      >
        🔖 Bookmark
      </button>
      <button
        onClick={toggleAnnotate}
        disabled={!state.recording}
        className={`px-3 py-1.5 text-sm rounded border ${
          state.annotateMode
            ? 'bg-[var(--accent,#3b82f6)] text-white border-transparent'
            : 'border-[var(--border)]'
        } disabled:opacity-40 disabled:cursor-not-allowed`}
      >
        ✎ Annotate
      </button>
      {showCompositeDownload && (
        <a
          href={compositeMp4Url(state.groupId!)}
          className="ml-2 px-3 py-1.5 text-sm rounded border border-[var(--border)] hover:bg-[var(--surface-2,#1a1a1a)]"
          download={`mosaic-${state.groupId}.mp4`}
        >
          ⤓ Composite mp4
        </a>
      )}
      {showDownload && (
        <a
          href={bundleZipUrl(state.groupId!)}
          className={`${showCompositeDownload ? 'ml-1' : 'ml-2'} px-3 py-1.5 text-sm rounded border border-[var(--border)] hover:bg-[var(--surface-2,#1a1a1a)]`}
          download
        >
          ⤓ Proof bundle
        </a>
      )}
    </div>
  );
}
