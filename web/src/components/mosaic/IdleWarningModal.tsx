import * as React from 'react';

interface IdleWarningModalProps {
  remainingSec: number;
  onContinue: () => void;
  onReleaseNow: () => void;
}

// Warning modal that surfaces ~30 s before the idle timeout fires. Demands an
// explicit "Continue Session" click so a user who walked away from the desk
// doesn't keep a device locked indefinitely. Matches the ADF idle-detection
// UX. Hub-side OrphanSweeper still backstops a tab close / network drop.
export function IdleWarningModal({ remainingSec, onContinue, onReleaseNow }: IdleWarningModalProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="idle-warning-title"
      className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center"
    >
      <div className="bg-[var(--bg)] border border-[var(--border)] rounded-lg w-full max-w-md p-6">
        <h3 id="idle-warning-title" className="text-base font-semibold mb-2">
          Are you still there?
        </h3>
        <p className="text-sm text-[var(--text-dim)] mb-4">
          Your devices will be released in{' '}
          <span className="text-[var(--text)] font-mono font-semibold">{remainingSec}s</span> due
          to inactivity. Click <strong>Continue Session</strong> to keep them locked.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onReleaseNow}
            className="h-9 px-3 rounded-md border border-[var(--border)] text-sm text-[var(--text-dim)] hover:text-[var(--text)]"
          >
            Release now
          </button>
          <button
            type="button"
            autoFocus
            onClick={onContinue}
            className="h-9 px-4 rounded-md bg-[var(--green)] text-black text-sm font-medium"
          >
            Continue Session
          </button>
        </div>
      </div>
    </div>
  );
}
