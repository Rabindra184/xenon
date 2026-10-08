// Logs: the words for its toolbar, rows and empty state. The model (logView) takes none of its text
// from here; the screen does. Button words that mean the same everywhere come from the shared copy.
import { COMMON } from './common';
import { SHELL } from './shell';

/** A count of lines, thousands grouped as Part A did: "1 line", "5,000 lines". */
const lineCount = (n: number) => (n === 1 ? '1 line' : `${n.toLocaleString('en-US')} lines`);

/** A day as 8 October 2026. */
const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

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
  lines: lineCount,
  /**
   * The first line of a file Save as… writes (R70): what it is, the day, what Logs showed (and the
   * search, if any), and how many of how many lines, "of" counting the lines Everything would show
   * with no search: "Xenon Control log · 8 October 2026 · Problems only · search “port” · 3 of 1,204 lines".
   */
  fileHeader: (o: { date: Date; show: 'everything' | 'problems'; query: string; shown: number; total: number }) => {
    const search = o.query.trim();
    return [
      'Xenon Control log',
      DAY.format(o.date),
      o.show === 'problems' ? LOGS.problemsOnly : LOGS.everything,
      ...(search === '' ? [] : [`search “${search}”`]),
      `${o.shown.toLocaleString('en-US')} of ${lineCount(o.total)}`
    ].join(' · ');
  },
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
