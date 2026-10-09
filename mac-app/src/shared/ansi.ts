// The escape codes in a server's output. One rule for every place that reads a log line's words:
// main, which quotes a crash's line, and the window, which shows, searches, copies and saves the
// lines and draws their colours (the window's ansi.ts parses the colours with this same pattern).

/**
 * Everything in a log line that is not its words, one match at a time, in this order:
 *  1. an OSC sequence, ESC ] … ended by BEL or ESC \ (or the end of the line): links (OSC 8) and
 *     window titles (OSC 0);
 *  2. a CSI sequence, ESC [ then parameter bytes (0x30–0x3F, `?25` and `38:2::r:g:b` among them),
 *     intermediate bytes (0x20–0x2F) and one final byte. Captured: (1) the parameters, (2) the
 *     intermediates, (3) the final byte; a colour code (SGR) is `m` with no intermediates;
 *  3. any other escape, ESC with intermediates and a final byte (a character set, the keypad);
 *  4. a lone control character: everything below a space but the tab and the line break, DEL, and
 *     the C1 controls (U+0080–U+009F), a lone ESC among them.
 * Global: copy it (`new RegExp(ESCAPE_RE)`) before stepping through a string with exec.
 */
export const ESCAPE_RE =
  /\x1b\][\s\S]*?(?:\x07|\x1b\\|$)|\x1b\[([\x30-\x3f]*)([\x20-\x2f]*)([\x40-\x7e])|\x1b[\x20-\x2f]*[\x30-\x7e]|[\x00-\x08\x0b-\x1f\x7f-\x9f]/g;

/** Any character an escape or a control starts with (ESC is a control too): text without one is already words. */
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/;

/** The words of a log line with every escape sequence and control taken away: what the person reads, searches and copies. */
export function stripAnsi(input: string): string {
  return CONTROL.test(input) ? input.replace(ESCAPE_RE, '') : input;
}
