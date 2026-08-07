/**
 * Pinned go-ios version and the install/upgrade decision.
 *
 * Why the pin matters: go-ios **v1.0.134** does not keep the iOS 17+/26 XCTest
 * session alive. WebDriverAgent launched via `runwda` is terminated by the OS a
 * few minutes later, while the host-side `runwda` process stays alive with
 * `exitCode === null` and logs nothing — so it presents as a WDA "hang" that
 * nothing detects. Measured on iOS 26.5.2 against an identical WDA 11.4.1
 * build (issue #187):
 *
 *   go-ios v1.0.134  -> WDA died at 2m51s
 *   xcodebuild        -> WDA alive at 11m+   (i.e. not WDA's fault)
 *   go-ios v1.2.1     -> WDA alive at 12m+
 *
 * Kept free of fs/network so the decision is unit-testable; install-go-ios.ts
 * supplies the real filesystem state.
 */

/** The go-ios release Xenon installs. Do not lower below v1.2.1 — see above. */
export const GO_IOS_VERSION = 'v1.2.1';

/** File recording which version currently sits in the cache directory. */
export const GO_IOS_VERSION_FILE = '.go-ios-version';

export function goIOSDownloadUrl(platform: string, version: string = GO_IOS_VERSION): string {
  return `https://github.com/danielpaulus/go-ios/releases/download/${version}/go-ios-${platform}.zip`;
}

/**
 * Whether go-ios must be (re)installed.
 *
 * The previous implementation keyed its cache on an unversioned zip filename,
 * so once anything was installed it never downloaded again — a version bump
 * would silently never reach existing machines. Comparing the recorded version
 * against the pin makes upgrades actually happen.
 *
 * @param installedVersion contents of GO_IOS_VERSION_FILE, or null when absent.
 */
export function needsGoIOSInstall(input: {
  binaryExists: boolean;
  installedVersion: string | null;
  expectedVersion?: string;
}): boolean {
  const expected = input.expectedVersion ?? GO_IOS_VERSION;
  if (!input.binaryExists) return true;
  if (!input.installedVersion) return true;
  return input.installedVersion.trim() !== expected;
}
