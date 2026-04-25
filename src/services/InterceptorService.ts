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
import { CapturedRequest, InterceptorOptions, Mock } from './interceptor/types';
import { buildHar, HarDocument } from './interceptor/HarBuilder';
import { PortAllocator } from './PortAllocator';
import { SocketServer } from './SocketServer';
import { SocketEvents } from '../enums/SocketEvents';

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
    const host = this.resolveProxyHost(device);

    const mocks = new MockEngine();
    for (const m of opts.mocks ?? []) mocks.addMock(m);

    const spillDir = path.join(os.tmpdir(), 'xenon-interceptor', sessionId);
    const buffer = new RequestBuffer({
      capacity: opts.bufferSize ?? DEFAULT_BUFFER_CAP,
      bodySpillThreshold: BODY_SPILL_THRESHOLD,
      spillDir,
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
        buffer.push(entry);
        this.emit({ type: 'request', sessionId, payload: entry });
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
    await adapter.setProxy(device.udid, host, port);

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
    };
    this.states.set(sessionId, state);

    this.emit({ type: 'session_started', sessionId, port, host });
    this.logger.info(
      `[${sessionId}] interceptor active on ${host}:${port} (device ${device.udid}, mode=${installMode})`,
    );
  }

  async stop(sessionId: string): Promise<void> {
    const state = this.states.get(sessionId);
    if (!state) return;
    this.states.delete(sessionId);

    try {
      await this.getAndroidAdapter().clearProxy(state.device.udid);
    } catch (err: any) {
      this.logger.warn(`Clear proxy failed for ${state.device.udid}: ${err.message}`);
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
      const dir = path.join(config.sessionAssetsPath, sessionId, 'interceptor');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'requests.json'), JSON.stringify(dump, null, 2), 'utf8');
      fs.writeFileSync(
        path.join(dir, 'session.har'),
        JSON.stringify(buildHar(state.buffer.list(), sessionId), null, 2),
        'utf8',
      );
    } catch (err: any) {
      this.logger.warn(`Interceptor flush failed for ${sessionId}: ${err.message}`);
    }

    state.buffer.clear();
    this.emit({ type: 'session_stopped', sessionId });
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

  private emit(evt: InterceptorEvent): void {
    for (const l of this.listeners) {
      try {
        l(evt);
      } catch (err: any) {
        this.logger.warn(`Interceptor listener error: ${err.message}`);
      }
    }
    this.broadcast(evt);
  }

  private broadcast(evt: InterceptorEvent): void {
    try {
      const socket = Container.get(SocketServer);
      if (evt.type === 'request') {
        socket.emitToDashboard(SocketEvents.INTERCEPTOR_REQUEST, evt.payload);
      } else if (evt.type === 'session_started') {
        socket.emitToDashboard(SocketEvents.INTERCEPTOR_SESSION_STARTED, {
          sessionId: evt.sessionId,
          host: evt.host,
          port: evt.port,
        });
      } else if (evt.type === 'session_stopped') {
        socket.emitToDashboard(SocketEvents.INTERCEPTOR_SESSION_STOPPED, {
          sessionId: evt.sessionId,
        });
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
    const provider = async (udid: string) => {
      const { default: AndroidDeviceManager } =
        await import('../device-managers/AndroidDeviceManager');
      const mgr = Container.get(AndroidDeviceManager);
      return await mgr.getAdbForDevice(udid);
    };
    this.androidAdapter = new AndroidProxyAdapter(provider);
    return this.androidAdapter;
  }

  private resolveProxyHost(device: IDevice): string {
    if (device.deviceType === 'emulator') return '10.0.2.2';
    return this.firstNonLoopbackIPv4() ?? '127.0.0.1';
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
