import 'reflect-metadata';
import { expect } from 'chai';
import http from 'http';
import { AddressInfo } from 'net';
import sinon from 'sinon';
import express from 'express';
import { Container } from 'typedi';
import ControlRouter from '../../src/app/routers/control';
import IOSStreamService from '../../src/device-managers/ios/IOSStreamService';
import { PortAllocator } from '../../src/services/PortAllocator';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { scopesForRole } from '../../src/middleware/authMiddleware';
import { loopbackServers } from '../helpers/loopbackServer';
import { OWN_NODE_ID, useOwnNodeId } from '../helpers/own-node-id';
import { withFindDevices } from '../helpers/one-row-store';
import { saveRegistrations } from '../helpers/container-registration';

/**
 * The iOS half of what #610 did for Android. An iPhone's preview viewer was
 * counted with updateViewerCount(udid, ±1), which looks the stream up by udid
 * each time: a viewer counted on a stream that then restarted uncounted the
 * new stream's viewer when it left, so the leave grace or the idle sweep could
 * stop a stream someone still watched. And the hourly lease refresh extended
 * the stream's port rows by port alone, whoever held them by then.
 */
describe('An iPhone preview viewer is counted on the stream it joined', () => {
  const udid = 'IOS-VIEWER-1';
  const entry = (viewerCount = 0) =>
    ({ status: 'running', wdaPort: 8100, mjpegPort: 9100, viewerCount, lastViewerAt: 0 }) as any;

  describe('IOSStreamService.addViewer', () => {
    it('uncounts the stream the viewer joined, not one that replaced it', () => {
      const ios = Container.get(IOSStreamService);
      const sessions: Map<string, any> = (ios as any).sessions;
      const first = entry();
      sessions.set(udid, first);
      try {
        const leave = ios.addViewer(udid);
        expect(first.viewerCount).to.equal(1);

        // The stream restarts; someone else is watching the new one.
        const second = entry(1);
        sessions.set(udid, second);
        leave();
        expect(second.viewerCount, "the new stream's viewer stays counted").to.equal(1);
        expect(first.viewerCount).to.equal(0);
      } finally {
        sessions.delete(udid);
      }
    });

    it('counts a leave once, however often it is called', () => {
      const ios = Container.get(IOSStreamService);
      const sessions: Map<string, any> = (ios as any).sessions;
      const stream = entry(1); // another viewer is already here
      sessions.set(udid, stream);
      try {
        const leave = ios.addViewer(udid);
        expect(stream.viewerCount).to.equal(2);
        leave();
        leave();
        expect(stream.viewerCount).to.equal(1);
      } finally {
        sessions.delete(udid);
      }
    });

    it('counts nothing for a phone with no stream', () => {
      const leave = Container.get(IOSStreamService).addViewer('NO-STREAM');
      expect(() => leave()).to.not.throw();
    });
  });

  describe('the hourly lease refresh', () => {
    let restore: () => void;
    beforeEach(() => {
      restore = saveRegistrations(PortAllocator);
    });
    afterEach(() => {
      restore();
      sinon.restore();
    });

    it("extends the stream's port rows only for this phone", async () => {
      const touch = sinon.stub().resolves();
      Container.set(PortAllocator, { touch } as any);
      const ios = Container.get(IOSStreamService);
      sinon.stub(ios as any, 'tunnels').returns({ touch: sinon.stub().resolves() });
      await (ios as any).refreshStreamLeases(udid, entry());
      expect(touch.callCount).to.equal(2);
      for (const call of touch.getCalls()) expect(call.args[2]).to.equal(udid);
      expect(touch.getCalls().map((c) => c.args[0])).to.deep.equal([8100, 9100]);
    });
  });

  describe('GET /control/:udid/stream', () => {
    useOwnNodeId();
    const loopback = loopbackServers();
    let source: http.Server;

    beforeEach(async () => {
      source = http.createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=frame' });
      });
      await new Promise<void>((resolve) => source.listen(0, '127.0.0.1', () => resolve()));
      sinon.stub(DeviceStoreFactory, 'getStore').returns(
        withFindDevices({
          findDevice: async ({ udid: id }: { udid: string }) => ({
            udid: id,
            host: '127.0.0.1',
            nodeId: OWN_NODE_ID,
            platform: 'ios',
            realDevice: true,
            busy: false,
            session_id: null,
            screenWidth: '390',
            screenHeight: '844',
          }),
        }) as any,
      );
    });

    afterEach(async () => {
      sinon.restore();
      await loopback.closeAll();
      source.closeAllConnections?.();
      await new Promise((resolve) => source.close(() => resolve(undefined)));
    });

    it("counts an iPhone's viewer with addViewer, and runs its leave when the viewer goes", async () => {
      const port = (source.address() as AddressInfo).port;
      const ios = Container.get(IOSStreamService);
      sinon
        .stub(ios, 'getStreamStatus')
        .returns({ status: 'running', wdaPort: 8100, mjpegPort: port, viewerCount: 0 } as any);
      sinon.stub(ios, 'isWDARunning').resolves(true);
      sinon.stub(ios, 'startStream').resolves({ wdaPort: 8100, mjpegPort: port });
      const leave = sinon.stub();
      const addViewer = sinon.stub(ios, 'addViewer').returns(leave);

      const app = express();
      const api = express.Router();
      api.use((req, _res, next) => {
        (req as any).auth = {
          kind: 'user-session',
          userId: 'usr_me',
          role: 'MEMBER',
          scopes: scopesForRole('MEMBER'),
          rateLimit: 100,
        };
        next();
      });
      ControlRouter.register(api);
      app.use('/xenon/api', api);
      const server = await loopback.serve(app);
      const req = http.get({
        host: '127.0.0.1',
        port: (server.address() as AddressInfo).port,
        path: `/xenon/api/control/${udid}/stream?t=0`,
        agent: false,
      });
      req.on('error', () => undefined);

      for (const end = Date.now() + 3000; Date.now() < end && !addViewer.called; )
        await new Promise((r) => setTimeout(r, 20));
      expect(addViewer.calledOnceWith(udid)).to.equal(true);

      req.destroy();
      for (const end = Date.now() + 3000; Date.now() < end && !leave.called; )
        await new Promise((r) => setTimeout(r, 20));
      expect(leave.called).to.equal(true);
    });
  });
});
