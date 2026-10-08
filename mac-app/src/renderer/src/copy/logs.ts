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
  /** Copy could not reach the clipboard. */
  copyFailed: 'Couldn’t copy the log. Try again.',
  saveAs: 'Save as…',
  /** Save as… could not write the file (R61). */
  saveFailed: 'Couldn’t save the log. Try another folder.',
  clear: COMMON.clear,
  /** With technical details on. */
  openLogFolder: SHELL.logs.openLogFolder,
  /** The count of lines shown, thousands grouped as Part A did: "1 line", "5,000 lines". */
  lines: (n: number) => (n === 1 ? '1 line' : `${n.toLocaleString('en-US')} lines`),
  /** The name of the scrolling list of lines. */
  listLabel: 'Log lines',
  empty: {
    /** No lines at all (or none but technical ones). */
    text: 'No output yet…',
    startServer: 'Start server',
    /** Lines, but Problems only shows none of them (R61). */
    noProblems: 'No problems so far.',
    /** Lines, but the search finds none of them (R61). */
    noMatch: 'No lines match your search.'
  },
  /** The accessible names of the icons on a warning and an error row. */
  level: {
    warn: 'Warning',
    error: 'Error'
  }
} as const;
