import React from 'react';
import { Modal } from '../ui/Modal';
import { Pill } from '../ui/Pill';
import { shortFailureLabel, type CapturedRequest } from '../../api-service/interceptor';

interface Props {
  request: CapturedRequest | null;
  onClose: () => void;
}

function statusTone(status: number): 'ready' | 'busy' | 'error' | 'neutral' {
  if (status >= 200 && status < 300) return 'ready';
  if (status >= 300 && status < 400) return 'neutral';
  if (status >= 400 && status < 500) return 'busy';
  if (status >= 500) return 'error';
  return 'neutral';
}

const HeaderList: React.FC<{ headers: Record<string, string> }> = ({ headers }) => {
  const entries = Object.entries(headers || {});
  if (entries.length === 0) {
    return <div className="text-xs text-[var(--text-dim)]">No headers</div>;
  }
  return (
    <div className="space-y-0.5 font-mono text-xs">
      {entries.map(([k, v]) => (
        <div key={k} className="flex gap-2">
          <span className="text-[var(--text-dim)] shrink-0">{k}:</span>
          <span className="break-all">{v}</span>
        </div>
      ))}
    </div>
  );
};

const BodyBlock: React.FC<{ body: string | null | undefined }> = ({ body }) => {
  if (body == null || body === '') {
    return <div className="text-xs text-[var(--text-dim)]">No body</div>;
  }
  let pretty = body;
  try {
    pretty = JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    /* not JSON, render as-is */
  }
  return (
    <pre className="font-mono text-xs whitespace-pre-wrap break-all bg-[var(--surface-2,var(--surface))] rounded p-2 max-h-64 overflow-auto">
      {pretty}
    </pre>
  );
};

export const NetworkRequestModal: React.FC<Props> = ({ request, onClose }) => {
  if (!request) return null;

  const title = (
    <div className="flex items-center gap-2 text-sm">
      <Pill tone="accent">{request.method}</Pill>
      {request.failed ? (
        <Pill tone="error">{shortFailureLabel(request.failureKind)}</Pill>
      ) : (
        <Pill tone={statusTone(request.resStatus)}>{request.resStatus || '—'}</Pill>
      )}
      <span className="font-mono text-xs truncate" title={request.url}>
        {request.url}
      </span>
    </div>
  );

  return (
    <Modal open={!!request} title={title} onClose={onClose} width={720}>
      <div className="space-y-4 text-xs">
        {request.failed && (
          <div className="border border-[var(--red,#dc2626)] rounded p-2 bg-[var(--red-soft,rgba(220,38,38,0.08))]">
            <div className="text-[var(--red,#dc2626)] uppercase tracking-wide text-[10px] mb-1">
              Failure
            </div>
            <div className="text-xs">{request.failureReason || 'Request failed'}</div>
            {request.failureKind && (
              <div className="font-mono text-[10px] text-[var(--text-dim)] mt-1">
                {request.failureKind}
              </div>
            )}
          </div>
        )}

        {!request.failed && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[var(--text-dim)] uppercase tracking-wide text-[10px] mb-1">
                Duration
              </div>
              <div className="font-mono">{request.durationMs} ms</div>
            </div>
            <div>
              <div className="text-[var(--text-dim)] uppercase tracking-wide text-[10px] mb-1">
                Flags
              </div>
              <div className="flex gap-1">
                {request.mocked && <Pill tone="accent">mocked</Pill>}
                {request.modified && <Pill tone="busy">modified</Pill>}
                {!request.mocked && !request.modified && (
                  <span className="text-[var(--text-dim)]">passthrough</span>
                )}
              </div>
            </div>
          </div>
        )}

        {request.commandHint && (
          <div>
            <div className="text-[var(--text-dim)] uppercase tracking-wide text-[10px] mb-1">
              Triggered by
            </div>
            <div className="font-mono">{request.commandHint.commandName}</div>
          </div>
        )}

        {!request.failed && (
          <>
            <div>
              <div className="text-[var(--text-dim)] uppercase tracking-wide text-[10px] mb-1">
                Request Headers
              </div>
              <HeaderList headers={request.reqHeaders} />
            </div>

            <div>
              <div className="text-[var(--text-dim)] uppercase tracking-wide text-[10px] mb-1">
                Request Body
              </div>
              <BodyBlock body={request.reqBody} />
            </div>

            <div>
              <div className="text-[var(--text-dim)] uppercase tracking-wide text-[10px] mb-1">
                Response Headers
              </div>
              <HeaderList headers={request.resHeaders} />
            </div>

            <div>
              <div className="text-[var(--text-dim)] uppercase tracking-wide text-[10px] mb-1">
                Response Body
              </div>
              <BodyBlock body={request.resBody} />
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};
