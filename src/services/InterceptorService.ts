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
import { AndroidProxyAdapter, CertInstallMode } from './interceptor/AndroidProxyAdapter';
import { HostFilter } from './interceptor/HostFilter';
import { CapturedRequest, InterceptorOptions, Mock } from './interceptor/types';
import { buildHar, HarDocument } from './interceptor/HarBuilder';
import { archivePaths } from './interceptor/SessionArchive';
import { PortAllocator } from './PortAllocator';
import { SocketServer } from './SocketServer';
import { SocketEvents } from '../enums/SocketEvents';
import { adbForPhone } from './network/adbForPhone';
import { PhoneProxy, ProxyRoute } from './network/PhoneProxy';
import { CaCertChange, PhoneNetworkLedger } from './network/PhoneNetworkLedger';
import { withPhoneNetworkLock } from './network/phoneNetworkLock';

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
  /** The CA certificate this capture put on the phone, to take off at its stop. */
  caCert?: CaCertChange;
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
    let caCert: CaCertChange | undefined;
    let pointing = false;
    try {
      const ca = await this.cert.ensure();

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
      caCert = await this.installCert(sessionId, device, ca.certPath, certFilename, installMode);
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
        caCert,
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
      if (caCert) await this.removeCert(sessionId, device, caCert);
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
    if (state.caCert) await this.removeCert(sessionId, state.device, state.caCert);

    try {
      await state.proxy.stop();
    } catch (err: any) {
      this.logger.warn(`Proxy stop failed for ${sessionId}: ${err.message}`);
    }

    try {
      // Its own port only. The phone's other leases (an SDK lease's ports, a
      // preview's stream) aren't the capture's: through 2.36 this deleted
      // every row leased to the phone.
      await Container.get(PortAllocator).release(state.port, state.device.udid);
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

  /**
   * Puts the CA certificate on the phone, under the phone's lock. Its file
   * is written down first (ledger part `caCert`) when it isn't there yet, so
   * the capture's stop, or the next start after a crash, takes it off. One
   * that was there before (a lab's install, or an earlier Xenon's: through
   * 2.36 none was ever removed) is pushed over and left. Answers what was
   * written down. An install that fails is logged; capture goes on without
   * HTTPS.
   */
  private async installCert(
    sessionId: string,
    device: IDevice,
    certPath: string,
    file: string,
    mode: CertInstallMode,
  ): Promise<CaCertChange | undefined> {
    const adapter = this.getAndroidAdapter();
    return withPhoneNetworkLock(device.udid, async () => {
      let recorded: CaCertChange | undefined;
      let alreadyRoot = false;
      try {
        const before = await adapter.caCertState(device.udid, file, mode);
        alreadyRoot = before.root;
        if (!before.present) {
          recorded = { mode, file, rootedByXenon: mode === 'system' && !before.root };
          await Container.get(PhoneNetworkLedger).note(sessionId, device.udid, {
            caCert: recorded,
          });
        }
        await adapter.installCaCert(device.udid, certPath, file, mode, { alreadyRoot });
      } catch (err: any) {
        this.logger.warn(
          `Cert install (${mode}) failed for ${device.udid}: ${err?.message ?? err}. HTTPS interception may not work.`,
        );
      }
      return recorded;
    });
  }

  /**
   * Takes the capture's CA certificate off the phone and settles its record;
   * a phone that can't be reached keeps the record for its next session or
   * the next start. adbd is left as root when the install turned it on:
   * `adb unroot` restarts adbd mid-teardown (AndroidProxyAdapter.removeCaCert).
   */
  private async removeCert(sessionId: string, device: IDevice, cert: CaCertChange): Promise<void> {
    await withPhoneNetworkLock(device.udid, async () => {
      try {
        await this.getAndroidAdapter().removeCaCert(device.udid, cert.file, cert.mode);
        await Container.get(PhoneNetworkLedger).settle(sessionId, 'caCert');
        this.logger.info(
          `[${sessionId}] took the capture's CA certificate (${cert.file}) off ${device.udid}` +
            (cert.rootedByXenon ? '; adbd stays root until the emulator restarts' : ''),
        );
      } catch (err: any) {
        this.logger.warn(
          `[${sessionId}] could not take the capture's CA certificate off ${device.udid}: ` +
            `${err?.message ?? err}. Xenon tries again at the phone's next session and when it restarts.`,
        );
      }
    }).catch(() => undefined);
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
