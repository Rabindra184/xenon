// The escape codes in a server's output. One rule for every place that reads a log line's words:
// main, which quotes a crash's line, and the window, which shows, searches, copies and saves the
// lines and draws their colours (the window's ansi.ts parses the colours with this same pattern).

/**
 * A CSI escape sequence: ESC [ parameters, then its final letter. Colour (SGR) codes end in `m`.
 * Global: copy it (`new RegExp(ESCAPE_RE)`) before stepping through a string with exec.
 */
export const ESCAPE_RE = /\x1b\[([0-9;]*)([A-Za-z])/g;

/** The words of a log line with every escape sequence taken away: what the person reads, searches and copies. */
export function stripAnsi(input: string): string {
  return input.includes('\x1b') ? input.replace(ESCAPE_RE, '') : input;
}
