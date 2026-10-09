import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import type { PreflightResult, Profile, ToolCheck } from '@shared/types';
import { NOT_INSTALLED_MESSAGE, portInUseMessage } from '@shared/preflightMessages';
import { buildEnv, resolveAndroidHome, which } from './env';
import {
  APPIUM_NODE_RANGE,
  XENON_APPIUM_MIN,
  appiumPrintedVersion,
  appiumSatisfiesXenon,
  assessIphoneSupport,
  firstUsefulLine,
  nodeSatisfiesAppium
} from './toolchainRules';
import { xenonCacheDir } from './paths';
import { installedPluginDir } from './installedPluginVersion';
import { loadGoIosPin } from './goIosPin';
import { parseExtensionList, xenonPluginName } from './setupPlan';
import { isPortInUse } from './portProbe';

const execFileAsync = promisify(execFile);

const ADB_REMEDIATION =
  'Only needed for local Android devices. Install the Android SDK (Android Studio) — Xenon finds it automatically at ~/Library/Android/sdk or via adb on your PATH.';
const XCODE_REMEDIATION = 'Only needed for iOS. Install Xcode and run xcode-select --install.';
const APPIUM_REMEDIATION = 'Install Appium 3: npm i -g appium';

/** Run a command in the corrected environment; `extraEnv` is layered on top (e.g. a profile's APPIUM_HOME). */
async function run(
  cmd: string,
  args: string[],
  extraEnv: Record<string, string> = {}
): Promise<{ ok: boolean; out: string }> {
  try {
    const env = await buildEnv(extraEnv);
    const { stdout, stderr } = await execFileAsync(cmd, args, { env, timeout: 15000, encoding: 'utf8' });
    return { ok: true, out: (stdout || stderr).trim() };
  } catch (err) {
    return { ok: false, out: err instanceof Error ? err.message : String(err) };
  }
}

/** Inspects the host toolchain Xenon depends on and reports actionable status. */
export class ToolchainInspector {
  /**
   * `profile` enables the checks whose verdict depends on profile settings;
   * `appiumHome` lets the iPhone check read the go-ios version the installed plugin pins.
   */
  async checkAll(profile?: Profile, appiumHome?: string): Promise<ToolCheck[]> {
    return Promise.all([
      this.checkNode(),
      this.checkAppium(),
      this.checkDrivers(appiumHome),
      this.checkAdb(),
      this.checkXcode(),
      this.checkGoIos(profile, appiumHome)
    ]);
  }

  private async checkNode(): Promise<ToolCheck> {
    const bin = await which('node');
    if (!bin) {
      return {
        id: 'node',
        label: 'Node.js',
        status: 'missing',
        code: 'missing',
        detail: 'node not found on PATH',
        blocking: true,
        remediation: `Install Node.js — Appium 3.x needs ${APPIUM_NODE_RANGE} (e.g. via Homebrew: brew install node).`
      };
    }
    const { out } = await run(bin, ['-v']);
    const ok = nodeSatisfiesAppium(out);
    return {
      id: 'node',
      label: 'Node.js',
      status: ok ? 'ok' : 'warn',
      code: ok ? 'ok' : 'unsupported',
      detail: out,
      blocking: !ok,
      remediation: ok
        ? undefined
        : `Appium 3.x requires Node ${APPIUM_NODE_RANGE} (even-numbered LTS lines). ` +
          `Odd majors like 21/23 and older 20.x/22.x are rejected at hub startup — upgrade or switch your Node runtime (e.g. brew install node).`
    };
  }

  private async checkAppium(): Promise<ToolCheck> {
    const bin = await which('appium');
    if (!bin) {
      return {
        id: 'appium',
        label: 'Appium',
        status: 'missing',
        code: 'missing',
        detail: 'appium not found on PATH',
        blocking: true,
        remediation: APPIUM_REMEDIATION
      };
    }
    const { ok, out } = await run(bin, ['-v']);
    if (!ok || !appiumPrintedVersion(out)) {
      // It is there but would not say its version (it crashed, or printed an error): that is no
      // verdict on the version, so not "too old" (R32). No working Appium, as if it were missing.
      return {
        id: 'appium',
        label: 'Appium',
        status: 'warn',
        code: 'missing',
        detail: firstUsefulLine(out, ok ? 'appium -v printed no version' : 'appium -v failed'),
        blocking: true,
        remediation: APPIUM_REMEDIATION
      };
    }
    const good = appiumSatisfiesXenon(out);
    return {
      id: 'appium',
      label: 'Appium',
      status: good ? 'ok' : 'warn',
      code: good ? 'ok' : 'unsupported',
      detail: out,
      blocking: !good,
      remediation: good ? undefined : `Xenon needs Appium ${XENON_APPIUM_MIN} or newer.`
    };
  }

  /**
   * Drivers live inside an Appium folder, so ask the one this profile uses: the
   * folder Set up installs into and Start launches from, not whatever the app's
   * own environment happens to name.
   */
  private async checkDrivers(appiumHome?: string): Promise<ToolCheck> {
    const bin = await which('appium');
    if (!bin) {
      return {
        id: 'drivers',
        label: 'Appium drivers',
        status: 'missing',
        code: 'missing',
        detail: 'appium not available',
        blocking: false
      };
    }
    const { ok, out } = await run(bin, ['driver', 'list', '--installed'], appiumHome ? { APPIUM_HOME: appiumHome } : {});
    if (!ok) {
      return {
        id: 'drivers',
        label: 'Appium drivers',
        status: 'warn',
        code: 'list-failed',
        detail: 'could not list drivers',
        blocking: false,
        remediation: 'Install drivers: appium driver install uiautomator2 && appium driver install xcuitest'
      };
    }
    const hasU2 = /uiautomator2/i.test(out);
    const hasXc = /xcuitest/i.test(out);
    const found = [hasU2 ? 'uiautomator2' : null, hasXc ? 'xcuitest' : null].filter(Boolean).join(', ') || 'none';
    return {
      id: 'drivers',
      label: 'Appium drivers',
      status: hasU2 || hasXc ? 'ok' : 'warn',
      // The list was read, so the code is ok even when it holds no driver: the detail says which.
      code: 'ok',
      detail: `installed: ${found}`,
      blocking: false,
      remediation:
        hasU2 && hasXc
          ? undefined
          : 'Install the platform drivers you need: appium driver install uiautomator2 (Android) / xcuitest (iOS).'
    };
  }

  private async checkAdb(): Promise<ToolCheck> {
    const androidHome = await resolveAndroidHome();
    const bin = (await which('adb')) || (androidHome ? path.join(androidHome, 'platform-tools', 'adb') : null);
    if (!bin || !existsSync(bin)) {
      return {
        id: 'adb',
        label: 'Android SDK (adb)',
        status: 'warn',
        code: 'missing',
        detail: 'adb not found and no Android SDK detected',
        blocking: false,
        remediation: ADB_REMEDIATION
      };
    }
    const { ok, out } = await run(bin, ['version']);
    if (!ok) {
      // An adb that is there but will not run is no Android tools at all (R30).
      return {
        id: 'adb',
        label: 'Android SDK (adb)',
        status: 'warn',
        code: 'missing',
        detail: firstUsefulLine(out, 'adb version failed'),
        blocking: false,
        remediation: ADB_REMEDIATION
      };
    }
    const version = out.split('\n')[0] || 'adb present';
    if (!androidHome) {
      // adb works, but the plugin's discovery reads ANDROID_HOME directly and we
      // could not resolve a root to inject — Android discovery will fail.
      return {
        id: 'adb',
        label: 'Android SDK (adb)',
        status: 'warn',
        code: 'no-sdk-root',
        detail: `${version} — but no SDK root could be resolved`,
        blocking: false,
        remediation:
          'adb is on PATH but its SDK root is unknown, so ANDROID_HOME cannot be injected and Android discovery will fail. Set ANDROID_HOME in this profile’s environment variables (Settings, with technical details on: Environment variables).'
      };
    }
    return {
      id: 'adb',
      label: 'Android SDK (adb)',
      status: 'ok',
      code: 'ok',
      detail: `${version} — ANDROID_HOME=${androidHome}`,
      blocking: false
    };
  }

  private async checkXcode(): Promise<ToolCheck> {
    const bin = await which('xcodebuild');
    if (!bin) {
      return {
        id: 'xcode',
        label: 'Xcode',
        status: 'warn',
        code: 'missing',
        detail: 'xcodebuild not found',
        blocking: false,
        remediation: XCODE_REMEDIATION
      };
    }
    const { ok, out } = await run(bin, ['-version']);
    if (!ok) {
      // /usr/bin/xcodebuild is a macOS shim that is always on the PATH. With only the Command Line
      // Tools (no Xcode) it fails, which is not ready (R30): what it said is the detail.
      return {
        id: 'xcode',
        label: 'Xcode',
        status: 'warn',
        code: 'missing',
        detail: firstUsefulLine(out, 'xcodebuild -version failed'),
        blocking: false,
        remediation: XCODE_REMEDIATION
      };
    }
    return {
      id: 'xcode',
      label: 'Xcode',
      status: 'ok',
      code: 'ok',
      detail: out.split('\n')[0] || 'xcode present',
      blocking: false
    };
  }

  /**
   * go-ios drives real iPhones. The plugin's setup script installs it into the
   * cache and records the version beside it; Xenon expects the version the
   * installed plugin pins, so a stale copy from an older Xenon is flagged too.
   */
  private async checkGoIos(profile?: Profile, appiumHome?: string): Promise<ToolCheck> {
    const dir = path.join(xenonCacheDir(), 'goIOS');
    let installedVersion: string | null = null;
    try {
      installedVersion = readFileSync(path.join(dir, '.go-ios-version'), 'utf8').trim() || null;
    } catch {
      // no version record — treated as unknown
    }
    const verdict = assessIphoneSupport({
      platform: profile?.settings?.platform as string | undefined,
      binaryExists: existsSync(path.join(dir, 'ios')),
      installedVersion,
      pinnedVersion: appiumHome ? loadGoIosPin(installedPluginDir(appiumHome)) : null
    });
    return { id: 'go-ios', label: 'iPhone support', ...verdict, blocking: false };
  }

  /** Whether the xenon plugin is installed into a given APPIUM_HOME. */
  async isPluginInstalled(appiumHome: string): Promise<boolean> {
    const bin = await which('appium');
    if (!bin) return false;
    try {
      const env = await buildEnv({ APPIUM_HOME: appiumHome });
      const { stdout } = await execFileAsync(bin, ['plugin', 'list', '--installed', '--json'], {
        env,
        timeout: 20000,
        encoding: 'utf8'
      });
      return xenonPluginName(parseExtensionList(stdout)) !== null;
    } catch {
      return false;
    }
  }

  private portInUse(port: number): Promise<boolean> {
    return isPortInUse(port);
  }

  /**
   * Full pre-launch gate: toolchain + port + plugin-installed.
   *
   * `skipPortCheck` is for when this app's own server is running: it holds the
   * port, so looking would blame "another app" for it.
   */
  async preflight(
    profile: Profile,
    appiumHome: string,
    opts: { skipPortCheck?: boolean } = {}
  ): Promise<PreflightResult> {
    const checks = await this.checkAll(profile, appiumHome);
    const blockers: string[] = [];

    if (!opts.skipPortCheck && (await this.portInUse(profile.server.port))) {
      blockers.push(portInUseMessage(profile.server.port));
    }
    // Without a usable Appium there is nothing to install Xenon into, and an
    // unsupported Node makes Appium itself fail (so the plugin list says nothing
    // true either). Set up cannot be the first thing to say then: that check
    // already says what to do.
    const runtimeBlocks = checks.some((c) => (c.id === 'appium' || c.id === 'node') && c.blocking && c.status !== 'ok');
    if (!runtimeBlocks && !(await this.isPluginInstalled(appiumHome))) {
      blockers.push(NOT_INSTALLED_MESSAGE);
    }

    const blockingCheck = checks.some((c) => c.blocking && c.status !== 'ok');
    return { ok: !blockingCheck && blockers.length === 0, checks, blockers };
  }
}
