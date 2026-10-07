// Pure helpers behind `npm run sync:tokens`. The launcher's design tokens are
// copied from the dashboard's web/src/tokens.css rather than hand-written, so
// the two can't drift apart silently. Kept free of IO so it's unit-testable.

/**
 * Colour tokens the launcher consumes. parseThemeBlocks fails the sync when one
 * goes missing from the dashboard, so a rename there can't quietly turn a
 * Tailwind colour into an invalid `rgb(var(--x-rgb))`.
 */
export const COLOR_VARS = [
  '--bg',
  '--surface',
  '--surface-2',
  '--surface-sunken',
  '--border',
  '--border-strong',
  '--text',
  '--text-muted',
  '--text-dim',
  '--green',
  '--green-dim',
  '--amber',
  '--red',
  '--blue',
  '--color-accent',
  '--color-on-accent',
  '--color-success',
  '--color-warning',
  '--color-danger',
  '--color-info',
  '--color-focus-ring',
  ...['ready', 'busy', 'reserved', 'error', 'offline'].flatMap((status) =>
    ['fg', 'bg', 'border'].map((part) => `--status-${status}-${part}`)
  )
];

/** How many `var(--x)` hops resolveVar follows before it decides there is a cycle. */
const MAX_VAR_DEPTH = 10;

export class MissingTokenError extends Error {
  constructor(name) {
    super(
      `Token ${name} is missing from the dashboard palette (web/src/tokens.css). ` +
        `Either it was renamed/removed there, or mac-app should stop consuming it.`
    );
    this.name = 'MissingTokenError';
  }
}

/**
 * '#22c55e' → '34 197 94'. Tailwind needs bare channels to apply opacity
 * modifiers (bg-accent/10) via <alpha-value>. Non-hex values return null.
 */
export function hexToRgbChannels(value) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  const n = parseInt(hex, 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

// ---------------------------------------------------------------------------
// Reading the dashboard's CSS
// ---------------------------------------------------------------------------

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Split a selector list on the commas that are not inside (...) or [...]. */
function splitSelectors(list) {
  const selectors = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const ch = list[i];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) {
      selectors.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  selectors.push(list.slice(start).trim());
  return selectors;
}

/** The style rules at the top level of a stylesheet. At-rules (@media…) are skipped whole. */
function topLevelRules(css) {
  const rules = [];
  let from = 0;
  while (from < css.length) {
    const open = css.indexOf('{', from);
    if (open === -1) break;
    let depth = 1;
    let close = open + 1;
    while (close < css.length && depth > 0) {
      if (css[close] === '{') depth++;
      else if (css[close] === '}') depth--;
      close++;
    }
    // A statement such as `@import '…';` ahead of the rule is not part of its selector.
    const text = css.slice(from, open);
    const prelude = text.slice(text.lastIndexOf(';') + 1).trim();
    if (!prelude.startsWith('@')) {
      rules.push({ selectors: splitSelectors(prelude), body: css.slice(open + 1, close - 1) });
    }
    from = close;
  }
  return rules;
}

/** The custom properties declared in a rule body, in order. */
function customProperties(body) {
  const props = {};
  for (const declaration of body.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon === -1) continue;
    const name = declaration.slice(0, colon).trim();
    if (name.startsWith('--')) props[name] = declaration.slice(colon + 1).trim().replace(/\s+/g, ' ');
  }
  return props;
}

const isLightRoot = (selector) => selector.replace(/"/g, "'") === ":root[data-theme='light']";

/**
 * Read the two themes out of the dashboard's tokens.css.
 *  - dark: every rule whose selector list has a bare `:root`, merged in order
 *    (the file splits them across two `.theme-dark, :root` blocks).
 *  - light: the `:root[data-theme='light']` block.
 * Everything else (`:where()`, legacy glow rules, @media) is not a theme.
 */
export function parseThemeBlocks(css) {
  const dark = {};
  const light = {};
  for (const { selectors, body } of topLevelRules(stripComments(css))) {
    if (selectors.includes(':root')) Object.assign(dark, customProperties(body));
    else if (selectors.some(isLightRoot)) Object.assign(light, customProperties(body));
  }
  for (const name of COLOR_VARS) {
    if (!dark[name]) throw new MissingTokenError(name);
  }
  return { dark, light };
}

// ---------------------------------------------------------------------------
// Colour maths
// ---------------------------------------------------------------------------

const VAR_REFERENCE = /^var\(\s*(--[\w-]+)\s*\)$/;

/**
 * The value of `name` once every plain `var(--x)` reference is followed.
 * Compound values (`rgb(var(--rgb-x) / 0.1)`, `var(--x, fallback)`) are returned
 * as written.
 */
export function resolveVar(name, vars) {
  let current = name;
  for (let hops = 0; hops <= MAX_VAR_DEPTH; hops++) {
    const value = vars[current];
    if (value === undefined) throw new MissingTokenError(current);
    const reference = VAR_REFERENCE.exec(value);
    if (!reference) return value;
    current = reference[1];
  }
  throw new Error(`Token ${name} is still a var() reference after ${MAX_VAR_DEPTH} hops. Is there a cycle?`);
}

/** WCAG relative luminance of a hex colour. */
function luminance(hex) {
  const channels = hexToRgbChannels(hex);
  if (!channels) throw new Error(`Not a hex colour: ${hex}`);
  const [r, g, b] = channels.split(' ').map((c) => {
    const s = Number(c) / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hex colours, from 1 to 21. */
export function contrastRatio(a, b) {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

// ---------------------------------------------------------------------------
// Writing the launcher's tokens.css
// ---------------------------------------------------------------------------

const HEADER = [
  '/* GENERATED by `npm run sync:tokens` — do not edit by hand.',
  " * Source of truth: web/src/tokens.css (the Xenon dashboard's design tokens).",
  ' * Both themes are copied as they are. Each variable that resolves to a hex',
  ' * colour also gets a <name>-rgb channel triple, so Tailwind can apply opacity',
  ' * modifiers (bg-accent/10) through <alpha-value>.',
  ' */'
];

const LIGHT_SELECTOR = ":root[data-theme='light']";

const declarations = (vars) => Object.entries(vars).map(([name, value]) => `  ${name}: ${value};`);

/** `<name>-rgb: r g b` for every variable that resolves to a hex colour within `vars`. */
function channelDeclarations(vars) {
  const lines = [];
  for (const name of Object.keys(vars)) {
    const channels = hexToRgbChannels(resolveVar(name, vars));
    if (channels) lines.push(`  ${name}-rgb: ${channels};`);
  }
  return lines;
}

/**
 * `own` is what the theme's block says; `effective` is what the theme resolves
 * against. For light that is dark with light on top, so a colour that light
 * changes only through a primitive (--color-accent: var(--green)) still gets
 * fresh channels instead of inheriting dark's.
 */
function themeRule(selector, scheme, own, effective) {
  return [
    `${selector} {`,
    `  color-scheme: ${scheme};`,
    ...declarations(own),
    '',
    ...channelDeclarations(effective),
    '}'
  ].join('\n');
}

/** Render the launcher's tokens.css from the two parsed themes. */
export function generateTokensCss({ dark, light }) {
  return [
    ...HEADER,
    themeRule(':root', 'dark', dark, dark),
    '',
    themeRule(LIGHT_SELECTOR, 'light', light, { ...dark, ...light }),
    ''
  ].join('\n');
}
