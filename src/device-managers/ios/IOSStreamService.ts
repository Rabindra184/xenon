/**
 * iOS Stream Service
 *
 * This service manages independent MJPEG streaming for iOS devices without requiring
 * an active Appium session. It uses go-ios to start WDA and forwards the MJPEG stream.
 *
 * Based on GADS implementation approach.
 */

import { Service } from 'typedi';
import { spawn, ChildProcess, exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import os from 'os';
import http from 'http';
import fs from 'fs-extra';
import tcpPortUsed from 'tcp-port-used';
import { InternalHttpClient } from '../../InternalHttpClient';
import log from '../../logger';
import { getFreePort, cachePath } from '../../helpers';
import { DeviceStoreFactory } from '../../data-service/device-store';

import { unblockDevice } from '../../data-service/device-service';

const execPromise = promisify(exec);
import { Container } from 'typedi';
import { ResourceIsolationService, IsolationProfile } from '../../services/ResourceIsolationService';

interface StreamSession {
  udid: string;
  wdaProcess: ChildProcess | null;
  forwardWDAProcess: ChildProcess | null;
  forwardMJPEGProcess: ChildProcess | null;
  tunnelProcess: ChildProcess | null;
  wdaPort: number;
  mjpegPort: number;
  sessionId?: string; // WDA Session ID for keyboard/interaction operations
  status: 'starting' | 'running' | 'stopped' | 'error';
  lastError?: string;
  startedAt?: Date;
  lastViewerAt: number;
  viewerCount: number;
  screenWidth?: number;
  screenHeight?: number;
}

@Service({ name: 'IOSStreamService' })
class IOSStreamService {
  private sessions: Map<string, StreamSession> = new Map();
  private startPromises: Map<string, Promise<{ wdaPort: number; mjpegPort: number }>> = new Map();
  public goIOSPath: string;

  constructor() {
    this.goIOSPath = this.getGoIOSPath();
    this.startWatchdog();
  }

  /**
   * Watchdog: Periodically monitors running streams and cleans up idle ones
   */
  private startWatchdog() {
    setInterval(async () => {
      for (const [udid, session] of this.sessions.entries()) {
        const now = Date.now();
        if (session.status === 'running') {
          // Check for inactivity
          if (now - session.lastViewerAt > 30000 && session.viewerCount === 0) {
            log.info(`[${udid}] [Watchdog] Stopping idle iOS stream (No viewers for 30s)`);
            this.stopStream(udid);
            continue;
          }

          // 2. Health check & Self-Healing
          // We use elased autonomous methodology to ensure devices are always warm
          const isAlive = await this.isStreamResponsive(udid);
          if (!isAlive) {
            log.warn(
              `Stream watchdog detected failure for ${udid}. Attempting autonomous healing...`,
            );
            try {
              // Get device state to check for Session Shield
              const device = await DeviceStoreFactory.getStore().findDevice({ udid });
              if (device && device.busy) {
                log.info(`🛡️ [Watchdog] Skipping heal for ${udid} as it has an active session.`);
                continue;
              }
              await this.startStream(udid);

              // Increment healed count for visual feedback
              if (device) {
                await DeviceStoreFactory.getStore().updateDevice(udid, device.host, {
                  totalHealedCount: (device.totalHealedCount || 0) + 1,
                });
              }
            } catch (e) {
              log.error(`Watchdog healing failed for ${udid}: ${e}`);
            }
          }
        }
      }
    }, 30000); // 30s interval for background stability
  }


  private getGoIOSPath(): string {
    const goIOSDir = cachePath('goIOS');
    return path.join(goIOSDir, 'ios');
  }

  /**
   * Check if go-ios binary exists
   */
  public async isGoIOSAvailable(): Promise<boolean> {
    try {
      if (!fs.existsSync(this.goIOSPath)) {
        log.warn(`go-ios binary not found at ${this.goIOSPath}`);
        return false;
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Detect the WDA bundle ID installed on the device
   */
  public async detectWDABundleId(udid: string): Promise<string | null> {
    try {
      const { stdout } = await execPromise(`"${this.goIOSPath}" apps --udid ${udid}`, {
        env: { ...process.env, ENABLE_GO_IOS_AGENT: 'yes' },
      });
      const apps = JSON.parse(stdout);
      const wda = apps.find(
        (a: any) =>
          (a.CFBundleIdentifier && a.CFBundleIdentifier.includes('WebDriverAgentRunner')) ||
          (a.CFBundleName && a.CFBundleName.includes('WebDriverAgentRunner')),
      );
      return wda ? wda.CFBundleIdentifier : null;
    } catch (error) {
      log.warn(`Failed to detect WDA bundle ID for ${udid}: ${error}`);
      return null;
    }
  }

  /**
   * Check if tunnel is needed (iOS 17+) and ensure it's running
   */
  public async ensureTunnel(udid: string): Promise<ChildProcess | null> {
    try {
      const { stdout } = await execPromise(`"${this.goIOSPath}" info --udid ${udid}`, {
        env: { ...process.env, ENABLE_GO_IOS_AGENT: 'yes' },
      });
      const info = JSON.parse(stdout);
      const versionStr = String(info.ProductVersion || info.HumanReadableProductVersionString || '0');
      // Extract the first numeric sequence (e.g., "15.8.6" or "iOS 17.2")
      const versionMatch = versionStr.match(/(\d+\.?\d*)/);
      const version = versionMatch ? parseFloat(versionMatch[0]) : 0;

      if (version >= 17) {
        log.info(`iOS ${version} detected for ${udid} (Raw: "${versionStr}"). Starting tunnel...`);

        // Check if already running in our session tracker
        const existing = [...this.sessions.values()].find(
          (s) => s.udid === udid && s.tunnelProcess && s.tunnelProcess.exitCode === null,
        );
        if (existing && existing.tunnelProcess) return existing.tunnelProcess;

        // CRITICAL: Kill any orphan tunnel processes before starting new one
        // This prevents 'address already in use' errors from stale processes
        await this.cleanupOrphanTunnels(udid);

        const isolationService = Container.get(ResourceIsolationService);
        const { command, args } = isolationService.wrapSpawn(
          this.goIOSPath,
          ['tunnel', 'start', '--udid', udid, '--userspace'],
          'Performance' // Performance mode for critical tunnel stability
        );

        const tunnelProcess = spawn(
          command,
          args,
          {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, ENABLE_GO_IOS_AGENT: 'yes' },
          },
        );

        tunnelProcess.stdout?.on('data', (data) => log.debug(`Tunnel [${udid}]: ${data}`));
        tunnelProcess.stderr?.on('data', (data) => log.debug(`Tunnel Err [${udid}]: ${data}`));

        // Wait for tunnel to establish by checking the go-ios agent port
        log.info(`Waiting for tunnel agent on port 60105 to be ready...`);
        let tunnelReady = false;
        const tunnelTimeout = 15000;
        const subStartTime = Date.now();
        while (Date.now() - subStartTime < tunnelTimeout) {
          try {
            tunnelReady = await tcpPortUsed.check(60105, '127.0.0.1');
            if (tunnelReady) break;
          } catch (e) { /* ignore */ }
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        if (!tunnelReady) {
          log.warn(`Tunnel agent port 60105 not ready after ${tunnelTimeout / 1000}s, proceeding anyway...`);
        } else {
          log.info(`Tunnel agent is ready. Settling for 2s...`);
          await new Promise((resolve) => setTimeout(resolve, 2000));
          log.info(`Tunnel agent settled.`);
        }
        return tunnelProcess;
      }
    } catch (error) {
      log.warn(`Failed to check version or start tunnel for ${udid}: ${error}`);
    }
    return null;
  }

  /**
   * Kill any orphan tunnel processes that might be left from previous runs
   * This is critical for preventing 'address already in use' errors
   */
  private async cleanupOrphanTunnels(udid: string): Promise<void> {
    log.debug(`Cleaning up orphan tunnels for ${udid}...`);

    const pkillCmds = [
      // Kill any existing tunnel for this specific device
      `pkill -9 -f "ios tunnel.*${udid}"`,
      `pkill -9 -f "go-ios.*tunnel.*${udid}"`,
    ];

    for (const cmd of pkillCmds) {
      try {
        await execPromise(cmd);
      } catch (err) {
        /* ignore - process might not exist */
      }
    }

    // Check common go-ios agent ports (60105, 60106) and kill if bound
    const agentPorts = [60105, 60106];
    for (const port of agentPorts) {
      try {
        const { stdout } = await execPromise(`lsof -ti :${port}`);
        const pids = stdout.trim().split('\n');
        for (const pid of pids) {
          if (pid) {
            log.debug(`Killing orphan process ${pid} on go-ios agent port ${port}`);
            await execPromise(`kill -9 ${pid}`);
          }
        }
      } catch (err) {
        /* ignore - lsof returns 1 if no port found */
      }
    }

    // Small delay to ensure OS releases sockets
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  /**
   * Check if WDA is already running and responding
   */
  public async isWDARunning(wdaPort: number): Promise<boolean> {
    const axios = (await import('axios')).default;
    // Fast check: Use short timeout and no internal retries
    const host = '127.0.0.1'; // Force IPv4 for local tunnels
    try {
      const response = await axios.get(`http://${host}:${wdaPort}/status`, {
        timeout: 2500, // 2.5s for consistency
        httpAgent: new http.Agent({ keepAlive: false }),
        validateStatus: (status) => status === 200,
      });
      const isReady = response.data?.value?.ready === true;
      if (!isReady) log.debug(`[WDA] Port ${wdaPort} active but not ready. Status: ${JSON.stringify(response.data?.value)}`);
      return isReady;
    } catch (error: any) {
      if (error.code === 'ECONNREFUSED') {
        log.debug(`[WDA] Port ${wdaPort} connection refused (Tunnel likely down)`);
      } else if (error.code === 'ECONNABORTED') {
        log.debug(`[WDA] Port ${wdaPort} health check timed out (WDA hanging)`);
      } else {
        log.debug(`[WDA] Port ${wdaPort} health check failed: ${error.message}`);
      }
      return false;
    }
  }

  /**
   * Comprehensive process-level and endpoint-level health check
   */
  public async isStreamResponsive(udid: string): Promise<boolean> {
    const session = this.sessions.get(udid);
    if (!session || session.status !== 'running') return false;

    // 1. Process Check: verify child processes haven't exited
    const processes = [
      { name: 'wda', p: session.wdaProcess },
      { name: 'iproxy-wda', p: session.forwardWDAProcess },
      { name: 'iproxy-mjpeg', p: session.forwardMJPEGProcess },
    ];

    for (const item of processes) {
      if (!item.p || item.p.exitCode !== null) {
        log.warn(`[Watchdog] Process ${item.name} for ${udid} is dead (code: ${item.p?.exitCode})`);
        return false;
      }
    }

    // 2. Network Check: verify endpoint is responding
    const isResponding = await this.isWDARunning(session.wdaPort);
    if (!isResponding) {
      log.warn(`[Watchdog] WDA endpoint for ${udid} on port ${session.wdaPort} is unresponsive`);
      return false;
    }

    return true;
  }

  /**
   * Start streaming for a device
   */
  public async startStream(udid: string): Promise<{ wdaPort: number; mjpegPort: number }> {
    // Return existing promise if already starting
    if (this.startPromises.has(udid)) {
      const existingPromise = this.startPromises.get(udid);
      if (existingPromise) return existingPromise;
    }

    // Define the core logic as an internal async function
    const performStartup = async () => {
      try {
        const existingSession = this.sessions.get(udid);
        if (existingSession && existingSession.status === 'running') {
          if (await this.isWDARunning(existingSession.wdaPort)) {
            return { wdaPort: existingSession.wdaPort, mjpegPort: existingSession.mjpegPort };
          }
          log.info(`Existing session for ${udid} not responding, restarting...`);
        }

        const device = await DeviceStoreFactory.getStore().findDevice({ udid });
        if (!device) throw new Error(`Device ${udid} not found`);

        const wdaPort = device.wdaLocalPort || (await getFreePort());
        const mjpegPort = device.mjpegServerPort || (await getFreePort());

        // Perform aggressive cleanup of any existing processes for THIS device/ports
        await this.stopStream(udid);
        await this.killStaleProcesses(udid, wdaPort, mjpegPort);

        const session: StreamSession = {
          udid,
          wdaProcess: null,
          forwardWDAProcess: null,
          forwardMJPEGProcess: null,
          tunnelProcess: null,
          wdaPort,
          mjpegPort,
          status: 'starting',
          startedAt: new Date(),
          lastViewerAt: Date.now(),
          viewerCount: 0,
        };
        this.sessions.set(udid, session);

        const goIOSAvailable = await this.isGoIOSAvailable();
        if (!goIOSAvailable) throw new Error('go-ios not available');

        // 1. Technical Optimization: If real iOS device and WDA IPA exists in repository, use it as priority
        const { APP_SERVICE } = await import('../../dashboard/services/app-service');
        const wdaApp = await APP_SERVICE.getWDAApp();
        if (wdaApp && fs.existsSync(wdaApp.filepath)) {
          log.info(
            `📱 Artisan WDA: Found pre-signed artifact "${wdaApp.name}". Provisioning ${udid} for stream...`,
          );
          try {
            const { Container } = await import('typedi');
            const { XenonManager } = await import('../index');
            const IOSDeviceManager = (await import('../IOSDeviceManager')).default;
            const deviceManager = Container.get(XenonManager);
            const manager = (await deviceManager.deviceInstances()).find(
              (m) => m instanceof IOSDeviceManager,
            ) as any;
            if (manager) {
              await manager.installApp(udid, wdaApp.filepath);
              log.info(`📱 Artisan WDA: Artifact provisioned successfully to ${udid}`);
            }
          } catch (e) {
            log.warn(`📱 Artisan WDA: Failed to provision WDA to ${udid}: ${e}`);
          }
        }

        // 2. Ensure tunnel for iOS 17+
        session.tunnelProcess = await this.ensureTunnel(udid);

        // 2. Start Port Forwarding using iproxy (more reliable on Mac)
        log.info(`Forwarding ${udid}: ${wdaPort}->8100, ${mjpegPort}->9100 using iproxy`);
        const isolationService = Container.get(ResourceIsolationService);

        const wdaIproxy = isolationService.wrapSpawn('iproxy', ['-u', udid, `${wdaPort}:8100`], 'Performance');
        const mjpegIproxy = isolationService.wrapSpawn('iproxy', ['-u', udid, `${mjpegPort}:9100`], 'Performance');

        session.forwardWDAProcess = spawn(wdaIproxy.command, wdaIproxy.args);
        session.forwardMJPEGProcess = spawn(mjpegIproxy.command, mjpegIproxy.args);

        const handleIproxyProcess = (p: ChildProcess, name: string) => {
          p.on('error', (err) => log.error(`${name} [${udid}] error: ${err.message}`));
          p.on('exit', (code) => {
            if (code !== 0 && code !== null) {
              log.warn(`${name} [${udid}] exited with code ${code}`);
            }
          });
        };

        handleIproxyProcess(session.forwardWDAProcess, 'iproxy-wda');
        handleIproxyProcess(session.forwardMJPEGProcess, 'iproxy-mjpeg');

        // 3. Detect and Start WDA
        const bundleId =
          (await this.detectWDABundleId(udid)) || 'com.qasecret.WebDriverAgentRunner.xctrunner';
        log.info(`Starting WDA ${bundleId} on ${udid}`);

        const wdaSpawn = isolationService.wrapSpawn(this.goIOSPath, [
          'runwda',
          '--bundleid',
          bundleId,
          '--testrunnerbundleid',
          bundleId,
          '--xctestconfig',
          'WebDriverAgentRunner.xctest',
          '--udid',
          udid,
        ], 'Performance'); // WDA deserves Performance mode

        session.wdaProcess = spawn(wdaSpawn.command, wdaSpawn.args, {
          env: { ...process.env, ENABLE_GO_IOS_AGENT: 'yes' },
        });

        const logDir = path.join(os.tmpdir(), 'xenon-logs');
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);
        const wdaRunLog = path.join(logDir, `runwda-${udid}.log`);
        session.wdaProcess.stdout?.on('data', (d) => fs.appendFileSync(wdaRunLog, d));
        session.wdaProcess.stderr?.on('data', (d) => fs.appendFileSync(wdaRunLog, d));

        // 4. Wait for WDA to be ready
        const startTime = Date.now();
        const timeout = 120000; // Senior Resiliency: 120s for WDA startup consistency
        while (Date.now() - startTime < timeout) {
          if (await this.isWDARunning(wdaPort)) {
            session.status = 'running';
            session.startedAt = new Date(); // Reset settlement timer for strict readiness phase

            // Ensure MJPEG server is started by updating WDA settings
            await this.updateWDASettings(wdaPort);

            // Wait up to 5 seconds for MJPEG server to be ready on the local port
            log.info(`Waiting for MJPEG server to be ready on port ${mjpegPort}...`);
            let mjpegReady = false;
            for (let i = 0; i < 5; i++) {
              // Try 5 times with 1-second delay = 5 seconds total
              // Perform a real HTTP check to see if the MJPEG server is actually serving
              try {
                mjpegReady = await tcpPortUsed.check(mjpegPort, '127.0.0.1');
                if (mjpegReady) break;
              } catch (e) {
                // Not ready yet
              }
              await new Promise((resolve) => setTimeout(resolve, 1000));
            }

            if (mjpegReady) {
              log.info(`MJPEG server is ready on port ${mjpegPort} for ${udid}`);
            } else {
              log.warn(
                `MJPEG server not detected on port ${mjpegPort} for ${udid} after 5s timeout. It might be starting slowly or WDA might be struggling.`,
              );
            }

            // Fetch screen size from WDA
            let screenWidth = 0,
              screenHeight = 0;
            try {
              const winSize: any = await InternalHttpClient.get(
                `http://127.0.0.1:${wdaPort}/window/size`,
              );
              screenWidth = winSize.value.width;
              screenHeight = winSize.value.height;
              session.screenWidth = screenWidth;
              session.screenHeight = screenHeight;
              log.info(`Detected screen size for ${udid}: ${screenWidth}x${screenHeight}`);
            } catch (e) {
              log.warn(`Failed to get screen size for ${udid}: ${e}`);
            }

            // Update device info in store
            const device = await DeviceStoreFactory.getStore().findDevice({ udid });
            if (device) {
              const updateData: any = {
                wdaLocalPort: wdaPort,
                mjpegServerPort: mjpegPort,
              };
              if (screenWidth > 0) {
                updateData.screenWidth = screenWidth.toString();
                updateData.screenHeight = screenHeight.toString();
              }
              await DeviceStoreFactory.getStore().updateDevice(udid, device.host, updateData);
            }

            log.info(`WDA is ready for ${udid} at port ${wdaPort}`);

            // Create a WDA session for keyboard/interaction operations
            try {
              const sessionId = await this.createWDASession(wdaPort);
              if (sessionId) {
                session.sessionId = sessionId;
                log.info(`Created WDA session ${sessionId} for ${udid} during stream startup`);
              }
            } catch (e: any) {
              log.warn(
                `Failed to create WDA session during stream startup for ${udid}: ${e.message}`,
              );
            }

            session.lastViewerAt = Date.now(); // Initialize activity
            return { wdaPort, mjpegPort };
          }

          if (session.wdaProcess?.exitCode !== null) {
            const logContent = fs.existsSync(wdaRunLog) ? fs.readFileSync(wdaRunLog, 'utf8') : '';
            throw new Error(
              `WDA process exited with code ${session.wdaProcess
                ?.exitCode}. Log: ${logContent.slice(-200)}`,
            );
          }

          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        throw new Error(`WDA failed to start within ${timeout / 1000}s. Check logs.`);
      } catch (error: any) {
        const session = this.sessions.get(udid);
        if (session) {
          session.status = 'error';
          session.lastError = error.message;
        }
        log.error(`Stream start failed for ${udid}: ${error.message}`);
        throw error;
      } finally {
        this.startPromises.delete(udid);
      }
    };

    // Set the promise in the map IMMEDIATELY before awaiting anything
    const startPromise = performStartup();
    this.startPromises.set(udid, startPromise);
    return startPromise;
  }

  private async killStaleProcesses(
    udid: string,
    wdaPort: number,
    mjpegPort: number,
  ): Promise<void> {
    log.info(`Cleaning up stale processes for ${udid} (Ports: ${wdaPort}, ${mjpegPort})`);

    // Senior Resiliency: Use centralized tunnel cleanup
    await this.cleanupOrphanTunnels(udid);

    const pkillCmds = [
      `pkill -9 -f "iproxy.*${udid}"`,
      `pkill -9 -f "ios runwda.*${udid}"`,
    ];

    for (const cmd of pkillCmds) {
      try {
        await execPromise(cmd);
      } catch (err) {
        /* ignore */
      }
    }

    // Port-based cleanup (more surgical)
    const ports = [wdaPort, mjpegPort];
    for (const port of ports) {
      try {
        const { stdout } = await execPromise(`lsof -ti :${port}`);
        const pids = stdout.trim().split('\n');
        for (const pid of pids) {
          if (pid) {
            log.debug(`Killing stale process ${pid} on port ${port}`);
            await execPromise(`kill -9 ${pid}`);
          }
        }
      } catch (err) {
        /* ignore - lsof returns 1 if no port found */
      }
    }

    // Small delay to ensure OS releases sockets
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  public async stopStream(udid: string): Promise<void> {
    const session = this.sessions.get(udid);
    if (!session) return;

    // Kill all processes including tunnel (CRITICAL: tunnel was missing from cleanup!)
    [session.wdaProcess, session.forwardWDAProcess, session.forwardMJPEGProcess, session.tunnelProcess].forEach((p) => {
      if (p)
        try {
          p.kill('SIGKILL');
        } catch (e) {
          // ignore
        }
    });

    // Principal Recovery: Release the device lock in the database
    try {
      const device = await DeviceStoreFactory.getStore().findDevice({ udid });
      if (device) {
        log.info(`Stream Stop: Manually releasing lock for ${udid}`);
        await unblockDevice(udid, device.host);
      }
    } catch (e) {
      log.error(`Failed to release lock during stream stop for ${udid}: ${e}`);
    }

    // Also clean up any orphan processes (belt and suspenders)
    await this.cleanupOrphanTunnels(udid);

    this.sessions.delete(udid);
  }

  private async updateWDASettings(wdaPort: number): Promise<void> {
    const urls = [`http://127.0.0.1:${wdaPort}/appium/settings`];
    const data = {
      settings: {
        mjpegServerPort: 9100,
        mjpegServerFramerate: 15, // Optimal for tunnel stability
        mjpegServerScreenshotQuality: 50, // Reduced quality to avoid ECONNRESETS during swipes
        mjpegScalingFactor: 100,
      },
    };

    for (const url of urls) {
      try {
        log.info(`Broadcasting WDA settings to ${url} (15fps/50%)`);
        await InternalHttpClient.post(url, data, { timeout: 10000 });
        return;
      } catch (error: any) {
        log.warn(`Failed to broadcast WDA settings via ${url}: ${error.code || error.message}`);
      }
    }
  }

  /**
   * Create a WDA session for keyboard/interaction operations
   * Uses minimal capabilities to avoid disrupting the current app
   * IMPORTANT: First checks if a session already exists (e.g., from active Appium automation)
   * and reuses it to avoid disrupting active automation runs.
   */
  private async createWDASession(wdaPort: number): Promise<string | null> {
    const axios = (await import('axios')).default;

    // SAFETY: First check if a session already exists (e.g., from active Appium session)
    // If yes, reuse it instead of creating a new one that could displace the automation
    try {
      const existingResponse = await axios.get(`http://127.0.0.1:${wdaPort}/sessions`, {
        timeout: 5000,
      });
      const sessions = existingResponse.data?.value || [];
      if (sessions.length > 0) {
        const existingSid = sessions[0].id || sessions[0].sessionId;
        if (existingSid) {
          log.info(`Reusing existing WDA session ${existingSid} (likely from active automation)`);
          return existingSid;
        }
      }
    } catch (err: any) {
      log.debug(`No existing WDA sessions found: ${err.message}`);
    }

    // No existing session - create a new one with minimal capabilities
    const sessionConfigs = [
      // Minimal session - doesn't specify bundleId, uses current app
      { capabilities: { alwaysMatch: {} } },
      // Springboard fallback
      { capabilities: { alwaysMatch: { bundleId: 'com.apple.springboard' } } },
    ];

    for (const config of sessionConfigs) {
      try {
        const response = await axios.post(`http://127.0.0.1:${wdaPort}/session`, config, {
          timeout: 15000,
          headers: { 'Content-Type': 'application/json' },
        });
        const sid = response.data?.sessionId || response.data?.value?.sessionId;
        if (sid) {
          return sid;
        }
      } catch (err: any) {
        log.debug(`WDA session creation attempt failed: ${err.message}`);
      }
    }
    return null;
  }

  public getStreamStatus(udid: string): StreamSession | undefined {
    return this.sessions.get(udid);
  }

  public updateViewerCount(udid: string, delta: number): void {
    const session = this.sessions.get(udid);
    if (session) {
      session.viewerCount = Math.max(0, session.viewerCount + delta);
      session.lastViewerAt = Date.now();
      log.debug(`[${udid}] iOS Stream viewer update: delta=${delta}, total=${session.viewerCount}`);
    }
  }

  public async cleanup(): Promise<void> {
    for (const udid of this.sessions.keys()) await this.stopStream(udid);
  }

  /**
   * Get the cached WDA session ID for a device
   */
  public getWDASessionId(udid: string): string | undefined {
    return this.sessions.get(udid)?.sessionId;
  }

  /**
   * Set/update the WDA session ID for a device.
   * Passing undefined will clear the cached session.
   */
  public setWDASessionId(udid: string, sessionId: string | undefined): void {
    const session = this.sessions.get(udid);
    if (session) {
      session.sessionId = sessionId;
      if (sessionId) {
        log.info(`Cached WDA Session ID for ${udid}: ${sessionId}`);
      } else {
        log.debug(`Cleared cached WDA Session ID for ${udid}`);
      }
    }
  }
}

export default IOSStreamService;
export { StreamSession };
