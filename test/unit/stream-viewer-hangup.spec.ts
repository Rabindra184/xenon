import 'reflect-metadata';
import { expect } from 'chai';
import http from 'http';
import { AddressInfo } from 'net';
import sinon from 'sinon';
import express from 'express';
import { Container } from 'typedi';
import ControlRouter from '../../src/app/routers/control';
import AndroidStreamService from '../../src/device-managers/android/AndroidStreamService';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { scopesForRole } from '../../src/middleware/authMiddleware';
import { loopbackServers } from '../helpers/loopbackServer';
import { OWN_NODE_ID, useOwnNodeId } from '../helpers/own-node-id';

/**
 * GET /control/:udid/stream counted its viewer only once the stream had
 * started, which takes seconds on a cold start, and only then listened for
 * `close`. A browser that hung up during that wait had already fired `close`,
 * so its viewer was counted and never uncounted, and the phone's preview and
 * hold were never released.
 *
 * Seen on the lab (2.8.1): an Android tile with H.264 preview did this every
 * time. It opens an MJPEG warm-up and drops it as soon as H.264 is ready, and
 * the phone stayed held for "1 other viewer(s)" with nothing connected.
 */

function buildApp() {
  const app = express();
  const apiRouter = express.Router();
  apiRouter.use((req, _res, next) => {
    (req as any).auth = {
      kind: 'user-session',
      userId: 'usr_me',
      role: 'MEMBER',
      scopes: scopesForRole('MEMBER'),
      rateLimit: 100,
    };
    next();
  });
  ControlRouter.register(apiRouter);
  app.use('/xenon/api', apiRouter);
  return app;
}

/** An MJPEG source that answers and then stays quiet, like a phone at rest. */
function mjpegSource(): Promise<http.Server> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=frame' });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check: () => boolean, ms = 2000): Promise<void> {
  for (const end = Date.now() + ms; Date.now() < end && !check(); ) await pause(20);
}

describe('GET /control/:udid/stream counts only viewers who are still there', () => {
  // The fake rows are this server's own phones.
  useOwnNodeId();

  const loopback = loopbackServers();
  let source: http.Server;
  let startCalled: Promise<void>;
  let finishStart: () => void;
  let viewers: number;

  beforeEach(async () => {
    source = await mjpegSource();
    const sourcePort = (source.address() as AddressInfo).port;

    let markCalled!: () => void;
    startCalled = new Promise((resolve) => (markCalled = resolve));
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    finishStart = release;

    // A cold start: the stream is ready only when the test says so.
    const android = Container.get(AndroidStreamService);
    sinon.stub(android, 'startStream').callsFake(async () => {
      markCalled();
      await held;
      return { mjpegPort: sourcePort };
    });
    viewers = 0;
    sinon.stub(android, 'updateViewerCount').callsFake((_udid: string, delta: number) => {
      viewers += delta;
    });
    sinon.stub(DeviceStoreFactory, 'getStore').returns({
      findDevice: async ({ udid }: { udid: string }) => ({
        udid,
        host: '127.0.0.1',
        nodeId: OWN_NODE_ID,
        platform: 'android',
        busy: false,
        session_id: null,
        screenWidth: '1080',
        screenHeight: '2220',
      }),
    } as any);
  });

  afterEach(async () => {
    sinon.restore();
    await loopback.closeAll();
    source.closeAllConnections?.();
    await new Promise((resolve) => source.close(() => resolve(undefined)));
  });

  async function watch(udid: string): Promise<http.ClientRequest> {
    const server = await loopback.serve(buildApp());
    const { port } = server.address() as AddressInfo;
    const req = http.get({
      host: '127.0.0.1',
      port,
      path: `/xenon/api/control/${udid}/stream?t=0`,
      agent: false,
    });
    req.on('error', () => undefined);
    return req;
  }

  it('never counts a viewer who hung up while the stream was starting', async () => {
    const req = await watch('HANGUP-DURING-START');
    await startCalled;

    req.destroy(); // the tile switched to H.264, or was closed
    await pause(100);
    finishStart();
    await pause(300);

    expect(viewers).to.equal(0);
  });

  it('counts a viewer who stays, and uncounts them when they leave', async () => {
    const req = await watch('STAYS-THEN-LEAVES');
    await startCalled;
    finishStart();

    await until(() => viewers === 1);
    expect(viewers, 'watching').to.equal(1);

    req.destroy();
    await until(() => viewers === 0);
    expect(viewers, 'left').to.equal(0);
  });
});
