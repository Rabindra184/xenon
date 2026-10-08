// Logs: the words for its toolbar, rows and empty state. The model (logView) takes none of its text
// from here; the screen does. Button words that mean the same everywhere come from the shared copy.
import { COMMON } from './common';
import { SHELL } from './shell';

export const LOGS = {
  /** The label of the Everything / Problems only choice. */
  show: 'Show',
  everything: 'Everything',
  problemsOnly: 'Problems only',
  /** The search box's placeholder, and its accessible name. */
  search: 'Search logs',
  copy: COMMON.copy,
  /** The toast after Copy. */
  copied: COMMON.copied,
  saveAs: 'Save as…',
  clear: COMMON.clear,
  /** With technical details on. */
  openLogFolder: SHELL.logs.openLogFolder,
  /** The count of lines shown. */
  lines: (n: number) => `${n} lines`,
  empty: {
    text: 'No output yet…',
    startServer: 'Start server'
  },
  /** The accessible names of the icons on a warning and an error row. */
  level: {
    warn: 'Warning',
    error: 'Error'
  }
} as const;
