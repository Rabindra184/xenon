import { FolderOpen } from 'lucide-react';
import { SHELL } from '../copy/shell';
import type { UiLogLine } from '../logBuffer';
import { LogConsole } from '../components/LogConsole';
import { Button } from '../components/ui/Button';

interface Props {
  logs: UiLogLine[];
  onClear: () => void;
  /** Offered while the server is stopped. */
  onStart?: () => void;
  /** With technical details on, the log folder can be opened. */
  technicalDetails: boolean;
}

/** Logs, until its own screen (B6): the console, and the log folder with technical details. */
export function Logs({ logs, onClear, onStart, technicalDetails }: Props) {
  return (
    <>
      {technicalDetails && (
        <div className="mb-3 flex shrink-0 justify-end">
          <Button
            size="sm"
            onClick={() => window.xenon.server.openPath('logs')}
            icon={<FolderOpen size={14} aria-hidden="true" />}
          >
            {SHELL.logs.openLogFolder}
          </Button>
        </div>
      )}
      <div className="min-h-0 flex-1">
        <LogConsole logs={logs} onClear={onClear} onStart={onStart} />
      </div>
    </>
  );
}
