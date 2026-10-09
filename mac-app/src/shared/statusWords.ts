import type { ServerStatus } from './types';

// The server's status in words, for the window and the menu-bar icon alike, so
// the two never say different things. Shared because the main process builds
// the menu-bar icon's menu; it imports nothing from Node or Electron.

/** The server's status in a word or two, as the sidebar shows it and a screen reader announces it. */
export const STATUS_WORD: Record<ServerStatus, string> = {
  stopped: 'Stopped',
  starting: 'Starting…',
  running: 'Running',
  stopping: 'Stopping…',
  crashed: 'Stopped unexpectedly'
};

/** The status word, and the port while running when it is known: "Running · port 4723". */
export function statusLine(status: ServerStatus, port: number | null): string {
  return status === 'running' && port !== null ? `${STATUS_WORD.running} · port ${port}` : STATUS_WORD[status];
}
