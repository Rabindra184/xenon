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

// Tailwind's default palette still exists (the config extends the theme, so
// that `text-3xl`-style drift is caught by the scales instead), which means
// `text-white` or `bg-gray-800` generate without complaint and don't follow the
// theme. A utility prefix followed by a palette name flags them. The project's
// own colours (accent, warn, danger, info, ok, focus, app, surface, ink, ...)
// are not palette names, so `text-accent` and `bg-danger/90` pass; `accent-` as
// a prefix (the accent-color utility) is still caught when a palette name follows.
const COLOR_UTILITY =
  'text|bg|border(?:-[trblxyse])?|ring(?:-offset)?|outline|fill|stroke|from|via|to|divide|placeholder|caret|accent|shadow|decoration';
const PALETTE_COLOR =
  'white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const DEFAULT_PALETTE = new RegExp(
  `(?<![\\w-])(?:${COLOR_UTILITY})-(?:${PALETTE_COLOR})(?:-\\d{2,3})?(?:/\\d+)?(?![\\w-])`,
  'g'
);

const RULES: ReadonlyArray<{ rule: string; pattern: RegExp; skip?: (match: RegExpExecArray) => boolean }> = [
  { rule: 'hex colour (use a token class)', pattern: /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?(?:[0-9a-fA-F]{2})?\b/g },
  { rule: 'arbitrary size (use a scale class)', pattern: /\[[^\]]*\d(px|rem)[^\]]*\]/g },
  { rule: 'rgb()/rgba() without var() (use a token)', pattern: /\brgba?\((?!var\()/g },
  { rule: 'default-palette colour (use a token colour)', pattern: DEFAULT_PALETTE },
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

  it('finds no hex, arbitrary size, bare rgb()/rgba(), default-palette colour or off-scale icon size in the renderer', () => {
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
    // Default-palette colours, in every spelling a class takes.
    for (const klass of [
      'text-white',
      'bg-black/40',
      'text-gray-500',
      'border-red-600/50',
      'hover:bg-slate-800',
      'dark:text-zinc-100',
      'ring-offset-white',
      'ring-blue-500',
      'divide-gray-200',
      'placeholder-gray-400',
      'accent-green-500',
      'border-t-red-500',
      'shadow-black/25',
      'fill-current text-rose-50'
    ]) {
      expect(rulesHit(`<div className="flex ${klass} p-2" />`), klass).toEqual(['default-palette colour']);
    }
    expect(
      rulesHit('<div className="bg-gradient-to-r from-blue-500 to-purple-600" />').length,
      'two palette colours on one line are one rule hit'
    ).toBe(1);
    // What stays allowed.
    expect(rulesHit('background: rgb(var(--bg-rgb) / 0.5);')).toEqual([]);
    expect(rulesHit('<Check size={14} /><X size={16} />')).toEqual([]);
    expect(rulesHit('<div className="w-64 text-sm bg-surface" id="root" />')).toEqual([]);
    // The project's own colours are not palette names, whatever the utility.
    for (const klass of [
      'text-accent',
      'bg-accent/15',
      'bg-accent-dim',
      'text-accent-fg',
      'text-danger-fg',
      'bg-danger/90',
      'border-danger',
      'text-warn',
      'text-ok',
      'bg-info',
      'ring-focus',
      'ring-offset-app',
      'bg-app',
      'bg-surface2',
      'bg-sunken',
      'border-line-strong',
      'border-dim',
      'text-ink',
      'text-muted',
      'bg-scrim/40',
      'bg-status-ready-bg',
      'border-status-error-border',
      'text-status-busy-fg',
      'whitespace-nowrap',
      'text-2xl',
      'shadow-lg',
      'outline-none',
      'fill-surface2'
    ]) {
      expect(rulesHit(`<div className="${klass}" />`), klass).toEqual([]);
    }
    // A CSS variable that merely contains a palette-like word is not a class.
    expect(rulesHit('--accent-subtle: var(--red-100); color: var(--text-red);')).toEqual([]);
  });
});
