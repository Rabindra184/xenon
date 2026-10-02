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
import { findOwnDevice } from '../ownDeviceRow';
import {
  isMissingWdaError,
  isOwnStreamProcess,
  isWdaLaunchFailure,
  missingWdaMessage,
  wdaLaunchFailureMessage,
} from './iosStreamDiagnostics';
import { reapAllOrphanTunnels, reapTunnelsForUdid } from './tunnelProcess';
import { IOSTunnels } from './IOSTunnels';

import { unblockDevice } from '../../data-service/device-service';
import { isManualLock } from '../../services/recording/manualLock';
import { RecordingStore } from '../../services/recording/recording-store';

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
  /** The phone's go-ios tunnel-info port, when this stream's start ensured one (iOS 17+). */
  tunnelPort: number | null;
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

/** A preview nobody has watched for this long is stopped and its hold released. */
export const IOS_IDLE_STOP_MS = 600_000;

/**
 * Whether the watchdog may stop an idle iOS stream: nobody has watched it for
 * 10 minutes, no recording reads it (a recording reads the stream directly,
 * so it isn't counted as a viewer), and no Appium session relies on it. A
 * live-preview hold is not an Appium session, so an abandoned one goes.
 */
export function shouldStopIdleIosStream(use: {
  idleMs: number;
  viewers: number;
  sessionId?: string | null;
  recording: boolean;
}): boolean {
  if (use.viewers > 0 || use.idleMs <= IOS_IDLE_STOP_MS || use.recording) return false;
  return !use.sessionId || isManualLock(use.sessionId);
}

/**
 * Whether a live Appium session holds the phone: busy under a session id that
 * isn't a live-preview hold. A claim still waiting for its session id isn't
 * one yet.
 */
export function heldByAppiumSession(
  device: { busy?: boolean | null; session_id?: string | null } | null | undefined,
): boolean {
  return !!device?.busy && !!device.session_id && !isManualLock(device.session_id);
}

/** A start refused a restart because an Appium session holds the phone. */
export class StreamRestartRefused extends Error {}

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
    // Every minute, and cheap: an unwatched preview's hold was held for good,
    // because the only idle check ran hourly and kept every busy device.
    // unref()ed: the server's listener keeps the process alive; these only
    // need to fire while it runs.
    setInterval(() => void this.sweepIdle(), 60_000).unref();
    // Hourly: port leases and the stream health check, which probes WDA.
    setInterval(async () => {
      for (const [udid, session] of this.sessions.entries()) {
        if (session.status === 'running') {
          // Keep this stream's port leases alive so the allocator never hands
          // its ports to another device mid-stream (TTL > this 1h interval).
          try {
            const portAllocator = Container.get(PortAllocator);
            await portAllocator.touch(session.wdaPort, this.STREAM_PORT_TTL_MS);
            await portAllocator.touch(session.mjpegPort, this.STREAM_PORT_TTL_MS);
            await this.tunnels().touch(udid);
          } catch {
            /* best-effort lease refresh */
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
              const device = await findOwnDevice(udid);
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
    }, 3600000).unref(); // 1hr interval for background stability
  }

  /**
   * Stop streams nobody has watched for 10 minutes, which releases an
   * abandoned live-preview hold. A stream an Appium session or a recording
   * relies on is kept, and checked again 10 minutes later.
   */
  private async sweepIdle(): Promise<void> {
    const now = Date.now();
    for (const [udid, session] of this.sessions.entries()) {
      if (session.status !== 'running') continue;
      const idleMs = now - session.lastViewerAt;
      if (session.viewerCount > 0 || idleMs <= IOS_IDLE_STOP_MS) continue;
      try {
        const device = await findOwnDevice(udid);
        const recording = await Container.get(RecordingStore).isRecording(udid);
        const stop = shouldStopIdleIosStream({
          idleMs,
          viewers: session.viewerCount,
          sessionId: device?.session_id,
          recording,
        });
        if (!stop) {
          session.lastViewerAt = now;
          continue;
        }
        log.info(`[${udid}] [Watchdog] Stopping idle iOS stream (no viewers for 10 min)`);
        await this.stopStream(udid);
      } catch (e: any) {
        log.warn(`[${udid}] [Watchdog] Idle check failed: ${e?.message ?? e}`);
      }
    }
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
   * Clear this phone's go-ios leftovers before a start: the tunnel IOSTunnels
   * tracks for it, then any untracked go-ios process for it from an earlier
   * run. Never another phone's. Each phone's tunnel has its own ports, so
   * nothing is killed by port. Through 2.7 this also kill -9'd whatever
   * listened on go-ios's default ports, 60105 and 60106, which was another
   * iPhone's live tunnel.
   *
   * Never while an Appium session holds the phone. That session may be
   * driving a WDA go-ios launched (iOSCapabilities points a session at the
   * stream's WDA whenever a stream runs), and on iOS 17+ that WDA reaches the
   * phone through the phone's tunnel. Nothing here can tell that tunnel from
   * an orphan, so the sweep waits for the next stop or start after the
   * session ends; a restart reaps every go-ios process at boot.
   */
  private async cleanupOrphanTunnels(udid: string): Promise<void> {
    if (await this.appiumSessionMayUse(udid, 'go-ios tunnels')) return;
    // A tunnel opened for screenshots is live and tracked, not a leftover:
    // the start's ensure takes it over (IOSTunnels.borrow).
    if (this.tunnels().isOnDemand(udid)) return;
    log.debug(`Cleaning up orphan tunnels for ${udid}...`);

    await this.tunnels().stop(udid);

    // Reap the tunnel process *group* for this udid so the self-forking go-ios
    // agent children (whose argv carries no udid, so a udid-scoped pkill can't
    // see them) die with their parent instead of orphaning. Group-scoped, so a
    // second device's tunnel is left untouched. See ./tunnelProcess.
    await reapTunnelsForUdid(udid, execPromise);

    // Small delay to ensure OS releases sockets
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  private tunnels(): IOSTunnels {
    return Container.get(IOSTunnels);
  }

  /**
   * Whether an Appium session may be using what the caller is about to kill:
   * one holds the phone, or the phone's row can't be read, in which case
   * nothing is known and nothing is killed.
   */
  private async appiumSessionMayUse(udid: string, what: string): Promise<boolean> {
    try {
      const device = await findOwnDevice(udid);
      if (!heldByAppiumSession(device)) return false;
      log.info(
        `[${udid}] Leaving ${what} alone: Appium session ${device?.session_id} holds the device and may be using them`,
      );
    } catch (e: any) {
      log.warn(`[${udid}] Leaving ${what} alone: could not read the device: ${e?.message ?? e}`);
    }
    return true;
  }

  /**
   * Throw StreamRestartRefused when an Appium session holds the phone, as the
   * watchdog's heal already skips a busy device. A restart would kill the WDA
   * and go-ios tunnel the session may be driving, or, on a stream attached to
   * the session's own WDA, launch a second WDA over it. A WDA that is only
   * slow to answer /status (a long command) would be killed for nothing. The
   * stream is left as it is; it can restart once the session ends. A row that
   * can't be read refuses too.
   */
  private async refuseRestartUnderAppiumSession(udid: string): Promise<void> {
    let device;
    try {
      device = await findOwnDevice(udid);
    } catch (e: any) {
      throw new StreamRestartRefused(
        `Stream for ${udid} is not answering, and the device can't be read to check for an Appium session (${e?.message ?? e}): not restarting it.`,
      );
    }
    if (!heldByAppiumSession(device)) return;
    throw new StreamRestartRefused(
      `Stream for ${udid} is not answering, but Appium session ${device?.session_id} holds the device: not restarting the WDA and go-ios tunnel it may be driving. The stream can restart once the session ends.`,
    );
  }

  /**
   * Check if WDA is already running and responding
   * Principal Resilience: Retries transient connection errors (ECONNRESET) up to 2 times
   * with exponential backoff, as these often indicate WDA is restarting or tunnel is reconnecting.
   *
   * It says whether *a* WDA answers on the port, never whose. WDA names no
   * phone: /status carries os, ios.ip, build and device (the form factor),
   * and /wda/device/info's `uuid` is identifierForVendor, not the UDID. So it
   * takes no udid. A caller that must know the phone relies on the port
   * being one it already knows belongs to it: its own stream's leased port,
   * or the Device row's port while an Appium session holds that phone.
   */
  public async isWDARunning(wdaPort: number, retries = 2): Promise<boolean> {
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

      const device = await findOwnDevice(udid);
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

      const device = await findOwnDevice(udid);
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
      // Never under a live Appium session (see refuseRestartUnderAppiumSession).
      await this.refuseRestartUnderAppiumSession(udid);
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
          await this.refuseRestartUnderAppiumSession(udid);
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

        const device = await findOwnDevice(udid);
        if (!device) throw new Error(`Device ${udid} not found`);

        // Tear down this udid's previous session BEFORE acquiring ports, never
        // after. acquire() hands a udid back its own existing leases, so a
        // failed start's session names the very port numbers this start is
        // about to get. Stopped after acquiring, its release() deleted this
        // start's leases: the stream ran on unleased ports, and the allocator
        // gave its 9100 to the S9+. A no-op when there is no previous session.
        await this.stopStream(udid);

        // Resolve stream ports through the PortAllocator — never a value
        // persisted on the Device row. A stale persisted mjpegServerPort (e.g.
        // 9100) bypassed the allocator and could collide with another device's
        // live lease on the same port (the Android stream leases 9100 too),
        // taking both streams down. The allocator's lease table + OS-free probe
        // guarantee a non-colliding port; the lease is refreshed by the watchdog
        // and released in stopStream().
        const portAllocator = Container.get(PortAllocator);
        const ttl = { ttlMs: this.STREAM_PORT_TTL_MS };

        // Principal Discovery: attach to the WDA an Appium session runs on this
        // device instead of launching a second one over it. The one exception
        // to the rule above: that session's forwarder listens on the Device
        // row's wdaLocalPort (iOSCapabilities hands it to Appium), and acquire()
        // can't find it, because it refuses any port with a live listener, this
        // device's own included. Only while an Appium session holds the device:
        // WDA names no phone (see isWDARunning), so that session is the only
        // evidence the port is this phone's. Outside one, an answer on a stale
        // row's port may be another phone's WDA.
        const appiumWdaPort = heldByAppiumSession(device) ? device.wdaLocalPort : undefined;
        const alreadyUp = !!appiumWdaPort && (await this.isWDARunning(appiumWdaPort));
        let wdaPort: number;
        if (appiumWdaPort && alreadyUp) {
          wdaPort = appiumWdaPort;
          if (!(await portAllocator.claim('wda', udid, wdaPort, ttl))) {
            log.warn(
              `[${udid}] WDA port ${wdaPort} is leased to another device; attaching unleased`,
            );
          }
        } else {
          wdaPort = await portAllocator.acquire('wda', udid, ttl);
        }
        const mjpegPort = await portAllocator.acquire('mjpeg', udid, ttl);

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
            tunnelPort: null,
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
        // (the previous session was already stopped, before the ports were acquired)
        await this.killStaleProcesses(udid, wdaPort, mjpegPort);

        const session: StreamSession = {
          udid,
          wdaProcess: null,
          forwardWDAProcess: null,
          forwardMJPEGProcess: null,
          tunnelPort: null,
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

        // 2. The phone's own go-ios tunnel, for iOS 17+ (see IOSTunnels)
        session.tunnelPort = await this.tunnels().ensure(udid);

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
          // GO_IOS_AGENT_PORT: runwda reaches this phone through its own
          // tunnel, not go-ios's default 60105.
          env: this.tunnels().envFor(udid),
        });
        Container.get(ProcessRegistry).track({ kind: 'wda', udid, process: session.wdaProcess });

        const logDir = path.join(os.tmpdir(), 'xenon-logs');
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);
        const wdaRunLog = path.join(logDir, `runwda-${udid}.log`);
        // Truncated per run, because this file is also the evidence the failure
        // is classified from. Appending across runs meant a "Did not find test
        // app" line from a day earlier was still matched today, so every later
        // failure of any kind — including one where WDA was demonstrably
        // installed — was reported as "WebDriverAgent is not installed".
        fs.writeFileSync(wdaRunLog, '');
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
            const device = await findOwnDevice(udid);
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
            // Both of these are permanent until a human acts, and they call for
            // opposite actions — install the app, versus trust the app that is
            // already installed. Surface which, rather than a raw exit code and
            // a log tail.
            if (isMissingWdaError(logContent)) {
              throw new Error(missingWdaMessage(udid));
            }
            if (isWdaLaunchFailure(logContent)) {
              throw new Error(wdaLaunchFailureMessage(udid));
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
        // Not a failed start: the running stream is left exactly as it was.
        if (error instanceof StreamRestartRefused) throw error;
        const session = this.sessions.get(udid);
        if (session) {
          session.status = 'error';
          session.lastError = error.message;
        }
        // A start that got its tunnel up and then failed (WDA didn't launch)
        // stops that tunnel, so it doesn't run on, holding its ports, until
        // the phone's next start. Not while an Appium session may use it.
        if (
          session?.tunnelPort != null &&
          !(await this.appiumSessionMayUse(udid, "the failed start's go-ios tunnel"))
        ) {
          await this.tunnels().stop(udid);
          session.tunnelPort = null;
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

  /**
   * Stop this udid's stream: its processes, a live-preview hold, the go-ios
   * orphan sweep (see cleanupOrphanTunnels) and its port leases.
   *
   * `forViewer` means the caller is only done watching (stream/stop,
   * stream/leave). While an Appium session holds the phone and this stream
   * launched its own WDA, nothing is stopped: a session allocated while the
   * stream ran drives that WDA, through this stream's forwarder and go-ios
   * tunnel. The session's teardown stops it (EventManager
   * stopIdleStreamForDevice), or the idle watchdog once the session has
   * ended. A restart never passes it: the WDA already failed its health check.
   */
  public async stopStream(udid: string, opts: { forViewer?: boolean } = {}): Promise<void> {
    const session = this.sessions.get(udid);
    if (!session) return;
    if (
      opts.forViewer &&
      session.wdaProcess &&
      (await this.appiumSessionMayUse(udid, "the stream's WDA and go-ios tunnel"))
    ) {
      return;
    }

    // Kill sidecar processes.
    [session.wdaProcess, session.forwardWDAProcess, session.forwardMJPEGProcess].forEach((p) => {
      if (p)
        try {
          p.kill('SIGKILL');
        } catch (e) {
          // ignore
        }
    });
    // This stream's go-ios tunnel: its whole process group and its port pair.
    // A stream attached to an Appium session's WDA started none.
    if (session.tunnelPort != null) await this.tunnels().stop(udid);

    // Principal Fix: Only release the device lock if THIS STREAM SERVICE owns it.
    // The lock could belong to an Appium automation session (session_id is a real UUID).
    // We should only unblock if it's a manual control lock (session_id starts with 'manual_').
    try {
      const device = await findOwnDevice(udid);
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
      await portAllocator.release(session.wdaPort, udid);
      await portAllocator.release(session.mjpegPort, udid);
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
    // Every go-ios process is gone, so no tunnel holds its ports. A lease left
    // by an earlier run would otherwise keep its pair for up to 1.5 hours.
    try {
      await Container.get(PortAllocator).releasePurpose('tunnel');
    } catch (err: any) {
      log.warn(`[IOSStreamService] Releasing tunnel port leases failed: ${err?.message ?? err}`);
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
