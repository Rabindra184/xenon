import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import net from 'node:net';
import path from 'node:path';
import { existsSync } from 'node:fs';
import type { PreflightResult, Profile, ToolCheck } from '@shared/types';
import { buildEnv, resolveAndroidHome, which } from './env';
import { assessWdaPressure } from './toolchainRules';
import { xenonCacheDir } from './paths';

const execFileAsync = promisify(execFile);

async function run(cmd: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  try {
    const env = await buildEnv();
    const { stdout, stderr } = await execFileAsync(cmd, args, { env, timeout: 15000, encoding: 'utf8' });
    return { ok: true, out: (stdout || stderr).trim() };
  } catch (err) {
    return { ok: false, out: err instanceof Error ? err.message : String(err) };
  }
}

/** Inspects the host toolchain Xenon depends on and reports actionable status. */
export class ToolchainInspector {
  /** `profile` enables the checks whose verdict depends on profile settings. */
  async checkAll(profile?: Profile): Promise<ToolCheck[]> {
    return Promise.all([
      this.checkNode(),
      this.checkAppium(),
      this.checkDrivers(),
      this.checkAdb(),
      this.checkXcode(),
      this.checkGoIos(),
      this.checkSimulatorPorts(profile)
    ]);
  }

  private async checkNode(): Promise<ToolCheck> {
    const bin = await which('node');
    if (!bin) {
      return {
        id: 'node',
        label: 'Node.js',
        status: 'missing',
        detail: 'node not found on PATH',
        blocking: true,
        remediation: 'Install Node.js ≥ 18 (e.g. via Homebrew: brew install node).'
      };
    }
    const { out } = await run(bin, ['-v']);
    const major = Number(out.replace(/^v/, '').split('.')[0]);
    const ok = Number.isFinite(major) && major >= 18;
    return {
      id: 'node',
      label: 'Node.js',
      status: ok ? 'ok' : 'warn',
      detail: out,
      blocking: !ok,
      remediation: ok ? undefined : 'Xenon requires Node ≥ 18. Upgrade your Node runtime.'
    };
  }

  private async checkAppium(): Promise<ToolCheck> {
    const bin = await which('appium');
    if (!bin) {
      return {
        id: 'appium',
        label: 'Appium',
        status: 'missing',
        detail: 'appium not found on PATH',
        blocking: true,
        remediation: 'Install Appium 3: npm i -g appium'
      };
    }
    const { ok, out } = await run(bin, ['-v']);
    const major = Number(out.split('.')[0]);
    const good = ok && Number.isFinite(major) && major >= 3;
    return {
      id: 'appium',
      label: 'Appium',
      status: good ? 'ok' : 'warn',
      detail: out,
      blocking: !good,
      remediation: good ? undefined : 'Xenon targets Appium 3.x. Run: npm i -g appium@latest'
    };
  }

  private async checkDrivers(): Promise<ToolCheck> {
    const bin = await which('appium');
    if (!bin) {
      return { id: 'drivers', label: 'Appium drivers', status: 'missing', detail: 'appium not available', blocking: false };
    }
    const { ok, out } = await run(bin, ['driver', 'list', '--installed']);
    if (!ok) {
      return {
        id: 'drivers',
        label: 'Appium drivers',
        status: 'warn',
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
        detail: 'adb not found and no Android SDK detected',
        blocking: false,
        remediation:
          'Only needed for local Android devices. Install the Android SDK (Android Studio) — Xenon finds it automatically at ~/Library/Android/sdk or via adb on your PATH.'
      };
    }
    const { out } = await run(bin, ['version']);
    const version = out.split('\n')[0] || 'adb present';
    if (!androidHome) {
      // adb works, but the plugin's discovery reads ANDROID_HOME directly and we
      // could not resolve a root to inject — Android discovery will fail.
      return {
        id: 'adb',
        label: 'Android SDK (adb)',
        status: 'warn',
        detail: `${version} — but no SDK root could be resolved`,
        blocking: false,
        remediation:
          'adb is on PATH but its SDK root is unknown, so ANDROID_HOME cannot be injected and Android discovery will fail. Set ANDROID_HOME in this profile’s environment variables (Secrets & Env).'
      };
    }
    return {
      id: 'adb',
      label: 'Android SDK (adb)',
      status: 'ok',
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
        detail: 'xcodebuild not found',
        blocking: false,
        remediation: 'Only needed for iOS. Install Xcode and run xcode-select --install.'
      };
    }
    const { out } = await run(bin, ['-version']);
    return { id: 'xcode', label: 'Xcode', status: 'ok', detail: out.split('\n')[0] || 'xcode present', blocking: false };
  }

  private async checkGoIos(): Promise<ToolCheck> {
    const goIos = path.join(xenonCacheDir(), 'goIOS', 'ios');
    const present = existsSync(goIos);
    return {
      id: 'go-ios',
      label: 'go-ios (auto-provisioned)',
      status: present ? 'ok' : 'warn',
      detail: present ? goIos : 'not yet downloaded',
      blocking: false,
      remediation: present ? undefined : 'Xenon downloads go-ios into ~/.cache/xenon on first iOS use — no action needed.'
    };
  }

  /**
   * Xenon leases one WDA port per discovered simulator from a fixed pool, so a
   * host with more simulators than the pool holds breaks iOS discovery before a
   * test ever runs. Profile-dependent: the fix is a setting, not an install.
   */
  private async checkSimulatorPorts(profile?: Profile): Promise<ToolCheck> {
    const label = 'Simulator / WDA ports';
    const xcrun = await which('xcrun');
    if (!xcrun) {
      return { id: 'wda-ports', label, status: 'ok', detail: 'Not applicable — Xcode not installed.', blocking: false };
    }

    const { ok, out } = await run(xcrun, ['simctl', 'list', 'devices', 'available', '--json']);
    if (!ok) {
      return {
        id: 'wda-ports',
        label,
        status: 'warn',
        detail: 'could not list simulators',
        blocking: false,
        remediation: 'Run `xcrun simctl list devices available` to check your Xcode command-line tools.'
      };
    }

    let available = 0;
    try {
      const parsed = JSON.parse(out) as { devices?: Record<string, Array<{ isAvailable?: boolean }>> };
      for (const list of Object.values(parsed.devices ?? {})) {
        available += list.filter((d) => d.isAvailable !== false).length;
      }
    } catch {
      return { id: 'wda-ports', label, status: 'warn', detail: 'could not parse simctl output', blocking: false };
    }

    const settings = profile?.settings ?? {};
    const verdict = assessWdaPressure({
      platform: settings.platform as string | undefined,
      availableSimulators: available,
      bootedSimulators: settings.bootedSimulators === true,
      simulatorAllowListCount: Array.isArray(settings.simulators) ? settings.simulators.length : 0
    });

    return { id: 'wda-ports', label, ...verdict, blocking: false };
  }

  /** Whether the xenon plugin is installed into a given APPIUM_HOME. */
  async isPluginInstalled(appiumHome: string): Promise<boolean> {
    const bin = await which('appium');
    if (!bin) return false;
    try {
      const env = await buildEnv({ APPIUM_HOME: appiumHome });
      const { stdout, stderr } = await execFileAsync(bin, ['plugin', 'list', '--installed'], {
        env,
        timeout: 20000,
        encoding: 'utf8'
      });
      return /xenon/i.test(stdout + stderr);
    } catch {
      return false;
    }
  }

  private portInUse(port: number, host = '127.0.0.1'): Promise<boolean> {
    return new Promise((resolve) => {
      const tester = net
        .createServer()
        .once('error', (err: NodeJS.ErrnoException) => resolve(err.code === 'EADDRINUSE'))
        .once('listening', () => tester.close(() => resolve(false)))
        .listen(port, host);
    });
  }

  /** Full pre-launch gate: toolchain + port + plugin-installed. */
  async preflight(profile: Profile, appiumHome: string): Promise<PreflightResult> {
    const checks = await this.checkAll(profile);
    const blockers: string[] = [];

    if (await this.portInUse(profile.server.port)) {
      blockers.push(`Port ${profile.server.port} is already in use. Choose another port or stop the process using it.`);
    }
    if (!(await this.isPluginInstalled(appiumHome))) {
      blockers.push('The xenon plugin is not installed in this APPIUM_HOME. Run first-run setup to install it.');
    }

    const blockingCheck = checks.some((c) => c.blocking && c.status !== 'ok');
    return { ok: !blockingCheck && blockers.length === 0, checks, blockers };
  }
}
