/**
 * The shared <Button>'s look lives in ui/button.css. A stylesheet elsewhere
 * that declares a rule *starting with* one of its classes restyles every
 * Button on any page that loads that sheet.
 *
 * device-control.css did exactly that with `.btn-secondary { padding: 10px
 * 20px; font-weight: 700; … }`, written for its own raw buttons. It loads on
 * the Devices page, where it bolded and padded every secondary Button and
 * squeezed an icon Button's SVG to zero width.
 *
 * Scoped rules (`.toolbar .btn-base.btn-size-icon`) stay allowed: they reach
 * only the Buttons inside that container.
 */

/** The classes ui/button.tsx puts on a <Button>. */
export const BUTTON_CLASSES = [
  'btn-base',
  'btn-primary',
  'btn-secondary',
  'btn-ghost',
  'btn-tonal',
  'btn-link',
  'btn-danger',
  'btn-size-sm',
  'btn-size-md',
  'btn-size-lg',
  'btn-size-icon',
];

// A compound that only picks the page or the theme (`:root`, `html`,
// `[data-theme='light']`, `:root:not([data-theme='light'])`), so a selector
// that starts with one is still global.
const PAGE_OR_THEME = /^(?::root|html|body)?(?:\[[^\]]*\])*(?::[a-z-]+(?:\([^)]*\))?)*$/i;

const BUTTON_CLASS = new RegExp(`\\.(?:${BUTTON_CLASSES.join('|')})(?![\\w-])`);

/** Selectors in `css` that apply globally to a shared Button class. */
export function globalButtonSelectors(css: string): string[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found: string[] = [];
  const prelude = /([^{}]+)\{/g;
  let m: RegExpExecArray | null;
  while ((m = prelude.exec(text))) {
    const selectors = m[1].trim();
    if (!selectors || selectors.startsWith('@')) continue;
    for (const raw of selectors.split(',')) {
      const selector = raw.trim().replace(/\s+/g, ' ');
      const compounds = selector.split(/\s*[>+~]\s*|\s+/).filter(Boolean);
      let i = 0;
      while (i < compounds.length - 1 && PAGE_OR_THEME.test(compounds[i])) i += 1;
      if (compounds[i] && BUTTON_CLASS.test(compounds[i])) found.push(selector);
    }
  }
  return found;
}
