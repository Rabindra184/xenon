/**
 * Where a selector's fingerprint is kept (`LocatorEtalon.selector`), and which
 * stored fingerprint a session reads.
 *
 * Each platform's fingerprint of a selector is its own row, under a key that
 * names the platform family and the strategy:
 *
 *   fp1|android|accessibility id|Login
 *   fp1|ios|accessibility id|Login
 *
 * A cross-platform suite uses one accessibility id on both apps. Through 2.36
 * fingerprints were kept by selector text alone, so both platforms shared
 * one row: Android learnt it first (`android.widget.Button`), iOS sessions
 * took it as complete and learnt nothing, and Fuzzy XML's type gate refused
 * every iOS element against it, so healing went on to OCR and the AI tiers.
 * Each save also replaced the row's strategy with its own.
 *
 * A row stored under the bare selector (every row written through 2.36, and
 * one from a session whose platform is neither) is the legacy row. A session
 * reads its own key first, then the legacy row only when the legacy row's
 * type belongs to the session's platform (`typeFamilyOf`: an Android class or
 * an `XCUIElementType*`) and it was learnt under the same strategy. A
 * session of neither platform reads and writes the legacy row as before.
 *
 * The schema is unchanged: `selector` stays the table's unique key, so a lab
 * whose database `prisma db push` keeps needs nothing at start.
 */

import { Platform, platformOf, typeFamilyOf } from './elementType';

export type PlatformFamily = 'android' | 'ios';

export const FINGERPRINT_KEY_PREFIX = 'fp1|';

/** The family of a session's `platformName` (tvOS is iOS's), or null for neither. */
export function platformFamilyOf(platformName: unknown): PlatformFamily | null {
  const platform: Platform = platformOf(platformName);
  return platform === 'other' ? null : platform;
}

/**
 * The key a fingerprint is stored under: the platform family's, or the bare
 * selector for a session of neither platform.
 */
export function fingerprintKey(
  family: PlatformFamily | null,
  strategy: unknown,
  selector: string,
): string {
  if (!family) return selector;
  return `${FINGERPRINT_KEY_PREFIX}${family}|${String(strategy ?? '')}|${selector}`;
}

export interface ParsedFingerprintKey {
  family: PlatformFamily;
  strategy: string;
  selector: string;
}

/**
 * A stored key's parts, or null for a legacy (bare selector) key. A strategy
 * never holds `|`; the selector, last, may.
 */
export function parseFingerprintKey(key: string): ParsedFingerprintKey | null {
  if (typeof key !== 'string' || !key.startsWith(FINGERPRINT_KEY_PREFIX)) return null;
  const rest = key.slice(FINGERPRINT_KEY_PREFIX.length);
  const familyEnd = rest.indexOf('|');
  if (familyEnd < 0) return null;
  const family = rest.slice(0, familyEnd);
  if (family !== 'android' && family !== 'ios') return null;
  const strategyEnd = rest.indexOf('|', familyEnd + 1);
  if (strategyEnd < 0) return null;
  return {
    family,
    strategy: rest.slice(familyEnd + 1, strategyEnd),
    selector: rest.slice(strategyEnd + 1),
  };
}

/** What a reader asks for: the session's platform and the find's strategy. */
export interface FingerprintScope {
  platformName?: unknown;
  strategy?: string;
}

/** A stored row as the stores answer it: `selector` is its key. */
export interface StoredFingerprint {
  selector: string;
  strategy?: string;
  nodeName?: string;
  [field: string]: unknown;
}

/**
 * Whether a legacy row serves a session of this platform and strategy: its
 * type is the platform's, and it was learnt under the same strategy (an empty
 * one on either side doesn't say otherwise).
 */
export function legacyServes(
  row: Pick<StoredFingerprint, 'strategy' | 'nodeName'>,
  family: PlatformFamily,
  strategy: string,
): boolean {
  if (typeFamilyOf(row.nodeName) !== family) return false;
  return !strategy || !row.strategy || row.strategy === strategy;
}

/** The keys a reader of this platform and strategy may be served from, its own first. */
export function readKeys(family: PlatformFamily, strategy: string, selector: string): string[] {
  return [fingerprintKey(family, strategy, selector), selector];
}

/**
 * The fingerprint a session of `family` reads for a find of `strategy` and
 * `selector`, from the rows stored under `readKeys`: its own, else a legacy
 * row that serves it.
 */
export function chooseFingerprint<T extends StoredFingerprint>(
  rows: T[],
  family: PlatformFamily,
  strategy: string,
  selector: string,
): T | null {
  const own = fingerprintKey(family, strategy, selector);
  const mine = rows.find((row) => row?.selector === own);
  if (mine) return mine;
  const legacy = rows.find((row) => row?.selector === selector);
  return legacy && legacyServes(legacy, family, strategy) ? legacy : null;
}

/** Whether a stored key is one of `selector`'s: its bare row or a platform's. */
export function isKeyOfSelector(key: unknown, selector: string): boolean {
  if (typeof key !== 'string') return false;
  return key === selector || parseFingerprintKey(key)?.selector === selector;
}
