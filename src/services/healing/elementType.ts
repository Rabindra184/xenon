/**
 * An element's type for its fingerprint (`LocatorSignature.nodeName`): the tag
 * the page source gives it. Fuzzy XML refuses a candidate of another type when
 * the fingerprint names one, and learning finds the element's path by it
 * (`findLearntElement`).
 *
 * Through 2.20 learning asked every driver for `getName`, and an Android
 * fingerprint fell back to `XCUIElementTypeAny`. UiAutomator2's `getName` is
 * not the class: on UiAutomator2 6.4.1 it answered "Sun, Nov 8" for a
 * TextView with that description and null for a FrameLayout with none, while
 * `getAttribute('class')` answered each one's class. So an Android element without a
 * description was typed `XCUIElementTypeAny`, which Fuzzy XML reads as any
 * type, and one with a description was typed by it ("Sun, Nov 8"): no element
 * has that tag, so no path was learnt and Fuzzy XML refused every candidate.
 */

import { meaningful } from './fingerprintIdentity';

/** What a fingerprint's type is when the driver can't say. */
export const ANDROID_FALLBACK_TYPE = 'android.view.View';
export const IOS_FALLBACK_TYPE = 'XCUIElementTypeAny';
export const UNKNOWN_TYPE = 'Unknown';

export type Platform = 'android' | 'ios' | 'other';

export function platformOf(platformName: unknown): Platform {
  const platform = String(platformName ?? '').toLowerCase();
  if (platform === 'android') return 'android';
  if (platform === 'ios' || platform === 'tvos') return 'ios';
  return 'other';
}

async function ask(read: () => Promise<unknown>): Promise<string | null> {
  try {
    const value = await read();
    return meaningful(value) ? value.trim() : null;
  } catch {
    return null;
  }
}

/**
 * The element's type, asked of the driver the way it answers:
 * - UiAutomator2: `getAttribute('class')` (`android.widget.TextView`). Never
 *   `getName`, which is the element's description or text.
 * - XCUITest: `getName`, which WebDriverAgent answers with the element's type
 *   (`XCUIElementTypeButton`), else `getAttribute('type')`.
 * A platform's fallback is its own, never the other's.
 */
export async function learnElementType(
  driver: any,
  elementId: string,
  platformName: unknown,
): Promise<string> {
  const platform = platformOf(platformName);
  if (platform === 'android') {
    if (typeof driver?.getAttribute === 'function') {
      const type = await ask(() => driver.getAttribute('class', elementId));
      if (type) return type;
    }
    return ANDROID_FALLBACK_TYPE;
  }
  if (platform === 'ios') {
    if (typeof driver?.getName === 'function') {
      const type = await ask(() => driver.getName(elementId));
      if (type && type.startsWith('XCUIElementType')) return type;
    }
    if (typeof driver?.getAttribute === 'function') {
      const type = await ask(() => driver.getAttribute('type', elementId));
      if (type && type.startsWith('XCUIElementType')) return type;
    }
    return IOS_FALLBACK_TYPE;
  }
  return UNKNOWN_TYPE;
}

/**
 * Whether a stored fingerprint's type is one a page source could have: an
 * Android class (`android.widget.Button`, `androidx.…`, `com.app.CustomView`:
 * dotted, no spaces) or an iOS type (`XCUIElementTypeButton`). Not
 * `XCUIElementTypeAny` or `Unknown`, the fallbacks, and not a description or
 * text, which Android fingerprints were typed by through 2.20. A fingerprint
 * whose type isn't is learnt again, once per process.
 *
 * Not judged by the session's platform: each platform's fingerprint is kept
 * apart (fingerprintKey.ts), and a stored type is read for the platform it
 * belongs to with `typeFamilyOf`.
 */
export function typeLooksLearnt(nodeName: unknown): boolean {
  if (typeof nodeName !== 'string' || nodeName === '') return false;
  if (nodeName === IOS_FALLBACK_TYPE || nodeName === UNKNOWN_TYPE) return false;
  if (nodeName.startsWith('XCUIElementType')) return true;
  return nodeName.includes('.') && !/\s/.test(nodeName);
}

/**
 * The platform a stored type belongs to: an iOS element type
 * (`XCUIElementTypeButton`) or an Android class (`android.widget.Button`,
 * `com.app.CustomView`). Null for the fallbacks and a description: Android
 * fingerprints were typed `XCUIElementTypeAny` or by their description
 * through 2.20, so neither says which platform learnt it.
 */
export function typeFamilyOf(nodeName: unknown): 'android' | 'ios' | null {
  if (!typeLooksLearnt(nodeName)) return null;
  return (nodeName as string).startsWith('XCUIElementType') ? 'ios' : 'android';
}
