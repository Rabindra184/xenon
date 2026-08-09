import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import { Container } from 'typedi';
import { WebSocket } from 'ws';
import { attachLogcatWs, parseLogcatWsPath, type LogcatWsDeps } from '../../src/app/ws/logcatWs';
import { LogcatMultiplexer } from '../../src/device-managers/android/LogcatMultiplexer';
import type { LogcatRecord } from '../../src/services/logcat/logcatParse';
import { evaluateDeviceAccess } from '../../src/services/device-access/deviceAccessPolicy';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';
import { StreamTicketService } from '../../src/services/token/StreamTicketService';
import log from '../../src/logger';

const rec = (message: string, ts = 1): LogcatRecord => ({
  ts,
  pid: 1,
  tid: 1,
  level: 'D',
  tag: 'T',
  message,
});

describe('parseLogcatWsPath', () => {
  it('extracts udid and ticket from the logcat path', () => {
    const p = parseLogcatWsPath('/xenon/api/control/DEV-1/logcat?ticket=abc');
    expect(p).to.deep.equal({ udid: 'DEV-1', ticket: 'abc' });
  });

  it('url-decodes the udid', () => {
    const p = parseLogcatWsPath('/xenon/api/control/A%2FB/logcat?ticket=t');
    expect(p!.udid).to.equal('A/B');
  });

  it('returns null without a ticket, so the upgrade is left alone', () => {
    expect(parseLogcatWsPath('/xenon/api/control/DEV-1/logcat')).to.equal(null);
  });

  it('does not claim the h264 path', () => {
    expect(parseLogcatWsPath('/xenon/api/control/DEV-1/stream/h264?ticket=t')).to.equal(null);
  });

  it('does not claim an unrelated path', () => {
    expect(parseLogcatWsPath('/socket.io/?EIO=4')).to.equal(null);
  });
});

interface Harness {
  port: number;
  close: () => Promise<void>;
  mux: LogcatMultiplexer;
  startCalls: number;
  authorizeCalls: number;
}

async function harness(over: {
  redeem?: (ticket: string, udid: string) => Promise<{ actorId: string }>;
  authorize?: (udid: string, actorId: string) => Promise<boolean>;
  startStream?: (udid: string) => Promise<LogcatMultiplexer>;
  maxBufferedBytes?: number;
}): Promise<Harness> {
  const mux = new LogcatMultiplexer();
  const state = { startCalls: 0, authorizeCalls: 0 };
  const server = http.createServer();
  const userAuthorize = over.authorize ?? (async () => true);
  const deps: LogcatWsDeps = {
    redeem: over.redeem ?? (async () => ({ actorId: 'usr_alice' })),
    authorize: (udid, actorId) => {
      state.authorizeCalls += 1;
      return userAuthorize(udid, actorId);
    },
    startStream:
      over.startStream ??
      (async () => {
        state.startCalls += 1;
        return mux;
      }),
  };
  if (over.maxBufferedBytes !== undefined) deps.maxBufferedBytes = over.maxBufferedBytes;
  attachLogcatWs(server, deps);
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    mux,
    get startCalls() {
      return state.startCalls;
    },
    get authorizeCalls() {
      return state.authorizeCalls;
    },
    close: () =>
      new Promise<void>((r) => {
        // http.Server#close only fires its callback once every connection has
        // ended — including upgraded WS sockets a test left open after
        // asserting 'open'. Force them down too, or a passing "stays open"
        // assertion hangs the whole suite waiting for a close that never
        // comes.
        server.closeAllConnections?.();
        server.close(() => r());
      }),
  } as Harness;
}

/** Resolves with the close code, or 'open' if the socket stays up. */
const connect = (port: number, ticket = 'tok') =>
  new Promise<number | 'open'>((resolve) => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/xenon/api/control/DEV-1/logcat?ticket=${ticket}`,
    );
    ws.on('close', (code) => resolve(code));
    ws.on('open', () =>
      setTimeout(() => {
        resolve('open');
        // The assertion is "stays open", not "stays open forever" — tear it
        // down once observed so it doesn't outlive the test and wedge the
        // next harness's server.close().
        ws.terminate();
      }, 150),
    );
  });

describe('attachLogcatWs handshake', () => {
  it('accepts a valid ticket for a device the caller may use', async () => {
    const h = await harness({});
    expect(await connect(h.port)).to.equal('open');
    await h.close();
  });

  it('closes 1008 when the ticket cannot be redeemed', async () => {
    const h = await harness({
      redeem: async () => {
        throw new Error('bad ticket');
      },
    });
    expect(await connect(h.port)).to.equal(1008);
    expect(h.startCalls, 'must not start a logcat process for an unredeemable ticket').to.equal(0);
    await h.close();
  });

  // Device logs carry tokens and PII, so they are an ownership-checked read:
  // the ticket alone must not be sufficient (design spec, "Authorisation").
  it('closes 1008 when the device is held by another user, and delivers nothing', async () => {
    const h = await harness({ authorize: async () => false });
    const got: any[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${h.port}/xenon/api/control/DEV-1/logcat?ticket=t`);
    ws.on('message', (d) => got.push(JSON.parse(d.toString())));
    const code = await new Promise<number | 'open'>((resolve) => {
      ws.on('close', (c) => resolve(c));
      ws.on('open', () => setTimeout(() => resolve('open'), 150));
    });
    expect(code).to.equal(1008);
    expect(h.startCalls, 'must not start a logcat process for a refused caller').to.equal(0);
    expect(got, 'a refused caller must never receive a record').to.deep.equal([]);
    await h.close();
  });

  it('closes 1011 when ownership cannot be determined, and delivers nothing', async () => {
    const h = await harness({
      authorize: async () => {
        throw new Error('store down');
      },
    });
    const got: any[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${h.port}/xenon/api/control/DEV-1/logcat?ticket=t`);
    ws.on('message', (d) => got.push(JSON.parse(d.toString())));
    const code = await new Promise<number | 'open'>((resolve) => {
      ws.on('close', (c) => resolve(c));
      ws.on('open', () => setTimeout(() => resolve('open'), 150));
    });
    expect(code).to.equal(1011);
    expect(h.startCalls, 'an undetermined owner must fail closed, not fall through').to.equal(0);
    expect(got).to.deep.equal([]);
    await h.close();
  });

  it('forwards records to a connected client', async () => {
    const h = await harness({});
    const ws = new WebSocket(`ws://127.0.0.1:${h.port}/xenon/api/control/DEV-1/logcat?ticket=t`);
    const got: any[] = [];
    ws.on('message', (d) => got.push(JSON.parse(d.toString())));
    await new Promise((r) => ws.on('open', r));
    h.mux.push({ ts: 1, pid: 1, tid: 1, level: 'D', tag: 'T', message: 'hello' });
    await new Promise((r) => setTimeout(r, 100));
    expect(got.map((r) => r.message)).to.deep.equal(['hello']);
    ws.close();
    await h.close();
  });

  // The trap documented in h264StreamWs: without cleanup registered before the
  // awaits, clientCount stays inflated and the idle watchdog never fires.
  it('leaves no client registered when the socket drops mid-handshake during redeem', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const h = await harness({
      redeem: async () => {
        await gate;
        return { actorId: 'usr_alice' };
      },
    });
    const ws = new WebSocket(`ws://127.0.0.1:${h.port}/xenon/api/control/DEV-1/logcat?ticket=t`);
    await new Promise((r) => setTimeout(r, 50));
    ws.terminate(); // disconnect while redeem is still pending
    // Let the server actually observe the close (a real socket teardown is a
    // macrotask; resolving `gate` below is a same-tick microtask chain that
    // would otherwise race ahead of it) BEFORE unblocking redeem. Otherwise
    // this proves nothing about the post-redeem guard: the client could get
    // registered first and only be torn down afterward by the 'close'
    // listener firing late — same end state, different (unguarded) mechanism.
    await new Promise((r) => setTimeout(r, 100));
    release();
    await new Promise((r) => setTimeout(r, 150));
    expect(h.mux.clientCount).to.equal(0);
    // The final clientCount alone can't distinguish "the post-redeem guard
    // short-circuited" from "a later guard cleaned up after the fact" — both
    // land here, since `closed` never resets and any later guard backstops
    // an earlier one. What only the post-redeem guard specifically buys is
    // skipping the now-pointless authorize() DB lookup and startStream() adb
    // spawn for a caller who is already gone — assert that directly.
    expect(h.authorizeCalls, 'must not check ownership once the caller is gone').to.equal(0);
    expect(h.startCalls, 'must not start a logcat process once the caller is gone').to.equal(0);
    await h.close();
  });

  // Same trap, later in the handshake: redeem + authorize already succeeded,
  // but startStream (which can shell out to adb) is still in flight when the
  // caller disconnects.
  it('leaves no client registered when the socket drops mid-handshake during startStream', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const gatedMux = new LogcatMultiplexer();
    const h = await harness({
      startStream: async () => {
        await gate;
        return gatedMux;
      },
    });
    const ws = new WebSocket(`ws://127.0.0.1:${h.port}/xenon/api/control/DEV-1/logcat?ticket=t`);
    await new Promise((r) => setTimeout(r, 50));
    ws.terminate(); // disconnect while startStream is still pending
    // See the matching comment in the redeem-timing test above: give the
    // server's close listener time to actually run before startStream
    // resolves, or this races the wrong way and proves nothing about the
    // post-startStream guard.
    await new Promise((r) => setTimeout(r, 100));
    release();
    await new Promise((r) => setTimeout(r, 150));
    expect(gatedMux.clientCount).to.equal(0);
    await h.close();
  });
});

// The wired ServerManager `authorize` calls the real evaluateDeviceAccess with
// isAdmin fixed to false (see docs on the ServerManager wiring below), so
// these exercise the actual policy function rather than a boolean stub that
// would pass regardless of which branch of evaluateDeviceAccess ran.
describe('attachLogcatWs ownership — real evaluateDeviceAccess', () => {
  const UDID = 'DEV-1';
  const ALICE = 'usr_alice'; // holds the device via a manual lock
  const BOB = 'usr_bob'; // a different, non-admin caller

  const authorizeAs = (isAdmin: boolean) => async (udid: string, actorId: string) =>
    evaluateDeviceAccess({
      udid,
      busy: true,
      sessionId: `manual_${ALICE}_${udid}`,
      sessionOwnerUserId: null,
      actorUserId: actorId,
      isAdmin,
    }).allow;

  it('denies a non-admin caller who does not hold the manual lock', async () => {
    const h = await harness({
      redeem: async () => ({ actorId: BOB }),
      authorize: authorizeAs(false),
    });
    const got: any[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${h.port}/xenon/api/control/${UDID}/logcat?ticket=t`);
    ws.on('message', (d) => got.push(JSON.parse(d.toString())));
    const code = await new Promise<number | 'open'>((resolve) => {
      ws.on('close', (c) => resolve(c));
      ws.on('open', () => setTimeout(() => resolve('open'), 150));
    });
    expect(code).to.equal(1008);
    expect(got).to.deep.equal([]);
    await h.close();
  });

  it('lets an admin caller bypass a manual lock held by someone else', async () => {
    const h = await harness({
      redeem: async () => ({ actorId: BOB }),
      authorize: authorizeAs(true),
    });
    expect(await connect(h.port)).to.equal('open');
    expect(h.startCalls).to.equal(1);
    await h.close();
  });
});

describe('attachLogcatWs with the real StreamTicketService', () => {
  let dir: string;
  let ticketSvc: StreamTicketService;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-logcat-ws-ticket-'));
    const keys = new JwtKeyService();
    await keys.init(dir);
    Container.set(JwtKeyService, keys);
    ticketSvc = new StreamTicketService();
  });

  afterEach(() => {
    Container.reset();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('accepts a ticket minted for this exact udid', async () => {
    const h = await harness({ redeem: (t, u) => ticketSvc.redeem(t, u) });
    const t = await ticketSvc.mint('DEV-1', 'usr_alice');
    expect(await connect(h.port, t)).to.equal('open');
    await h.close();
  });

  it('rejects a malformed ticket string', async () => {
    const h = await harness({ redeem: (t, u) => ticketSvc.redeem(t, u) });
    expect(await connect(h.port, 'not-a-real-jwt')).to.equal(1008);
    await h.close();
  });

  // A ticket minted for a different device is not a valid credential for
  // DEV-1, even though `connect()` presents it with a well-formed signature.
  it('rejects a ticket minted for a different udid', async () => {
    const h = await harness({ redeem: (t, u) => ticketSvc.redeem(t, u) });
    const t = await ticketSvc.mint('DEV-OTHER', 'usr_alice');
    expect(await connect(h.port, t)).to.equal(1008);
    await h.close();
  });

  // "The ticket alone is not sufficient" cuts both ways: it must also not be
  // reusable once redeemed.
  it('rejects a replayed (already-redeemed) ticket', async () => {
    const h = await harness({ redeem: (t, u) => ticketSvc.redeem(t, u) });
    const t = await ticketSvc.mint('DEV-1', 'usr_alice');
    expect(await connect(h.port, t)).to.equal('open');
    expect(await connect(h.port, t)).to.equal(1008);
    await h.close();
  });
});

// Carried forward from the Task 2 review: LogcatMultiplexer only reports its
// coalesced "N lines dropped" marker on the next record a client accepts. A
// client that disconnects while backed up never gets one, so without this
// layer surfacing it, the gap simply vanishes — the one case the marker
// exists for goes unreported. Reaching a client cannot happen once its
// socket is gone, so the only place left to make the loss visible is the
// server log.
describe('attachLogcatWs client lifecycle', () => {
  it('logs the pending drop count when a permanently backed-up client disconnects', async () => {
    const warnSpy = sinon.stub(log, 'warn');
    try {
      // maxBufferedBytes: 0 makes canAccept() refuse unconditionally
      // (bufferedAmount is never negative), so every push is a guaranteed drop.
      const h = await harness({ maxBufferedBytes: 0 });
      const ws = new WebSocket(`ws://127.0.0.1:${h.port}/xenon/api/control/DEV-1/logcat?ticket=t`);
      const got: any[] = [];
      ws.on('message', (d) => got.push(JSON.parse(d.toString())));
      await new Promise((r) => ws.on('open', r));
      await new Promise((r) => setTimeout(r, 50));

      h.mux.push(rec('lost one'));
      h.mux.push(rec('lost two'));
      h.mux.push(rec('lost three'));
      await new Promise((r) => setTimeout(r, 50));
      expect(got, 'a permanently backed-up client must never receive a record').to.deep.equal([]);

      ws.terminate();
      await new Promise((r) => setTimeout(r, 150));

      const loggedTheGap = warnSpy
        .getCalls()
        .some((c) => /3/.test(String(c.args[0])) && /dropped/i.test(String(c.args[0])));
      expect(
        loggedTheGap,
        'the pending drop count must be surfaced when the client leaves',
      ).to.equal(true);
      await h.close();
    } finally {
      warnSpy.restore();
    }
  });

  // The multiplexer counts a throwing sink as a drop and moves on — it has no
  // mechanism to remove a client itself. Eviction depends on this layer
  // forcing the socket closed so its own close/error listeners fire, exactly
  // as h264StreamWs.ts's cleanup wiring does.
  it('evicts a client whose send starts throwing, instead of leaving it registered forever', async () => {
    const h = await harness({});
    const ws = new WebSocket(`ws://127.0.0.1:${h.port}/xenon/api/control/DEV-1/logcat?ticket=t`);
    await new Promise((r) => ws.on('open', r));
    await new Promise((r) => setTimeout(r, 50));
    expect(h.mux.clientCount).to.equal(1);

    const originalSend = WebSocket.prototype.send;
    (WebSocket.prototype as any).send = function () {
      throw new Error('boom');
    };
    try {
      h.mux.push(rec('trigger'));
      await new Promise((r) => setTimeout(r, 150));
    } finally {
      WebSocket.prototype.send = originalSend;
    }

    expect(h.mux.clientCount, 'a persistently throwing sink must be evicted').to.equal(0);
    await h.close();
  });
});
