import 'reflect-metadata';
import { expect } from 'chai';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import sinon from 'sinon';
import { Container } from 'typedi';
import { PortAllocator, createPortOwner } from '../../src/services/PortAllocator';
import { SessionLifecycleService } from '../../src/services/SessionLifecycleService';
import { InterceptorService } from '../../src/services/InterceptorService';
import { iOSCapabilities } from '../../src/XenonCapabilityManager';
import { forgetSessionMemory } from '../../src/sessions/sessionMemory';
import { config } from '../../src/config';
import { useScratchDatabase } from '../helpers/scratch-database';
import { usePrismaStores } from '../helpers/loki-stores';

/** Whether nothing listens on `port`, on either family's wildcard. */
function bindable(port: number): Promise<boolean> {
  const one = (host: string) =>
    new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.once('error', (err: NodeJS.ErrnoException) =>
        resolve(err.code === 'EADDRNOTAVAIL' || err.code === 'EAFNOSUPPORT'),
      );
      server.listen(port, host, () => server.close(() => resolve(true)));
    });
  return one('0.0.0.0').then((ok) => (ok ? one('::') : false));
}

/** A 100-port block in 20000-32799 whose first ten and 50-59 nobody listens on. */
async function freeBlock(): Promise<number> {
  let base = 20000;
  for (let attempt = 0; attempt < 20; attempt++) {
    base = 20000 + Math.floor(Math.random() * 128) * 100;
    let free = true;
    for (const offset of [0, 1, 2, 3, 50, 51, 52, 53]) {
      if (!(await bindable(base + offset))) {
        free = false;
        break;
      }
    }
    if (free) return base;
  }
  return base;
}

/**
 * A session's end gives back the ports the session leased for itself, and
 * nothing else of its phone's. Through 2.36 it deleted every row leased to
 * the phone (`releaseForUdid`): an SDK lease's reserved ports, which the
 * lease picker then handed to the next lease while the first one's session
 * still held them ("Address already in use"), and a live preview's stream
 * ports, when the stream outlived the session. Stopping a capture did the
 * same.
 */
describe("a session's ports: only its own are given back", function () {
  this.timeout(30_000);
  const scratch = useScratchDatabase();
  usePrismaStores();

  const PHONE = 'phone-a';
  let base: number;
  let allocator: PortAllocator;

  beforeEach(async () => {
    base = await freeBlock();
    allocator = Container.get(PortAllocator);
    allocator.configure({ wda: [base, base + 3], mjpeg: [base + 50, base + 53] });
  });

  afterEach(async () => {
    allocator.configure({});
    sinon.restore();
    await scratch.db.portLease.deleteMany({});
  });

  async function lease(port: number, leasedToUdid: string, extra: Record<string, unknown> = {}) {
    const now = Date.now();
    await scratch.db.portLease.create({
      data: {
        port,
        purpose: 'wda',
        leasedToUdid,
        leasedAt: now,
        expiresAt: now + 60_000,
        ...extra,
      },
    });
  }

  /** What the phone's other holders leased: an SDK lease, a preview's stream, its tunnel. */
  async function othersOnThePhone(): Promise<number[]> {
    await lease(base + 10, PHONE, { purpose: 'systemPort', leaseId: 'lease-1', leasedToHost: 'h' });
    await lease(base + 11, PHONE, {
      purpose: 'wdaLocalPort',
      leaseId: 'lease-1',
      leasedToHost: 'h',
    });
    await lease(base + 12, PHONE, { purpose: 'mjpeg' });
    await lease(base + 13, PHONE, { purpose: 'wda' });
    await lease(base + 14, PHONE, { purpose: 'tunnel' });
    return [base + 10, base + 11, base + 12, base + 13, base + 14];
  }

  async function ports(): Promise<number[]> {
    const rows = await scratch.db.portLease.findMany({ orderBy: { port: 'asc' } });
    return rows.map((r) => r.port);
  }

  function session(id: string, device: Record<string, unknown>) {
    return {
      getId: () => id,
      getDevice: () => device,
      isVideoRecordingInProgress: () => false,
    };
  }

  it("a session's end leaves an SDK lease's ports, a preview's stream and the tunnel", async () => {
    const others = await othersOnThePhone();

    await (Container.get(SessionLifecycleService) as any).finalizeCleanup(
      session('s-1', { udid: PHONE, host: 'h', platform: 'android' }),
    );

    expect(await ports()).to.deep.equal(others);
  });

  it('stopping a capture gives back its own port, and no other of the phone', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-port-owner-'));
    const assets = config.sessionAssetsPath;
    config.sessionAssetsPath = dir;
    try {
      const others = await othersOnThePhone();
      await lease(base + 20, PHONE, { purpose: 'proxy' });
      const svc = new InterceptorService();
      sinon.stub(svc as any, 'emit');
      (svc as any).states.set('s-cap', {
        sessionId: 's-cap',
        device: { udid: PHONE, host: 'h' },
        port: base + 20,
        host: 'h',
        proxy: { stop: async () => undefined },
        mocks: { list: () => [] },
        buffer: { list: () => [], clear: () => undefined },
        startedAt: 0,
      });

      await svc.stop('s-cap');

      expect(await ports()).to.deep.equal(others);
    } finally {
      config.sessionAssetsPath = assets;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  describe("an iOS session's own WebDriverAgent and MJPEG ports", () => {
    const simulator = {
      udid: PHONE,
      host: 'h',
      name: 'iPhone 17',
      realDevice: false,
      sdk: '26.0',
      platform: 'ios',
      claimedAt: 1_700_000_000_000,
    };

    async function allocate(): Promise<any> {
      const caps: any = { alwaysMatch: {}, firstMatch: [{}] };
      await iOSCapabilities(caps, simulator);
      return caps.firstMatch[0];
    }

    it('are new ports, never a row the phone already holds', async () => {
      await lease(base, PHONE, { purpose: 'wda' });
      await lease(base + 50, PHONE, { purpose: 'mjpeg' });

      const fm = await allocate();

      expect(fm['appium:wdaLocalPort']).to.equal(base + 1);
      expect(fm['appium:mjpegServerPort']).to.equal(base + 51);
    });

    it('go back when the create fails', async () => {
      const others = await othersOnThePhone();
      await allocate();
      expect(await ports()).to.have.length(others.length + 2);

      await Container.get(SessionLifecycleService).releaseAllocation({
        caps: { alwaysMatch: {}, firstMatch: [{}] },
        device: simulator as any,
        remote: false,
        pendingSessionId: 'pending-x',
        apiKeyId: null,
        userId: null,
      } as any);

      expect(await ports()).to.deep.equal(others);
    });

    it('go with the session, however it ends, once it holds the phone', async () => {
      const others = await othersOnThePhone();
      await allocate();
      await (allocator as any).adoptForSession?.(createPortOwner(simulator), 's-ios');

      // An ending that never reaches finalizeCleanup (a session neither the
      // dashboard nor a video put in SESSION_MANAGER).
      forgetSessionMemory('s-ios');
      for (let i = 0; i < 50 && (await ports()).length > others.length; i++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      expect(await ports()).to.deep.equal(others);
    });

    it('go with the session at finalizeCleanup, leaving the rest', async () => {
      const others = await othersOnThePhone();
      await allocate();
      await (allocator as any).adoptForSession?.(createPortOwner(simulator), 's-ios2');

      await (Container.get(SessionLifecycleService) as any).finalizeCleanup(
        session('s-ios2', { udid: PHONE, host: 'h', platform: 'ios', realDevice: false }),
      );

      expect(await ports()).to.deep.equal(others);
    });
  });

  describe('touch', () => {
    async function expiresAt(port: number): Promise<number> {
      const row = await scratch.db.portLease.findUnique({ where: { port } });
      return Number(row?.expiresAt);
    }

    it("never extends another phone's row", async () => {
      await lease(base, 'phone-b', { purpose: 'mjpeg' });
      const before = await expiresAt(base);

      await (allocator as any).touch(base, 24 * 60 * 60 * 1000, PHONE);

      expect(await expiresAt(base)).to.equal(before);
    });

    it("never extends an SDK lease's port or a session's own", async () => {
      await lease(base, PHONE, { purpose: 'systemPort', leaseId: 'lease-1' });
      await lease(base + 1, 'session:s-9', { purpose: 'wda' });
      const before = [await expiresAt(base), await expiresAt(base + 1)];

      await allocator.touch(base, 24 * 60 * 60 * 1000);
      await allocator.touch(base + 1, 24 * 60 * 60 * 1000);

      expect([await expiresAt(base), await expiresAt(base + 1)]).to.deep.equal(before);
    });

    it("extends the phone's own row", async () => {
      await lease(base, PHONE, { purpose: 'mjpeg' });
      const before = await expiresAt(base);

      await (allocator as any).touch(base, 24 * 60 * 60 * 1000, PHONE);

      expect(await expiresAt(base)).to.be.greaterThan(before);
    });
  });
});
