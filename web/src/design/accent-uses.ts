// Shared by the guard test (accent-uses.test.ts), which also rewrites the baseline.

/**
 * A use of the accent green: var(--color-accent…), rgb(var(--rgb-accent) …),
 * var(--accent-subtle) / var(--accent-border), in CSS, Tailwind classes or
 * inline styles.
 *
 * Accent is for what you can act on, what is selected, what has focus and
 * where you are (the rule is beside --color-accent in src/tokens.css). A
 * machine can't tell a button from a decorative icon, so this counts every
 * use outside the shared components and lets a page lose them, never gain
 * them: new controls take their green from Button, SegmentedControl,
 * Input/Select and the focus tokens, which carry it themselves.
 */
export const ACCENT_USE =
  /var\(--color-accent(?:-strong|-soft)?\)|var\(--rgb-accent\)|var\(--accent-(?:subtle|border)\)/g;

/** Where the accent is defined or owned. */
export function isExempt(rel: string): boolean {
  return (
    rel === 'src/tokens.css' ||
    rel.startsWith('src/components/ui/') ||
    rel.startsWith('src/design/')
  );
}

export function countAccentUses(source: string): number {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  return (code.match(ACCENT_USE) ?? []).length;
}
