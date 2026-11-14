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
import { PhoneProxy, ProxyRoute } from './network/PhoneProxy';

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
}

const DEFAULT_BUFFER_CAP = 1000;
const BODY_SPILL_THRESHOLD = 1024 * 1024;

@Service()
export class InterceptorService {
  private logger = log.scope('InterceptorService');
  private states: Map<string, SessionState> = new Map();
  /** Captures still starting, so a session's end can wait for one and stop it. */
  private starting: Map<string, Promise<void>> = new Map();
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

  /**
   * Whether the session's traffic is captured or its capture is starting:
   * what a session's end must stop (PhoneNetworkRestore). stop waits for a
   * start in progress.
   */
  hasCapture(sessionId: string): boolean {
    return this.states.has(sessionId) || this.starting.has(sessionId);
  }

  /** The port the session's capture proxy listens on, while it captures. */
  proxyPortOf(sessionId: string): number | undefined {
    return this.states.get(sessionId)?.port;
  }

  /** The sessions whose traffic is captured on this server, or whose capture is starting. */
  sessionIds(): string[] {
    return [...new Set([...this.states.keys(), ...this.starting.keys()])];
  }

  async start(sessionId: string, device: IDevice, opts: InterceptorOptions): Promise<void> {
    if (!opts.enabled) return;
    if (this.states.has(sessionId) || this.starting.has(sessionId)) {
      this.logger.warn(`Interceptor already active for session ${sessionId}; skipping`);
      return;
    }
    if (device.platform?.toLowerCase() !== 'android') {
      this.logger.warn(
        `Interceptor v1 supports Android only; skipping for ${device.udid} (${device.platform})`,
      );
      return;
    }

    // Registered before anything is awaited: a session that ends while its
    // capture starts finds it (isActive), and its stop waits for the start.
    const work = this.startCapture(sessionId, device, opts);
    this.starting.set(sessionId, work);
    try {
      await work;
    } finally {
      this.starting.delete(sessionId);
    }
  }

  /**
   * Starts the session's capture, step by step. A step that throws undoes the
   * ones before it, then the error goes to the caller: the phone's proxy put
   * back, the MITM proxy stopped (it listens on every interface), the `adb
   * reverse` removed and the port lease released. Through 2.36 a throw part
   * way (the adb call that sets the phone's proxy, typically) left all of
   * them, with no state for the session's end to stop.
   */
  private async startCapture(
    sessionId: string,
    device: IDevice,
    opts: InterceptorOptions,
  ): Promise<void> {
    const phoneProxy = Container.get(PhoneProxy);
    const ownedBefore = phoneProxy.owns(sessionId);
    let port: number | undefined;
    let routing: ProxyRoute | undefined;
    let proxy: MitmProxyHost | undefined;
    let pointing = false;
    try {
      const ca = await this.cert.ensure();
      const adapter = this.getAndroidAdapter();

      port = await Container.get(PortAllocator).acquire('proxy', device.udid);
      routing = await phoneProxy.route(device, port);
      const host = routing.deviceHost;

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

      const mitm = new MitmProxyHost(
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
          this.emit({ type: 'request', sessionId, payload: entry }, device);
        },
      );

      proxy = mitm;
      await mitm.start();

      const certFilename = this.cert.androidCertFilename();
      const installMode = AndroidProxyAdapter.selectInstallMode(device);
      try {
        await adapter.installCaCert(device.udid, ca.certPath, certFilename, installMode);
      } catch (err: any) {
        this.logger.warn(
          `Cert install (${installMode}) failed for ${device.udid}: ${err.message}. HTTPS interception may not work.`,
        );
      }
      pointing = true;
      await phoneProxy.pointAt(sessionId, device, port, routing);

      const state: SessionState = {
        sessionId,
        device,
        port,
        host,
        proxy: mitm,
        mocks,
        buffer,
        certInstalledFilename: certFilename,
        startedAt: Date.now(),
      };
      this.states.set(sessionId, state);

      this.emit({ type: 'session_started', sessionId, port, host }, device);
      this.logger.info(
        `[${sessionId}] interceptor active on ${host}:${port} (device ${device.udid}, mode=${installMode}, transport=${routing.transport})`,
      );
    } catch (err: any) {
      this.logger.warn(
        `[${sessionId}] interceptor failed to start on ${device.udid}: ${err?.message ?? err}. ` +
          'Undoing what it had set up.',
      );
      // The phone's proxy first, so it stops pointing at the proxy about to stop.
      let reverseReleased = false;
      if (pointing && !ownedBefore && phoneProxy.owns(sessionId)) {
        // Puts the phone's own proxy back and removes the reverse with it; a
        // phone that can't be reached keeps its record for the next start.
        // Owned before (traffic shaping pointed it first), pointAt took its
        // change back, and the reverse is removed below.
        await phoneProxy.release(sessionId);
        reverseReleased = true;
      }
      if (proxy) {
        await proxy.stop().catch((e: any) => {
          this.logger.warn(`Proxy stop failed for ${sessionId}: ${e?.message ?? e}`);
        });
      }
      if (port !== undefined && routing && !reverseReleased) {
        await phoneProxy.unroute(device, port, routing);
      }
      if (port !== undefined) {
        await Container.get(PortAllocator)
          .release(port, device.udid)
          .catch((e: any) => {
            this.logger.warn(`Port release failed for ${device.udid}: ${e?.message ?? e}`);
          });
      }
      throw err;
    }
  }

  async stop(sessionId: string): Promise<void> {
    const starting = this.starting.get(sessionId);
    if (starting) await starting.catch(() => undefined);
    const state = this.states.get(sessionId);
    if (!state) return;
    this.states.delete(sessionId);

    // The phone's own proxy back, and every adb reverse gone (PhoneProxy):
    // once for the session, whether capture or traffic shaping ends first.
    await Container.get(PhoneProxy).release(sessionId);

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
    this.emit({ type: 'session_stopped', sessionId }, state.device);
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
   * `phone` is the session's phone, by udid and host (an emulator's udid
   * repeats across servers). The dashboard events reach only admins who see
   * it: a captured request's headers and bodies can carry the app's sign-in
   * tokens, and REST's /interceptor routes are admin-only too. The
   * `session_started` payload's own `host` is the capture proxy's, not the
   * phone's.
   */
  private emit(evt: InterceptorEvent, phone: Pick<IDevice, 'udid' | 'host'>): void {
    for (const l of this.listeners) {
      try {
        l(evt);
      } catch (err: any) {
        this.logger.warn(`Interceptor listener error: ${err.message}`);
      }
    }
    this.broadcast(evt, phone);
  }

  private broadcast(evt: InterceptorEvent, phone: Pick<IDevice, 'udid' | 'host'>): void {
    try {
      const socket = Container.get(SocketServer);
      const scope = { udid: phone.udid, host: phone.host, adminOnly: true };
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

  private getAndroidAdapter(): AndroidProxyAdapter {
    if (this.androidAdapter) return this.androidAdapter;
    this.androidAdapter = new AndroidProxyAdapter(adbForPhone);
    return this.androidAdapter;
  }
}
