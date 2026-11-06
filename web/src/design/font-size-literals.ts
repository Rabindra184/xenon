// Shared by the guard test (font-size-literals.test.ts), which also rewrites the baseline.

/**
 * A size written as a number instead of a type role from src/tokens.css:
 *   font-size: 11px          (CSS, any px or rem value)
 *   text-[11px]              (a Tailwind arbitrary size)
 *   fontSize: '11px' / 12    (an inline style)
 * `font-size: var(--type-…)`, `inherit` and Tailwind's text-caption … text-display
 * don't match, nor does an `em` size: it scales with the text around it (inline
 * code at 0.9em), which already has its role. What is left in the baseline is icon
 * glyphs drawn with a character (×, ▸, a provider's letter), not text.
 */
export const FONT_SIZE_LITERAL =
  /font-size:\s*[0-9.]+(?:px|rem)\b|\btext-\[[0-9.]+(?:px|rem)\]|fontSize:\s*(?:['"][0-9.]+(?:px|rem)?['"]|[0-9.]+\b)/g;

/** Files that may hold raw sizes by design. Everything else should use a role. */
export const EXEMPT: Record<string, string> = {
  'src/tokens.css': 'defines the type roles',
};

export function countFontSizeLiterals(source: string): number {
  // Comments quote old sizes ("was 11px"); they are not styling.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  return (code.match(FONT_SIZE_LITERAL) ?? []).length;
}
