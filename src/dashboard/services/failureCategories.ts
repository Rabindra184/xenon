/**
 * What files a failed session under a `failure_category`, and how.
 *
 * Every text here is one the installed drivers, Appium or Xenon really send
 * (UiAutomator2 6.4.1 with its server 9.3.1, XCUITest 10.9.0 with
 * WebDriverAgent 10.2.3, base-driver 10.x). Through 2.14 the rules were
 * guesses: none of App crash's texts existed anywhere, a raw body's stack
 * trace was matched too (every UiAutomator2 error on a hub carries netty's
 * `IdleStateHandler`, so it was filed TIMEOUT), and the five failed commands
 * were lumped together, so a find the test expected to fail outranked the
 * real failure.
 *
 * A rule matches a W3C error code exactly (`codes`), or a phrase anywhere in
 * the reason or a command's error or message (`phrases`), ignoring case.
 * Rules are tried in this order; see categorizeFailure for which evidence is
 * read first.
 */

/** A session the server's restart or shutdown ended. SessionManager also writes it at boot. */
export const HUB_RESTART_CATEGORY = 'HUB_RESTART';

/** What a failure that matches no rule is filed as. */
export const UNMATCHED_CATEGORY = 'UNKNOWN';

export interface FailureRule {
  category: string;
  /** W3C error codes (`value.error` of a WebDriver answer), matched whole. */
  codes: readonly string[];
  /** Text matched anywhere in a reason, error or message, ignoring case. */
  phrases: readonly string[];
}

export const FAILURE_RULES: readonly FailureRule[] = [
  {
    // ShutdownCoordinator's drain.
    category: HUB_RESTART_CATEGORY,
    codes: [],
    phrases: ['Hub shutdown'],
  },
  {
    // Before SESSION_LOST: a proxied connect that fails with EMFILE is the
    // server out of files, not the helper gone.
    category: 'SYSTEM_OVERLOAD',
    codes: [],
    phrases: ['OutOfMemory', 'too many open files', 'EMFILE', 'failed to allocate'],
  },
  {
    // The phone's automation helper (WebDriverAgent, the UiAutomator2
    // server, Chromedriver) or the session itself went away during the run.
    category: 'SESSION_LOST',
    codes: ['invalid session id'],
    phrases: [
      // base-driver's proxy, when the helper doesn't answer at all.
      'Could not proxy command to the remote server',
      'socket hang up',
      'ECONNREFUSED',
      'ECONNRESET',
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
      // Xenon lost the session: OrphanSweeper, SessionHeartbeatService.
      'Session heartbeat timeout',
      'Session terminal failure',
      'The node no longer has this session',
      'Node session status failed',
    ],
  },
  {
    category: 'APP_CRASH',
    codes: [],
    phrases: [
      // WebDriverAgent, when the app under test is gone.
      'is not running, possibly crashed',
      // UiAutomator2, when the app blocks its main thread (what Android calls
      // "not responding").
      'hogging the main UI thread',
      // A test reporting the crash itself.
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
      'did not complete before its timeout expired',
      'Timed out waiting for asynchronous script result',
      'did not respond to the requested command after',
      'waiting for XCTest to complete',
      // Xenon's autowait, waiting for an element that exists to be enabled.
      'to be enabled',
      'TimeoutException',
    ],
  },
  {
    category: 'ELEMENT_NOT_FOUND',
    codes: ['no such element'],
    phrases: [
      'An element could not be located',
      'unable to find an element',
      "didn't match any elements",
      'NoSuchElement',
      // Xenon's own: autowait, OmniVision and its element lookup.
      'Autowait timed out',
      'Xenon found nothing on the screen matching',
      'Xenon has no element',
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
 * Categories no longer written, which sessions filed through 2.14 still hold.
 * Their runbooks stay. WDA_FAILURE's live cases are SESSION_LOST now, and
 * XENON_COMMAND_FAILURE matched nothing real but base-driver's default
 * stale-element text, which is STALE_ELEMENT.
 */
export const RETIRED_CATEGORIES: readonly string[] = ['WDA_FAILURE', 'XENON_COMMAND_FAILURE'];

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
 * commands (newest first). The evidence is read in turns, and the first turn
 * a rule matches decides:
 *
 * 1. The reason, together with the newest failed command when the reason was
 *    taken from it: on a hub the reason is that command's bare code ("no
 *    such element"), and its message says more.
 * 2. Otherwise the newest failed command on its own.
 * 3. Then each older failed command, newest first.
 *
 * So a find the test expected to fail, earlier in the run, doesn't decide
 * the category of a session that ended some other way.
 */
export function categorizeFailure(reason: string, failedCommands: CommandError[]): string {
  const [newest, ...older] = failedCommands;
  const said = (c: CommandError) => [c.error, c.message].filter((s): s is string => !!s);
  const r = reason.trim();
  const reasonIsNewest = !!newest && !!r && said(newest).some((s) => norm(s) === norm(r));

  const turns: Array<{ texts: string[]; codes: string[] }> = [];
  if (reasonIsNewest) {
    turns.push({ texts: [r, ...said(newest)], codes: newest.error ? [newest.error] : [] });
  } else {
    if (r) turns.push({ texts: [r], codes: [r] });
    if (newest) turns.push({ texts: said(newest), codes: newest.error ? [newest.error] : [] });
  }
  for (const c of older) turns.push({ texts: said(c), codes: c.error ? [c.error] : [] });

  for (const turn of turns) {
    const category = ruleFor(turn.texts, turn.codes);
    if (category) return category;
  }
  return UNMATCHED_CATEGORY;
}
