import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { Container, Service } from 'typedi';
import log from '../../logger';
import { prisma } from '../../prisma';
import type { IDevice } from '../../interfaces/IDevice';
import { PluginContext } from '../../PluginContext';
import { isOwnDevice, localDeviceHosts } from '../../device-managers/localDeviceHosts';
import { XenonManager } from '../../device-managers';
import AndroidDeviceManager from '../../device-managers/AndroidDeviceManager';
import { IOSTunnels } from '../../device-managers/ios/IOSTunnels';
import { goIosBinaryPath } from '../../device-managers/ios/goIosBinary';
import { ProcessRegistry } from '../ProcessRegistry';
import { appPackageOf } from './androidMetrics';
import { AndroidMetricsSampler } from './AndroidMetricsSampler';
import { IOSMetricsSampler } from './IOSMetricsSampler';
import { NodeMetricsStore } from './NodeMetricsStore';
import {
  FLUSH_INTERVAL_MS,
  MAX_BUFFERED_SAMPLES,
  MetricSample,
  MetricsSampler,
  RecordingState,
  SamplerHooks,
} from './types';

const execFileAsync = promisify(execFile);

/** One adb call of a sample; one that hangs this long is a failed sample. */
const ADB_TIMEOUT_MS = 5_000;

export interface MetricsStart {
  sessionId: string;
  device: IDevice;
  capabilities: Record<string, any>;
}

interface Running {
  sampler: MetricsSampler;
  buffer: MetricSample[];
  /** None on a node, which holds samples for its hub instead of writing them. */
  flushTimer?: ReturnType<typeof setInterval>;
  /** Writes run one after another. */
  writing: Promise<void>;
  /** The sampler stopped itself after repeated failures. */
  gaveUp: boolean;
  /** On a node: the samples go to the NodeMetricsStore. */
  held: boolean;
}

/**
 * CPU and memory for the session page's Performance panel. A sampler per
 * session on this server's own phones, from EventManager's start (once the
 * session's row exists) to its stop; samples are written every
 * FLUSH_INTERVAL_MS. Sampling never fails a session.
 */
@Service()
export class SessionMetricsService {
  private log = log.scope('SessionMetrics');
  private running = new Map<string, Running>();

  /** Whether a session on this phone is sampled. */
  appliesTo(device: IDevice | undefined): boolean {
    if (!device) return false;
    const ctx = this.context();
    if (ctx.pluginArgs?.sessionMetrics === false) return false;
    const platform = String(device.platform ?? '').toLowerCase();
    // An emulator's /proc reads like a phone's; a simulator has no sysmontap.
    if (platform !== 'android' && !(platform === 'ios' && device.realDevice === true)) {
      return false;
    }
    return isOwnDevice(localDeviceHosts(ctx.pluginArgs, ctx.port), ctx.nodeId, device);
  }

  start({ sessionId, device, capabilities }: MetricsStart): void {
    if (this.running.has(sessionId) || !this.appliesTo(device)) return;
    // A node has no Session row for the hub's sessions, so it holds the
    // figures for its hub to collect (GET /node/sessions/:id/metrics).
    const held = this.holdsForHub();
    const store = held ? this.nodeStore() : null;
    const hooks: SamplerHooks = {
      onSample: (s) => {
        if (store) store.add(sessionId, s);
        else this.running.get(sessionId)?.buffer.push(s);
      },
      onGiveUp: (reason) => {
        const entry = this.running.get(sessionId);
        if (entry) entry.gaveUp = true;
        store?.gaveUp(sessionId);
        this.log.warn(`[${sessionId}] Stopped sampling ${device.udid}: ${reason}`);
      },
    };
    let sampler: MetricsSampler;
    try {
      sampler = this.samplerFor(sessionId, device, capabilities, hooks);
    } catch (err: any) {
      this.log.warn(`[${sessionId}] Can't sample ${device.udid}: ${err?.message ?? err}`);
      return;
    }
    store?.begin(sessionId, String(device.platform ?? ''));
    let flushTimer: ReturnType<typeof setInterval> | undefined;
    if (!held) {
      flushTimer = setInterval(() => void this.flush(sessionId), FLUSH_INTERVAL_MS);
      flushTimer.unref?.();
    }
    this.running.set(sessionId, {
      sampler,
      buffer: [],
      flushTimer,
      writing: Promise.resolve(),
      gaveUp: false,
      held,
    });
    sampler.start();
    this.log.info(`[${sessionId}] Sampling CPU and memory on ${device.udid}`);
  }

  /** Whether this server is sampling a running session, stopped after giving up, or never did. */
  recordingState(sessionId: string): RecordingState {
    const entry = this.running.get(sessionId);
    if (!entry) return 'off';
    return entry.gaveUp ? 'stopped' : 'sampling';
  }

  /** Stops the session's sampler and writes what it buffered. Idempotent. */
  async stop(sessionId: string): Promise<void> {
    const entry = this.running.get(sessionId);
    if (!entry) return;
    this.running.delete(sessionId);
    if (entry.flushTimer) clearInterval(entry.flushTimer);
    await entry.sampler.stop().catch(() => undefined);
    if (entry.held) this.nodeStore().end(sessionId);
    else await this.write(sessionId, entry);
  }

  private async flush(sessionId: string): Promise<void> {
    const entry = this.running.get(sessionId);
    if (entry) await this.write(sessionId, entry);
  }

  /** On failure the samples wait for the next write; the newest MAX_BUFFERED_SAMPLES are kept. */
  private write(sessionId: string, entry: Running): Promise<void> {
    entry.writing = entry.writing.then(async () => {
      const batch = entry.buffer.splice(0);
      if (batch.length === 0) return;
      try {
        await this.writeSamples(sessionId, batch);
      } catch (err: any) {
        entry.buffer.unshift(...batch);
        const over = entry.buffer.length - MAX_BUFFERED_SAMPLES;
        if (over > 0) entry.buffer.splice(0, over);
        this.log.debug(
          `[${sessionId}] Writing ${batch.length} samples failed: ${err?.message ?? err}`,
        );
      }
    });
    return entry.writing;
  }

  // ---------------------------------------------------------------------
  // Seams. Overridden by tests; the defaults are the real thing.
  // ---------------------------------------------------------------------

  protected context(): PluginContext {
    return Container.get(PluginContext);
  }

  /** A node (a server with `hub`) holds the figures for its hub instead of writing them. */
  protected holdsForHub(): boolean {
    return this.context().pluginArgs?.hub !== undefined;
  }

  protected nodeStore(): NodeMetricsStore {
    return Container.get(NodeMetricsStore);
  }

  protected async writeSamples(sessionId: string, samples: MetricSample[]): Promise<void> {
    await prisma.sessionMetric.createMany({
      data: samples.map((s) => ({
        session_id: sessionId,
        at: s.at,
        device_cpu_pct: s.deviceCpuPct,
        device_mem_mb: s.deviceMemMb,
        device_mem_total: s.deviceMemTotalMb,
        app_cpu_pct: s.appCpuPct,
        app_mem_mb: s.appMemMb,
        app_id: s.appId,
      })),
    });
  }

  protected samplerFor(
    sessionId: string,
    device: IDevice,
    capabilities: Record<string, any>,
    hooks: SamplerHooks,
  ): MetricsSampler {
    if (String(device.platform).toLowerCase() === 'android') {
      let adb: Promise<{ path: string; base: string[] }> | undefined;
      return new AndroidMetricsSampler({
        appPackage: appPackageOf(capabilities),
        hooks,
        shell: async (command) => {
          if (!adb) adb = this.adbCommand(device.udid);
          try {
            const { path, base } = await adb;
            return await this.execAdb(path, [...base, 'shell', command]);
          } catch (err) {
            adb = undefined; // looked up again next time
            throw err;
          }
        },
      });
    }
    return new IOSMetricsSampler({
      udid: device.udid,
      tunnels: Container.get(IOSTunnels),
      hooks,
      spawnSysmontap: (env) => {
        const proc = spawn(goIosBinaryPath(), ['sysmontap', '--udid', device.udid], {
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        Container.get(ProcessRegistry).track({
          sessionId,
          udid: device.udid,
          kind: 'other',
          process: proc,
        });
        return proc;
      },
    });
  }

  /**
   * The resolved adb, and the arguments that reach this phone: the host's,
   * then `-s <udid>`. The shared appium-adb instance names no device (its
   * `shell()` adds `-s` only after `setDeviceId`), so with several phones on
   * one adb server a plain `adb shell` fails.
   */
  protected async adbCommand(udid: string): Promise<{ path: string; base: string[] }> {
    const managers = await Container.get(XenonManager).deviceInstances();
    const android = managers.find((m) => m instanceof AndroidDeviceManager) as
      | AndroidDeviceManager
      | undefined;
    if (!android) throw new Error('no Android device manager');
    const adb = (await android.getAdbForDevice(udid)) as unknown as {
      executable?: { path?: string };
      adbHost?: string;
      adbPort?: number;
    };
    const path = adb?.executable?.path;
    if (!path) throw new Error(`adb executable path not resolved for ${udid}`);
    const hostArgs =
      adb.adbHost && adb.adbPort ? ['-H', adb.adbHost, '-P', String(adb.adbPort)] : [];
    return { path, base: [...hostArgs, '-s', udid] };
  }

  protected async execAdb(path: string, args: string[]): Promise<string> {
    const { stdout } = await execFileAsync(path, args, { timeout: ADB_TIMEOUT_MS });
    return stdout;
  }
}
