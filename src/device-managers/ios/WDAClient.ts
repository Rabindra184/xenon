import axios from 'axios';
import semver from 'semver';
import http from 'http';
import log from '../../logger';
import { Container, Service } from 'typedi';
import IOSStreamService from './IOSStreamService';
import { IDevice } from '../../interfaces/IDevice';
import { DeviceStoreFactory } from '../../data-service/device-store';
import { exec, execFile, spawn } from 'child_process';
import { promisify } from 'util';
import readline from 'readline';
import path from 'path';
import os from 'os';
import fs from 'fs-extra';

const execFilePromise = promisify(execFile);
const execPromise = promisify(exec);

@Service()
export class WDAClient {
  private log = log.scope('WDAClient');
  private wdaConnectionCache: Map<
    string,
    { host: string; pathPrefix: string; sessionId?: string }
  > = new Map();
  private commandQueues: Map<string, Promise<any>> = new Map();
  private ideviceinstallerVersion: string | null = null;
  private typeBuffers: Map<
    string,
    { text: string; timer: NodeJS.Timeout | null; pending: boolean }
  > = new Map();

  private async executeSerializedCommand<T>(udid: string, action: () => Promise<T>): Promise<T> {
    const currentQueue = this.commandQueues.get(udid) || Promise.resolve();
    const nextInQueue = currentQueue
      .catch(() => { })
      .then(() => action())
      .finally(() => {
        if (this.commandQueues.get(udid) === nextInQueue) this.commandQueues.delete(udid);
      });
    this.commandQueues.set(udid, nextInQueue);
    return nextInQueue;
  }

  async sendWDACommand(
    udid: string,
    method: 'get' | 'post',
    endpoint: string,
    data?: any,
  ): Promise<any> {
    if (
      ['/status', '/health'].includes(endpoint) ||
      (method === 'get' && endpoint === '/sessions')
    ) {
      return this.performWDACommand(udid, method, endpoint, data);
    }
    return this.executeSerializedCommand(udid, () =>
      this.performWDACommand(udid, method, endpoint, data),
    );
  }

  private async performWDACommand(
    udid: string,
    method: 'get' | 'post',
    endpoint: string,
    data?: any,
  ): Promise<any> {
    const device = await DeviceStoreFactory.getStore().findDevice({ udid });
    if (!device) throw new Error(`Device ${udid} not found`);
    const streamStatus = Container.get(IOSStreamService).getStreamStatus(udid);
    const port =
      streamStatus?.status === 'running' || streamStatus?.status === 'starting'
        ? streamStatus.wdaPort
        : (device as any).wdaLocalPort;
    if (!port) throw new Error(`WDA port not available for ${udid}`);

    const cacheKey = `${udid}:${port}`;
    let cached = this.wdaConnectionCache.get(cacheKey);
    if (!cached?.sessionId) {
      const sid = Container.get(IOSStreamService).getWDASessionId(udid);
      if (sid) {
        cached = { host: '127.0.0.1', pathPrefix: `/session/${sid}`, sessionId: sid };
        this.wdaConnectionCache.set(cacheKey, cached);
      }
    }

    const prefixes = cached?.sessionId ? [`/session/${cached.sessionId}`] : ['', '/session/any'];
    let lastError: any;
    for (const prefix of prefixes) {
      try {
        const url = `http://127.0.0.1:${port}${['/status', '/health'].includes(endpoint) ? '' : prefix}${endpoint}`;
        const res =
          method === 'post'
            ? await axios.post(url, data || {}, { timeout: 10000 })
            : await axios.get(url, { timeout: 10000 });
        const sid = res.data?.sessionId || res.data?.value?.sessionId;
        if (sid && sid !== cached?.sessionId) {
          this.wdaConnectionCache.set(cacheKey, {
            host: '127.0.0.1',
            pathPrefix: `/session/${sid}`,
            sessionId: sid,
          });
          Container.get(IOSStreamService).setWDASessionId(udid, sid);
        }
        return res;
      } catch (err: any) {
        lastError = err;
      }
    }
    throw lastError;
  }

  async ensureWDASession(udid: string, port: number): Promise<string | null> {
    try {
      const res = await axios.post(
        `http://127.0.0.1:${port}/session`,
        { capabilities: { alwaysMatch: { bundleId: 'com.apple.springboard' } } },
        { timeout: 10000 },
      );
      const sid = res.data?.sessionId || res.data?.value?.sessionId;
      if (sid) {
        this.wdaConnectionCache.set(`${udid}:${port}`, {
          host: '127.0.0.1',
          pathPrefix: `/session/${sid}`,
          sessionId: sid,
        });
        Container.get(IOSStreamService).setWDASessionId(udid, sid);
        return sid;
      }
    } catch (e: any) {
      this.log.debug(`Failed to ensure WDA session for ${udid}: ${e.message}\n${e.stack}`);
    }
    return null;
  }

  async recoverWDASession(udid: string, port: number): Promise<string | null> {
    try {
      const res = await axios.get(`http://127.0.0.1:${port}/sessions`, { timeout: 5000 });
      const sid = res.data?.value?.[0]?.id;
      if (sid) {
        this.wdaConnectionCache.set(`${udid}:${port}`, {
          host: '127.0.0.1',
          pathPrefix: `/session/${sid}`,
          sessionId: sid,
        });
        Container.get(IOSStreamService).setWDASessionId(udid, sid);
        return sid;
      }
    } catch (e: any) {
      this.log.debug(`Failed to recover WDA session for ${udid}: ${e.message}\n${e.stack}`);
    }
    return null;
  }

  async tap(udid: string, x: number, y: number): Promise<void> {
    try {
      await this.sendWDACommand(udid, 'post', '/actions', {
        actions: [
          {
            type: 'pointer',
            id: 'finger1',
            actions: [
              { type: 'pointerMove', duration: 0, x, y },
              { type: 'pointerDown', button: 0 },
              { type: 'pause', duration: 50 },
              { type: 'pointerUp', button: 0 },
            ],
          },
        ],
      });
    } catch (e) {
      await this.sendWDACommand(udid, 'post', '/wda/tap', { x, y });
    }
  }

  async swipe(
    udid: string,
    x: number,
    y: number,
    ex: number,
    ey: number,
    duration: number,
  ): Promise<void> {
    try {
      await this.sendWDACommand(udid, 'post', '/wda/swipe', {
        startX: x,
        startY: y,
        endX: ex,
        endY: ey,
        delay: duration / 1000,
      });
    } catch (e) {
      await this.sendWDACommand(udid, 'post', '/actions', {
        actions: [
          {
            type: 'pointer',
            id: 'finger1',
            actions: [
              { type: 'pointerMove', duration: 0, x, y },
              { type: 'pointerDown', button: 0 },
              { type: 'pause', duration: 100 },
              { type: 'pointerMove', duration: 500, x: ex, y: ey },
              { type: 'pointerUp', button: 0 },
            ],
          },
        ],
      });
    }
  }

  async typeText(udid: string, text: string): Promise<void> {
    const b = this.typeBuffers.get(udid) || { text: '', timer: null, pending: false };
    this.typeBuffers.set(udid, b);
    b.text += text;
    if (b.timer) clearTimeout(b.timer);
    if (!b.pending) b.timer = setTimeout(() => this.flushTypeBuffer(udid), 150);
  }

  private async flushTypeBuffer(udid: string) {
    const b = this.typeBuffers.get(udid);
    if (!b || !b.text) return;
    const t = b.text;
    b.text = '';
    b.timer = null;
    b.pending = true;
    try {
      await this.sendWDACommand(udid, 'post', '/wda/type', { text: t });
    } finally {
      b.pending = false;
      if (b.text) setTimeout(() => this.flushTypeBuffer(udid), 50);
    }
  }

  async pressKey(udid: string, key: string | number): Promise<void> {
    const n = key.toString().toLowerCase();
    if (['home', '3'].includes(n)) {
      try {
        await this.sendWDACommand(udid, 'post', '/wda/homescreen', {});
      } catch (e) {
        await this.sendWDACommand(udid, 'post', '/wda/pressButton', { name: 'home' });
      }
      return;
    }
    await this.sendWDACommand(udid, 'post', '/wda/pressButton', {
      name: n === 'backspace' ? 'delete' : n,
    });
  }

  async getScreenshot(udid: string): Promise<string> {
    const s = Container.get(IOSStreamService);
    if (await s.isGoIOSAvailable()) {
      try {
        const p = path.join(os.tmpdir(), `screenshot-${udid}.png`);
        await execFilePromise(s.goIOSPath, ['screenshot', '--udid', udid, '--output', p], {
          env: { ...process.env, ENABLE_GO_IOS_AGENT: 'yes' },
        });
        const b = await fs.readFile(p);
        await fs.remove(p);
        return b.toString('base64');
      } catch (e: any) {
        this.log.debug(`go-ios screenshot failed for ${udid}: ${e.message}\n${e.stack}`);
      }
    }
    const res = await this.sendWDACommand(udid, 'get', '/screenshot');
    return res.data?.value?.screenshot || res.data?.value || '';
  }

  async getClipboard(udid: string): Promise<string> {
    try {
      await this.sendWDACommand(udid, 'post', '/wda/apps/activate', {
        bundleId: 'com.apple.springboard',
      });
      await new Promise((r) => setTimeout(r, 1000));
      const res = await this.sendWDACommand(udid, 'post', '/wda/getPasteboard', {
        contentType: 'plaintext',
      });
      if (res.data?.value) return Buffer.from(res.data.value, 'base64').toString('utf8');
    } catch (e: any) {
      this.log.debug(`Failed to get clipboard for ${udid}: ${e.message}\n${e.stack}`);
    }
    return '';
  }

  async setClipboard(udid: string, content: string): Promise<void> {
    try {
      await this.sendWDACommand(udid, 'post', '/wda/setPasteboard', {
        content: Buffer.from(content).toString('base64'),
        contentType: 'plaintext',
      });
    } catch (e: any) {
      this.log.debug(`Failed to set clipboard for ${udid}: ${e.message}\n${e.stack}`);
    }
  }

  async lock(udid: string): Promise<void> {
    try {
      await this.sendWDACommand(udid, 'post', '/wda/lock', {});
    } catch (e: any) {
      this.log.debug(`Failed to lock device ${udid}: ${e.message}\n${e.stack}`);
    }
  }
  async unlock(udid: string): Promise<void> {
    try {
      await this.sendWDACommand(udid, 'post', '/wda/unlock', {});
    } catch (e: any) {
      this.log.debug(`Failed to unlock device ${udid}: ${e.message}\n${e.stack}`);
    }
  }

  /**
   * Performs an early check of ideviceinstaller requirements
   */
  async checkRequirements(): Promise<void> {
    const version = await this.getIdeviceinstallerVersion();
    this.log.info(`iOS Installation Requirement Check: ideviceinstaller ${version}`);
    if (semver.lt(version, '1.1.0')) {
      this.log.warn(
        `⚠️ ideviceinstaller version ${version} is legacy. We recommend upgrading to 1.1.2 or 1.2.0+ for better compatibility (brew upgrade ideviceinstaller).`,
      );
    }
  }

  private async getIdeviceinstallerVersion(): Promise<string> {
    if (this.ideviceinstallerVersion) return this.ideviceinstallerVersion;
    try {
      const { stdout } = await execFilePromise('ideviceinstaller', ['--version']);
      const match = stdout.match(/ideviceinstaller\s+([\d.]+)/);
      if (match) {
        const coerced = semver.coerce(match[1]);
        if (coerced) {
          this.ideviceinstallerVersion = coerced.version;
          this.log.info(
            `Detected ideviceinstaller version: Raw="${stdout.trim()}", Normalized="${this.ideviceinstallerVersion}"`,
          );
          return this.ideviceinstallerVersion;
        }
      }
    } catch (e: any) {
      try {
        const { stdout } = await execFilePromise('ideviceinstaller', ['-v']);
        const match = stdout.match(/ideviceinstaller\s+([\d.]+)/);
        if (match) {
          const coerced = semver.coerce(match[1]);
          if (coerced) {
            this.ideviceinstallerVersion = coerced.version;
            this.log.info(
              `Detected ideviceinstaller version (alt): Raw="${stdout.trim()}", Normalized="${this.ideviceinstallerVersion}"`,
            );
            return this.ideviceinstallerVersion;
          }
        }
      } catch (e2: any) {
        this.log.warn(`Failed to detect ideviceinstaller version: ${e2.message}`);
      }
    }
    this.ideviceinstallerVersion = '1.0.0'; // Fallback to legacy
    return this.ideviceinstallerVersion;
  }

  async installApp(udid: string, p: string): Promise<void> {
    const version = await this.getIdeviceinstallerVersion();
    // Threshold adjusted: 1.1.0 and above use 'install' subcommand. Version 1.1.1 dropped legacy flags.
    try {
      if (semver.gte(version, '1.1.0')) {
        await execFilePromise('ideviceinstaller', ['-u', udid, 'install', p]);
      } else {
        await execFilePromise('ideviceinstaller', ['-u', udid, '-i', p]);
      }
    } catch (e: any) {
      this.log.warn(`ideviceinstaller failed for ${udid}: ${e.message}. Trying go-ios fallback.`);
      const s = Container.get(IOSStreamService);
      try {
        await execFilePromise(s.goIOSPath, ['install', `--path=${p}`, '--udid', udid], {
          env: { ...process.env, ENABLE_GO_IOS_AGENT: 'yes' },
        });
        this.log.info(`Successfully installed app using go-ios on ${udid}`);
      } catch (e2: any) {
        this.log.error(
          `Installation failed for ${udid} with both tools. Last error: ${e2.message}`,
        );
        throw e2;
      }
    }
  }

  async uninstallApp(udid: string, b: string): Promise<void> {
    const version = await this.getIdeviceinstallerVersion();
    try {
      if (semver.gte(version, '1.1.0')) {
        await execFilePromise('ideviceinstaller', ['-u', udid, 'uninstall', b]);
      } else {
        await execFilePromise('ideviceinstaller', ['-u', udid, '-U', b]);
      }
    } catch (e: any) {
      this.log.warn(
        `ideviceinstaller uninstall failed for ${udid}: ${e.message}. Trying go-ios fallback.`,
      );
      const s = Container.get(IOSStreamService);
      try {
        await execFilePromise(s.goIOSPath, ['uninstall', `--bundleid=${b}`, '--udid', udid], {
          env: { ...process.env, ENABLE_GO_IOS_AGENT: 'yes' },
        });
        this.log.info(`Successfully uninstalled app ${b} using go-ios on ${udid}`);
      } catch (e2: any) {
        this.log.error(
          `Uninstallation failed for ${udid} with both tools. Last error: ${e2.message}`,
        );
        throw e2;
      }
    }
  }

  async listApps(udid: string): Promise<string[]> {
    const version = await this.getIdeviceinstallerVersion();
    const args = semver.gte(version, '1.1.0') ? ['-u', udid, 'list'] : ['-u', udid, '-l'];
    try {
      const { stdout } = await execFilePromise('ideviceinstaller', args);
      const apps = stdout
        .split('\n')
        .filter((l) => l.includes(' - '))
        .map((l) => l.split(' - ')[0]);

      if (apps.length > 0) return apps;
      this.log.info(
        `ideviceinstaller returned empty app list for ${udid}. Trying go-ios fallback.`,
      );
    } catch (e: any) {
      this.log.warn(
        `ideviceinstaller listApps failed for ${udid}: ${e.message}. Trying go-ios fallback.`,
      );
    }

    // Fallback to go-ios
    try {
      const s = Container.get(IOSStreamService);
      const { stdout } = await execFilePromise(s.goIOSPath, ['apps', '--list', '--udid', udid], {
        env: { ...process.env, ENABLE_GO_IOS_AGENT: 'yes' },
      });
      return stdout
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => line.split(/\s+/)[0]);
    } catch (e2: any) {
      this.log.error(`Failed to list apps for ${udid} using go-ios: ${e2.message}`);
      return [];
    }
  }

  async getLogs(udid: string): Promise<string> {
    const s = Container.get(IOSStreamService);
    let command = 'idevicesyslog';
    let args = ['-u', udid];

    if (await s.isGoIOSAvailable()) {
      command = s.goIOSPath;
      args = ['syslog', '--udid', udid];
    }

    this.log.debug(`Fetching logs for ${udid} using ${command} ${args.join(' ')}`);

    return new Promise((resolve) => {
      const proc = spawn(command, args, {
        env: { ...process.env, ENABLE_GO_IOS_AGENT: 'yes' },
      });
      let output = '';
      let resolved = false;

      if (!proc.stdout) {
        resolved = true;
        this.log.error(`Failed to capture logs for ${udid}: stdout stream is missing`);
        proc.kill('SIGKILL');
        resolve(output);
        return;
      }

      const rl = readline.createInterface({
        input: proc.stdout,
        terminal: false,
      });

      rl.on('line', (line) => {
        if (!line.trim()) return;
        if (command === s.goIOSPath) {
          try {
            const parsed = JSON.parse(line);
            output += (parsed.msg || line) + '\n';
          } catch (e) {
            output += line + '\n';
          }
        } else {
          output += line + '\n';
        }
      });

      proc.stderr?.on('data', (data) => {
        this.log.debug(`[getLogs][stderr] ${data.toString()}`);
      });

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          proc.kill('SIGKILL');
          this.log.debug(`getLogs snapshot completed (timeout) for ${udid}`);
          resolve(output);
        }
      }, 2000);

      proc.on('error', (err) => {
        if (!resolved) {
          resolved = true;
          this.log.debug(`getLogs failed for ${udid}: ${err.message}`);
          clearTimeout(timer);
          resolve(output);
        }
      });

      proc.on('exit', (code) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          this.log.debug(`getLogs process exited with code ${code} for ${udid}`);
          resolve(output);
        }
      });
    });
  }

  async verifyWDAStatus(udid: string): Promise<boolean> {
    try {
      const res = await this.sendWDACommand(udid, 'get', '/status');
      return res.data?.value?.ready === true;
    } catch (e: any) {
      this.log.debug(`Failed to verify WDA status for ${udid}: ${e.message}\n${e.stack}`);
      return false;
    }
  }

  async executeShell(udid: string, command: string): Promise<string> {
    const ALLOWED_COMMANDS = ['ls', 'ps', 'top', 'whoami', 'date', 'uptime', 'netstat', 'id'];

    // Basic sanitation
    const safeCommand = command.trim();

    // Check if the command starts with any allowed prefix
    const isAllowed = ALLOWED_COMMANDS.some((prefix) => safeCommand.startsWith(prefix));

    if (!isAllowed) {
      this.log.warn(`Blocked potentially unsafe shell command on ${udid}: ${safeCommand}`);
      throw new Error(`Command '${safeCommand}' is not allowed for security reasons.`);
    }

    // Split command into args for execFilePromise
    const args = safeCommand.split(/\s+/);

    const { stdout } = await execFilePromise('xcrun', ['simctl', ...args, udid]).catch(
      async (e: any) => {
        this.log.debug(`xcrun simctl failed for ${udid}: ${e.message}. Trying go-ios fallback.`);
        const s = Container.get(IOSStreamService);
        return await execFilePromise(s.goIOSPath, [...args, '--udid', udid], {
          env: { ...process.env, ENABLE_GO_IOS_AGENT: 'yes' },
        });
      },
    );
    return stdout;
  }
}
