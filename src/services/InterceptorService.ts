import { Container, Service } from 'typedi';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import log from '../logger';
import { config } from '../config';
import { IDevice } from '../interfaces/IDevice';
import { CertManager } from './interceptor/CertManager';
import { MockEngine } from './interceptor/MockEngine';
import { RequestBuffer } from './interceptor/RequestBuffer';
import { MitmProxyHost } from './interceptor/MitmProxyHost';
import { AndroidProxyAdapter } from './interceptor/AndroidProxyAdapter';
import { HostFilter } from './interceptor/HostFilter';
import { CapturedRequest, InterceptorOptions, Mock } from './interceptor/types';
import { buildHar, HarDocument } from './interceptor/HarBuilder';
import { archivePaths } from './interceptor/SessionArchive';
import { PortAllocator } from './PortAllocator';
import { SocketServer } from './SocketServer';
import { SocketEvents } from '../enums/SocketEvents';
import { adbForPhone } from './network/adbForPhone';
import { PhoneNetworkLedger } from './network/PhoneNetworkLedger';
import { withPhoneNetworkLock } from './network/phoneNetworkLock';
import { isDeadCaptureProxy, isUnsetProxy } from './network/xenonProxy';

export type InterceptorEventListener = (evt: InterceptorEvent) => void;

export type InterceptorEvent =
  | { type: 'request'; sessionId: string; payload: CapturedRequest }
  | { type: 'session_started'; sessionId: string; port: number; host: string }
  | { type: 'session_stopped'; sessionId: string };

interface SessionState {
  sessionId: string;
  device: IDevice;
  port: number;
  host: string;
  proxy: MitmProxyHost;
  mocks: MockEngine;
  buffer: RequestBuffer;
  certInstalledFilename: string;
  startedAt: number;
  // True when adb reverse was successfully set up; stop() must remove it.
  reverseEstablished: boolean;
  // The phone's own proxy before the session's, put back by stop(); null: none.
  previousProxy: string | null;
}

const DEFAULT_BUFFER_CAP = 1000;
const BODY_SPILL_THRESHOLD = 1024 * 1024;

@Service()
export class InterceptorService {
  private logger = log.scope('InterceptorService');
  private states: Map<string, SessionState> = new Map();
  private listeners: Set<InterceptorEventListener> = new Set();
  private cert: CertManager;
  private androidAdapter: AndroidProxyAdapter | undefined;

  constructor() {
    this.cert = new CertManager(path.join(config.cacheDir, 'interceptor-ca'));
  }

  onEvent(listener: InterceptorEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  isActive(sessionId: string): boolean {
    return this.states.has(sessionId);
  }

  /** The sessions whose traffic is captured on this server. */
  sessionIds(): string[] {
    return [...this.states.keys()];
  }

  async start(sessionId: string, device: IDevice, opts: InterceptorOptions): Promise<void> {
    if (!opts.enabled) return;
    if (this.states.has(sessionId)) {
      this.logger.warn(`Interceptor already active for session ${sessionId}; skipping`);
      return;
    }
    if (device.platform?.toLowerCase() !== 'android') {
      this.logger.warn(
        `Interceptor v1 supports Android only; skipping for ${device.udid} (${device.platform})`,
      );
      return;
    }

    const ca = await this.cert.ensure();
    const adapter = this.getAndroidAdapter();

    const port = await Container.get(PortAllocator).acquire('proxy', device.udid);
    const routing = await this.establishDeviceRouting(device, port);
    const host = routing.deviceProxyHost;

    const mocks = new MockEngine();
    for (const m of opts.mocks ?? []) mocks.addMock(m);

    const spillDir = path.join(os.tmpdir(), 'xenon-interceptor', sessionId);
    const buffer = new RequestBuffer({
      capacity: opts.bufferSize ?? DEFAULT_BUFFER_CAP,
      bodySpillThreshold: BODY_SPILL_THRESHOLD,
      spillDir,
    });

    const filter = new HostFilter({
      include: opts.includeHosts,
      exclude: opts.excludeHosts,
    });

    const proxy = new MitmProxyHost(
      {
        port,
        host: '0.0.0.0',
        sslCaDir: this.cert.sslCaDir,
        sessionId,
        captureBodies: opts.captureBodies ?? true,
      },
      mocks,
      (entry) => {
        // Filter is capture-only: mocks already matched (and possibly fired) before
        // we get here, so excluded hosts can still be intentionally mocked while
        // staying out of the dashboard.
        if (!filter.accepts(entry.host)) return;
        buffer.push(entry);
        this.emit({ type: 'request', sessionId, payload: entry }, device.udid);
      },
    );

    await proxy.start();

    const certFilename = this.cert.androidCertFilename();
    const installMode = AndroidProxyAdapter.selectInstallMode(device);
    try {
      await adapter.installCaCert(device.udid, ca.certPath, certFilename, installMode);
    } catch (err: any) {
      this.logger.warn(
        `Cert install (${installMode}) failed for ${device.udid}: ${err.message}. HTTPS interception may not work.`,
      );
    }
    const previousProxy = await this.pointPhoneAtProxy(
      sessionId,
      device.udid,
      host,
      port,
      routing.reverseEstablished,
    );

    const state: SessionState = {
      sessionId,
      device,
      port,
      host,
      proxy,
      mocks,
      buffer,
      certInstalledFilename: certFilename,
      startedAt: Date.now(),
      reverseEstablished: routing.reverseEstablished,
      previousProxy,
    };
    this.states.set(sessionId, state);

    this.emit({ type: 'session_started', sessionId, port, host }, device.udid);
    this.logger.info(
      `[${sessionId}] interceptor active on ${host}:${port} (device ${device.udid}, mode=${installMode}, transport=${routing.transport})`,
    );
  }

  async stop(sessionId: string): Promise<void> {
    const state = this.states.get(sessionId);
    if (!state) return;
    this.states.delete(sessionId);

    await this.putPhoneProxyBack(state);

    if (state.reverseEstablished) {
      try {
        await this.getAndroidAdapter().removeReverse(state.device.udid, state.port);
      } catch (err: any) {
        this.logger.warn(
          `adb reverse --remove failed for ${state.device.udid}:${state.port}: ${err.message}`,
        );
      }
    }

    try {
      await state.proxy.stop();
    } catch (err: any) {
      this.logger.warn(`Proxy stop failed for ${sessionId}: ${err.message}`);
    }

    try {
      await Container.get(PortAllocator).releaseForUdid(state.device.udid);
    } catch (err: any) {
      this.logger.warn(`Port release failed for ${state.device.udid}: ${err.message}`);
    }

    try {
      const dump = this.serializeForDisk(state);
      const paths = archivePaths(config.sessionAssetsPath, sessionId);
      fs.mkdirSync(paths.dir, { recursive: true });
      fs.writeFileSync(paths.requests, JSON.stringify(dump, null, 2), 'utf8');
      fs.writeFileSync(
        paths.har,
        JSON.stringify(buildHar(state.buffer.list(), sessionId), null, 2),
        'utf8',
      );
    } catch (err: any) {
      this.logger.warn(`Interceptor flush failed for ${sessionId}: ${err.message}`);
    }

    state.buffer.clear();
    this.emit({ type: 'session_stopped', sessionId }, state.device.udid);
    this.logger.info(`[${sessionId}] interceptor stopped`);
  }

  addMock(sessionId: string, mock: Mock): string {
    return this.requireState(sessionId).mocks.addMock(mock);
  }

  removeMock(sessionId: string, mockId: string): boolean {
    return this.requireState(sessionId).mocks.removeMock(mockId);
  }

  clearMocks(sessionId: string): void {
    this.requireState(sessionId).mocks.clear();
  }

  listMocks(sessionId: string) {
    return this.requireState(sessionId).mocks.list();
  }

  getRequests(sessionId: string): CapturedRequest[] {
    return this.requireState(sessionId).buffer.list();
  }

  getRequest(sessionId: string, requestId: string): CapturedRequest | undefined {
    return this.requireState(sessionId).buffer.get(requestId);
  }

  exportHar(sessionId: string): HarDocument {
    const state = this.requireState(sessionId);
    return buildHar(state.buffer.list(), sessionId);
  }

  private requireState(sessionId: string): SessionState {
    const state = this.states.get(sessionId);
    if (!state) throw new Error(`Interceptor not active for session ${sessionId}`);
    return state;
  }

  /**
   * `udid` is the session's phone. The dashboard events reach only admins who
   * see it: a captured request's headers and bodies can carry the app's
   * sign-in tokens, and REST's /interceptor routes are admin-only too.
   */
  private emit(evt: InterceptorEvent, udid: string): void {
    for (const l of this.listeners) {
      try {
        l(evt);
      } catch (err: any) {
        this.logger.warn(`Interceptor listener error: ${err.message}`);
      }
    }
    this.broadcast(evt, udid);
  }

  private broadcast(evt: InterceptorEvent, udid: string): void {
    try {
      const socket = Container.get(SocketServer);
      const scope = { udid, adminOnly: true };
      if (evt.type === 'request') {
        void socket.emitToDashboardForDevices(SocketEvents.INTERCEPTOR_REQUEST, evt.payload, scope);
      } else if (evt.type === 'session_started') {
        void socket.emitToDashboardForDevices(
          SocketEvents.INTERCEPTOR_SESSION_STARTED,
          {
            sessionId: evt.sessionId,
            host: evt.host,
            port: evt.port,
          },
          scope,
        );
      } else if (evt.type === 'session_stopped') {
        void socket.emitToDashboardForDevices(
          SocketEvents.INTERCEPTOR_SESSION_STOPPED,
          {
            sessionId: evt.sessionId,
          },
          scope,
        );
      }
    } catch (err: any) {
      /* socket server may not be initialized yet — non-fatal */
    }
  }

  private serializeForDisk(state: SessionState) {
    return {
      sessionId: state.sessionId,
      udid: state.device.udid,
      startedAt: state.startedAt,
      stoppedAt: Date.now(),
      proxyHost: state.host,
      proxyPort: state.port,
      mocks: state.mocks.list(),
      requests: state.buffer.list(),
    };
  }

  /**
   * Points the whole phone at the session's proxy, and returns the proxy the
   * phone had (null: none) for stop() to put back. The change is written down
   * before it is made, so a restart after a crash can undo it
   * (PhoneNetworkLedger, PhoneNetworkRestore).
   *
   * A previous proxy that is a capture an earlier run left behind (this
   * machine, a capture port, nothing answering) is not the phone's own: it
   * counts as none, so the end of this session doesn't put a dead proxy back.
   */
  private async pointPhoneAtProxy(
    sessionId: string,
    udid: string,
    host: string,
    port: number,
    reverseEstablished: boolean,
  ): Promise<string | null> {
    const adapter = this.getAndroidAdapter();
    const setting = `${host}:${port}`;
    return await withPhoneNetworkLock(udid, async () => {
      let previous: string | null = null;
      try {
        const read = await adapter.readProxy(udid);
        const leftover =
          read === setting ||
          (await isDeadCaptureProxy(read, Container.get(PortAllocator).rangeOf('proxy')));
        if (leftover) {
          this.logger.info(
            `[${sessionId}] ${udid} had a proxy left by an earlier capture (${read})`,
          );
        }
        previous = isUnsetProxy(read) || leftover ? null : read;
      } catch (err: any) {
        this.logger.warn(`Could not read the proxy of ${udid}: ${err?.message ?? err}`);
      }
      await Container.get(PhoneNetworkLedger).note(sessionId, udid, {
        proxy: { set: setting, previous, ...(reverseEstablished ? { reversePort: port } : {}) },
      });
      await adapter.setProxy(udid, host, port);
      return previous;
    });
  }

  /**
   * Puts back the proxy the phone had before the session. A phone that can't
   * be reached keeps the change written down, and is put back at its next
   * session or at this server's next start.
   */
  private async putPhoneProxyBack(state: SessionState): Promise<void> {
    const udid = state.device.udid;
    await withPhoneNetworkLock(udid, async () => {
      try {
        await this.getAndroidAdapter().restoreProxy(udid, state.previousProxy);
        await Container.get(PhoneNetworkLedger).settle(state.sessionId, 'proxy');
      } catch (err: any) {
        this.logger.warn(
          `Could not put back the proxy of ${udid} after session ${state.sessionId}: ` +
            `${err?.message ?? err}. Xenon tries again at the phone's next session and when it restarts.`,
        );
      }
    });
  }

  private getAndroidAdapter(): AndroidProxyAdapter {
    if (this.androidAdapter) return this.androidAdapter;
    this.androidAdapter = new AndroidProxyAdapter(adbForPhone);
    return this.androidAdapter;
  }

  // Establishes how the device will reach the host-side MITM proxy.
  //
  // Emulators have a free ride: 10.0.2.2 is a special alias that always resolves to
  // the host loopback regardless of network shape, so no per-device setup is needed.
  //
  // Real devices used to be pointed at the host's first non-loopback IPv4. That works
  // only when host and device share a LAN — and most environments where Xenon is
  // useful (CI runners, hotel WiFi, NAT'd hosts, USB-only labs) violate that. So we
  // now try `adb reverse tcp:N tcp:N` first, which tunnels the device-local port back
  // to the host over the adb transport itself (USB or wireless adb). On success the
  // device proxy points at 127.0.0.1 — which the device sees as itself but is
  // actually our host's port via the adb tunnel.
  //
  // If `adb reverse` fails for some reason we still fall back to the LAN IP so users
  // who had a working LAN setup don't regress; the warning surfaces the failure so
  // they know what happened if interception silently stops working.
  private async establishDeviceRouting(
    device: IDevice,
    port: number,
  ): Promise<{ deviceProxyHost: string; reverseEstablished: boolean; transport: string }> {
    if (device.deviceType === 'emulator') {
      return { deviceProxyHost: '10.0.2.2', reverseEstablished: false, transport: 'emulator' };
    }
    try {
      await this.getAndroidAdapter().addReverse(device.udid, port, port);
      return { deviceProxyHost: '127.0.0.1', reverseEstablished: true, transport: 'adb-reverse' };
    } catch (err: any) {
      const lan = this.firstNonLoopbackIPv4() ?? '127.0.0.1';
      this.logger.warn(
        `adb reverse failed for ${device.udid} (${err.message}); falling back to host LAN IP ${lan}. ` +
          'Interception will fail unless the device can reach this address.',
      );
      return { deviceProxyHost: lan, reverseEstablished: false, transport: 'lan-fallback' };
    }
  }

  private firstNonLoopbackIPv4(): string | null {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      for (const info of ifaces[name] ?? []) {
        if (info.family === 'IPv4' && !info.internal) return info.address;
      }
    }
    return null;
  }
}
