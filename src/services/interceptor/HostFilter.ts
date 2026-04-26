// Captures whether a given host (already extracted, no port) should reach the
// dashboard / buffer. Used to silence noisy traffic (analytics, third-party CDNs)
// from the network panel without interfering with mocking — mocks still match
// regardless, since they are explicit user config.
//
// Semantics:
// - When include is non-empty: host must match SOME include pattern.
// - When exclude is non-empty: host must match NO exclude pattern.
// - Both can apply — include narrows, exclude carves out.
// - Empty / absent lists = pass-through.
//
// Glob:
// - `*` matches one DNS label (no dots).
// - `**` matches zero or more labels (across dots).
// - All other characters are literal; dots are NOT regex any-char.
// - Case-insensitive.
export interface HostFilterOptions {
  include?: string[];
  exclude?: string[];
}

export class HostFilter {
  private readonly include: RegExp[];
  private readonly exclude: RegExp[];

  constructor(opts: HostFilterOptions = {}) {
    this.include = (opts.include ?? []).map(compileHostGlob);
    this.exclude = (opts.exclude ?? []).map(compileHostGlob);
  }

  accepts(host: string): boolean {
    const h = host.toLowerCase();
    if (this.include.length > 0 && !this.include.some((re) => re.test(h))) return false;
    if (this.exclude.length > 0 && this.exclude.some((re) => re.test(h))) return false;
    return true;
  }
}

function compileHostGlob(pattern: string): RegExp {
  const lower = pattern.toLowerCase();
  // Bare * is a "match anything" sigil — without this, users would need to write **
  // for an unconstrained allow/deny, which is unintuitive.
  if (lower === '*') return /^.*$/;
  let re = '';
  for (let i = 0; i < lower.length; i++) {
    const ch = lower[i];
    if (ch === '*' && lower[i + 1] === '*') {
      // ** = zero or more labels (with their dots). Use a non-greedy "any" so a
      // pattern like **.example.com still anchors on the literal suffix.
      re += '(?:.*)?';
      i++;
      // consume an immediately following dot so '**.example.com' matches both
      // 'api.example.com' and 'example.com' (zero-label case).
      if (lower[i + 1] === '.') i++;
    } else if (ch === '*') {
      re += '[^.]*';
    } else if ('.+?^$()[]{}|\\/'.includes(ch)) {
      re += '\\' + ch;
    } else {
      re += ch;
    }
  }
  return new RegExp(`^${re}$`);
}
