import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

// Playwright's Electron support cannot open a second page ("Target.createTarget:
// Not supported"), which AxeBuilder does by default to gather its results. Its
// legacy mode does not need one. Frames are not tested in that mode, and this
// window is a single frame.

// The WCAG 2.1 A and AA rules. Only serious and critical findings fail a test;
// moderate and minor ones (heading order, landmark nesting) are not blockers.
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const BLOCKING = new Set(['serious', 'critical']);

interface Finding {
  id: string;
  impact?: string | null;
  help: string;
  nodes: Array<{ target: unknown[]; failureSummary?: string }>;
}

export interface AccessibleOptions {
  /**
   * CSS selectors to leave out. For a known problem in a screen that a later
   * change rebuilds, which that change must remove again; say why at the call.
   */
  exclude?: string[];
}

function describe(v: Finding): string {
  const where = v.nodes.map((n) => `    ${n.target.join(' ')}`).join('\n');
  return `${v.impact} ${v.id}: ${v.help} (${v.nodes.length} element${v.nodes.length === 1 ? '' : 's'})\n${where}`;
}

/** Waits out running colour transitions: axe reads computed colours, and a half-faded one is a false contrast failure. */
async function settleTransitions(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.allSettled(
      document
        .getAnimations()
        .filter((a) => a instanceof CSSTransition)
        .map((a) => a.finished)
    )
  );
}

/** Fails, listing every serious or critical WCAG 2.1 A/AA violation on the page as it is now. */
export async function expectAccessible(page: Page, label: string, options: AccessibleOptions = {}): Promise<void> {
  await settleTransitions(page);
  let axe = new AxeBuilder({ page }).setLegacyMode().withTags(WCAG_TAGS);
  for (const selector of options.exclude ?? []) axe = axe.exclude(selector);
  const results = await axe.analyze();
  const blocking = results.violations.filter((v) => v.impact && BLOCKING.has(v.impact));
  expect(blocking.map(describe), `${label}: serious or critical accessibility violations`).toEqual([]);
}

/**
 * Runs expectAccessible in the dark theme and then the light one, and leaves the
 * window in light, which is where Playwright pins an Electron window anyway.
 *
 * Playwright pins an Electron window's prefers-color-scheme to light, so the
 * theme is switched by emulating the media query the renderer follows (the
 * Appearance preference must be 'system', its default). Each switch is checked
 * on <html data-theme> first, so a run that never left light can't pass as dark.
 */
export async function expectAccessibleInBothThemes(
  page: Page,
  label: string,
  options: AccessibleOptions = {}
): Promise<void> {
  const html = page.locator('html');
  try {
    for (const theme of ['dark', 'light'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await expect(html).toHaveAttribute('data-theme', theme, { timeout: 2_000 });
      await expectAccessible(page, `${label} (${theme})`, options);
    }
  } finally {
    await page.emulateMedia({ colorScheme: 'light' });
  }
}
