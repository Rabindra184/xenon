import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from '../helpers/loopbackRequest';
import {
  evaluateDeviceAccess,
  isLeaseHolder,
  DeviceAccessInput,
} from '../../src/services/device-access/deviceAccessPolicy';
import { deviceAccessGuard } from '../../src/middleware/deviceAccessGuard';
import { makeTicketActorAuthorizer } from '../../src/services/device-access/ticketActorAccess';
import { decideStreamStartConflict } from '../../src/app/routers/streamStartConflict';
import { BusyPrecheck } from '../../src/services/recording/busy-precheck';

// A phone an SDK lease holds is its lease holder's. The guard used to read
// only `busy` and `session_id`: a freshly leased phone (busy, no session) was
// refused to everyone but admins, its holder included, and a leased phone
// whose `busy` had been cleared (a lease-bound session's release, the idle
// sweeper) was open to anyone.

const UDID = 'DEV-1';
const HOST = 'http://hub:4723';
const ALICE = 'usr_alice';
const ALICE_KEY = 'key_alice';
const BOB = 'usr_bob';
const BOB_KEY = 'key_bob';

const aliceLease = { actorId: ALICE_KEY, holderUserId: ALICE };

function input(over: Partial<DeviceAccessInput> = {}): DeviceAccessInput {
  return {
    udid: UDID,
    busy: true,
    sessionId: null,
    sessionOwnerUserId: null,
    actorUserId: BOB,
    actorApiKeyId: BOB_KEY,
    isAdmin: false,
    lease: aliceLease,
    ...over,
  };
}

describe('device access on a leased phone', () => {
  describe('evaluateDeviceAccess', () => {
    it('lets the lease holder through by the key that created it', () => {
      expect(
        evaluateDeviceAccess(input({ actorUserId: 'usr_other', actorApiKeyId: ALICE_KEY })),
      ).to.deep.equal({ allow: true });
    });

    it('lets the lease holder through with any credential of theirs', () => {
      expect(
        evaluateDeviceAccess(input({ actorUserId: ALICE, actorApiKeyId: undefined })),
      ).to.deep.equal({ allow: true });
    });

    it('lets a user through on a lease made with their bearer token (actorId is the user id)', () => {
      expect(
        evaluateDeviceAccess(
          input({
            actorUserId: ALICE,
            actorApiKeyId: undefined,
            lease: { actorId: ALICE, holderUserId: ALICE },
          }),
        ),
      ).to.deep.equal({ allow: true });
    });

    it('refuses anyone else, naming the lease holder', () => {
      expect(evaluateDeviceAccess(input())).to.deep.equal({
        allow: false,
        code: 'device_held_by_another_user',
        holderId: ALICE,
        heldBy: 'lease',
      });
    });

    it("refuses anyone else even when the phone's busy flag was cleared", () => {
      expect(evaluateDeviceAccess(input({ busy: false })).allow).to.equal(false);
    });

    it('lets the owner of the session running on the leased phone drive it', () => {
      expect(
        evaluateDeviceAccess(input({ sessionId: 'sess-1', sessionOwnerUserId: BOB })),
      ).to.deep.equal({ allow: true });
    });

    it("doesn't let a manual hold on a leased phone stand in for the lease", () => {
      expect(evaluateDeviceAccess(input({ sessionId: `manual_${BOB}_${UDID}` })).allow).to.equal(
        false,
      );
    });

    it('fails closed when the holder cannot be resolved', () => {
      const d = evaluateDeviceAccess(input({ lease: { actorId: 'key_gone', holderUserId: null } }));
      expect(d).to.deep.equal({
        allow: false,
        code: 'device_held_by_another_user',
        holderId: '',
        heldBy: 'lease',
      });
    });

    it('still allows an admin', () => {
      expect(evaluateDeviceAccess(input({ isAdmin: true }))).to.deep.equal({ allow: true });
    });

    it('leaves an unleased phone to the rules it had', () => {
      expect(evaluateDeviceAccess(input({ lease: null, busy: false }))).to.deep.equal({
        allow: true,
      });
      expect(
        evaluateDeviceAccess(input({ lease: null, sessionId: 'sess-1', sessionOwnerUserId: ALICE }))
          .allow,
      ).to.equal(false);
    });

    it('isLeaseHolder needs a lease', () => {
      expect(isLeaseHolder(null, ALICE, ALICE_KEY)).to.equal(false);
    });
  });

  describe('deviceAccessGuard', () => {
    function appFor(opts: {
      actorUserId: string;
      apiKeyId?: string;
      role?: string;
      busy?: boolean;
      lease?: { actorId: string } | null;
      leaseHolder?: string | null;
      leaseLookup?: () => Promise<{ actorId: string } | null>;
    }) {
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        (req as any).auth = {
          kind: 'api-key',
          userId: opts.actorUserId,
          role: opts.role ?? 'MEMBER',
          scopes: 'devices',
          rateLimit: 100,
        };
        if (opts.apiKeyId) (req as any).apiKey = { id: opts.apiKeyId };
        next();
      });
      const router = express.Router();
      router.use(
        deviceAccessGuard({
          findDevice: async () => ({
            udid: UDID,
            host: HOST,
            busy: opts.busy ?? true,
            session_id: null,
          }),
          resolveSessionOwner: async () => null,
          describeHolder: async (id) => (id === ALICE ? 'alice@example.com' : null),
          findActiveLease:
            opts.leaseLookup ??
            (async (udid, host) => (udid === UDID && host === HOST ? (opts.lease ?? null) : null)),
          resolveLeaseHolder: async () => opts.leaseHolder ?? null,
        }),
      );
      router.post('/:udid/tap', (_req, res) => res.json({ reached: true }));
      router.get('/:udid/clipboard', (_req, res) => res.json({ reached: true }));
      app.use('/control', router);
      return app;
    }

    it('lets the lease holder control the phone they just leased', async () => {
      const res = await request(
        appFor({ actorUserId: ALICE, lease: { actorId: ALICE_KEY }, leaseHolder: ALICE }),
      ).post(`/control/${UDID}/tap`);
      expect(res.status).to.equal(200);
      expect(res.body.reached).to.equal(true);
    });

    it('refuses another member with a message about the lease', async () => {
      const res = await request(
        appFor({ actorUserId: BOB, lease: { actorId: ALICE_KEY }, leaseHolder: ALICE }),
      ).post(`/control/${UDID}/tap`);
      expect(res.status).to.equal(409);
      expect(res.body.error).to.equal('device_held_by_another_user');
      expect(res.body.message).to.match(/leased by alice@example\.com/);
      expect(res.body.holder.userId).to.equal(ALICE);
    });

    it('refuses another member on a leased phone whose busy flag was cleared', async () => {
      const res = await request(
        appFor({
          actorUserId: BOB,
          busy: false,
          lease: { actorId: ALICE_KEY },
          leaseHolder: ALICE,
        }),
      ).get(`/control/${UDID}/clipboard`);
      expect(res.status).to.equal(409);
    });

    it('answers 503 when it cannot tell whether a lease holds the phone', async () => {
      const res = await request(
        appFor({
          actorUserId: BOB,
          leaseLookup: async () => {
            throw new Error('db down');
          },
        }),
      ).post(`/control/${UDID}/tap`);
      expect(res.status).to.equal(503);
      expect(res.body.error).to.equal('device_ownership_unavailable');
    });

    it('does not look leases up for an admin', async () => {
      const res = await request(
        appFor({
          actorUserId: BOB,
          role: 'SUPER_ADMIN',
          leaseLookup: async () => {
            throw new Error('an admin should not need this');
          },
        }),
      ).post(`/control/${UDID}/tap`);
      expect(res.status).to.equal(200);
    });
  });

  describe('the logcat ticket authorizer', () => {
    const authorize = makeTicketActorAuthorizer({
      findDevice: async () => ({ udid: UDID, host: HOST, busy: true, session_id: null }),
      resolveSessionOwner: async () => null,
      findActiveLease: async () => ({ actorId: ALICE_KEY }),
      resolveLeaseHolder: async () => ALICE,
    });

    it('lets the lease holder read the leased phone', async () => {
      expect(await authorize(UDID, { actorId: ALICE } as any)).to.equal(true);
    });

    it('refuses anyone else', async () => {
      expect(await authorize(UDID, { actorId: BOB } as any)).to.equal(false);
    });
  });

  describe('stream/start', () => {
    const start = (over: Record<string, unknown> = {}) =>
      decideStreamStartConflict({
        udid: UDID,
        busy: true,
        sessionId: null,
        hasLiveManualStream: false,
        sessionOwnerUserId: null,
        actorUserId: ALICE,
        isAdmin: false,
        ...over,
      });

    it('lets the lease holder preview their leased phone (busy, no session)', () => {
      expect(start({ leaseHolder: true })).to.deep.equal({ action: 'proceed' });
    });

    it('still refuses a busy phone with no holder on record to anyone else', () => {
      expect(start().action).to.equal('deny');
    });

    it("doesn't let a lease stand in for someone else's session on the phone", () => {
      expect(
        start({ leaseHolder: true, sessionId: 'sess-9', sessionOwnerUserId: BOB }).action,
      ).to.equal('deny');
    });

    function appFor(actorUserId: string, role = 'MEMBER', leased = true) {
      const app = express();
      app.use((req, _res, next) => {
        (req as any).auth = { kind: 'api-key', userId: actorUserId, role, scopes: 'devices' };
        next();
      });
      const router = express.Router();
      router.use(
        deviceAccessGuard({
          findDevice: async () => ({ udid: UDID, host: HOST, busy: false, session_id: null }),
          resolveSessionOwner: async () => null,
          describeHolder: async () => 'alice@example.com',
          findActiveLease: async () => {
            if (role === 'SUPER_ADMIN') throw new Error('an admin should not need this');
            return leased ? { actorId: ALICE_KEY } : null;
          },
          resolveLeaseHolder: async () => ALICE,
        }),
      );
      router.post('/:udid/stream/start', (_req, res) => res.json({ reached: true }));
      app.use('/control', router);
      return app;
    }

    it('refuses a stranger before the handler (and before a hub forwards it)', async () => {
      const res = await request(appFor(BOB)).post(`/control/${UDID}/stream/start`);
      expect(res.status).to.equal(409);
      expect(res.body.message).to.match(/leased by/);
    });

    it('passes the lease holder on to the handler', async () => {
      const res = await request(appFor(ALICE)).post(`/control/${UDID}/stream/start`);
      expect(res.body.reached).to.equal(true);
    });

    it('leaves an unleased phone to stream/start, as before', async () => {
      const res = await request(appFor(BOB, 'MEMBER', false)).post(`/control/${UDID}/stream/start`);
      expect(res.body.reached).to.equal(true);
    });

    it('passes an admin without looking leases up', async () => {
      const res = await request(appFor(BOB, 'SUPER_ADMIN')).post(`/control/${UDID}/stream/start`);
      expect(res.body.reached).to.equal(true);
    });
  });

  describe('recordings (BusyPrecheck)', () => {
    const precheck = (row: Record<string, unknown>, lease: { actorId: string } | null | Error) =>
      new BusyPrecheck(
        { findDevice: async () => ({ udid: UDID, host: HOST, ...row }) },
        { isRecording: async () => false },
        {
          find: async () => {
            if (lease instanceof Error) throw lease;
            return lease;
          },
          holderOf: async () => ALICE,
        },
      );

    it("refuses a stranger's recording of a leased phone, busy or not", async () => {
      expect(
        await precheck({ busy: false }, { actorId: ALICE_KEY }).findBusy([UDID], BOB),
      ).to.deep.equal([{ udid: UDID, reason: 'leased' }]);
    });

    it('lets the lease holder record their leased phone', async () => {
      expect(
        await precheck({ busy: true }, { actorId: ALICE_KEY }).findBusy([UDID], ALICE),
      ).to.deep.equal([]);
    });

    it('still refuses the holder while a session runs on it, as for any session', async () => {
      const busy = await precheck(
        { busy: true, session_id: 'sess-1' },
        { actorId: ALICE_KEY },
      ).findBusy([UDID], ALICE);
      expect(busy).to.deep.equal([{ udid: UDID, reason: 'automation', sessionId: 'sess-1' }]);
    });

    it('fails the start when it cannot tell whether a lease holds the phone', async () => {
      let thrown: unknown;
      try {
        await precheck({ busy: false }, new Error('db down')).findBusy([UDID], BOB);
      } catch (e) {
        thrown = e;
      }
      expect((thrown as Error)?.message).to.equal('db down');
    });
  });
});
