import React from 'react';
import { VideoOff } from 'lucide-react';
import XenonApiService from '../../api-service';
import type { ISession } from '../../interfaces/ISession';

interface Props {
  session: ISession;
}

export const RecordingCard: React.FC<Props> = ({ session }) => {
  const isLive = session.status === 'running';
  const hasRecording = !!session.video_recording;

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
      <header className="px-3 py-2 border-b border-[var(--border)] flex items-center justify-between">
        <span className="text-[10px] font-mono font-semibold uppercase tracking-widest text-[var(--text-dim)]">
          Recording
        </span>
        {isLive && (
          <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-[var(--red)]">
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
            <div className="text-xs text-[var(--text-dim)] max-w-xs">
              {session.status === 'failed'
                ? 'Session failed before recording started.'
                : session.video_recording_enabled === false
                ? 'Recording was disabled for this session.'
                : 'No recording was captured.'}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
