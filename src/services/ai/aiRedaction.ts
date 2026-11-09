import { parseSecureValueRules, SecureValueRule } from '../../helpers/secureValueRules';

/**
 * What Xenon takes out of a call to the AI provider before the provider's SDK
 * sees it (the server option `aiRedaction`, Xenon Test's ENH-05).
 *
 * Every call goes through `AIService.callProvider`: failure analysis (the
 * failure reason, the last commands' answers, device-log lines and a
 * screenshot), the LLM healing tier (the page source), and the screenshot
 * calls (visual healing, `-custom:ai-icon`, `smartTap`, `visualTap`,
 * `assertVisualState`, describing the screen). Through 2.23 all of it went
 * to the provider as it was.
 *
 * - **Text** is redacted by named built-in sets (`builtIn`) and the lab's own
 *   rules (`rules`, in the format of Appium's `log-filters`). Applied to the
 *   whole prompt, page source and logs included.
 * - **Screenshots** are sent or withheld (`screenshots`). Redacting inside a
 *   picture would need on-device OCR first; that is not done.
 * - **A configuration that can't be read fails closed:** every AI call is
 *   refused, saying why, rather than sending what the lab meant to hide.
 */

export type ScreenshotPolicy = 'send' | 'withhold';

export interface AiRedactionOption {
  builtIn?: string[];
  rules?: unknown[];
  screenshots?: ScreenshotPolicy;
}

/** A built-in set: a pattern and what replaces a match (or a function deciding). */
interface BuiltInRule {
  pattern: RegExp;
  replace: (match: string, ...groups: string[]) => string;
}

/** Whether a run of digits passes the Luhn check, as a card number does. */
export function passesLuhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export const BUILT_IN_SETS: Record<string, BuiltInRule[]> = {
  /** An address with a domain: `name@example.com`. */
  emails: [
    {
      pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
      replace: () => '[redacted email]',
    },
  ],
  /**
   * A phone number in international form: a `+`, then 8 to 15 digits with
   * spaces, dots, dashes or brackets between them. Not every run of digits:
   * a page source and a log are full of dates, ids and coordinates.
   */
  phoneNumbers: [
    {
      pattern: /\+\d[\d\s().-]{6,20}\d/g,
      replace: (match) => {
        const digits = match.replace(/\D/g, '').length;
        return digits >= 8 && digits <= 15 ? '[redacted phone]' : match;
      },
    },
  ],
  /**
   * A card number: 13 to 19 digits, with spaces or dashes between groups,
   * that passes the Luhn check. An order number of the same length almost
   * never does.
   */
  cardNumbers: [
    {
      pattern: /\b\d(?:[ -]?\d){12,18}\b/g,
      replace: (match) => (passesLuhn(match.replace(/\D/g, '')) ? '[redacted card]' : match),
    },
  ],
  /** Tokens and passwords: JWTs, `Bearer …`, and the value after a key such as `password:`. */
  secrets: [
    {
      pattern: /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g,
      replace: () => '[redacted token]',
    },
    {
      pattern: /\b(Bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
      replace: (_m, word) => `${word} [redacted token]`,
    },
    {
      pattern:
        /\b((?:access[_-]?|refresh[_-]?|api[_-]?|session[_-]?)?(?:token|password|passwd|secret|api[_-]?key))(\\?["']?\s*[:=]\s*\\?["']?)([^"'\s,;&}<>\\]{3,})/gi,
      replace: (_m, key, sep) => `${key}${sep}[redacted]`,
    },
  ],
};

export const BUILT_IN_SET_NAMES = Object.keys(BUILT_IN_SETS);

/** What a server redacts, read once from its option. */
export interface AiRedaction {
  /** The configuration's problem; every AI call is refused while it has one. */
  error?: string;
  builtIn: string[];
  rules: SecureValueRule[];
  screenshots: ScreenshotPolicy;
  /** Whether it redacts or withholds anything at all. */
  active: boolean;
}

export const NO_REDACTION: AiRedaction = {
  builtIn: [],
  rules: [],
  screenshots: 'send',
  active: false,
};

/** The server's `aiRedaction` option, read. Unset is no redaction. */
export function readAiRedaction(option: unknown): AiRedaction {
  if (option === undefined || option === null) return NO_REDACTION;
  const fail = (error: string): AiRedaction => ({
    ...NO_REDACTION,
    screenshots: 'withhold',
    active: true,
    error: `aiRedaction is not valid, so no AI call is made: ${error}`,
  });
  if (typeof option !== 'object' || Array.isArray(option)) return fail('it must be an object');
  const o = option as AiRedactionOption;
  const builtIn = o.builtIn ?? [];
  if (!Array.isArray(builtIn) || builtIn.some((name) => typeof name !== 'string')) {
    return fail('builtIn must be a list of names');
  }
  const unknown = builtIn.filter((name) => !BUILT_IN_SET_NAMES.includes(name));
  if (unknown.length > 0) {
    return fail(`unknown builtIn ${unknown.join(', ')}; known: ${BUILT_IN_SET_NAMES.join(', ')}`);
  }
  if (o.rules !== undefined && !Array.isArray(o.rules)) return fail('rules must be a list');
  const parsed = parseSecureValueRules(o.rules, '[redacted]');
  if ('error' in parsed) return fail(parsed.error);
  const screenshots = o.screenshots ?? 'send';
  if (screenshots !== 'send' && screenshots !== 'withhold') {
    return fail("screenshots must be 'send' or 'withhold'");
  }
  return {
    builtIn: [...new Set(builtIn)],
    rules: parsed.rules,
    screenshots,
    active: builtIn.length > 0 || parsed.rules.length > 0 || screenshots === 'withhold',
  };
}

/** The text with every built-in set's and rule's matches replaced, and how many there were. */
export function redactText(
  text: string,
  redaction: AiRedaction,
): { text: string; replaced: number } {
  let replaced = 0;
  let out = text;
  for (const name of redaction.builtIn) {
    for (const rule of BUILT_IN_SETS[name]) {
      out = out.replace(rule.pattern, (...args: any[]) => {
        const match = args[0] as string;
        const groups = args.slice(1, -2) as string[];
        const next = rule.replace(match, ...groups);
        if (next !== match) replaced += 1;
        return next;
      });
    }
  }
  for (const rule of redaction.rules) {
    out = out.replace(rule.pattern, (...args: any[]) => {
      replaced += 1;
      // The replacer's $1… refer to the rule's own groups, as in Appium.
      return (args[0] as string).replace(
        new RegExp(rule.pattern.source, rule.pattern.flags.replace('g', '')),
        rule.replacer,
      );
    });
  }
  return { text: out, replaced };
}

/** What `/capabilities` says about it: names and counts, never the patterns. */
export function describeAiRedaction(redaction: AiRedaction): {
  builtIn: string[];
  rules: number;
  screenshots: ScreenshotPolicy;
  valid: boolean;
} {
  return {
    builtIn: redaction.builtIn,
    rules: redaction.rules.length,
    screenshots: redaction.screenshots,
    valid: redaction.error === undefined,
  };
}
