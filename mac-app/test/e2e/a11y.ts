import AxeBuilder from '@axe-core/playwright';
import { expect, type JSHandle, type Page } from '@playwright/test';

// Playwright's Electron support cannot open a second page ("Target.createTarget:
// Not supported"), which AxeBuilder does by default to gather its results. Its
// legacy mode does not need one. Frames are not tested in that mode, and this
// window is a single frame.

// The WCAG 2.1 A and AA rules. Only serious and critical findings fail a test;
// moderate and minor ones (heading order, landmark nesting) are not blockers.
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const BLOCKING = new Set(['serious', 'critical']);
const CONTRAST = 'color-contrast';

/**
 * Reasons axe may give for not deciding a text's contrast that are accepted as
 * they are. Keep it empty unless the screen really has such text (for example
 * words over a photo or a gradient), and say at the entry which text it is and
 * why it can't be measured. Off-screen and covered text is never one of them:
 * the scroll sweep below brings it into view.
 */
const UNMEASURABLE_ALLOWED = new Set<string>([]);

interface CheckResult {
  id: string;
  message: string;
  data?: { messageKey?: string } | null;
}

interface AxeNode {
  target: unknown[];
  any: CheckResult[];
  all: CheckResult[];
  none: CheckResult[];
}

interface AxeRule {
  id: string;
  impact?: string | null;
  help: string;
  nodes: AxeNode[];
}

interface AxeRun {
  violations: AxeRule[];
  incomplete: AxeRule[];
  passes: AxeRule[];
}

export interface AccessibleOptions {
  /**
   * CSS selectors to leave out. For a known problem in a screen that a later
   * change rebuilds, which that change must remove again; say why at the call.
   */
  exclude?: string[];
}

const where = (node: AxeNode): string => node.target.join(' ');

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

/** Two frames, so a scroll's observers (the settings scroll-spy) have run and React has drawn their result. */
async function nextFrames(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  );
}

async function analyze(page: Page, options: AccessibleOptions, rules?: string[], only?: string[]): Promise<AxeRun> {
  let axe = new AxeBuilder({ page }).setLegacyMode();
  axe = rules ? axe.withRules(rules) : axe.withTags(WCAG_TAGS);
  for (const selector of only ?? []) axe = axe.include(selector);
  for (const selector of options.exclude ?? []) axe = axe.exclude(selector);
  return (await axe.analyze()) as unknown as AxeRun;
}

/** The elements whose contrast is undecided in `run`, as axe's selectors. */
const undecidedIn = (run: AxeRun): string[] =>
  run.incomplete.filter((rule) => rule.id === CONTRAST).flatMap((rule) => rule.nodes.map(where));

/** The contrast verdicts (passed or failed) in `run`, as axe's selectors. */
const decidedIn = (run: AxeRun): string[] =>
  [...run.passes, ...run.violations].filter((rule) => rule.id === CONTRAST).flatMap((rule) => rule.nodes.map(where));

/**
 * Every element that scrolls (overflow auto or scroll, with more content than
 * room), outermost first. Axe can only measure contrast on what is on screen:
 * text below the fold of a scroll area comes back "incomplete", not failed.
 */
async function scrollAreas(page: Page): Promise<JSHandle<HTMLElement[]>> {
  return page.evaluateHandle(() =>
    [...document.querySelectorAll<HTMLElement>('*')].filter((el) => {
      const style = getComputedStyle(el);
      const scrolls = (overflow: string) => overflow === 'auto' || overflow === 'scroll';
      return (
        (scrolls(style.overflowY) && el.scrollHeight > el.clientHeight) ||
        (scrolls(style.overflowX) && el.scrollWidth > el.clientWidth)
      );
    })
  );
}

/**
 * Brings every part of every scroll area on screen in turn and, at each stop,
 * runs the contrast rule on the texts still `undecided` inside that area. Steps
 * are half a view, so a text cut by an edge at one stop is whole at the next.
 * Stops early once nothing is left to decide. Puts every scroll position back.
 */
async function sweepContrast(page: Page, options: AccessibleOptions, undecided: string[]): Promise<AxeRun[]> {
  const pending = new Set(undecided);
  const runs: AxeRun[] = [];
  if (pending.size === 0) return runs;
  const areas = await scrollAreas(page);
  const saved = await areas.evaluate((els) =>
    els.map((el) => {
      const before = { top: el.scrollTop, left: el.scrollLeft, behavior: el.style.scrollBehavior };
      // A smooth-scrolling area would still be moving when axe looks.
      el.style.scrollBehavior = 'auto';
      return before;
    })
  );
  try {
    for (let index = 0; index < saved.length && pending.size > 0; index++) {
      const { stops, inside } = await areas.evaluate(
        (els, { i, selectors }) => {
          const el = els[i];
          // A nested area (a list inside the tab) must itself be on screen first.
          el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          const along = (size: number, view: number) => {
            const last = Math.max(0, size - view);
            const step = Math.max(1, Math.floor(view / 2));
            const positions: number[] = [];
            for (let at = 0; at < last; at += step) positions.push(at);
            positions.push(last);
            return positions;
          };
          const tops = along(el.scrollHeight, el.clientHeight);
          const lefts = along(el.scrollWidth, el.clientWidth);
          return {
            stops: tops.flatMap((top) => lefts.map((left) => ({ top, left }))),
            inside: selectors.filter((selector) => {
              const target = document.querySelector(selector);
              return !!target && el.contains(target);
            })
          };
        },
        { i: index, selectors: [...pending] }
      );
      let left = inside.filter((selector) => pending.has(selector));
      for (const stop of stops) {
        if (left.length === 0) break;
        await areas.evaluate(
          (els, { i, top, left }) => {
            els[i].scrollTop = top;
            els[i].scrollLeft = left;
          },
          { i: index, ...stop }
        );
        await nextFrames(page);
        await settleTransitions(page);
        const run = await analyze(page, options, [CONTRAST], left);
        runs.push(run);
        for (const selector of decidedIn(run)) pending.delete(selector);
        left = left.filter((selector) => pending.has(selector));
      }
    }
  } finally {
    await areas.evaluate((els, before) => {
      // Innermost first: putting an outer area back last leaves it where it was,
      // even after scrollIntoView moved it to show an inner one.
      for (let i = els.length - 1; i >= 0; i--) {
        els[i].scrollTop = before[i].top;
        els[i].scrollLeft = before[i].left;
        els[i].style.scrollBehavior = before[i].behavior;
      }
    }, saved);
    await areas.dispose();
  }
  return runs;
}

/** Why axe could not decide a node's contrast, as its message key (bgGradient, elmPartiallyObscured, …). */
function reasonOf(node: AxeNode): string {
  const check = [...node.any, ...node.all, ...node.none].find((c) => c.data?.messageKey) ?? node.any[0];
  return check?.data?.messageKey ?? check?.message ?? 'unknown';
}

/**
 * Every serious or critical WCAG 2.1 A/AA problem on the page, as readable lines.
 *  - All rules run once, on the page as it is.
 *  - The texts whose contrast that run could not decide (off screen, under the
 *    window's edge) are checked again across the whole of every scroll area,
 *    and a text that fails at any scroll position fails.
 *  - A text whose contrast axe could not decide at any position is a problem
 *    too, unless its reason is in UNMEASURABLE_ALLOWED.
 */
export async function accessibilityProblems(page: Page, options: AccessibleOptions = {}): Promise<string[]> {
  await settleTransitions(page);
  const first = await analyze(page, options);
  const runs = [first, ...(await sweepContrast(page, options, undecidedIn(first)))];

  // Violations, merged by rule and element across every run.
  const failing = new Map<string, { rule: AxeRule; nodes: Map<string, AxeNode> }>();
  for (const run of runs) {
    for (const rule of run.violations) {
      if (!rule.impact || !BLOCKING.has(rule.impact)) continue;
      const entry = failing.get(rule.id) ?? { rule, nodes: new Map<string, AxeNode>() };
      for (const node of rule.nodes) entry.nodes.set(where(node), node);
      failing.set(rule.id, entry);
    }
  }

  // Contrast axe decided somewhere (passed or failed) is decided.
  const decided = new Set(runs.flatMap(decidedIn));
  const undecided = new Map<string, Map<string, AxeNode>>();
  for (const run of runs) {
    for (const rule of run.incomplete) {
      if (rule.id !== CONTRAST) continue;
      for (const node of rule.nodes) {
        const key = where(node);
        const reason = reasonOf(node);
        if (decided.has(key) || UNMEASURABLE_ALLOWED.has(reason)) continue;
        const nodes = undecided.get(reason) ?? new Map<string, AxeNode>();
        nodes.set(key, node);
        undecided.set(reason, nodes);
      }
    }
  }

  const lines = (nodes: Map<string, AxeNode>) => [...nodes.keys()].map((key) => `    ${key}`).join('\n');
  const count = (n: number) => `${n} element${n === 1 ? '' : 's'}`;
  return [
    ...[...failing.values()].map(
      ({ rule, nodes }) => `${rule.impact} ${rule.id}: ${rule.help} (${count(nodes.size)})\n${lines(nodes)}`
    ),
    ...[...undecided.entries()].map(
      ([reason, nodes]) =>
        `unmeasured ${CONTRAST} (${reason}): axe could not decide the contrast anywhere in the scroll range (${count(nodes.size)})\n${lines(nodes)}`
    )
  ];
}

/** Fails, listing every serious or critical WCAG 2.1 A/AA problem on the page; see accessibilityProblems. */
export async function expectAccessible(page: Page, label: string, options: AccessibleOptions = {}): Promise<void> {
  const problems = await accessibilityProblems(page, options);
  expect(problems, `${label}: serious or critical accessibility problems`).toEqual([]);
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
