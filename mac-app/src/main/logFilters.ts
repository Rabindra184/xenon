export interface LogFilterRule {
  pattern: string;
  flags: string;
  replacer: string;
}

// Appium logs request bodies, so every launch config carries these two rules to
// keep tokens, passwords and apiKey values out of the log. They are the
// `log-filters` rules in website/docs/authentication.md (YAML form, for a
// `--config` file); a test keeps the two in step. Patterns are plain strings,
// so each backslash in the regex is doubled here.
export const XENON_LOG_FILTERS: readonly LogFilterRule[] = [
  {
    pattern: '([Tt]oken\\\\?["\']?\\s*:\\s*\\\\?["\']?)[A-Za-z0-9._~+/=-]+',
    flags: 'g',
    replacer: '$1**REDACTED**'
  },
  {
    pattern:
      '((?:[Pp]assword|apiKey)\\\\?["\']?\\s*:\\s*(\\\\?)(["\'`]))(?:\\2\\\\(?:\\2[\\s\\S]|[^\\\\])|(?!\\3)[^\\\\\\x00-\\x1f])*',
    flags: 'g',
    replacer: '$1**REDACTED**'
  }
];
