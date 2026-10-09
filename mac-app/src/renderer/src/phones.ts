import type { PreflightResult, Profile } from '@shared/types';

// Which phones a profile is for, and what the drivers check says about the
// drivers they need. Home and Setup both read these, so they live apart from
// either screen's model (setupRows reads them, and homeState reads setupRows).

export type Phones = 'android' | 'ios' | 'both';

/** Which phones a profile is for. Unset, or anything else, is both, as Xenon reads it. */
export function phonesOf(p: Profile): Phones {
  const platform = p.settings.platform;
  return platform === 'android' || platform === 'ios' ? platform : 'both';
}

/**
 * Whether the profile uses real iPhones, which need iPhone support (go-ios):
 * it is not for Android alone, and not for iOS simulators alone.
 */
export function usesRealIphones(p: Profile): boolean {
  return phonesOf(p) !== 'android' && p.settings.iosDeviceType !== 'simulated';
}

export type Driver = 'uiautomator2' | 'xcuitest';

/**
 * Whether a driver is installed, from the drivers check. Only a list the check
 * could read ("installed: uiautomator2, xcuitest", or "installed: none") can
 * say a driver is missing. Anything else ("could not list drivers", "appium not
 * available", no drivers check) tells nothing, so it is unknown: a Mac that
 * works must not be sent to first run because the listing failed.
 */
export function driverState(readiness: PreflightResult | null, driver: Driver): 'installed' | 'missing' | 'unknown' {
  const detail = readiness?.checks.find((c) => c.id === 'drivers')?.detail;
  const listed = typeof detail === 'string' ? /^installed:\s*(.*)$/i.exec(detail.trim()) : null;
  if (listed === null) return 'unknown';
  return listed[1].toLowerCase().includes(driver) ? 'installed' : 'missing';
}
