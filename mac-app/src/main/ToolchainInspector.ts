import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import net from 'node:net';
import path from 'node:path';
import { existsSync } from 'node:fs';
import type { PreflightResult, Profile, ToolCheck } from '@shared/types';
import { buildEnv, which } from './env';
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
  async checkAll(): Promise<ToolCheck[]> {
    return Promise.all([
      this.checkNode(),
      this.checkAppium(),
      this.checkDrivers(),
      this.checkAdb(),
      this.checkXcode(),
      this.checkGoIos()
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
    const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
    const bin = (await which('adb')) || (androidHome ? path.join(androidHome, 'platform-tools', 'adb') : null);
    if (!bin || !existsSync(bin)) {
      return {
        id: 'adb',
        label: 'Android SDK (adb)',
        status: 'warn',
        detail: 'adb not found / ANDROID_HOME unset',
        blocking: false,
        remediation: 'Only needed for Android. Install the Android SDK and set ANDROID_HOME.'
      };
    }
    const { out } = await run(bin, ['version']);
    return { id: 'adb', label: 'Android SDK (adb)', status: 'ok', detail: out.split('\n')[0] || 'adb present', blocking: false };
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
    const checks = await this.checkAll();
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
