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
    options?: { useSessionPath?: boolean },
  ): Promise<any> {
    if (
      ['/status', '/health'].includes(endpoint) ||
      (method === 'get' && endpoint === '/sessions')
    ) {
      return this.performWDACommand(udid, method, endpoint, data, 0, options);
    }
    return this.executeSerializedCommand(udid, () =>
      this.performWDACommand(udid, method, endpoint, data, 0, options),
    );
  }

  private async performWDACommand(
    udid: string,
    method: 'get' | 'post',
    endpoint: string,
    data?: any,
    retryCount = 0,
    options?: { useSessionPath?: boolean },
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

    // Principal Intelligence: Prioritize the host that worked last time.
    // Usually localhost (tunnel) is fastest, but if it's lagging, network IP is a solid fallback.
    const hosts = [];
    if (cached?.host) {
      hosts.push(cached.host);
      if (cached.host === '127.0.0.1' && device.ip) hosts.push(device.ip);
      if (cached.host !== '127.0.0.1') hosts.push('127.0.0.1');
    } else {
      hosts.push('127.0.0.1');
      if (device.ip) hosts.push(device.ip);
    }

    for (const targetHost of hosts) {
      const isNetworkHost = targetHost !== '127.0.0.1';
      const targetPort = isNetworkHost ? 8100 : port;

      for (const prefix of prefixes) {
        try {
          const isSessionless =
            !options?.useSessionPath &&
            (['/status', '/health'].includes(endpoint) || endpoint.startsWith('/wda/'));
          const url = `http://${targetHost}:${targetPort}${isSessionless ? '' : prefix}${endpoint}`;

          // Principal Stability: Screenshots, activation, and script execution need longer timeouts.
          // Heartbeats and Status checks should be snappy to fail-over quickly.
          const isHeavyCommand =
            endpoint.includes('screenshot') ||
            endpoint.includes('source') ||
            endpoint.includes('swipe') ||
            endpoint.includes('touchAndHold') ||
            endpoint.includes('activate') ||
            endpoint.includes('execute') ||
            endpoint.includes('actions');
          const timeout = isHeavyCommand ? 30000 : 5000; // Snappy 5s timeout for standard commands

          const res =
            method === 'post'
              ? await axios.post(url, data || {}, { timeout })
              : await axios.get(url, { timeout });

          // If we reached a host but it returned a logical error (e.g. 404 for session),
          // we should update our cache and potentially stop retrying this host/prefix combo.
          // However, for simplicity, we treat any successful HTTP response as "Host is alive".

          if (isNetworkHost && targetHost !== cached?.host) {
            this.log.debug(`[WDA] Successful fallback to network IP ${targetHost} for ${udid}`);
          }

          const sid = res.data?.sessionId || res.data?.value?.sessionId;
          if (sid && sid !== cached?.sessionId) {
            this.log.debug(`[WDA] Detected new session ID: ${sid} via ${targetHost}`);
            this.wdaConnectionCache.set(cacheKey, {
              host: targetHost,
              pathPrefix: `/session/${sid}`,
              sessionId: sid,
            });
            Container.get(IOSStreamService).setWDASessionId(udid, sid);
          }
          return res;
        } catch (err: any) {
          lastError = err;
          if (err.response) {
            const status = err.response.status;
            const errorMsg = JSON.stringify(err.response.data);

            this.log.info(
              `[WDA] Command ${method.toUpperCase()} ${endpoint} failed (${status}): ${errorMsg}`,
            );

            // Principal Resiliency: Multi-Phase Recovery
            if (retryCount < 2) {
              // Phase 1: Dead Session Recovery (404)
              if (status === 404 && prefix.includes('/session/')) {
                // Special Intelligence: Some WDA versions don't support /execute, /wda/homescreen, etc.
                // We should NOT clear the session if these specific commands fail with 404,
                // as they might just be unsupported features.
                const NON_FATAL_ENDPOINTS = ['execute', 'homescreen', 'pressButton'];
                if (NON_FATAL_ENDPOINTS.some((e) => endpoint.includes(e))) {
                  this.log.debug(
                    `[WDA] Command ${endpoint} failed with 404 (Unsupported or Logical Error). Skipping session reset.`,
                  );
                  throw err;
                }

                this.log.warn(
                  `[WDA] Session ${cached?.sessionId} appears dead. Resetting and retrying...`,
                );
                this.wdaConnectionCache.delete(cacheKey);
                Container.get(IOSStreamService).setWDASessionId(udid, '');
                return this.performWDACommand(
                  udid,
                  method,
                  endpoint,
                  data,
                  retryCount + 1,
                  options,
                );
              }

              // Phase 2: Transient State Recovery (500)
              // This handles "Focused" errors, "Internal" errors, or transient locks during app switches.
              if (status === 500) {
                this.log.warn(
                  `[WDA] Transient error (500) for ${udid}, retrying in 1s... (Reason: ${errorMsg})`,
                );
                await new Promise((r) => setTimeout(r, 1000));
                return this.performWDACommand(
                  udid,
                  method,
                  endpoint,
                  data,
                  retryCount + 1,
                  options,
                );
              }
            }

            throw err;
          }

          // If network host fails, don't retry other prefixes if it's just a status check
          if (isNetworkHost && ['/status', '/health'].includes(endpoint)) break;
        }
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
            parameters: { pointerType: 'touch' },
            actions: [
              { type: 'pointerMove', duration: 0, x, y },
              { type: 'pointerDown', button: 0 },
              { type: 'pause', duration: 50 },
              { type: 'pointerUp', button: 0 },
            ],
          },
        ],
      });
    } catch (e: any) {
      this.log.error(`Failed to tap at (${x}, ${y}): ${e.message}`);
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
      // Principal Strategy: Use W3C Actions with touch pointer.
      // This is the most modern, precise, and reliable method for iOS.
      await this.sendWDACommand(udid, 'post', '/actions', {
        actions: [
          {
            type: 'pointer',
            id: 'finger1',
            parameters: { pointerType: 'touch' },
            actions: [
              { type: 'pointerMove', duration: 0, x: Math.round(x), y: Math.round(y) },
              { type: 'pointerDown', button: 0 },
              { type: 'pause', duration: 100 },
              { type: 'pointerMove', duration: 500, x: Math.round(ex), y: Math.round(ey) },
              { type: 'pointerUp', button: 0 },
            ],
          },
        ],
      });
    } catch (e: any) {
      this.log.debug('[WDA] W3C actions failed, falling back to legacy swipe...');
      try {
        // Fallback 1: Coordinate-based (older WDA)
        await this.sendWDACommand(udid, 'post', '/wda/swipe', {
          startX: Math.round(x),
          startY: Math.round(y),
          endX: Math.round(ex),
          endY: Math.round(ey),
          delay: duration / 1000,
        });
      } catch (e2) {
        // Fallback 2: Direction-based (strict WDA)
        let direction = 'up';
        if (Math.abs(ex - x) > Math.abs(ey - y)) {
          direction = ex > x ? 'right' : 'left';
        } else {
          direction = ey > y ? 'down' : 'up';
        }
        await this.sendWDACommand(udid, 'post', '/wda/swipe', { direction });
      }
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

    // Principal Modernization: Use /wda/pressButton with {name: 'home'} as primary.
    // Legacy /wda/homescreen is often removed in modern WDA versions.
    if (['home', '3'].includes(n)) {
      try {
        await this.sendWDACommand(udid, 'post', '/wda/pressButton', { name: 'home' });
      } catch (e) {
        // Fallback for extremely old WDA
        await this.sendWDACommand(udid, 'post', '/wda/homescreen', {}).catch(() => { });
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
      this.log.debug(`[Clipboard] Requesting pasteboard for ${udid}...`);

      const device = await DeviceStoreFactory.getStore().findDevice({ udid });
      if (!device) throw new Error(`Device ${udid} not found`);
      const isRealDevice = !!(device as IDevice & { realDevice?: boolean }).realDevice;

      const fetchParams = { contentType: 'plaintext' };
      let res: any;
      let value = '';

      // On iOS 13+ real devices, WDA must be in foreground to read clipboard (Apple limitation).
      // Skip fast-path for real devices and activate WDA first; use fast-path only for simulators.
      if (!isRealDevice) {
        res = await this.sendWDACommand(udid, 'post', '/wda/getPasteboard', fetchParams);
        const raw = res.data?.value;
        if (raw && typeof raw === 'string' && raw.length > 0) {
          this.log.debug(`[Clipboard] Fast-path successful for ${udid}`);
          return this.parsePasteboardResponse(raw);
        }
        this.log.debug('[Clipboard] Fast-path empty. Proceeding with surgical foregrounding...');
      } else {
        this.log.debug(
          '[Clipboard] Real device: activating WDA first (required for clipboard access).',
        );
      }

      // Surgical Foregrounding: Capture -> Activate WDA -> Fetch -> Restore
      let previousApp: string | null = null;
      try {
        const activeAppRes = await this.sendWDACommand(udid, 'get', '/wda/activeAppInfo');
        previousApp = activeAppRes.data?.value?.bundleId || activeAppRes.data?.bundleId;
      } catch (e: any) {
        this.log.debug(`[Clipboard] Failed to capture active app: ${e.message}`);
      }

      const s = Container.get(IOSStreamService);
      const wdaBundleId =
        (await s.detectWDABundleId(udid)) || 'com.qasecret.WebDriverAgentRunner.xctrunner';

      // Phase 1: Activate WDA so it can access UIPasteboard (required on real devices)
      const CLIPBOARD_SETTLE_MS = 1500; // WDA needs time in foreground to read pasteboard
      try {
        this.log.debug(`[Clipboard] Activating WDA (${wdaBundleId}) for ${udid}...`);
        await this.sendWDACommand(udid, 'post', '/wda/apps/activate', { bundleId: wdaBundleId });
        await new Promise((r) => setTimeout(r, CLIPBOARD_SETTLE_MS));
      } catch (e: any) {
        this.log.debug(`[Clipboard] Cross-session activation info: ${e.message}`);
      }

      // Tier 1: Session-less getPasteboard (primary for standalone WDA)
      res = await this.sendWDACommand(udid, 'post', '/wda/getPasteboard', fetchParams).catch(() =>
        this.sendWDACommand(udid, 'get', '/wda/getPasteboard'),
      );
      this.log.debug(`[Clipboard] Tier 1 (Runner-CS) raw response: ${JSON.stringify(res?.data)}`);
      value = this.parsePasteboardResponse(res?.data);

      // Tier 1b: If empty and we have a session, try session-scoped getPasteboard (some WDA builds use /session/.../wda/getPasteboard)
      if (!value && s.getWDASessionId(udid)) {
        try {
          res = await this.sendWDACommand(udid, 'post', '/wda/getPasteboard', fetchParams, {
            useSessionPath: true,
          });
          value = this.parsePasteboardResponse(res?.data);
          if (value)
            this.log.debug(`[Clipboard] Session-scoped getPasteboard succeeded for ${udid}`);
        } catch (e: any) {
          this.log.debug(`[Clipboard] Session-scoped getPasteboard failed: ${e.message}`);
        }
      }

      // Tier 2: Home -> Runner -> Focus Fallback
      if (!value) {
        this.log.debug('[Clipboard] Primary fetch empty. Trying Home-Surgical restoration...');
        try {
          await this.sendWDACommand(udid, 'post', '/wda/homescreen', {});
          await new Promise((r) => setTimeout(r, 1000));
          await this.sendWDACommand(udid, 'post', '/wda/apps/activate', { bundleId: wdaBundleId });
          await new Promise((r) => setTimeout(r, CLIPBOARD_SETTLE_MS));
          await this.tap(udid, 200, 400).catch(() => { });
          await new Promise((r) => setTimeout(r, 800));

          res = await this.sendWDACommand(udid, 'post', '/wda/getPasteboard', fetchParams);
          this.log.debug(
            `[Clipboard] Tier 2 (Home-Surgical) raw response: ${JSON.stringify(res?.data)}`,
          );
          value = this.parsePasteboardResponse(res?.data);
        } catch (e: any) { }
      }

      // Tier 3: Safari System Fallback
      if (!value) {
        this.log.debug('[Clipboard] Trying Safari System Tier...');
        try {
          await this.sendWDACommand(udid, 'post', '/wda/apps/activate', {
            bundleId: 'com.apple.mobilesafari',
          });
          await new Promise((r) => setTimeout(r, CLIPBOARD_SETTLE_MS));
          res = await this.sendWDACommand(udid, 'post', '/wda/getPasteboard', fetchParams);
          this.log.debug(
            `[Clipboard] Tier 3 (Safari-CS) raw response: ${JSON.stringify(res?.data)}`,
          );
          value = this.parsePasteboardResponse(res?.data);
        } catch (e: any) { }
      }

      // Restore Previous App
      if (previousApp && previousApp !== wdaBundleId && !previousApp.startsWith('com.apple.')) {
        this.log.debug(`[Clipboard] Background restoring ${previousApp}`);
        this.sendWDACommand(udid, 'post', '/wda/apps/activate', { bundleId: previousApp }).catch(
          () => { },
        );
      }

      // FINAL FALLBACK: Appium script (session-scoped)
      if (!value) {
        try {
          this.log.debug('[Clipboard] Tiers failed. Executing Mobile Script fallback...');
          res = await this.sendWDACommand(udid, 'post', '/execute', {
            script: 'mobile: getClipboard',
            args: [fetchParams],
          }).catch(() =>
            this.sendWDACommand(udid, 'post', '/execute/sync', {
              script: 'mobile: getClipboard',
              args: [fetchParams],
            }),
          );
          value = this.parsePasteboardResponse(res?.data);
        } catch (e: any) { }
      }

      if (!value) {
        this.log.info(
          `[Clipboard] All recovery tiers yielded empty results for ${udid}. Last HTTP status: ${res?.status ?? 'N/A'}`,
        );
      }

      return value || '';
    } catch (e: any) {
      this.log.error(`Failed to get clipboard for ${udid}: ${e.message}`);
    }
    return '';
  }

  /**
   * Universal parser for varied WDA pasteboard response formats.
   * Handles strings, nested objects, content/result/data fields, and base64 auto-decoding.
   */
  private parsePasteboardResponse(data: any): string {
    if (data === undefined || data === null) return '';
    if (typeof data === 'string') return data;

    // Top-level value (standard WDA/Appium response)
    let value = data?.value;
    // Some proxies or WDA builds use content/result/data at top level
    if (
      (!value || (typeof value === 'object' && Object.keys(value).length === 0)) &&
      typeof data?.content === 'string'
    )
      value = data.content;
    if (
      (!value || (typeof value === 'object' && Object.keys(value).length === 0)) &&
      typeof data?.result === 'string'
    )
      value = data.result;
    if (
      (!value || (typeof value === 'object' && Object.keys(value).length === 0)) &&
      typeof data?.data === 'string'
    )
      value = data.data;

    // Unwrap nested objects: { value: { string/content/value/plaintext/text: "..." } }
    if (value && typeof value === 'object') {
      value = value.string || value.content || value.value || value.plaintext || value.text || '';
    }

    if (!value || typeof value !== 'string') return '';

    // Trim so we don't treat whitespace-only as empty when it's valid content
    value = value.trim();
    if (value.length === 0) return '';

    // Base64: WDA often returns plaintext as base64. Only decode when it looks like base64.
    if (value.length > 8 && /^[A-Za-z0-9+/]+=*$/.test(value) && value.length % 4 === 0) {
      try {
        const decoded = Buffer.from(value, 'base64').toString('utf8');
        if (!/[\x00-\x08\x0E-\x1F]/.test(decoded)) return decoded;
      } catch (e) {
        // not valid base64, use as-is
      }
    }

    return value;
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
    // Find device to check if it's a simulator
    const device = await DeviceStoreFactory.getStore().findDevice({ udid });
    const isSimulator = device && !device.realDevice;

    let command = 'idevicesyslog';
    let args = ['-u', udid];

    if (isSimulator) {
      command = 'xcrun';
      args = ['simctl', 'spawn', udid, 'log', 'show', '--last', '10s', '--style', 'compact'];
    } else if (await s.isGoIOSAvailable()) {
      command = s.goIOSPath;
      args = ['syslog', '--udid', udid];
    }

    this.log.debug(`Fetching logs for ${udid} (Simulator: ${isSimulator}) using ${command} ${args.join(' ')}`);

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

      let timer: NodeJS.Timeout;
      const resetInactivityTimeout = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            rl.close();
            proc.kill('SIGKILL');
            this.log.debug(`getLogs snapshot completed (inactivity timeout) for ${udid}`);
            resolve(output);
          }
        }, 2000);
      };

      // Initial timer start
      resetInactivityTimeout();

      rl.on('line', (line) => {
        resetInactivityTimeout();
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
        resetInactivityTimeout();
        this.log.debug(`[getLogs][stderr] ${data.toString()}`);
      });

      proc.on('error', (err) => {
        if (!resolved) {
          resolved = true;
          rl.close();
          this.log.debug(`getLogs failed for ${udid}: ${err.message}`);
          clearTimeout(timer);
          resolve(output);
        }
      });

      proc.on('exit', (code) => {
        if (!resolved) {
          resolved = true;
          rl.close();
          clearTimeout(timer);
          this.log.debug(`getLogs process exited with code ${code} for ${udid}`);
          resolve(output);
        }
      });
    });
  }

  async verifyWDAStatus(udid: string): Promise<boolean> {
    // Use retry logic for transient errors (ECONNRESET, timeouts)
    const maxRetries = 2;
    let lastError: any;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await this.sendWDACommand(udid, 'get', '/status');
        return res.data?.value?.ready === true;
      } catch (e: any) {
        lastError = e;
        const isTransientError =
          e.code === 'ECONNRESET' ||
          e.code === 'ETIMEDOUT' ||
          e.code === 'ECONNABORTED' ||
          (e.response && e.response.status >= 500);

        if (isTransientError && attempt < maxRetries) {
          const backoffMs = Math.min(500 * Math.pow(2, attempt), 2000);
          this.log.debug(
            `[WDA] Transient error verifying status for ${udid} (${e.code || e.response?.status}), retrying in ${backoffMs}ms (attempt ${attempt + 1}/${maxRetries + 1})`,
          );
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          continue;
        }

        // Permanent error or max retries reached
        this.log.debug(`Failed to verify WDA status for ${udid}: ${e.message}`);
        return false;
      }
    }

    return false;
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
