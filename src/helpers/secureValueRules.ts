/**
 * Rules that hide values in text, in the format of Appium's `log-filters`
 * (SecureValuesPreprocessor in `@appium/logger`): a string (that text, as a
 * whole word), `{ text }` likewise, or `{ pattern, flags?, replacer? }`, a
 * regular expression always applied with `g`. The replacer defaults to
 * `**SECURE**`. Xenon reads them for the token log filter check
 * (tokenLogFilter.ts) and for AI redaction (aiRedaction.ts), so a lab writes
 * one format for both.
 */

export const DEFAULT_SECURE_REPLACER = '**SECURE**';

export interface SecureValueRule {
  pattern: RegExp;
  replacer: string;
}

function escapeRegExp(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

/** Appium's parseRule; throws for a rule Appium would refuse, saying why. */
export function parseSecureValueRule(
  rule: unknown,
  defaultReplacer = DEFAULT_SECURE_REPLACER,
): SecureValueRule {
  let pattern: string | undefined;
  let replacer = defaultReplacer;
  let flags = ['g'];
  if (typeof rule === 'string') {
    if (rule.length === 0) throw new Error('a rule must not be empty');
    pattern = `\\b${escapeRegExp(rule)}\\b`;
  } else if (rule && typeof rule === 'object' && !Array.isArray(rule)) {
    const r = rule as Record<string, unknown>;
    if ('pattern' in r) {
      if (typeof r.pattern !== 'string' || r.pattern.length === 0) {
        throw new Error("a rule's 'pattern' must be a non-empty string");
      }
      pattern = r.pattern;
    } else if ('text' in r) {
      if (typeof r.text !== 'string' || r.text.length === 0) {
        throw new Error("a rule's 'text' must be a non-empty string");
      }
      pattern = `\\b${escapeRegExp(r.text)}\\b`;
    }
    if (!pattern) throw new Error("a rule needs 'pattern' or 'text'");
    if ('flags' in r) {
      for (const flag of ['i', 'g', 'm', 's', 'u', 'y']) {
        if (String(r.flags ?? '').includes(flag)) flags.push(flag);
      }
      flags = [...new Set(flags)];
    }
    if (typeof r.replacer === 'string') replacer = r.replacer;
  } else {
    throw new Error('a rule must be a string or an object');
  }
  try {
    return { pattern: new RegExp(pattern, flags.join('')), replacer };
  } catch (err) {
    throw new Error(`a rule's pattern is not a regular expression: ${(err as Error).message}`);
  }
}

/** The rules from a list (or one rule), or a reason they can't be read. */
export function parseSecureValueRules(
  rules: unknown,
  defaultReplacer = DEFAULT_SECURE_REPLACER,
): { rules: SecureValueRule[] } | { error: string } {
  if (rules === undefined || rules === null) return { rules: [] };
  const sources = Array.isArray(rules) ? rules : [rules];
  try {
    return { rules: sources.map((rule) => parseSecureValueRule(rule, defaultReplacer)) };
  } catch (err) {
    return { error: (err as Error).message };
  }
}
