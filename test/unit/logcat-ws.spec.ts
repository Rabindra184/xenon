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
import {
  attachLogcatWs,
  parseLogcatWsPath,
  type LogcatWsActor,
  type LogcatWsDeps,
} from '../../src/app/ws/logcatWs';
import { LogcatMultiplexer } from '../../src/device-managers/android/LogcatMultiplexer';
import type { LogcatRecord } from '../../src/services/logcat/logcatParse';
import {
  makeTicketActorAuthorizer,
  type DeviceOwnershipRow,
} from '../../src/services/device-access/ticketActorAccess';
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

/**
 * The three callbacks this layer hands the multiplexer.
 *
 * A capturing stand-in mux lets a test drive them the way the real mux does —
 * including the cases a live socket cannot be manoeuvred into on demand (a
 * record arriving while the socket is CLOSING, a replay send that bypasses
 * canAccept). Without this the backpressure/teardown branches are only
 * reachable by luck, which is how they ended up unpinned in the first place.
 */
interface CapturedSink {
  send: (r: LogcatRecord) => void;
  canAccept: () => boolean;
  onClose?: () => void;
}

function capturingMux() {
  const state: { sink?: CapturedSink; removeCalls: number } = { removeCalls: 0 };
  const fake = {
    addClient(
      send: (r: LogcatRecord) => void,
      canAccept: () => boolean,
      onClose?: () => void,
    ): () => void {
      state.sink = { send, canAccept, onClose };
      return () => {
        state.removeCalls += 1;
      };
    },
  } as unknown as LogcatMultiplexer;
  return { fake, state };
}

interface Harness {
  port: number;
  close: () => Promise<void>;
  mux: LogcatMultiplexer;
  startCalls: number;
  authorizeCalls: number;
  /** Every actor object `authorize` was handed, in order. */
  authorizeActors: LogcatWsActor[];
}

async function harness(over: {
  redeem?: (ticket: string, udid: string) => Promise<LogcatWsActor>;
  authorize?: (udid: string, actor: LogcatWsActor) => Promise<boolean>;
  startStream?: (udid: string) => Promise<LogcatMultiplexer>;
  maxBufferedBytes?: number;
}): Promise<Harness> {
  const mux = new LogcatMultiplexer();
  const state = { startCalls: 0, authorizeCalls: 0, authorizeActors: [] as LogcatWsActor[] };
  const server = http.createServer();
  const userAuthorize = over.authorize ?? (async () => true);
  const deps: LogcatWsDeps = {
    redeem: over.redeem ?? (async () => ({ actorId: 'usr_alice' })),
    authorize: (udid, actor) => {
      state.authorizeCalls += 1;
      state.authorizeActors.push(actor);
      return userAuthorize(udid, actor);
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
    get authorizeActors() {
      return state.authorizeActors;
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

const url = (port: number, udid = 'DEV-1', ticket = 't') =>
  `ws://127.0.0.1:${port}/xenon/api/control/${udid}/logcat?ticket=${ticket}`;

/** Resolves with the close code, or 'open' if the socket stays up. */
const connect = (port: number, ticket = 'tok', udid = 'DEV-1') =>
  new Promise<number | 'open'>((resolve) => {
    const ws = new WebSocket(url(port, udid, ticket));
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

/**
 * Connect and report the outcome, collecting anything delivered on the way.
 *
 * Deny tests must be able to prove a refused caller received *nothing*. That
 * only means something if a wrongly-admitted caller would have received
 * something, so every caller of this seeds the mux first: LogcatMultiplexer
 * replays its buffer to a joining client, so a wrongful join delivers the seed
 * immediately. Without the seed, `got` is empty either way and the assertion
 * cannot fail.
 */
async function connectCollecting(h: Harness, ticket = 't', udid = 'DEV-1') {
  const got: LogcatRecord[] = [];
  const ws = new WebSocket(url(h.port, udid, ticket));
  ws.on('message', (d) => got.push(JSON.parse(d.toString())));
  const code = await new Promise<number | 'open'>((resolve) => {
    ws.on('close', (c) => resolve(c));
    ws.on('open', () => setTimeout(() => resolve('open'), 150));
  });
  if (code === 'open') ws.terminate();
  return { code, got };
}

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
    h.mux.push(rec('secret token in the logs'));
    const { code, got } = await connectCollecting(h);
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
    h.mux.push(rec('secret token in the logs'));
    const { code, got } = await connectCollecting(h);
    expect(code).to.equal(1011);
    expect(h.startCalls, 'an undetermined owner must fail closed, not fall through').to.equal(0);
    expect(got, 'a refused caller must never receive a record').to.deep.equal([]);
    await h.close();
  });

  it('forwards records to a connected client', async () => {
    const h = await harness({});
    const ws = new WebSocket(url(h.port));
    const got: any[] = [];
    ws.on('message', (d) => got.push(JSON.parse(d.toString())));
    await new Promise((r) => ws.on('open', r));
    h.mux.push({ ts: 1, pid: 1, tid: 1, level: 'D', tag: 'T', message: 'hello' });
    await new Promise((r) => setTimeout(r, 100));
    expect(got.map((r) => r.message)).to.deep.equal(['hello']);
    ws.close();
    await h.close();
  });

  // The whole ownership check is worthless if the identity it judges is not
  // the one the ticket vouched for. Substituting any constant here (an empty
  // string, a hardcoded id) must fail.
  it('judges ownership against exactly the actor redeem returned', async () => {
    const minted: LogcatWsActor = { actorId: 'usr_bob', isAdmin: true, apiKeyId: 'key_legacy' };
    const h = await harness({ redeem: async () => minted });
    expect(await connect(h.port)).to.equal('open');
    expect(h.authorizeActors).to.have.length(1);
    expect(
      h.authorizeActors[0],
      'authorize must see the redeemed actor, privileges included',
    ).to.deep.equal(minted);
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
    const ws = new WebSocket(url(h.port));
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

  // Middle checkpoint: redeem is done and the ownership lookup is in flight
  // (it hits the device store and, for a live Appium session, resolves the
  // session owner) when the caller disconnects. Same reasoning as the two
  // neighbours — the observable is the adb spawn that must not happen.
  it('leaves no client registered when the socket drops mid-handshake during authorize', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const h = await harness({
      authorize: async () => {
        await gate;
        return true;
      },
    });
    const ws = new WebSocket(url(h.port));
    await new Promise((r) => setTimeout(r, 50));
    ws.terminate(); // disconnect while authorize is still pending
    await new Promise((r) => setTimeout(r, 100));
    release();
    await new Promise((r) => setTimeout(r, 150));
    expect(h.authorizeCalls, 'authorize was already in flight').to.equal(1);
    expect(h.startCalls, 'must not start a logcat process once the caller is gone').to.equal(0);
    expect(h.mux.clientCount).to.equal(0);
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
    const ws = new WebSocket(url(h.port));
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

/**
 * Upstream death must reach the browser.
 *
 * LogcatStreamService pushes a synthetic "log stream ended" record and then
 * drops the multiplexer, both when `adb logcat` exits and on an explicit
 * stop(). Dropping the mux detaches the client but says nothing on the wire:
 * the socket simply stops receiving. A browser cannot observe "send is no
 * longer being called", so without an explicit close the tab sits on a frozen
 * buffer, badged LIVE, and its reconnect-with-backoff never fires.
 */
describe('attachLogcatWs upstream teardown', () => {
  it('closes the browser socket when the multiplexer closes', async () => {
    const h = await harness({});
    const got: LogcatRecord[] = [];
    const ws = new WebSocket(url(h.port));
    ws.on('message', (d) => got.push(JSON.parse(d.toString())));
    await new Promise((r) => ws.on('open', r));
    await new Promise((r) => setTimeout(r, 50));

    const outcome = new Promise<[number, string] | 'still-open'>((resolve) => {
      ws.on('close', (c, reason) => resolve([c, reason.toString()]));
      setTimeout(() => resolve('still-open'), 500);
    });

    // Exactly what LogcatStreamService.end() does when the adb child exits.
    h.mux.push({
      ts: 2,
      pid: 0,
      tid: 0,
      level: 'E',
      tag: 'xenon',
      message: 'log stream ended (process exited)',
      synthetic: true,
    });
    h.mux.close();

    const seen = await outcome;
    expect(seen, 'the socket must be closed, not left attached to a dead multiplexer').to.not.equal(
      'still-open',
    );
    const [code, reason] = seen as [number, string];
    expect(code, 'a close code the client can act on').to.equal(1012);
    expect(reason).to.equal('stream ended');
    expect(
      got.map((r) => r.message),
      'the final record must reach the client before the close',
    ).to.deep.equal(['log stream ended (process exited)']);
    expect(h.mux.clientCount).to.equal(0);
    if (ws.readyState !== WebSocket.CLOSED) ws.terminate();
    await h.close();
  });
});

/**
 * The production ownership decision, tested directly.
 *
 * This function IS the security boundary the WS enforces — device lookup, the
 * manual-lock branch, the session-owner resolve, the actor's privileges. The
 * earlier version of this suite tested a hand-written near-copy of the
 * ServerManager block instead, and the copy had already drifted away from the
 * original in three places. Drive the real thing; inject only the two lookups.
 */
describe('makeTicketActorAuthorizer', () => {
  const UDID = 'DEV-1';
  const ALICE = 'usr_alice';
  const BOB = 'usr_bob';

  const authorizer = (device: DeviceOwnershipRow | null, owner: string | null = null) => {
    const calls = { findDevice: 0, resolveSessionOwner: 0 };
    const fn = makeTicketActorAuthorizer({
      findDevice: async () => {
        calls.findDevice += 1;
        return device;
      },
      resolveSessionOwner: async () => {
        calls.resolveSessionOwner += 1;
        return owner;
      },
    });
    return { fn, calls };
  };

  it('denies a device the store cannot resolve', async () => {
    // Fail-closed, and deliberately unlike deviceAccessGuard's fall-through:
    // there is no 404 behind this call, and getAdbForDevice happily runs
    // `adb -s <udid> logcat` against an unknown serial.
    const { fn, calls } = authorizer(null);
    expect(await fn(UDID, { actorId: BOB })).to.equal(false);
    expect(calls.resolveSessionOwner, 'nothing to resolve for a device that is not there').to.equal(
      0,
    );
  });

  it('denies an unknown device even to an admin', async () => {
    const { fn } = authorizer(null);
    expect(await fn(UDID, { actorId: BOB, isAdmin: true })).to.equal(false);
  });

  it('allows an idle device', async () => {
    const { fn, calls } = authorizer({ busy: false, session_id: null });
    expect(await fn(UDID, { actorId: BOB })).to.equal(true);
    expect(calls.findDevice).to.equal(1);
  });

  it('allows the holder of the manual lock', async () => {
    const { fn } = authorizer({ busy: true, session_id: `manual_${ALICE}_${UDID}` });
    expect(await fn(UDID, { actorId: ALICE })).to.equal(true);
  });

  it('denies a non-admin who does not hold the manual lock', async () => {
    const { fn } = authorizer({ busy: true, session_id: `manual_${ALICE}_${UDID}` });
    expect(await fn(UDID, { actorId: BOB })).to.equal(false);
  });

  // Finding 3(a): isAdmin was hardcoded false in the wiring, so the admin
  // bypass only ever worked on an admin's own device — the support case the
  // branch exists for (watch another user's failing run) was the one it failed.
  it('lets an admin bypass a manual lock held by someone else', async () => {
    const { fn } = authorizer({ busy: true, session_id: `manual_${ALICE}_${UDID}` });
    expect(await fn(UDID, { actorId: BOB, isAdmin: true })).to.equal(true);
  });

  // Finding 3(b): deviceAccessGuard passes actorApiKeyId so a pre-1.13.0
  // manual_<apiKeyId>_<udid> lock is still recognised as self. Dropping it
  // here denied a caller their own device over the WS while /control admitted
  // them for the same lock.
  it('recognises a pre-1.13.0 lock keyed on the api-key id as self', async () => {
    const { fn } = authorizer({ busy: true, session_id: `manual_key_legacy_${UDID}` });
    expect(await fn(UDID, { actorId: ALICE, apiKeyId: 'key_legacy' })).to.equal(true);
    expect(
      await fn(UDID, { actorId: ALICE, apiKeyId: 'key_someone_else' }),
      "another user's key-keyed lock is still foreign",
    ).to.equal(false);
  });

  it('allows the owner of the running Appium session', async () => {
    const { fn, calls } = authorizer({ busy: true, session_id: 'appium-sess-1' }, ALICE);
    expect(await fn(UDID, { actorId: ALICE })).to.equal(true);
    expect(calls.resolveSessionOwner).to.equal(1);
  });

  it('denies a caller who does not own the running Appium session', async () => {
    const { fn } = authorizer({ busy: true, session_id: 'appium-sess-1' }, ALICE);
    expect(await fn(UDID, { actorId: BOB })).to.equal(false);
  });

  it('denies when the session is unattributable', async () => {
    const { fn } = authorizer({ busy: true, session_id: 'appium-sess-1' }, null);
    expect(await fn(UDID, { actorId: ALICE })).to.equal(false);
  });

  // Propagating rather than returning false is what the WS turns into 1011
  // "ownership unavailable" instead of a plain deny — and, crucially, it can
  // never be mistaken for an allow.
  it('propagates a device-lookup failure instead of guessing', async () => {
    const fn = makeTicketActorAuthorizer({
      findDevice: async () => {
        throw new Error('store down');
      },
      resolveSessionOwner: async () => null,
    });
    let err: Error | undefined;
    try {
      await fn(UDID, { actorId: ALICE });
    } catch (e: any) {
      err = e;
    }
    expect(err, 'a failed lookup must not resolve to a verdict').to.be.an('error');
  });

  it('propagates a session-owner lookup failure instead of guessing', async () => {
    const fn = makeTicketActorAuthorizer({
      findDevice: async () => ({ busy: true, session_id: 'appium-sess-1' }),
      resolveSessionOwner: async () => {
        throw new Error('db down');
      },
    });
    let err: Error | undefined;
    try {
      await fn(UDID, { actorId: ALICE });
    } catch (e: any) {
      err = e;
    }
    expect(err, 'a failed lookup must not resolve to a verdict').to.be.an('error');
  });
});

// End-to-end over a real socket, with the production authorizer wired in the
// same shape ServerManager wires it — only the two lookups are faked.
describe('attachLogcatWs ownership — wired through makeTicketActorAuthorizer', () => {
  const UDID = 'DEV-1';
  const ALICE = 'usr_alice'; // holds the device via a manual lock
  const BOB = 'usr_bob'; // a different caller

  const wired = (device: DeviceOwnershipRow | null, owner: string | null = null) =>
    makeTicketActorAuthorizer({
      findDevice: async () => device,
      resolveSessionOwner: async () => owner,
    });

  const heldByAlice = { busy: true, session_id: `manual_${ALICE}_${UDID}` };

  it('denies a non-admin caller who does not hold the manual lock', async () => {
    const h = await harness({
      redeem: async () => ({ actorId: BOB }),
      authorize: wired(heldByAlice),
    });
    h.mux.push(rec('secret token in the logs'));
    const { code, got } = await connectCollecting(h, 't', UDID);
    expect(code).to.equal(1008);
    expect(got).to.deep.equal([]);
    expect(h.startCalls).to.equal(0);
    await h.close();
  });

  it('lets an admin caller bypass a manual lock held by someone else', async () => {
    const h = await harness({
      redeem: async () => ({ actorId: BOB, isAdmin: true }),
      authorize: wired(heldByAlice),
    });
    expect(await connect(h.port, 't', UDID)).to.equal('open');
    expect(h.startCalls).to.equal(1);
    await h.close();
  });

  it('closes 1008 and starts nothing for a device the store cannot resolve', async () => {
    const h = await harness({
      redeem: async () => ({ actorId: BOB }),
      authorize: wired(null),
    });
    h.mux.push(rec('secret token in the logs'));
    const { code, got } = await connectCollecting(h, 't', 'GHOST-DEVICE');
    expect(code).to.equal(1008);
    expect(
      h.startCalls,
      'adb would happily run `adb -s GHOST-DEVICE logcat` against the default device',
    ).to.equal(0);
    expect(got).to.deep.equal([]);
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
    // Remove only what this block set. Container.reset() wipes the process-wide
    // TypeDI container, which is a cross-file hazard the moment this spec
    // shares a mocha process with anything that registers a singleton.
    Container.remove(JwtKeyService);
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

  it('carries the minting actor privileges through to the ownership check', async () => {
    const h = await harness({ redeem: (t, u) => ticketSvc.redeem(t, u) });
    const t = await ticketSvc.mint('DEV-1', 'usr_alice', {
      isAdmin: true,
      apiKeyId: 'key_legacy',
    });
    expect(await connect(h.port, t)).to.equal('open');
    expect(h.authorizeActors[0]).to.deep.equal({
      actorId: 'usr_alice',
      isAdmin: true,
      apiKeyId: 'key_legacy',
    });
    await h.close();
  });

  it('reads a ticket minted without privileges as a plain, non-admin caller', async () => {
    const h = await harness({ redeem: (t, u) => ticketSvc.redeem(t, u) });
    const t = await ticketSvc.mint('DEV-1', 'usr_bob');
    expect(await connect(h.port, t)).to.equal('open');
    expect(h.authorizeActors[0].isAdmin, 'no admin unless the mint said so').to.equal(false);
    expect(h.authorizeActors[0].apiKeyId).to.equal(undefined);
    await h.close();
  });

  // The claims are only trustworthy because they are inside the RS256
  // signature. Editing the payload of a legitimately-minted non-admin ticket
  // to claim admin must not survive verification — otherwise this change would
  // have handed every ticket holder an admin bypass.
  it('rejects a ticket whose payload was edited to claim admin', async () => {
    const h = await harness({ redeem: (t, u) => ticketSvc.redeem(t, u) });
    const t = await ticketSvc.mint('DEV-1', 'usr_bob');
    const [header, payload, signature] = t.split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    expect(claims.isAdmin, 'the honest ticket must not already be admin').to.equal(false);
    claims.isAdmin = true;
    const forged = [
      header,
      Buffer.from(JSON.stringify(claims)).toString('base64url'),
      signature,
    ].join('.');

    expect(await connect(h.port, forged)).to.equal(1008);
    expect(h.authorizeCalls, 'a forged claim must never reach the policy').to.equal(0);
    expect(h.startCalls).to.equal(0);
    await h.close();
  });

  it('rejects an unsigned (alg:none) ticket claiming admin', async () => {
    const h = await harness({ redeem: (t, u) => ticketSvc.redeem(t, u) });
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
      udid: 'DEV-1',
      actorId: 'usr_bob',
      isAdmin: true,
      iss: 'xenon-hub',
      aud: 'xenon-stream',
      exp: Math.floor(Date.now() / 1000) + 60,
      jti: 'forged-1',
    })}.`;

    expect(await connect(h.port, unsigned)).to.equal(1008);
    expect(h.authorizeCalls).to.equal(0);
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
  const droppedWarnings = (spy: sinon.SinonStub) =>
    spy.getCalls().filter((c) => /dropped/i.test(String(c.args[0])));

  it('logs the pending drop count when a permanently backed-up client disconnects', async () => {
    const warnSpy = sinon.stub(log, 'warn');
    try {
      // maxBufferedBytes: 0 makes canAccept() refuse unconditionally
      // (bufferedAmount is never negative), so every push is a guaranteed drop.
      const h = await harness({ maxBufferedBytes: 0 });
      const ws = new WebSocket(url(h.port));
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

      const warned = droppedWarnings(warnSpy).map((c) => String(c.args[0]));
      expect(
        warned.some((m) => /3/.test(m)),
        'the pending drop count must be surfaced when the client leaves',
      ).to.equal(true);
      await h.close();
    } finally {
      warnSpy.restore();
    }
  });

  // A socket can emit BOTH 'error' and 'close' (a protocol violation does it
  // every time). remove() is idempotent; the warn is not, so without a guard
  // one disconnect reports its gap twice and a reader double-counts the loss.
  it('reports the drop count once even when the socket emits error and close', async () => {
    const warnSpy = sinon.stub(log, 'warn');
    try {
      const h = await harness({ maxBufferedBytes: 0 });
      const ws = new WebSocket(url(h.port));
      ws.on('error', () => undefined); // the client sees the server hang up
      await new Promise((r) => ws.on('open', r));
      await new Promise((r) => setTimeout(r, 50));
      h.mux.push(rec('lost one'));
      await new Promise((r) => setTimeout(r, 50));

      // An unmasked frame from a client is a protocol violation: the server's
      // socket emits 'error' and then 'close'.
      (ws as any)._socket.write(Buffer.from([0x81, 0x01, 0x41]));
      await new Promise((r) => setTimeout(r, 250));

      expect(
        droppedWarnings(warnSpy).map((c) => String(c.args[0])),
        'one disconnect, one report',
      ).to.have.length(1);
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
    const ws = new WebSocket(url(h.port));
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

/**
 * The sink's own contract, driven directly.
 *
 * These three branches decide whether a log line is delivered, dropped-and-
 * counted, or lost silently. A live socket cannot be put into the states that
 * distinguish them on demand, so the multiplexer is stood in for and its three
 * callbacks are called the way the real one calls them.
 */
describe('attachLogcatWs sink', () => {
  async function sinkHarness(maxBufferedBytes?: number) {
    const cap = capturingMux();
    const h = await harness({
      startStream: async () => cap.fake,
      ...(maxBufferedBytes === undefined ? {} : { maxBufferedBytes }),
    });
    const ws = new WebSocket(url(h.port));
    const got: LogcatRecord[] = [];
    ws.on('message', (d) => got.push(JSON.parse(d.toString())));
    ws.on('error', () => undefined);
    await new Promise((r) => ws.on('open', r));
    await new Promise((r) => setTimeout(r, 50));
    if (!cap.state.sink) throw new Error('sink was never registered');
    return { h, ws, got, sink: cap.state.sink };
  }

  it('refuses records once the socket is no longer OPEN', async () => {
    const { h, ws, sink } = await sinkHarness();
    expect(sink.canAccept(), 'an open, unbacked-up socket accepts').to.equal(true);

    ws.terminate();
    await new Promise((r) => setTimeout(r, 150));

    // bufferedAmount is 0 on a dead socket, so a size-only check would happily
    // report "room available" and the mux would count the record as delivered.
    expect(
      sink.canAccept(),
      'a socket that is gone must be refused, so the mux counts the drop too',
    ).to.equal(false);
    await h.close();
  });

  it('counts a record pushed while the socket is closing, instead of losing it silently', async () => {
    const warnSpy = sinon.stub(log, 'warn');
    try {
      const { h, ws, got, sink } = await sinkHarness();
      // Upstream died: this is what the multiplexer's close() invokes. The
      // socket is now CLOSING, but its 'close' event has not fired yet.
      sink.onClose!();
      // A record that lands in that window. `ws` swallows a send on a
      // non-OPEN socket — no throw, no error event — so nothing but this
      // layer can notice the loss.
      sink.send(rec('late line'));
      await new Promise((r) => setTimeout(r, 250));

      expect(
        got.map((r) => r.message),
        'a closing socket cannot deliver',
      ).to.deep.equal([]);
      const warned = warnSpy.getCalls().map((c) => String(c.args[0]));
      expect(
        warned.some((m) => /dropped/i.test(m) && /1 line/.test(m)),
        'the lost line must be counted and reported, not swallowed',
      ).to.equal(true);
      if (ws.readyState !== WebSocket.CLOSED) ws.terminate();
      await h.close();
    } finally {
      warnSpy.restore();
    }
  });

  it('clears the pending drop count once a record actually gets out', async () => {
    const warnSpy = sinon.stub(log, 'warn');
    try {
      // maxBufferedBytes: 0 → canAccept always refuses, so these are real drops.
      const { h, ws, got, sink } = await sinkHarness(0);
      expect(sink.canAccept()).to.equal(false);
      expect(sink.canAccept()).to.equal(false);
      expect(sink.canAccept()).to.equal(false);

      // The replay burst in addClient sends without consulting canAccept; a
      // record that genuinely reaches the client closes the gap.
      sink.send(rec('delivered'));
      await new Promise((r) => setTimeout(r, 100));
      expect(got.map((r) => r.message)).to.deep.equal(['delivered']);

      ws.terminate();
      await new Promise((r) => setTimeout(r, 200));

      expect(
        warnSpy
          .getCalls()
          .map((c) => String(c.args[0]))
          .filter((m) => /dropped/i.test(m)),
        'the gap was closed by a delivered record; nothing is still pending',
      ).to.deep.equal([]);
      await h.close();
    } finally {
      warnSpy.restore();
    }
  });
});
