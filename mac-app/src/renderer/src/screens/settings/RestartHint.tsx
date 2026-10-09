import { RotateCw } from 'lucide-react';
import { SETTINGS } from '../../copy/settings';

/**
 * "Restart the server to use this." under a server setting edited while the
 * server runs (restartHint). It is a polite live region that stays on the page,
 * so the words are announced when they appear.
 */
export function RestartHint({ show, text = SETTINGS.screen.restartToUse }: { show: boolean; text?: string }) {
  return (
    <p role="status" className="text-xs text-ink">
      {show && (
        <span className="inline-flex items-center gap-1.5">
          <RotateCw size={14} aria-hidden="true" className="shrink-0 text-info" />
          {text}
        </span>
      )}
    </p>
  );
}
