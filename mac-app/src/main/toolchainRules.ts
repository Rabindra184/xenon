import path from 'node:path';

// Pure decision logic behind the toolchain checks. Deliberately free of any
// electron / fs / spawn dependency so it stays unit-testable — the IO lives in
// env.ts and ToolchainInspector.

/**
 * Size of the plugin's WDA port pool. Mirrors `wda: [8100, 8199]` in
 * src/services/PortAllocator.ts — one port per discovered simulator, so a host
 * with more simulators than this fails iOS discovery with
 * "Port range for purpose 'wda' is exhausted".
 */
export const WDA_POOL_SIZE = 100;
export const WDA_POOL_RANGE = '8100-8199';

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

/** Relative path proving a given APPIUM_HOME has the Xenon plugin installed. */
export const PLUGIN_MARKER = ['node_modules', 'xenon'];

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

export interface WdaPressureInput {
  /** Profile's `platform` setting. */
  platform: string | undefined;
  /** Simulators simctl reports as available. */
  availableSimulators: number;
  /** Profile's `bootedSimulators` setting. */
  bootedSimulators: boolean;
  /** Length of the profile's `simulators` allow-list. */
  simulatorAllowListCount: number;
}

export interface RuleVerdict {
  status: 'ok' | 'warn';
  detail: string;
  remediation?: string;
}

const REMEDIATION =
  `Enable "Booted Simulators" (bootedSimulators), or list only the simulators you need under "Simulators" — ` +
  `otherwise iOS discovery fails with "Port range for purpose 'wda' is exhausted".`;

/**
 * Xenon leases one WDA port per discovered simulator, so a host with more
 * simulators than the pool can hold breaks iOS discovery before any test runs.
 * Never blocking: the server still starts and Android is unaffected.
 */
export function assessWdaPressure(input: WdaPressureInput): RuleVerdict {
  const { platform, availableSimulators, bootedSimulators, simulatorAllowListCount } = input;

  if (platform === 'android') {
    return { status: 'ok', detail: 'Not applicable — Android-only profile.' };
  }
  if (bootedSimulators) {
    return {
      status: 'ok',
      detail: `Booted-only discovery: ports are leased per booted simulator (pool ${WDA_POOL_RANGE}).`
    };
  }
  if (simulatorAllowListCount > 0) {
    return simulatorAllowListCount > WDA_POOL_SIZE
      ? {
          status: 'warn',
          detail: `The simulators allow-list has ${simulatorAllowListCount} entries, over the ${WDA_POOL_SIZE}-port WDA pool (${WDA_POOL_RANGE}).`,
          remediation: REMEDIATION
        }
      : {
          status: 'ok',
          detail: `Allow-list of ${simulatorAllowListCount} simulator(s) fits the ${WDA_POOL_SIZE}-port WDA pool.`
        };
  }
  if (availableSimulators > WDA_POOL_SIZE) {
    return {
      status: 'warn',
      detail: `${availableSimulators} available simulators exceed the ${WDA_POOL_SIZE}-port WDA pool (${WDA_POOL_RANGE}).`,
      remediation: REMEDIATION
    };
  }
  return {
    status: 'ok',
    detail: `${availableSimulators} available simulator(s) fit the ${WDA_POOL_SIZE}-port WDA pool.`
  };
}
