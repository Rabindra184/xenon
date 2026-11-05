import fs from 'fs';
import path from 'path';
import { cachePath } from '../../helpers';
import { GO_IOS_VERSION } from '../../scripts/goIosVersion';

/**
 * The go-ios binary that ships with the plugin, beside this module.
 * scripts/fetch-go-ios.js takes it out of the pinned go-ios package at build
 * time, checked against its SHA-256, and build:copy ships it under lib/: from
 * src/ under ts-node this is the fetched copy, from lib/ the shipped one.
 * Every go-ios command Xenon runs uses this one path. The reaps find go-ios
 * processes by it, and the start's also by the legacy path.
 */
export function goIosBinaryPath(): string {
  return path.join(__dirname, 'vendor', 'go-ios', 'ios');
}

/**
 * Where src/scripts/install-go-ios.ts put go-ios before 2.18. Nothing runs it:
 * only the start's reap looks there, for go-ios an older Xenon left running.
 * Kept until 3.0.
 */
export function legacyGoIosBinaryPath(): string {
  return path.join(cachePath('goIOS'), 'ios');
}

/** Whether go-ios can run here. */
export type GoIosBinaryState = 'ok' | 'not-mac' | 'missing' | 'not-executable';

export interface GoIosCheckDeps {
  platform: NodeJS.Platform;
  exists(p: string): boolean;
  isExecutable(p: string): boolean;
  makeExecutable(p: string): void;
}

function systemDeps(): GoIosCheckDeps {
  return {
    platform: process.platform,
    exists: (p) => fs.existsSync(p),
    isExecutable: (p) => {
      try {
        fs.accessSync(p, fs.constants.X_OK);
        return true;
      } catch {
        return false;
      }
    },
    makeExecutable: (p) => fs.chmodSync(p, 0o755),
  };
}

/**
 * Whether the go-ios at `binaryPath` can run here.
 *
 * - `not-mac` off macOS, without looking at the file: it is a Mac build, so
 *   on Linux it would fail to run rather than be missing.
 * - `missing` when the file isn't there.
 * - `not-executable` when it isn't executable and one `chmod 0755` doesn't
 *   make it so (an install that dropped the mode, in a folder the server
 *   can't write).
 */
export function checkGoIosBinary(
  binaryPath: string,
  deps: GoIosCheckDeps = systemDeps(),
): GoIosBinaryState {
  if (deps.platform !== 'darwin') return 'not-mac';
  if (!deps.exists(binaryPath)) return 'missing';
  if (deps.isExecutable(binaryPath)) return 'ok';
  try {
    deps.makeExecutable(binaryPath);
  } catch {
    // Judged by the check below.
  }
  return deps.isExecutable(binaryPath) ? 'ok' : 'not-executable';
}

/** What Xenon says when go-ios can't run here. */
export function goIosStateMessage(
  state: Exclude<GoIosBinaryState, 'ok'>,
  binaryPath: string,
): string {
  switch (state) {
    case 'missing':
      return `go-ios is missing from this Xenon install (${binaryPath}). Reinstall the plugin.`;
    case 'not-executable':
      return `go-ios at ${binaryPath} can't be run and couldn't be made executable. Reinstall the plugin.`;
    case 'not-mac':
      return 'go-ios comes with Xenon for macOS only. iPhones need a Mac.';
  }
}

/**
 * The line the start logs about go-ios: on a Mac whose `platform` option is
 * `ios` or `both` (any case), which go-ios it runs, or why it can't. Nothing
 * for Android alone, or off macOS.
 */
export function goIosStartupReport(
  platformArg: unknown,
  state: GoIosBinaryState,
  binaryPath: string,
): { level: 'info' | 'warn'; message: string } | null {
  const platform = String(platformArg).toLowerCase();
  if (platform !== 'ios' && platform !== 'both') return null;
  if (state === 'not-mac') return null;
  if (state === 'ok') {
    return { level: 'info', message: `go-ios ${GO_IOS_VERSION} (comes with Xenon): ${binaryPath}` };
  }
  return { level: 'warn', message: goIosStateMessage(state, binaryPath) };
}
