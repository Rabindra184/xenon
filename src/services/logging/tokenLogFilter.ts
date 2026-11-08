/**
 * Whether Appium's own log hides the tokens a session create carries.
 *
 * Appium logs every request's body, cut at 1,024 characters, before any
 * plugin runs, so a create's `xe:options.token`, `sessionToken` or
 * `leaseToken` reaches its log unless the client sends
 * `X-Appium-Is-Sensitive: true` or the server has `log-filters` rules that
 * hide them (website/docs/authentication.md). Xenon can't add rules to
 * Appium's logger: a plugin may load another copy of `@appium/logger`. It can
 * read the rules the server was started with (`ServerArgs.logFilters`, which
 * Appium has parsed by then, from `--log-filters <file>` or a `--config`
 * file's `server.log-filters`), and apply them as Appium does
 * (SecureValuesPreprocessor in `@appium/logger`) to a sample create.
 *
 * Xenon Control writes the rules into every launch config from 0.3.0. A lab
 * on 0.1.5 had none, and its log held every lease token.
 */

export const DEFAULT_SECURE_REPLACER = '**SECURE**';

/** Sample values of the three create tokens, shaped like the real ones. */
const SAMPLE_TOKENS = {
  token: 'xtk_sampleAccessToken0123456789',
  sessionToken: 'eyJhbGciOiJSUzI1NiJ9.eyJzYW1wbGUiOnRydWV9.c2FtcGxlU2lnbmF0dXJl',
  leaseToken: 'xlt_sampleLeaseToken0123456789',
};

/** What Appium logs for a create: the body, as JSON, in its request line. */
function sampleCreateLine(): string {
  const body = {
    capabilities: {
      alwaysMatch: {
        platformName: 'Android',
        'xe:options': { accessKey: 'xak_sample', ...SAMPLE_TOKENS, leaseId: 'lease-sample' },
      },
      firstMatch: [{}],
    },
  };
  return `--> POST /session ${JSON.stringify(body)}`;
}

interface Rule {
  pattern: RegExp;
  replacer: string;
}

function escapeRegExp(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

/** Appium's parseRule; throws for a rule Appium would refuse. */
function parseRule(rule: unknown): Rule {
  let pattern: string | undefined;
  let replacer = DEFAULT_SECURE_REPLACER;
  let flags = ['g'];
  if (typeof rule === 'string') {
    if (rule.length === 0) throw new Error('empty rule');
    pattern = `\\b${escapeRegExp(rule)}\\b`;
  } else if (rule && typeof rule === 'object' && !Array.isArray(rule)) {
    const r = rule as Record<string, unknown>;
    if ('pattern' in r) {
      if (typeof r.pattern !== 'string' || r.pattern.length === 0) throw new Error('bad pattern');
      pattern = r.pattern;
    } else if ('text' in r) {
      if (typeof r.text !== 'string' || r.text.length === 0) throw new Error('bad text');
      pattern = `\\b${escapeRegExp(r.text)}\\b`;
    }
    if (!pattern) throw new Error('no pattern or text');
    if ('flags' in r) {
      for (const flag of ['i', 'g', 'm', 's', 'u', 'y']) {
        if (String(r.flags ?? '').includes(flag)) flags.push(flag);
      }
      flags = [...new Set(flags)];
    }
    if (typeof r.replacer === 'string') replacer = r.replacer;
  } else {
    throw new Error('not a rule');
  }
  return { pattern: new RegExp(pattern, flags.join('')), replacer };
}

/** The rules Appium would load from `logFilters`, or null when it would refuse them. */
function rulesOf(logFilters: unknown): Rule[] | null {
  if (logFilters === undefined || logFilters === null) return [];
  const sources = Array.isArray(logFilters) ? logFilters : [logFilters];
  try {
    return sources.map(parseRule);
  } catch {
    return null;
  }
}

/**
 * Whether the server's `log-filters` rules hide all three create tokens in
 * Appium's request line. False with no rules, rules Appium would refuse, or
 * rules that leave any token value in the line.
 */
export function rulesHideTokens(logFilters: unknown): boolean {
  const rules = rulesOf(logFilters);
  if (!rules || rules.length === 0) return false;
  let line = sampleCreateLine();
  for (const rule of rules) line = line.replace(rule.pattern, rule.replacer);
  return Object.values(SAMPLE_TOKENS).every((value) => !line.includes(value));
}

let hidesTokens = false;

/** Called once at startup with the server's arguments (ServerManager.updateServer). */
export function noteServerLogFilters(logFilters: unknown): boolean {
  hidesTokens = rulesHideTokens(logFilters);
  return hidesTokens;
}

/** For `GET /capabilities`: whether the running server's log hides create tokens. */
export function tokenLogFilterOn(): boolean {
  return hidesTokens;
}
