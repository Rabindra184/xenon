import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Colours, sizes, radii and shadows come only from token classes (tokens.css),
// so a screen can't drift from the dashboard's design or break in the other
// theme. This guard reads the renderer source and names the file and line of
// anything that bypasses them.

const RENDERER = resolve(__dirname, '../src/renderer/src');
const SOURCE = /\.(ts|tsx|css)$/;
/** tokens.css is where the raw values live, so it is the one file allowed to hold them. */
const EXEMPT = new Set(['tokens.css']);

const RULES: ReadonlyArray<{ rule: string; pattern: RegExp; skip?: (match: RegExpExecArray) => boolean }> = [
  { rule: 'hex colour (use a token class)', pattern: /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?(?:[0-9a-fA-F]{2})?\b/g },
  { rule: 'arbitrary size (use a scale class)', pattern: /\[[^\]]*\d(px|rem)[^\]]*\]/g },
  { rule: 'rgb()/rgba() without var() (use a token)', pattern: /\brgba?\((?!var\()/g },
  { rule: 'icon size other than 14 or 16', pattern: /size=\{(\d+)\}/g, skip: (m) => m[1] === '14' || m[1] === '16' }
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return SOURCE.test(entry.name) && !EXEMPT.has(entry.name) ? [path] : [];
  });
}

/** Every `file:line  rule: text` the given files break. */
function violationsIn(files: string[], root = RENDERER): string[] {
  const found: string[] = [];
  for (const file of files) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((text, index) => {
        for (const { rule, pattern, skip } of RULES) {
          pattern.lastIndex = 0;
          for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
            if (skip?.(m)) continue;
            found.push(`${relative(root, file)}:${index + 1}  ${rule}: ${m[0]}`);
          }
        }
      });
  }
  return found;
}

describe('style guard', () => {
  it('scans the renderer source (and not tokens.css)', () => {
    const files = sourceFiles(RENDERER).map((f) => relative(RENDERER, f));
    expect(files).toContain('App.tsx');
    expect(files).toContain('styles.css');
    expect(files).toContain(join('components', 'ui', 'Button.tsx'));
    expect(files).not.toContain('tokens.css');
  });

  it('finds no hex, arbitrary size, bare rgb()/rgba() or off-scale icon size in the renderer', () => {
    expect(violationsIn(sourceFiles(RENDERER))).toEqual([]);
  });

  it('would catch each kind of violation (the rules themselves work)', () => {
    const rulesHit = (line: string): string[] =>
      RULES.filter(({ pattern, skip }) => {
        pattern.lastIndex = 0;
        for (let m = pattern.exec(line); m; m = pattern.exec(line)) if (!skip?.(m)) return true;
        return false;
      }).map(({ rule }) => rule.split(' (')[0]);

    expect(rulesHit('color: #fff;')).toEqual(['hex colour']);
    expect(rulesHit('border: 1px solid #1b1f2580;')).toEqual(['hex colour']);
    expect(rulesHit('<div className="w-[220px] text-[11px]" />')).toEqual(['arbitrary size']);
    expect(rulesHit('<div className="h-[1.5rem]" />')).toEqual(['arbitrary size']);
    expect(rulesHit('background: rgba(0, 0, 0, 0.5);')).toEqual(['rgb()/rgba() without var()']);
    expect(rulesHit('<Check size={12} />')).toEqual(['icon size other than 14 or 16']);
    // What stays allowed.
    expect(rulesHit('background: rgb(var(--bg-rgb) / 0.5);')).toEqual([]);
    expect(rulesHit('<Check size={14} /><X size={16} />')).toEqual([]);
    expect(rulesHit('<div className="w-64 text-sm bg-surface" id="root" />')).toEqual([]);
  });
});
