/**
 * iOS Stream Service
 *
 * This service manages independent MJPEG streaming for iOS devices without requiring
 * an active Appium session. It uses go-ios to start WDA and forwards the MJPEG stream.
 */

import { Service } from 'typedi';
import { ProcessRegistry } from '../../services/ProcessRegistry';
import { spawn, ChildProcess, exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import os from 'os';
import http from 'http';
import fs from 'fs-extra';
import tcpPortUsed from 'tcp-port-used';
import { InternalHttpClient } from '../../InternalHttpClient';
import log from '../../logger';
import { cachePath } from '../../helpers';
import { SingleFlight } from '../../helpers/singleFlight';
import { PortAllocator } from '../../services/PortAllocator';
import { DeviceStoreFactory } from '../../data-service/device-store';
import {
  classifyTunnelStderr,
  isMissingWdaError,
  isOwnStreamProcess,
  missingWdaMessage,
} from './iosStreamDiagnostics';
import {
  killProcessGroup,
  reapAllOrphanTunnels,
  reapTunnelsForUdid,
  tunnelSpawnOptions,
} from './tunnelProcess';

import { unblockDevice } from '../../data-service/device-service';

const execPromise = promisify(exec);
import { Container } from 'typedi';
import {
  ResourceIsolationService,
  IsolationProfile,
} from '../../services/ResourceIsolationService';

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
  private startFlight = new SingleFlight<{ wdaPort: number; mjpegPort: number }>();
  private recoveryCooldowns: Map<string, number> = new Map(); // Track last recovery attempt time
  private readonly RECOVERY_COOLDOWN_MS = 30000; // 30s cooldown between recovery attempts
  // Port-lease TTL for an active stream. Longer than the watchdog interval (1h),
  // which refreshes it each tick, so a long-lived stream's port never expires
  // and gets reallocated to another device; stopStream() releases it explicitly.
  private readonly STREAM_PORT_TTL_MS = 90 * 60 * 1000; // 1.5h
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
          // Keep this stream's port leases alive so the allocator never hands
          // its ports to another device mid-stream (TTL > this 1h interval).
          try {
            const portAllocator = Container.get(PortAllocator);
            await portAllocator.touch(session.wdaPort, this.STREAM_PORT_TTL_MS);
            await portAllocator.touch(session.mjpegPort, this.STREAM_PORT_TTL_MS);
          } catch {
            /* best-effort lease refresh */
          }

          // Check for inactivity
          if (now - session.lastViewerAt > 600000 && session.viewerCount === 0) {
            // Principal Protection: Never stop a stream if the device is busy with an active session.
            // This prevents the watchdog from killing WDA while a test is running.
            const device = await DeviceStoreFactory.getStore().findDevice({ udid });
            if (device && device.busy) {
              log.debug(
                `🛡️ [${udid}] [Watchdog] Stream is idle but device is BUSY. Keeping alive.`,
              );
              session.lastViewerAt = Date.now(); // Refresh timer to avoid constant DB checks
              continue;
            }

            log.info(`[${udid}] [Watchdog] Stopping idle iOS stream (No viewers for 30s)`);
            this.stopStream(udid);
            continue;
          }

          // 2. Health check & Self-Healing
          // We use elased autonomous methodology to ensure devices are always warm
          const isAlive = await this.isStreamResponsive(udid);
          if (!isAlive) {
            // Check cooldown before attempting recovery
            if (!this.canAttemptRecovery(udid)) {
              const lastAttempt = this.recoveryCooldowns.get(udid);
              const waitMs = this.RECOVERY_COOLDOWN_MS - (Date.now() - (lastAttempt || 0));
              log.debug(
                `[Watchdog] ${udid} stream unhealthy but recovery cooldown active (${Math.ceil(waitMs / 1000)}s remaining). Skipping recovery attempt.`,
              );
              continue;
            }

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
              this.markRecoveryAttempt(udid);
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
    }, 3600000); // 1hr interval for background stability
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
      const versionStr = String(
        info.ProductVersion || info.HumanReadableProductVersionString || '0',
      );
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
          'Performance', // Performance mode for critical tunnel stability
        );

        // detached: the go-ios tunnel leads its own process group so its
        // self-forking agent children are reaped as a group on cleanup instead
        // of orphaning into a runaway respawn storm. See ./tunnelProcess.
        const tunnelProcess = spawn(
          command,
          args,
          tunnelSpawnOptions({ ...process.env, ENABLE_GO_IOS_AGENT: 'yes' }),
        );
        Container.get(ProcessRegistry).track({ kind: 'other', udid, process: tunnelProcess });

        tunnelProcess.stdout?.on('data', (data) => log.debug(`Tunnel [${udid}]: ${data}`));
        // go-ios repeatedly warns about any connected pre-iOS-17 device (which
        // needs no tunnel). Log that once — attributed to the real target udid,
        // not this tunnel's owner — and suppress the rest to avoid log spam.
        const loggedUnsupported = new Set<string>();
        tunnelProcess.stderr?.on('data', (data) => {
          const text = String(data);
          const { unsupported, udid: targetUdid } = classifyTunnelStderr(text);
          if (unsupported) {
            const key = targetUdid ?? 'unknown';
            if (!loggedUnsupported.has(key)) {
              loggedUnsupported.add(key);
              log.debug(
                `Tunnel [${udid}]: device ${key} is pre-iOS 17 and needs no tunnel; suppressing repeated go-ios warnings`,
              );
            }
            return;
          }
          log.debug(`Tunnel Err [${udid}]: ${text}`);
        });

        // Wait for tunnel to establish by checking the go-ios agent port
        log.info('Waiting for tunnel agent on port 60105 to be ready...');
        let tunnelReady = false;
        const tunnelTimeout = 15000;
        const subStartTime = Date.now();
        while (Date.now() - subStartTime < tunnelTimeout) {
          try {
            tunnelReady = await tcpPortUsed.check(60105, '127.0.0.1');
            if (tunnelReady) break;
          } catch (e) {
            /* ignore */
          }
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        if (!tunnelReady) {
          log.warn(
            `Tunnel agent port 60105 not ready after ${tunnelTimeout / 1000}s, proceeding anyway...`,
          );
        } else {
          log.info('Tunnel agent is ready. Settling for 2s...');
          await new Promise((resolve) => setTimeout(resolve, 2000));
          log.info('Tunnel agent settled.');
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

    // Reap the tunnel process *group* for this udid so the self-forking go-ios
    // agent children (whose argv carries no udid, so a udid-scoped pkill can't
    // see them) die with their parent instead of orphaning. Group-scoped, so a
    // second device's tunnel is left untouched. See ./tunnelProcess.
    await reapTunnelsForUdid(udid, execPromise);

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
   * Principal Resilience: Retries transient connection errors (ECONNRESET) up to 2 times
   * with exponential backoff, as these often indicate WDA is restarting or tunnel is reconnecting.
   */
  public async isWDARunning(
    wdaPort: number,
    udid?: string,
    retries = 2,
  ): Promise<boolean> {
    const axios = (await import('axios')).default;
    const host = '127.0.0.1'; // Force IPv4 for local tunnels
    const maxRetries = retries;
    let lastError: any;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await axios.get(`http://${host}:${wdaPort}/status`, {
          timeout: 2500, // 2.5s for consistency
          httpAgent: new http.Agent({ keepAlive: false }),
          validateStatus: (status) => status === 200,
        });

        // Principal Resilience: Verify the UDID if provided to ensure we're talking to the right device
        const remoteUdid = response.data?.value?.ios?.udid;
        if (udid && remoteUdid && remoteUdid !== udid) {
          log.warn(
            `[WDA] Port ${wdaPort} is used by a DIFFERENT device: ${remoteUdid} (expected ${udid})`,
          );
          return false;
        }

        const isReady = response.data?.value?.ready === true;
        if (!isReady) {
          log.debug(
            `[WDA] Port ${wdaPort} active but not ready. Status: ${JSON.stringify(
              response.data?.value,
            )}`,
          );
        }
        return isReady;
      } catch (error: any) {
        lastError = error;
        const isTransientError =
          error.code === 'ECONNRESET' ||
          error.code === 'ETIMEDOUT' ||
          error.code === 'ECONNABORTED' ||
          (error.response && error.response.status >= 500);

        if (isTransientError && attempt < maxRetries) {
          const backoffMs = Math.min(500 * Math.pow(2, attempt), 2000); // 500ms, 1000ms, 2000ms max
          log.debug(
            `[WDA] Port ${wdaPort} transient error (${error.code || error.response?.status}), retrying in ${backoffMs}ms (attempt ${attempt + 1}/${maxRetries + 1})`,
          );
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          continue;
        }

        // Permanent error or max retries reached
        if (error.code === 'ECONNREFUSED') {
          log.debug(`[WDA] Port ${wdaPort} connection refused (Tunnel likely down)`);
        } else if (error.code === 'ECONNABORTED') {
          log.debug(`[WDA] Port ${wdaPort} health check timed out (WDA hanging)`);
        } else if (error.code === 'ECONNRESET') {
          log.debug(
            `[WDA] Port ${wdaPort} connection reset after ${attempt + 1} attempts (WDA may be restarting or tunnel unstable)`,
          );
        } else {
          log.debug(`[WDA] Port ${wdaPort} health check failed: ${error.message}`);
        }
        return false;
      }
    }

    return false;
  }

  /**
   * Comprehensive process-level and endpoint-level health check.
   * Principal Intelligence: Differentiates between 'Process dead' and 'Network unreachable'.
   * If only the tunnel is dead but WDA is alive via IP, it will trigger a tunnel restart.
   */
  public async isStreamResponsive(udid: string): Promise<boolean> {
    const session = this.sessions.get(udid);
    if (!session || session.status !== 'running') return false;

    // 1. Process Check: verify child processes haven't exited
    const isWdaAlive = session.wdaProcess && session.wdaProcess.exitCode === null;
    const isWdaIproxyAlive =
      session.forwardWDAProcess && session.forwardWDAProcess.exitCode === null;
    const isMjpegIproxyAlive =
      session.forwardMJPEGProcess && session.forwardMJPEGProcess.exitCode === null;

    if (!isWdaAlive) {
      log.warn(`🛡️ [${udid}] [Watchdog] WDA process is dead. Full restart required.`);
      return false;
    }

    if (!isWdaIproxyAlive || !isMjpegIproxyAlive) {
      log.warn(
        `🛡️ [${udid}] [Watchdog] Tunnel processes are dead. Attempting tunnel-only recovery...`,
      );

      const device = await DeviceStoreFactory.getStore().findDevice({ udid });
      if (device && device.ip) {
        // Double check if WDA is alive via network IP
        const isWdaAccessibleViaNetwork = await this.isWDARunningOnHost(device.ip, 8100);
        if (isWdaAccessibleViaNetwork) {
          log.info(
            `🛡️ [${udid}] [Watchdog] WDA is alive on network ${device.ip}. Restarting tunnels...`,
          );
          await this.restartTunnelsOnly(session);
          return true; // We healed it!
        }
      }
      return false; // Cannot heal without network access or if WDA is also dead
    }

    // 2. Network Check: verify endpoint is responding via tunnel
    const isRespondingViaTunnel = await this.isWDARunning(session.wdaPort);
    if (!isRespondingViaTunnel) {
      log.warn(
        `🛡️ [${udid}] [Watchdog] WDA tunnel on port ${session.wdaPort} is unresponsive. checking network...`,
      );

      const device = await DeviceStoreFactory.getStore().findDevice({ udid });
      if (device && device.ip) {
        const isWdaAccessibleViaNetwork = await this.isWDARunningOnHost(device.ip, 8100);
        if (isWdaAccessibleViaNetwork) {
          log.info(
            `🛡️ [${udid}] [Watchdog] WDA is alive on network but tunnel is hung. Restarting tunnels...`,
          );
          await this.restartTunnelsOnly(session);
          return true;
        }
      }
      return false;
    }

    return true;
  }

  /**
   * Check if WDA is running on a specific host/port
   */
  private async isWDARunningOnHost(host: string, port: number): Promise<boolean> {
    const axios = (await import('axios')).default;
    try {
      const response = await axios.get(`http://${host}:${port}/status`, {
        timeout: 3000,
        validateStatus: (status) => status === 200,
      });
      return response.data?.value?.ready === true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Restarts only the iproxy tunnels without stopping WDA
   */
  private async restartTunnelsOnly(session: StreamSession): Promise<void> {
    const udid = session.udid;
    const isolationService = Container.get(ResourceIsolationService);

    // 1. Kill old tunnels
    if (session.forwardWDAProcess) session.forwardWDAProcess.kill('SIGKILL');
    if (session.forwardMJPEGProcess) session.forwardMJPEGProcess.kill('SIGKILL');

    // 2. Start new tunnels
    const wdaIproxy = isolationService.wrapSpawn(
      'iproxy',
      ['-u', udid, `${session.wdaPort}:8100`],
      'Performance',
    );
    const mjpegIproxy = isolationService.wrapSpawn(
      'iproxy',
      ['-u', udid, `${session.mjpegPort}:9100`],
      'Performance',
    );

    session.forwardWDAProcess = spawn(wdaIproxy.command, wdaIproxy.args);
    Container.get(ProcessRegistry).track({ kind: 'other', udid, process: session.forwardWDAProcess });
    session.forwardMJPEGProcess = spawn(mjpegIproxy.command, mjpegIproxy.args);
    Container.get(ProcessRegistry).track({ kind: 'ios-mjpeg', udid, process: session.forwardMJPEGProcess });

    log.info(`🛡️ [${udid}] [Watchdog] Tunnels restarted successfully.`);
  }

  /**
   * Start streaming for a device
   */
  /**
   * Check if recovery is allowed (cooldown period has passed)
   */
  private canAttemptRecovery(udid: string): boolean {
    const lastAttempt = this.recoveryCooldowns.get(udid);
    if (!lastAttempt) return true;
    const elapsed = Date.now() - lastAttempt;
    return elapsed >= this.RECOVERY_COOLDOWN_MS;
  }

  /**
   * Mark recovery attempt timestamp
   */
  private markRecoveryAttempt(udid: string): void {
    this.recoveryCooldowns.set(udid, Date.now());
  }

  public async startStream(udid: string): Promise<{ wdaPort: number; mjpegPort: number }> {
    // Check if stream is already running - avoid unnecessary restarts
    const existingSession = this.sessions.get(udid);
    if (existingSession && existingSession.status === 'running') {
      const isHealthy = await this.isWDARunning(existingSession.wdaPort);
      if (isHealthy) {
        log.debug(`[${udid}] Stream already running and healthy, reusing existing session`);
        return { wdaPort: existingSession.wdaPort, mjpegPort: existingSession.mjpegPort };
      }
      // Stream exists but unhealthy - check cooldown before recovery
      if (!this.canAttemptRecovery(udid)) {
        const lastAttempt = this.recoveryCooldowns.get(udid);
        const waitMs = this.RECOVERY_COOLDOWN_MS - (Date.now() - (lastAttempt || 0));
        log.debug(
          `[${udid}] Recovery cooldown active (${Math.ceil(waitMs / 1000)}s remaining). Skipping recovery attempt.`,
        );
        throw new Error(
          `Stream recovery is in cooldown. Last attempt was ${Math.ceil(waitMs / 1000)}s ago.`,
        );
      }
      // Stop unhealthy stream before restarting
      log.info(`[${udid}] Stream exists but unhealthy, stopping before restart...`);
      await this.stopStream(udid);
    }

    // Startup-failure circuit-breaker: a failed start (e.g. WDA not installed on
    // the device) sets a recovery cooldown. Until it elapses, short-circuit with
    // a clear error instead of re-running the full, doomed startup on every
    // stream request — otherwise a client polling the stream URL drives a
    // resource-burning restart loop.
    if (!existingSession || existingSession.status !== 'running') {
      if (!this.canAttemptRecovery(udid)) {
        const lastAttempt = this.recoveryCooldowns.get(udid);
        const waitMs = this.RECOVERY_COOLDOWN_MS - (Date.now() - (lastAttempt || 0));
        const reason = existingSession?.lastError ? ` Last error: ${existingSession.lastError}` : '';
        throw new Error(
          `Stream start is cooling down for ${Math.ceil(waitMs / 1000)}s after a failed attempt.${reason}`,
        );
      }
    }

    // Define the core logic as an internal async function
    const performStartup = async () => {
      try {
        const existingSession = this.sessions.get(udid);
        if (existingSession && existingSession.status === 'running') {
          const isHealthy = await this.isWDARunning(existingSession.wdaPort);
          if (isHealthy) {
            log.debug(`[${udid}] Stream already running and healthy, reusing existing session`);
            return { wdaPort: existingSession.wdaPort, mjpegPort: existingSession.mjpegPort };
          }
          // Stream exists but unhealthy - check cooldown before recovery
          if (!this.canAttemptRecovery(udid)) {
            const lastAttempt = this.recoveryCooldowns.get(udid);
            const waitMs = this.RECOVERY_COOLDOWN_MS - (Date.now() - (lastAttempt || 0));
            log.debug(
              `[${udid}] Recovery cooldown active (${Math.ceil(waitMs / 1000)}s remaining). Skipping recovery attempt.`,
            );
            throw new Error(
              `Stream recovery is in cooldown. Last attempt was ${Math.ceil(waitMs / 1000)}s ago.`,
            );
          }
          log.info(`Existing session for ${udid} not responding, restarting...`);
          this.markRecoveryAttempt(udid);
        }

        const device = await DeviceStoreFactory.getStore().findDevice({ udid });
        if (!device) throw new Error(`Device ${udid} not found`);

        // Always resolve stream ports through the PortAllocator — never a value
        // persisted on the Device row. A stale persisted mjpegServerPort (e.g.
        // 9100) bypassed the allocator and could collide with another device's
        // live lease on the same port (the Android stream leases 9100 too),
        // taking both streams down. The allocator's lease table + OS-free probe
        // guarantee a non-colliding port; the lease is refreshed by the watchdog
        // and released in stopStream().
        const portAllocator = Container.get(PortAllocator);
        const wdaPort = await portAllocator.acquire('wda', udid, { ttlMs: this.STREAM_PORT_TTL_MS });
        const mjpegPort = await portAllocator.acquire('mjpeg', udid, {
          ttlMs: this.STREAM_PORT_TTL_MS,
        });

        // Principal Discovery: Check if WDA is already up (e.g. from an active Appium session)
        // If yes, and it belongs to our device, we simply attach to it instead of killing it.
        const alreadyUp = await this.isWDARunning(wdaPort, udid);
        if (alreadyUp) {
          log.info(`[${udid}] WDA already responding on port ${wdaPort}. Attaching to existing tunnel...`);

          // WDA reachable on 127.0.0.1:wdaPort means the WDA iproxy is live, but the
          // MJPEG iproxy is a separate process and may have died (or never started if
          // WDA was launched outside our service). If we don't ensure it here, the
          // proxy connection to 127.0.0.1:mjpegPort will fail and the tile shows
          // "Connection Failed" even though WDA itself is healthy.
          const isolationService = Container.get(ResourceIsolationService);
          let forwardMJPEGProcess: ChildProcess | null = null;
          const mjpegForwarded = await tcpPortUsed.check(mjpegPort, '127.0.0.1');
          if (!mjpegForwarded) {
            log.info(
              `[${udid}] MJPEG port ${mjpegPort} not forwarded. Starting iproxy ${mjpegPort}:9100...`,
            );
            const mjpegIproxy = isolationService.wrapSpawn(
              'iproxy',
              ['-u', udid, `${mjpegPort}:9100`],
              'Performance',
            );
            forwardMJPEGProcess = spawn(mjpegIproxy.command, mjpegIproxy.args);
            Container.get(ProcessRegistry).track({
              kind: 'ios-mjpeg',
              udid,
              process: forwardMJPEGProcess,
            });
            forwardMJPEGProcess.on('error', (err) =>
              log.error(`iproxy-mjpeg [${udid}] error: ${err.message}`),
            );
            // Give iproxy a moment to bind; without this the proxy can race past us
            // and hit ECONNREFUSED on its first attempt.
            for (let i = 0; i < 5; i++) {
              if (await tcpPortUsed.check(mjpegPort, '127.0.0.1')) break;
              await new Promise((resolve) => setTimeout(resolve, 500));
            }
          }

          const session: StreamSession = {
            udid,
            wdaProcess: null,
            forwardWDAProcess: null,
            forwardMJPEGProcess,
            tunnelProcess: null,
            wdaPort,
            mjpegPort,
            status: 'running',
            startedAt: new Date(),
            lastViewerAt: Date.now(),
            viewerCount: 0,
          };
          this.sessions.set(udid, session);

          // Ensure MJPEG server is enabled if it wasn't already
          await this.updateWDASettings(wdaPort);

          return { wdaPort, mjpegPort };
        }

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

        const wdaIproxy = isolationService.wrapSpawn(
          'iproxy',
          ['-u', udid, `${wdaPort}:8100`],
          'Performance',
        );
        const mjpegIproxy = isolationService.wrapSpawn(
          'iproxy',
          ['-u', udid, `${mjpegPort}:9100`],
          'Performance',
        );

        session.forwardWDAProcess = spawn(wdaIproxy.command, wdaIproxy.args);
        Container.get(ProcessRegistry).track({ kind: 'other', udid, process: session.forwardWDAProcess });
        session.forwardMJPEGProcess = spawn(mjpegIproxy.command, mjpegIproxy.args);
        Container.get(ProcessRegistry).track({ kind: 'ios-mjpeg', udid, process: session.forwardMJPEGProcess });

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

        const wdaSpawn = isolationService.wrapSpawn(
          this.goIOSPath,
          [
            'runwda',
            '--bundleid',
            bundleId,
            '--testrunnerbundleid',
            bundleId,
            '--xctestconfig',
            'WebDriverAgentRunner.xctest',
            '--udid',
            udid,
          ],
          'Performance',
        ); // WDA deserves Performance mode

        session.wdaProcess = spawn(wdaSpawn.command, wdaSpawn.args, {
          env: { ...process.env, ENABLE_GO_IOS_AGENT: 'yes' },
        });
        Container.get(ProcessRegistry).track({ kind: 'wda', udid, process: session.wdaProcess });

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
            // Clear recovery cooldown on successful start
            this.recoveryCooldowns.delete(udid);
            return { wdaPort, mjpegPort };
          }

          if (session.wdaProcess?.exitCode !== null) {
            const logContent = fs.existsSync(wdaRunLog) ? fs.readFileSync(wdaRunLog, 'utf8') : '';
            // Missing WDA is permanent until the app is installed — surface an
            // actionable reason instead of a raw exit code + log tail.
            if (isMissingWdaError(logContent)) {
              throw new Error(missingWdaMessage(udid));
            }
            throw new Error(
              `WDA process exited with code ${session.wdaProcess?.exitCode
              }. Log: ${logContent.slice(-200)}`,
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
        // Back off before the next attempt so a polling client can't drive a
        // restart loop against a device that keeps failing to start.
        this.markRecoveryAttempt(udid);
        log.error(`Stream start failed for ${udid}: ${error.message}`);
        throw error;
      }
    };

    // Dedupe through SingleFlight so registration cannot race the release.
    // This path happened to be safe only because every early return awaited
    // first; Android's did not, and silently poisoned its map (issue #194).
    return this.startFlight.run(udid, performStartup);
  }

  private async killStaleProcesses(
    udid: string,
    wdaPort: number,
    mjpegPort: number,
  ): Promise<void> {
    log.info(`Cleaning up stale processes for ${udid} (Ports: ${wdaPort}, ${mjpegPort})`);

    // Senior Resiliency: Use centralized tunnel cleanup
    await this.cleanupOrphanTunnels(udid);

    // Principal Resilience: Avoid broad pkill on the UDID, which kills Appium's tunnels too.
    // Instead, rely on the surgical lsof port-based cleanup below to only clear
    // the specific ports we need.
    const pkillCmds: string[] = []; // Broad pkill disabled for automation co-existence
    
    if (pkillCmds.length > 0) {
      for (const cmd of pkillCmds) {
        try {
          await execPromise(cmd);
        } catch (err) {
          /* ignore */
        }
      }
    }

    // Port-based cleanup (more surgical). Only kill a process if it is *ours* —
    // its command line must reference this udid. Ports can be shared across
    // subsystems (e.g. an iOS device defaulting to mjpegServerPort 9100 collides
    // with the Android stream's PortAllocator lease at 9100), and blindly killing
    // every listener on the port would tear down a healthy neighbour's stream.
    const ports = [wdaPort, mjpegPort];
    for (const port of ports) {
      try {
        const { stdout } = await execPromise(`lsof -ti :${port}`);
        const pids = stdout.trim().split('\n').filter(Boolean);
        for (const pid of pids) {
          let command = '';
          try {
            const { stdout: cmd } = await execPromise(`ps -p ${pid} -o command=`);
            command = cmd.trim();
          } catch {
            /* process already gone, or ps failed — treat as not-ours */
          }
          if (!isOwnStreamProcess(command, udid)) {
            log.debug(
              `Leaving process ${pid} on port ${port} alone — not owned by ${udid} (cmd: ${command || 'unknown'})`,
            );
            continue;
          }
          log.debug(`Killing stale process ${pid} on port ${port} for ${udid}`);
          await execPromise(`kill -9 ${pid}`);
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

    // Kill sidecar processes. The go-ios tunnel is detached (its own process
    // group), so reap the whole group — a plain p.kill() would leave the
    // self-forking agent children behind to respawn. See ./tunnelProcess.
    [session.wdaProcess, session.forwardWDAProcess, session.forwardMJPEGProcess].forEach((p) => {
      if (p)
        try {
          p.kill('SIGKILL');
        } catch (e) {
          // ignore
        }
    });
    killProcessGroup(session.tunnelProcess?.pid);

    // Principal Fix: Only release the device lock if THIS STREAM SERVICE owns it.
    // The lock could belong to an Appium automation session (session_id is a real UUID).
    // We should only unblock if it's a manual control lock (session_id starts with 'manual_').
    try {
      const device = await DeviceStoreFactory.getStore().findDevice({ udid });
      if (device && device.session_id?.startsWith('manual_')) {
        log.info(`Stream Stop: Releasing manual control lock for ${udid}`);
        await unblockDevice(udid, device.host);
      } else if (device && device.busy) {
        log.info(
          `Stream Stop: Device ${udid} is busy with session ${device.session_id}. NOT releasing lock.`,
        );
      }
    } catch (e) {
      log.error(`Failed to check/release lock during stream stop for ${udid}: ${e}`);
    }

    // Also clean up any orphan processes (belt and suspenders)
    await this.cleanupOrphanTunnels(udid);

    // Release the port leases so the allocator can reuse these ports for other
    // devices — they were held for the lifetime of this stream.
    try {
      const portAllocator = Container.get(PortAllocator);
      await portAllocator.release(session.wdaPort);
      await portAllocator.release(session.mjpegPort);
    } catch (e) {
      log.warn(`Failed to release port leases for ${udid}: ${e}`);
    }

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
    // Full shutdown: sweep any go-ios tunnels/agents that escaped per-session
    // teardown (e.g. a detached agent child that setsid'd into a new group).
    await this.reapOrphanTunnels();
  }

  /**
   * Reap every process running the vendored go-ios binary. Safe only when the
   * server owns no legitimate tunnel — i.e. on fresh boot (orphans from a
   * previous run, or a hard-killed / crashed process whose graceful cleanup
   * never ran) or during full shutdown. This is the catch-all that stops the
   * self-forking go-ios agent storm from surviving across restarts.
   */
  public async reapOrphanTunnels(): Promise<void> {
    try {
      const reaped = await reapAllOrphanTunnels(this.goIOSPath, execPromise);
      if (reaped > 0) {
        log.info(`[IOSStreamService] Reaped ${reaped} orphan go-ios tunnel process(es)`);
      }
    } catch (err: any) {
      log.warn(`[IOSStreamService] Orphan tunnel reap failed: ${err?.message ?? err}`);
    }
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
