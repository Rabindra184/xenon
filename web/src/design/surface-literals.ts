// Shared by the guard test (surface-literals.test.ts), which also rewrites the baseline.

/**
 * A surface drawn with numbers instead of the tokens in src/tokens.css:
 *   box-shadow: 0 4px 12px …      a shadow or ring (use --elevation-* / --ring-* / --focus-outline)
 *   border-radius: 6px            a corner (use --radius-sm … --radius-full)
 *   backdrop-filter: blur(16px)   glass on a surface (blur belongs only behind a modal)
 * and in TSX: shadow-[…], shadow-sm … shadow-2xl, rounded-[…], backdrop-blur,
 * and inline boxShadow / borderRadius / backdropFilter values.
 *
 * Not counted: none, 0, 50% (a circle), inherit, anything built on a token
 * (calc(var(--radius-md) - 2px)), Tailwind's rounded / rounded-md … (pointed at
 * the tokens in tailwind.config.js) and shadow-flat … shadow-modal.
 */
const CSS_SHADOW = /(?<![-\w])box-shadow:\s*([^;}]+)/g;
const CSS_RADIUS = /(?<![-\w])border(?:-(?:top|bottom)-(?:left|right))?-radius:\s*([^;}]+)/g;
const CSS_BLUR = /(?<![-\w])backdrop-filter:\s*[^;}]*blur\(/g;
const TW =
  /(?<![-\w])(?:shadow-\[|shadow-(?:sm|md|lg|xl|2xl)\b|rounded(?:-[a-z]+)?-\[|backdrop-blur)/g;
const INLINE =
  /\b(?:boxShadow|backdropFilter):\s*['"`](?!var\(|none)|\bborderRadius:\s*(?:['"`](?!var\()[0-9.]+(?:px|rem)|[1-9][0-9]*\b)/g;

const TOKEN_ONLY =
  /^(?:none|inherit|initial|unset|0|var\(--[\w-]+\)(?:\s*,\s*var\(--[\w-]+\))*)\s*(?:!important)?$/;

function rawShadow(value: string): boolean {
  return !TOKEN_ONLY.test(value.trim());
}

function rawRadius(value: string): boolean {
  const v = value.trim();
  if (/var\(--radius/.test(v)) return false;
  return /[0-9.]+(?:px|rem|em)\b/.test(v.replace(/\b0(?:px)?\b/g, ''));
}

/** Files that may draw surfaces with numbers by design. */
export const EXEMPT: Record<string, string> = {
  'src/tokens.css': 'defines the radii, elevation levels and rings',
};

export function countSurfaceLiterals(source: string): number {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  let n = 0;
  for (const m of Array.from(code.matchAll(CSS_SHADOW))) if (rawShadow(m[1])) n++;
  for (const m of Array.from(code.matchAll(CSS_RADIUS))) if (rawRadius(m[1])) n++;
  n += (code.match(CSS_BLUR) ?? []).length;
  n += (code.match(TW) ?? []).length;
  n += (code.match(INLINE) ?? []).length;
  return n;
}
