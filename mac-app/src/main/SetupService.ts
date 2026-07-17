import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { SetupProgress } from '@shared/types';
import { buildEnv, which } from './env';
import { NPM_PLUGIN, partitionDrivers, planPluginSteps } from './setupPlan';

export interface SetupOptions {
  appiumHome: string;
  /**
   * Preferred plugin source. 'local' is used only when running from a source
   * checkout; otherwise (e.g. the packaged app) it transparently falls back to
   * npm — see planPluginSteps.
   */
  pluginSource: 'local' | 'npm';
  /** Appium drivers to ensure are installed. */
  drivers: Array<'uiautomator2' | 'xcuitest'>;
}

/**
 * First-run / on-demand provisioning: installs (or updates) the xenon plugin
 * and platform drivers into a given APPIUM_HOME. Emits 'progress'
 * (SetupProgress) for each step so the renderer can show live status.
 */
export class SetupService extends EventEmitter {
  /** Best-effort path to the local repo root (present only in a source checkout). */
  private localRepoRoot(): string | null {
    // In dev, the app runs from mac-app/, so the repo root is one level up.
    const candidate = path.resolve(app.getAppPath(), '..');
    return existsSync(path.join(candidate, 'schema.json')) ? candidate : null;
  }

  private emitProgress(p: SetupProgress): void {
    this.emit('progress', p);
  }

  private runStep(step: string, bin: string, args: string[], env: NodeJS.ProcessEnv): Promise<boolean> {
    this.emitProgress({ step, done: false, ok: false, detail: `${bin} ${args.join(' ')}` });
    return new Promise((resolve) => {
      const child = spawn(bin, args, { env });
      let tail = '';
      const capture = (b: Buffer) => {
        tail = (tail + b.toString('utf8')).slice(-500);
      };
      child.stdout?.on('data', capture);
      child.stderr?.on('data', capture);
      child.on('error', (err) => {
        this.emitProgress({ step, done: true, ok: false, detail: err.message });
        resolve(false);
      });
      child.on('exit', (code) => {
        const ok = code === 0;
        this.emitProgress({ step, done: true, ok, detail: ok ? 'done' : `exit ${code}: ${tail.trim()}` });
        resolve(ok);
      });
    });
  }

  /** Run a command and collect its full stdout (used for `--json` queries). */
  private capture(bin: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string }> {
    return new Promise((resolve) => {
      const child = spawn(bin, args, { env });
      let stdout = '';
      child.stdout?.on('data', (b: Buffer) => {
        stdout += b.toString('utf8');
      });
      child.on('error', () => resolve({ code: -1, stdout }));
      child.on('exit', (code) => resolve({ code: code ?? -1, stdout }));
    });
  }

  /**
   * Parse `appium <kind> list --installed --json` into the manifest object.
   * Warnings are emitted on stderr, so stdout is (mostly) clean JSON; we still
   * slice to the outermost braces to be defensive. Returns {} on any failure.
   */
  private async listInstalled(
    kind: 'plugin' | 'driver',
    bin: string,
    env: NodeJS.ProcessEnv,
  ): Promise<Record<string, { pkgName?: string; installed?: boolean }>> {
    const { code, stdout } = await this.capture(bin, [kind, 'list', '--installed', '--json'], env);
    if (code !== 0) return {};
    const start = stdout.indexOf('{');
    const end = stdout.lastIndexOf('}');
    if (start === -1 || end === -1) return {};
    try {
      return JSON.parse(stdout.slice(start, end + 1));
    } catch {
      return {};
    }
  }

  /** Registered name of our plugin if installed (matched by package), else null. */
  private async installedPluginName(bin: string, env: NodeJS.ProcessEnv): Promise<string | null> {
    const manifest = await this.listInstalled('plugin', bin, env);
    for (const [name, info] of Object.entries(manifest)) {
      if (info?.pkgName === NPM_PLUGIN && info.installed !== false) return name;
    }
    return null;
  }

  async install(opts: SetupOptions): Promise<boolean> {
    const appiumBin = await which('appium');
    if (!appiumBin) {
      this.emitProgress({ step: 'locate-appium', done: true, ok: false, detail: 'appium not found on PATH' });
      return false;
    }
    const env = await buildEnv({ APPIUM_HOME: opts.appiumHome });

    // 1) Install or update the plugin. Falls back to npm when no local repo is
    //    present (F2) and updates rather than reinstalling when already installed (F3).
    const plan = planPluginSteps({
      installedName: await this.installedPluginName(appiumBin, env),
      pluginSource: opts.pluginSource,
      repoRoot: opts.pluginSource === 'local' ? this.localRepoRoot() : null,
    });
    if (plan.fallbackToNpm) {
      this.emitProgress({
        step: 'plugin-source',
        done: true,
        ok: true,
        detail: 'no local checkout found — installing from npm',
      });
    }
    for (const s of plan.steps) {
      const ok = await this.runStep(s.step, appiumBin, s.args, env);
      if (!ok) return false;
    }

    // 2) Install requested drivers, skipping ones already present (a bare
    //    `driver install` errors on an installed driver).
    const installedDrivers = Object.keys(await this.listInstalled('driver', appiumBin, env));
    const { toInstall, skip } = partitionDrivers(opts.drivers, installedDrivers);
    for (const driver of skip) {
      this.emitProgress({ step: `install-driver:${driver}`, done: true, ok: true, detail: 'already installed' });
    }
    let allOk = true;
    for (const driver of toInstall) {
      const ok = await this.runStep(`install-driver:${driver}`, appiumBin, ['driver', 'install', driver], env);
      allOk = allOk && ok;
    }

    // 3) Verify.
    const verifyOk = await this.runStep('verify-plugin', appiumBin, ['plugin', 'list', '--installed'], env);
    return allOk && verifyOk;
  }
}
