import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { SetupProgress } from '@shared/types';
import { buildEnv, which } from './env';

const NPM_PLUGIN = '@xenon-device-management/xenon';

export interface SetupOptions {
  appiumHome: string;
  /** Install the plugin from the local repo checkout or from npm. */
  pluginSource: 'local' | 'npm';
  /** Appium drivers to ensure are installed. */
  drivers: Array<'uiautomator2' | 'xcuitest'>;
}

/**
 * First-run / on-demand provisioning: installs the xenon plugin (and optionally
 * platform drivers) into a given APPIUM_HOME. Emits 'progress' (SetupProgress)
 * for each step so the renderer can show live status.
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

  async install(opts: SetupOptions): Promise<boolean> {
    const appiumBin = await which('appium');
    if (!appiumBin) {
      this.emitProgress({ step: 'locate-appium', done: true, ok: false, detail: 'appium not found on PATH' });
      return false;
    }
    const env = await buildEnv({ APPIUM_HOME: opts.appiumHome });

    // 1) Install the plugin.
    let source: string;
    if (opts.pluginSource === 'local') {
      const repo = this.localRepoRoot();
      if (!repo) {
        this.emitProgress({ step: 'install-plugin', done: true, ok: false, detail: 'local repo not found; use npm source' });
        return false;
      }
      source = `--source=local ${repo}`;
    } else {
      source = `--source=npm ${NPM_PLUGIN}`;
    }
    const pluginOk = await this.runStep('install-plugin', appiumBin, ['plugin', 'install', ...source.split(' ')], env);
    if (!pluginOk) return false;

    // 2) Install requested drivers (idempotent — Appium no-ops if present).
    let allOk = true;
    for (const driver of opts.drivers) {
      const ok = await this.runStep(`install-driver:${driver}`, appiumBin, ['driver', 'install', driver], env);
      allOk = allOk && ok;
    }

    // 3) Verify.
    const verifyOk = await this.runStep('verify-plugin', appiumBin, ['plugin', 'list', '--installed'], env);
    return allOk && verifyOk;
  }
}
