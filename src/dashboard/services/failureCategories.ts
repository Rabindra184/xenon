/**
 * What files a failed session under a `failure_category`, and how.
 *
 * The texts here are those the installed drivers, Appium and Xenon send
 * (UiAutomator2 6.4.1 with its server 9.3.1, XCUITest 10.9.0 with
 * WebDriverAgent 10.2.3, base-driver 10.x), plus a few a test may report in
 * its own words (`xenon: setSessionStatus`), marked as such.
 *
 * Through 2.15 the rules were guesses:
 * - none of App crash's texts existed anywhere;
 * - a raw body's stack trace was matched too. Every UiAutomator2 error a hub
 *   records carries netty's `IdleStateHandler`, so one that matched no
 *   earlier rule was filed TIMEOUT;
 * - the five failed commands were read as one text, so a failure the test
 *   had recovered from could decide the category.
 *
 * A rule matches a W3C error code exactly (`codes`), or a phrase anywhere in
 * the reason or a command's error or message (`phrases`), ignoring case.
 * Codes are only on the rows a hub records for a node's sessions: this
 * server's own rows hold the message alone, so every category needs phrases
 * too. Xenon's own messages are read first, by how they start, since they
 * quote the test's selector (xenonOwnCategory). Rules are tried in this order.
 */

/** A session the server's restart or shutdown ended. SessionManager also writes it at boot. */
export const HUB_RESTART_CATEGORY = 'HUB_RESTART';

/** What a failure that matches no rule is filed as. */
export const UNMATCHED_CATEGORY = 'UNKNOWN';

export interface FailureRule {
  category: string;
  /**
   * W3C error codes (`value.error` of a WebDriver answer), matched whole.
   * A reason Xenon wrote whole is matched the same way ('Hub shutdown').
   */
  codes: readonly string[];
  /** Text matched anywhere in a reason, error or message, ignoring case. */
  phrases: readonly string[];
}

export const FAILURE_RULES: readonly FailureRule[] = [
  {
    // ShutdownCoordinator's drain: the whole reason, never a phrase in one.
    category: HUB_RESTART_CATEGORY,
    codes: ['Hub shutdown'],
    phrases: [],
  },
  {
    // Before SESSION_LOST: a proxied connect that fails with EMFILE ("Could
    // not proxy command ... connect EMFILE") is the server out of files, not
    // the helper gone. Not a bare "EMFILE": that is a substring of a locator
    // such as "systemFileList".
    category: 'SYSTEM_OVERLOAD',
    codes: [],
    phrases: ['OutOfMemory', 'too many open files', 'connect EMFILE'],
  },
  {
    // The phone's automation helper (WebDriverAgent, the UiAutomator2
    // server, Chromedriver) or the session itself went away during the run.
    category: 'SESSION_LOST',
    codes: ['invalid session id'],
    phrases: [
      // base-driver's proxy, when the helper doesn't answer at all (socket
      // hang up, ECONNREFUSED, a read time-out).
      'Could not proxy command to the remote server',
      // UiAutomator2: its server's instrumentation exited ("probably crashed"
      // is the helper, not the app), or the phone went away.
      'instrumentation process is not running',
      // WebDriverAgent restarted and lost the session.
      'Session does not exist',
      'A session is either terminated or not started',
      // Appium's own, when a command races the session's end.
      'The session with id',
      // Appium ended the session itself (onUnexpectedShutdown).
      'unexpectedly shut down',
      'Driver shut down unexpectedly',
      'Chromedriver quit unexpectedly',
      // XCUITest's commandTimeouts, which then ends the session.
      'Appium did not get any response from',
      // Xenon lost the session: OrphanSweeper, SessionHeartbeatService, and
      // the hub's answer for a node it can't reach (forwardToNode).
      'Session heartbeat timeout',
      'Session terminal failure',
      'The node no longer has this session',
      'Node session status failed',
      'could not reach the node running this session',
    ],
  },
  {
    category: 'APP_CRASH',
    codes: [],
    phrases: [
      // WebDriverAgent, when the app under test is gone.
      'is not running, possibly crashed',
      // A test's own words.
      'The application has crashed',
      'Application not responding',
      'process has died',
      'activity has died',
    ],
  },
  {
    category: 'STALE_ELEMENT',
    codes: ['stale element reference'],
    phrases: [
      // base-driver's and WebDriverAgent's default, and the UiAutomator2
      // server's.
      'no longer attached to the DOM',
      // The UiAutomator2 server's cache. "not present in the cache or has
      // expired" is answered as "no such element", hence this rule first.
      'does not exist in DOM anymore',
      'do not exist in DOM anymore',
      'is not linked to the same object in DOM anymore',
      'is not present in the cache or has expired',
      'StaleObjectException',
      // WebDriverAgent's cache and snapshots.
      'expired from the internal cache',
      'is not present in the current view anymore',
      // Safari and web views on an iPhone.
      'Element does not exist in cache',
    ],
  },
  {
    // Specific phrases only: a bare "timeout" also matched Xenon's own
    // autowait misses, a hung helper, heartbeat reasons and command titles.
    category: 'TIMEOUT',
    codes: ['timeout', 'script timeout'],
    phrases: [
      'New Command Timeout of',
      'timed out due to inactivity',
      // base-driver's defaults for `timeout` and `script timeout`.
      'did not complete before its timeout expired',
      'Timed out waiting for asynchronous script result',
      // XCUITest and WebDriverAgent.
      'waiting for XCTest to complete',
      'cannot be launched within',
      'Timed out while waiting until the screen gets locked',
      'Did not receive any expected',
      // UiAutomator2, when the app never lets the screen go idle (an endless
      // animation, a video, a busy main thread) and it can't be read.
      'hogging the main UI thread',
      // A test's own words (Selenium's exception).
      'TimeoutException',
    ],
  },
  {
    category: 'ELEMENT_NOT_FOUND',
    codes: ['no such element'],
    phrases: [
      'An element could not be located',
      // WebDriverAgent's identifier and predicate lookups.
      "didn't match any elements",
      // A test's own words (NoSuchElementException).
      'NoSuchElement',
    ],
  },
  {
    // No native driver reports a blocking prompt: it shows up as Element not
    // found. Only web pages on an iPhone, and a test's own words.
    category: 'PERMISSION_BLOCKED',
    codes: ['unexpected alert open'],
    phrases: [
      'A modal dialog was open',
      'Permission alert',
      'Security alert',
      'Always Allow',
      'Allow while using app',
    ],
  },
];

/** Every category the failure analysis writes, upper case as stored. */
export const ANALYSIS_CATEGORIES: readonly string[] = [
  ...FAILURE_RULES.map((r) => r.category),
  UNMATCHED_CATEGORY,
];

/**
 * Categories no longer written, which sessions filed through 2.15 still hold.
 * Their runbooks stay. WDA_FAILURE's live cases are SESSION_LOST now, and
 * XENON_COMMAND_FAILURE matched nothing real but base-driver's default
 * stale-element text, which is STALE_ELEMENT.
 */
export const RETIRED_CATEGORIES: readonly string[] = ['WDA_FAILURE', 'XENON_COMMAND_FAILURE'];

/**
 * The category of a message Xenon itself throws, by how it starts. These
 * quote the test's selector, which may hold any rule's phrase ("Allow
 * notifications to be enabled"), so they are read before the rules.
 */
export function xenonOwnCategory(text: string): string | undefined {
  const t = text.trim();
  // CommandInterceptor's autowait: an element that never became enabled, or
  // one that was never found.
  if (t.startsWith('Autowait timed out after ')) {
    return t.endsWith(' to be enabled') ? 'TIMEOUT' : 'ELEMENT_NOT_FOUND';
  }
  // OmniVision's miss, and an element id Xenon doesn't hold.
  if (t.startsWith('Xenon found nothing on the screen matching ')) return 'ELEMENT_NOT_FOUND';
  if (t.startsWith('Xenon has no element ')) return 'ELEMENT_NOT_FOUND';
  return undefined;
}

/** What a failed command said: its W3C code (on a hub's rows) and its message. */
export interface CommandError {
  /** `value.error`: a W3C code in a full WebDriver answer, the message itself in this server's own rows. */
  error?: string;
  /** `value.message`, when the answer has one. */
  message?: string;
}

/**
 * The error and message of a failed command's recorded answer, and nothing
 * else: never its stack trace, which names netty's IdleStateHandler on every
 * UiAutomator2 error and the driver on every error.
 */
export function commandErrorOf(response: string | null | undefined): CommandError {
  if (!response) return {};
  try {
    const value = JSON.parse(response)?.value;
    if (!value || typeof value !== 'object') return {};
    return {
      error: typeof value.error === 'string' ? value.error : undefined,
      message: typeof value.message === 'string' ? value.message : undefined,
    };
  } catch {
    return {};
  }
}

const norm = (s: string) => s.trim().toLowerCase();

function ruleFor(texts: string[], codes: string[]): string | undefined {
  for (const t of texts) {
    const own = xenonOwnCategory(t);
    if (own) return own;
  }
  const haystack = texts.map(norm);
  const codeSet = new Set(codes.map(norm));
  for (const rule of FAILURE_RULES) {
    if (rule.codes.some((c) => codeSet.has(norm(c)))) return rule.category;
    if (rule.phrases.some((p) => haystack.some((t) => t.includes(norm(p))))) return rule.category;
  }
  return undefined;
}

/**
 * A failed session's category, from its failure reason and its failed
 * commands (newest first).
 *
 * The failure that ended the session decides alone: the reason, read with the
 * newest failed command when the reason was taken from it (for a session on
 * a node's phone the reason is that command's bare code, "no such element",
 * and its message says more). A reason no rule matches is UNKNOWN: an earlier
 * failure the test recovered from, or a find it expected to fail, doesn't
 * decide. Only a session with no reason at all is read from its failed
 * commands, newest first.
 */
export function categorizeFailure(reason: string, failedCommands: CommandError[]): string {
  const said = (c: CommandError) => [c.error, c.message].filter((s): s is string => !!s);
  const codesOf = (c: CommandError) => (c.error ? [c.error] : []);
  const r = reason.trim();

  if (r) {
    const newest = failedCommands[0];
    const fromNewest = !!newest && said(newest).some((s) => norm(s) === norm(r));
    const category = fromNewest
      ? ruleFor([r, ...said(newest)], codesOf(newest))
      : ruleFor([r], [r]);
    return category ?? UNMATCHED_CATEGORY;
  }

  for (const c of failedCommands) {
    const category = ruleFor(said(c), codesOf(c));
    if (category) return category;
  }
  return UNMATCHED_CATEGORY;
}
