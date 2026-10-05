// The content rules for the documentation site. A page that still carries the
// stub marker is unfinished, and a handful of terms from older releases must
// not come back (a flag that was renamed, a feature that was removed, a count
// that changed). Pure: the CLI reads the files and prints what this finds.

export const STUB_MARKER = 'XENON-DOCS-STUB';

// `ignoreCase` is for terms whose spelling varies in prose ("5-Tier"). The
// rest are matched exactly, so "grpc" in a URL or "florence" as a name is left
// alone.
const STALE_TERMS = [
  { term: 'df:options' },
  { term: 'x-xenon-api-key' },
  { term: 'xe:priority' },
  { term: 'max_thermal_status' },
  { term: '5-tier', ignoreCase: true },
  { term: 'Florence' },
  { term: 'gRPC' },
  { term: 'Appium 2.x' },
  { term: 'estCostUsd' },
  { term: 'bootstrap-key' },
  { term: 'xenon-platform/xenon' },
];

const ALL = Symbol('all stale terms');

// File basename -> the stale terms that file may contain. The release notes
// are the changelog, so they name what was removed or renamed; Upgrading says
// that `df:options` is no longer read.
const EXEMPT = new Map([
  ['release-notes.md', ALL],
  ['upgrading.md', ['df:options']],
]);

const baseName = (filePath) => filePath.split(/[\\/]/).pop();

function isExempt(filePath, term) {
  const allowed = EXEMPT.get(baseName(filePath));
  return allowed === ALL || (Array.isArray(allowed) && allowed.includes(term));
}

function mentions(line, { term, ignoreCase }) {
  return ignoreCase ? line.toLowerCase().includes(term.toLowerCase()) : line.includes(term);
}

/**
 * @param {Array<{ path: string, text: string }>} files
 * @returns {Array<{ path: string, line: number, problem: string }>}
 */
export function findProblems(files) {
  const problems = [];
  for (const { path: filePath, text } of files) {
    const rules = STALE_TERMS.filter((rule) => !isExempt(filePath, rule.term));
    text.split(/\r?\n/).forEach((line, index) => {
      const lineNumber = index + 1;
      if (line.includes(STUB_MARKER)) {
        problems.push({ path: filePath, line: lineNumber, problem: `unfinished page (${STUB_MARKER})` });
      }
      for (const rule of rules) {
        if (mentions(line, rule)) {
          problems.push({ path: filePath, line: lineNumber, problem: `stale term "${rule.term}"` });
        }
      }
    });
  }
  return problems;
}
