/**
 * Prove a locator actually resolves — through Appium, not against a snapshot.
 *
 * The inspector already scores locators and matches them against the captured
 * XML, which answers "does this string select something in that tree". It does
 * NOT answer the question a test author actually has: *will Appium find this*.
 * Those differ often enough to matter — a stale snapshot, a strategy the XML
 * matcher cannot evaluate at all (`-android uiautomator`, `-ios predicate
 * string`), or a driver that normalises selectors differently. A green badge
 * that came from matching XML would be exactly the "silently plausible" signal
 * that sends someone to write a test that then fails.
 *
 * So this runs the real `findElements` on the real driver and reports what came
 * back, optionally acting on the element afterwards.
 */

export type VerifyAction = 'none' | 'tap' | 'clear' | 'sendKeys';

export interface VerifyLocatorRequest {
  strategy: string;
  selector: string;
  action?: VerifyAction;
  /** Only read for `sendKeys`. */
  text?: string;
}

export interface VerifyLocatorResult {
  found: boolean;
  /** How many elements matched. >1 means the locator is ambiguous. */
  count: number;
  /** Present when exactly one element matched and it could be measured. */
  rect?: { x: number; y: number; width: number; height: number };
  actionPerformed: VerifyAction;
  /** Set when the find succeeded but the action did not. */
  actionError?: string;
  /** Set when the find itself failed — the message Appium gave. */
  error?: string;
  elapsedMs: number;
}

/**
 * The subset of an Appium driver this needs. Declared structurally so the
 * logic is testable without standing up a session — the same reason
 * `evaluateDeviceAccess` and `resolveAuthDisabled` are pure.
 */
export interface DriverLike {
  findElements(
    strategy: string,
    selector: string,
  ): Promise<Array<{ ELEMENT?: string; [k: string]: any }>>;
  getElementRect?(
    elementId: string,
  ): Promise<{ x: number; y: number; width: number; height: number }>;
  click?(elementId: string): Promise<void>;
  clear?(elementId: string): Promise<void>;
  setValue?(text: string, elementId: string): Promise<void>;
}

/** Appium returns element ids under one of two keys depending on protocol era. */
const W3C_KEY = 'element-6066-11e4-a52e-4f735466cecf';
export function elementIdOf(el: Record<string, any>): string | undefined {
  return el?.[W3C_KEY] ?? el?.ELEMENT;
}

export async function verifyLocator(
  driver: DriverLike,
  req: VerifyLocatorRequest,
  now: () => number = Date.now,
): Promise<VerifyLocatorResult> {
  const started = now();
  const action: VerifyAction = req.action ?? 'none';

  if (!req.strategy || !req.selector) {
    return {
      found: false,
      count: 0,
      actionPerformed: 'none',
      error: 'strategy and selector are both required',
      elapsedMs: now() - started,
    };
  }

  // findElements, not findElement: a locator matching THREE things is a
  // different problem from one matching none, and findElement collapses both
  // into "the first one" / a throw. Ambiguity is the more common and more
  // dangerous defect, so it has to be visible.
  let elements: Array<Record<string, any>>;
  try {
    elements = await driver.findElements(req.strategy, req.selector);
  } catch (e: any) {
    return {
      found: false,
      count: 0,
      actionPerformed: 'none',
      error: e?.message || String(e),
      elapsedMs: now() - started,
    };
  }

  const count = elements?.length ?? 0;
  if (count === 0) {
    return { found: false, count: 0, actionPerformed: 'none', elapsedMs: now() - started };
  }

  const id = elementIdOf(elements[0]);
  let rect: VerifyLocatorResult['rect'];
  // Only measure an unambiguous match. Drawing a box around "the first of
  // four" would claim a precision the locator does not have.
  if (count === 1 && id && driver.getElementRect) {
    try {
      rect = await driver.getElementRect(id);
    } catch {
      /* rect is a nicety; never fail a successful find over it */
    }
  }

  const base: VerifyLocatorResult = {
    found: true,
    count,
    rect,
    actionPerformed: 'none',
    elapsedMs: now() - started,
  };

  if (action === 'none') return base;

  // Refuse to act on an ambiguous locator. Acting on "the first match" is how
  // a test passes locally and taps the wrong thing in CI, and it would also
  // make this tool endorse a locator that should be rewritten.
  if (count > 1) {
    return {
      ...base,
      actionError: `Refusing to ${action}: ${count} elements match. Narrow the locator first.`,
      elapsedMs: now() - started,
    };
  }
  if (!id) {
    return {
      ...base,
      actionError: 'Driver returned an element without an id',
      elapsedMs: now() - started,
    };
  }

  try {
    if (action === 'tap') {
      if (!driver.click) throw new Error('Driver does not support click');
      await driver.click(id);
    } else if (action === 'clear') {
      if (!driver.clear) throw new Error('Driver does not support clear');
      await driver.clear(id);
    } else if (action === 'sendKeys') {
      if (!driver.setValue) throw new Error('Driver does not support setValue');
      await driver.setValue(req.text ?? '', id);
    }
    return { ...base, actionPerformed: action, elapsedMs: now() - started };
  } catch (e: any) {
    // The find SUCCEEDED and the action failed — a materially different result
    // from "locator not found", and the one that tells you the element exists
    // but is disabled, covered, or off-screen. Kept distinct from `error`.
    return { ...base, actionError: e?.message || String(e), elapsedMs: now() - started };
  }
}
