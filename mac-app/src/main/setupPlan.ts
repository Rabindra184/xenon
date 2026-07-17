/**
 * Pure planning logic for first-run / on-demand provisioning.
 *
 * Kept free of IO so it can be unit-tested: given the current install state and
 * the requested source, it decides which `appium` sub-commands to run. The
 * IO (spawning appium, parsing `--json`) lives in SetupService.
 */

/** Appium plugin *name* (as registered in the extensions manifest). */
export const PLUGIN_NAME = 'xenon';
/** npm package that provides the plugin. */
export const NPM_PLUGIN = '@xenon-device-management/xenon';

export interface PluginPlanInput {
  /**
   * The registered name of our plugin if it is already installed (e.g. 'xenon'),
   * or null if it is not installed. Detected by matching the package name, so
   * unrelated plugins never trigger the update path.
   */
  installedName: string | null;
  /** Source the caller asked for. */
  pluginSource: 'local' | 'npm';
  /** Local repo root, or null when not running from a source checkout. */
  repoRoot: string | null;
}

export interface SetupStep {
  /** Progress label surfaced to the renderer. */
  step: string;
  /** argv passed to the `appium` binary. */
  args: string[];
}

export interface PluginPlan {
  /** The source actually used after fallback resolution. */
  effectiveSource: 'local' | 'npm';
  /** True when 'local' was requested but no repo was found, so we used npm. */
  fallbackToNpm: boolean;
  /** Ordered appium sub-commands to run for the plugin phase. */
  steps: SetupStep[];
}

/**
 * Decide how to install/update the plugin.
 *
 * - Fixes F2: a packaged app has no local repo, so `local` transparently falls
 *   back to `npm` instead of hard-failing with "local repo not found".
 * - Fixes F3: when the plugin is already installed we `plugin update` (npm) or
 *   uninstall+reinstall (local) instead of a bare `plugin install`, which errors
 *   on an already-installed plugin.
 */
export function planPluginSteps(input: PluginPlanInput): PluginPlan {
  const installed = input.installedName !== null;
  const name = input.installedName ?? PLUGIN_NAME;
  const canUseLocal = input.pluginSource === 'local' && input.repoRoot !== null;
  const fallbackToNpm = input.pluginSource === 'local' && input.repoRoot === null;
  const effectiveSource: 'local' | 'npm' = canUseLocal ? 'local' : 'npm';

  const steps: SetupStep[] = [];

  if (effectiveSource === 'local') {
    // `plugin install --source=local` errors if already present, so reinstall
    // the working copy: uninstall first when needed.
    if (installed) {
      steps.push({ step: 'uninstall-plugin', args: ['plugin', 'uninstall', name] });
    }
    steps.push({
      step: 'install-plugin',
      args: ['plugin', 'install', '--source=local', input.repoRoot as string],
    });
  } else if (installed) {
    steps.push({ step: 'update-plugin', args: ['plugin', 'update', name] });
  } else {
    steps.push({ step: 'install-plugin', args: ['plugin', 'install', '--source=npm', NPM_PLUGIN] });
  }

  return { effectiveSource, fallbackToNpm, steps };
}

/**
 * Split requested drivers into those that still need installing vs. those
 * already present. `appium driver install <name>` errors on an installed
 * driver, so the already-installed ones must be skipped for the button to
 * succeed end-to-end.
 */
export function partitionDrivers(
  requested: string[],
  installed: string[],
): { toInstall: string[]; skip: string[] } {
  const installedSet = new Set(installed);
  return {
    toInstall: requested.filter((d) => !installedSet.has(d)),
    skip: requested.filter((d) => installedSet.has(d)),
  };
}
