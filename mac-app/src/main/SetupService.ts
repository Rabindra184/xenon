import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { GO_IOS_STEP } from '@shared/setupNotes';
import type { SetupProgress, SetupResult } from '@shared/types';
import { buildEnv, which } from './env';
import { installedPluginDir } from './installedPluginVersion';
import {
  GO_IOS_SCRIPT,
  parseExtensionList,
  partitionDrivers,
  planGoIosStep,
  planPluginSteps,
  xenonPluginName,
  type ExtensionManifest,
} from './setupPlan';

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
  /**
   * Which devices the profile targets. The go-ios installer runs for 'ios' and
   * 'both' (real iPhones need it) and is skipped for 'android'.
   */
  platform: 'ios' | 'android' | 'both';
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

  /** `appium <kind> list --installed --json` as a manifest; {} when the command fails. */
  private async listInstalled(kind: 'plugin' | 'driver', bin: string, env: NodeJS.ProcessEnv): Promise<ExtensionManifest> {
    const { code, stdout } = await this.capture(bin, [kind, 'list', '--installed', '--json'], env);
    return code === 0 ? parseExtensionList(stdout) : {};
  }

  async install(opts: SetupOptions): Promise<SetupResult> {
    const appiumBin = await which('appium');
    if (!appiumBin) {
      this.emitProgress({ step: 'locate-appium', done: true, ok: false, detail: 'appium not found on PATH' });
      return { ok: false, failedStep: 'locate-appium' };
    }
    const env = await buildEnv({ APPIUM_HOME: opts.appiumHome });

    // First step that failed, so the renderer can say which part needs attention.
    let failedStep: string | null = null;
    const record = (step: string, ok: boolean): boolean => {
      if (!ok && failedStep === null) failedStep = step;
      return ok;
    };

    // 1) Install or update the plugin. Falls back to npm when no local repo is
    //    present (F2) and updates rather than reinstalling when already installed (F3).
    const plan = planPluginSteps({
      installedName: xenonPluginName(await this.listInstalled('plugin', appiumBin, env)),
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
      if (!record(s.step, ok)) return { ok: false, failedStep };
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
      allOk = record(`install-driver:${driver}`, ok) && allOk;
    }

    // 3) Real iPhones need go-ios, which the installed plugin fetches itself:
    //    it decides whether to download, replace or skip, and exits non-zero on failure.
    const pluginDir = installedPluginDir(opts.appiumHome);
    const goIos = planGoIosStep({
      platform: opts.platform,
      pluginDir,
      scriptExists: existsSync(path.join(pluginDir, ...GO_IOS_SCRIPT)),
    });
    if (goIos.kind === 'skip') {
      this.emitProgress({ step: GO_IOS_STEP, done: true, ok: true, detail: goIos.detail });
    } else if (goIos.kind === 'run') {
      const nodeBin = await which('node');
      if (!nodeBin) {
        this.emitProgress({ step: goIos.step.step, done: true, ok: false, detail: 'node not found on PATH' });
        allOk = record(goIos.step.step, false) && allOk;
      } else {
        const ok = await this.runStep(goIos.step.step, nodeBin, goIos.step.args, env);
        allOk = record(goIos.step.step, ok) && allOk;
      }
    }

    // 4) Verify.
    const verifyOk = await this.runStep('verify-plugin', appiumBin, ['plugin', 'list', '--installed'], env);
    record('verify-plugin', verifyOk);
    return { ok: allOk && verifyOk, failedStep };
  }
}
