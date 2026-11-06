// Shared by the guard test (font-size-literals.test.ts), which also rewrites the baseline.

/**
 * A size written as a number instead of a type role from src/tokens.css:
 *   font-size: 11px          (CSS, any px / rem / em value)
 *   text-[11px]              (a Tailwind arbitrary size)
 *   fontSize: '11px' / 12    (an inline style)
 * `font-size: var(--type-…)`, `inherit` and Tailwind's text-caption … text-display
 * don't match. Tailwind's text-lg / xl / 2xl … aren't counted here either: they
 * are on the scale's old steps and move to roles page by page.
 */
export const FONT_SIZE_LITERAL =
  /font-size:\s*[0-9.]+(?:px|rem|em)\b|\btext-\[[0-9.]+(?:px|rem|em)\]|fontSize:\s*(?:['"][0-9.]+(?:px|rem|em)?['"]|[0-9.]+\b)/g;

/** Files that may hold raw sizes by design. Everything else should use a role. */
export const EXEMPT: Record<string, string> = {
  'src/tokens.css': 'defines the type roles',
};

export function countFontSizeLiterals(source: string): number {
  // Comments quote old sizes ("was 11px"); they are not styling.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  return (code.match(FONT_SIZE_LITERAL) ?? []).length;
}
