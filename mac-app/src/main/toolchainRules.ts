import path from 'node:path';
import { NPM_PLUGIN } from './setupPlan';

// Pure decision logic behind the toolchain checks. Deliberately free of any
// electron / fs / spawn dependency so it stays unit-testable — the IO lives in
// env.ts and ToolchainInspector.

/**
 * Node versions Appium 3.x accepts, mirrored from its `package.json` `engines`
 * field: `"^20.19.0 || ^22.12.0 || >=24.0.0"`. Odd-numbered (non-LTS) majors
 * such as 21 and 23 are excluded, as are 20.0–20.18 and 22.0–22.11.
 *
 * Kept here as a pure, unit-tested predicate rather than a bare `major >= 18`
 * inline in ToolchainInspector: that older check went green on Node 23.x (and
 * 18.x/21.x/older 20.x/22.x), which Appium then refuses to start on — the hub
 * dies at launch with "Node version must be at least ^20.19.0 || ^22.12.0 ||
 * >=24.0.0", turning a green preflight into a confusing runtime crash.
 */
export const APPIUM_NODE_RANGE = '^20.19 || ^22.12 || >=24';

export function nodeSatisfiesAppium(version: string): boolean {
  const [maj, min] = version.replace(/^v/, '').split('.').map(Number);
  if (!Number.isFinite(maj) || !Number.isFinite(min)) return false;
  return (maj === 20 && min >= 19) || (maj === 22 && min >= 12) || maj >= 24;
}

/** Oldest Appium this Xenon release runs on. */
export const XENON_APPIUM_MIN = '3.1.1';

export function appiumSatisfiesXenon(version: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
  const have = parse(version);
  const min = parse(XENON_APPIUM_MIN);
  if (have.length < 3 || !have.every(Number.isFinite)) return false;
  for (let i = 0; i < 3; i++) {
    if (have[i] !== min[i]) return have[i] > min[i];
  }
  return true;
}

/** Marker prefix used to pull variables back out of a login-shell invocation. */
export const SHELL_VAR_PREFIX = '__XENON_';

/** Parse `__XENON_NAME__:value` lines out of noisy login-shell output. */
export function parseShellVars(stdout: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = new RegExp(`^${SHELL_VAR_PREFIX}([A-Z_]+)__:(.*)$`, 'gm');
  for (const m of stdout.matchAll(re)) {
    const value = m[2].trim();
    if (value) out[m[1]] = value;
  }
  return out;
}

export interface AndroidHomeInput {
  /** $ANDROID_HOME, from the login shell or the process env. */
  androidHome?: string;
  /** $ANDROID_SDK_ROOT, same sources. */
  sdkRoot?: string;
  /** Absolute path to adb, if one was resolved on PATH. */
  adbPath?: string | null;
  /** Conventional SDK location, passed in only if it exists on disk. */
  defaultSdkDir?: string | null;
}

const clean = (v?: string): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

/**
 * Resolve the Android SDK root.
 *
 * A macOS GUI app inherits neither the user's shell exports nor their PATH, and
 * plenty of working setups never export ANDROID_HOME at all — adb is simply on
 * PATH. Since adb lives at `<sdk>/platform-tools/adb`, its location tells us the
 * SDK root, so the launcher can inject the variable instead of asking the user
 * to go set it.
 */
export function deriveAndroidHome(input: AndroidHomeInput): string | null {
  const explicit = clean(input.androidHome) ?? clean(input.sdkRoot);
  if (explicit) return explicit;

  const adb = clean(input.adbPath ?? undefined);
  if (adb) {
    const toolsDir = path.dirname(adb);
    // Only trust adb's location when it sits in the SDK's platform-tools dir;
    // a shim on PATH (e.g. /opt/homebrew/bin/adb) says nothing about the root.
    if (path.basename(toolsDir) === 'platform-tools') return path.dirname(toolsDir);
  }

  return clean(input.defaultSdkDir ?? undefined);
}

/**
 * Relative path proving a given APPIUM_HOME has the Xenon plugin installed.
 *
 * Derived from NPM_PLUGIN so the probe can never drift from the package we
 * actually install. This previously hard-coded the *unscoped* `node_modules/
 * xenon`, which is a different, unrelated public npm package — older setups can
 * leave one behind. That made the probe wrong in both directions: a home holding
 * only the real scoped install was reported as having no plugin, while a home
 * holding only the stale unscoped leftover was reported as having one. Because
 * pickAppiumHome returns the first candidate whose `hasPlugin` is true, that
 * decided which APPIUM_HOME the server launched from — i.e. potentially an older
 * plugin build than the one just installed.
 *
 * Deliberately does NOT also accept the legacy unscoped path: doing so would
 * preserve the false positive this fixes.
 */
export const PLUGIN_MARKER = ['node_modules', NPM_PLUGIN];

/** Absolute path whose existence proves `home` has the Xenon plugin installed. */
export function pluginMarkerPath(home: string): string {
  return path.join(home, ...PLUGIN_MARKER);
}

export type AppiumHomeSource = 'profile' | 'env' | 'app-managed' | 'convention' | 'fallback';

export interface AppiumHomeCandidate {
  path: string;
  /** Cheap filesystem probe — preflight still does the authoritative check. */
  hasPlugin: boolean;
  source: Exclude<AppiumHomeSource, 'profile' | 'fallback'>;
}

/**
 * Choose the APPIUM_HOME a profile launches against.
 *
 * A profile stores '' for "auto" rather than a resolved path: profiles are
 * exportable, so baking one machine's home into it would break the next one.
 * Auto therefore means "the first home that actually has the plugin", which is
 * what makes a fresh profile start on a host that's already set up.
 */
export function pickAppiumHome(input: {
  override?: string;
  candidates: AppiumHomeCandidate[];
  fallback: string;
}): { path: string; source: AppiumHomeSource } {
  const override = input.override?.trim();
  if (override) return { path: override, source: 'profile' };

  const installed = input.candidates.find((c) => c.hasPlugin);
  if (installed) return { path: installed.path, source: installed.source };

  // Nothing is set up yet — the app-managed home is where first-run setup installs.
  return { path: input.fallback, source: 'fallback' };
}

export interface RuleVerdict {
  status: 'ok' | 'warn';
  detail: string;
  remediation?: string;
}

export interface IphoneSupportInput {
  /** Profile's `platform` setting. */
  platform: string | undefined;
  /** Whether go-ios is present in Xenon's cache. */
  binaryExists: boolean;
  /** Version recorded next to the go-ios binary, or null if there is no record. */
  installedVersion: string | null;
  /** go-ios version the installed plugin expects, or null if it can't be read. */
  pinnedVersion: string | null;
}

/**
 * Whether iPhones can be driven: go-ios must be installed, and the version
 * Xenon pins matters — an older go-ios lets WebDriverAgent die minutes into a
 * run. Setup installs it, so the remedy is always "run Set up". Never blocking:
 * the server starts and Android is unaffected.
 */
export function assessIphoneSupport(input: IphoneSupportInput): RuleVerdict {
  const { platform, binaryExists, installedVersion, pinnedVersion } = input;

  if (platform === 'android') {
    return { status: 'ok', detail: 'Not needed for Android-only profiles.' };
  }
  if (!binaryExists) {
    return {
      status: 'warn',
      detail: 'Not installed yet',
      remediation: "iPhones won't work until setup finishes. Run Set up on this tab."
    };
  }
  const installed = installedVersion?.trim() || null;
  if (pinnedVersion && installed !== pinnedVersion) {
    return {
      status: 'warn',
      detail: `${installed ? `go-ios ${installed}` : 'go-ios (unknown version)'}, Xenon expects ${pinnedVersion}`,
      remediation: 'Xenon was updated. Run Set up again to update iPhone support.'
    };
  }
  return { status: 'ok', detail: pinnedVersion ? `Ready for iPhones (go-ios ${pinnedVersion})` : 'Ready for iPhones' };
}
