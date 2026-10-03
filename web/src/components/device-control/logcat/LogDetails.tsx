import * as React from 'react';
import { X } from 'lucide-react';
import { Button } from '../../ui/button';
import { levelName, type LogPlatform } from './levelCounts';
import { formatTimeMs } from './logFormat';
import type { BufferedLogcatRecord } from './useLogcatStream';

export interface LogDetailsProps {
  record: BufferedLogcatRecord;
  platform: LogPlatform;
  /** False once the buffer has dropped the line, or it was cleared. */
  inBuffer: boolean;
  onCopyLine(): void;
  onCopyMessage(): void;
  onShowOnlyTag(): void;
  onHideTag(): void;
  onShowOnlyApp(): void;
  onClose(): void;
}

/**
 * The panel under the list for the line you clicked: all of it, and what you
 * can do with it. It keeps its own copy of the line, so it goes on showing it
 * after the buffer drops it.
 */
export function LogDetails({
  record: r,
  platform,
  inBuffer,
  onCopyLine,
  onCopyMessage,
  onShowOnlyTag,
  onHideTag,
  onShowOnlyApp,
  onClose,
}: LogDetailsProps) {
  const own = !!r.synthetic;
  return (
    <section className="log-details" aria-label="Line details">
      <header className="log-details-head">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="log-details-close"
          aria-label="Close details"
          title="Close details (Esc)"
          onClick={onClose}
        >
          <X size={14} aria-hidden="true" />
        </Button>
        <h3 className="log-details-title">
          {own ? 'Added by Xenon' : `${levelName(r.level, platform)} · ${r.tag}`}
        </h3>
      </header>
      {own && (
        <p className="log-details-note">Xenon added this line. It didn’t come from the phone.</p>
      )}
      <dl className="log-details-fields">
        <div>
          <dt>Time</dt>
          <dd>{formatTimeMs(r.ts)}</dd>
        </div>
        {!own && (
          <>
            <div>
              <dt>App</dt>
              <dd>{r.pkg ?? 'Unknown'}</dd>
            </div>
            <div>
              <dt>Process ID</dt>
              <dd>{r.pid}</dd>
            </div>
            <div>
              <dt>Thread ID</dt>
              <dd>{r.tid}</dd>
            </div>
          </>
        )}
      </dl>
      {!inBuffer && <p className="log-details-left">This line has left the buffer</p>}
      <pre className="log-details-msg">{r.message}</pre>
      <div className="log-details-actions">
        <Button type="button" variant="secondary" size="sm" onClick={onCopyLine}>
          Copy line
        </Button>
        {!own && (
          <>
            <Button type="button" variant="secondary" size="sm" onClick={onCopyMessage}>
              Copy message
            </Button>
            {r.tag && (
              <>
                <Button type="button" variant="secondary" size="sm" onClick={onShowOnlyTag}>
                  Show only this tag
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={onHideTag}>
                  Hide this tag
                </Button>
              </>
            )}
            {r.pkg && (
              <Button type="button" variant="secondary" size="sm" onClick={onShowOnlyApp}>
                Show only this app
              </Button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
