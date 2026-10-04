import React from 'react';
import { VideoOff } from 'lucide-react';
import XenonApiService from '../../api-service';
import type { ISession } from '../../interfaces/ISession';

interface Props {
  session: ISession;
}

/**
 * Why there's no video, from what the session's record says: whether it
 * asked for a recording, and whether it is still running. Nothing more is
 * known, so nothing more is said: a failed session that asked for one may
 * have failed long after recording started.
 */
export function noVideoReason(
  session: Pick<ISession, 'status' | 'video_recording_enabled'>,
): string {
  const running = session.status === 'running';
  if (session.video_recording_enabled === false) {
    return running ? 'Recording is off for this session.' : 'Recording was off for this session.';
  }
  return running
    ? 'Any video appears here after the session ends.'
    : 'No video was saved for this session.';
}

export const RecordingCard: React.FC<Props> = ({ session }) => {
  const isLive = session.status === 'running';
  const hasRecording = !!session.video_recording;

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
      <header className="px-3 py-2 border-b border-[var(--border)] flex items-center justify-between">
        <span className="text-[11px] font-semibold text-[var(--text-dim)]">
          Recording
        </span>
        {isLive && (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--red)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--red)] pulse-dot" />
            Live
          </span>
        )}
      </header>

      <div className="aspect-video bg-[var(--bg)] flex items-center justify-center">
        {isLive && session.has_live_video ? (
          <img
            src={XenonApiService.getSessionLiveVideoUrl(session.id)}
            alt={`Live view of session ${session.id}`}
            className="w-full h-full object-contain"
          />
        ) : hasRecording ? (
          <video
            controls
            src={XenonApiService.getAssetUrl(session.video_recording)}
            className="w-full h-full object-contain"
          />
        ) : (
          <div className="flex flex-col items-center text-center px-6 py-8 gap-2">
            <div className="h-10 w-10 rounded-full bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center">
              <VideoOff className="h-5 w-5 text-[var(--text-dim)]" />
            </div>
            <div className="text-sm text-[var(--text)] font-medium">No video available</div>
            <div className="text-xs text-[var(--text-dim)] max-w-xs">{noVideoReason(session)}</div>
          </div>
        )}
      </div>
    </section>
  );
};
