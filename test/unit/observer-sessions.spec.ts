import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { IDevice } from '../../src/interfaces/IDevice';
import { SessionOwnerResolver } from '../../src/services/device-access/SessionOwnerResolver';
import {
  defaultObserverDeps,
  ObserverDeps,
  parseSessionIds,
  resolveObservedPhones,
} from '../../src/services/recording/observerSessions';

describe('observerSessions', () => {
  function phone(udid: string, fields: Partial<IDevice>, host = 'http://127.0.0.1:4723'): IDevice {
    return { udid, host, claimSessionId: null, session_id: undefined, ...fields } as IDevice;
  }

  /** Fake deps: the rows a store holds, each session's owner, and whether the caller sees the phones. */
  function deps(
    rows: IDevice[],
    owners: Record<string, string | null>,
    canSee: ObserverDeps['canSee'] = async () => true,
  ): ObserverDeps {
    return {
      canSee,
      findClaimedDevices: async (sessionId) =>
        rows.filter(
          (d) =>
            d.claimSessionId === sessionId ||
            (d.claimSessionId == null && d.session_id === sessionId),
        ),
      ownerOf: async (sessionId) => owners[sessionId] ?? null,
    };
  }

  const member = { userId: 'u1', isAdmin: false };
  const admin = { userId: 'admin', isAdmin: true };

  describe('resolveObservedPhones', () => {
    it('resolves each session to the phone its claim names', async () => {
      const rows = [
        phone('ios-1', { claimSessionId: 'S2', session_id: 'S2' }, 'http://node:4723'),
        phone('android-1', { claimSessionId: 'S1', session_id: 'S1' }),
      ];
      const result = await resolveObservedPhones(
        ['S1', 'S2'],
        member,
        deps(rows, { S1: 'u1', S2: 'u1' }),
      );
      expect(result).to.deep.equal({
        ok: true,
        phones: [
          { sessionId: 'S1', udid: 'android-1', host: 'http://127.0.0.1:4723' },
          { sessionId: 'S2', udid: 'ios-1', host: 'http://node:4723' },
        ],
      });
    });

    it('accepts a pre-claim row whose session_id names the session', async () => {
      const rows = [phone('android-1', { claimSessionId: null, session_id: 'S1' })];
      const result = await resolveObservedPhones(['S1'], member, deps(rows, { S1: 'u1' }));
      expect(result).to.deep.equal({
        ok: true,
        phones: [{ sessionId: 'S1', udid: 'android-1', host: 'http://127.0.0.1:4723' }],
      });
    });

    it("accepts a hub's node phone claimed by claimSessionId with an empty session_id", async () => {
      const rows = [
        phone('node-phone', { claimSessionId: 'S1', session_id: '' }, 'http://node:4723'),
      ];
      const result = await resolveObservedPhones(['S1'], member, deps(rows, { S1: 'u1' }));
      expect(result).to.deep.equal({
        ok: true,
        phones: [{ sessionId: 'S1', udid: 'node-phone', host: 'http://node:4723' }],
      });
    });

    it('refuses with 404 when no claim names a session', async () => {
      const rows = [phone('android-1', { claimSessionId: 'S1', session_id: 'S1' })];
      const result = await resolveObservedPhones(
        ['S1', 'S9'],
        member,
        deps(rows, { S1: 'u1', S9: 'u1' }),
      );
      expect(result).to.deep.equal({ ok: false, status: 404 });
    });

    it('does not take a row whose claim names another session, though its session_id names this one', async () => {
      // The store's session_id lookup can find a row another session has
      // claimed since; holdsClaim refuses it, so the deps never hand it over.
      const rows = [phone('android-1', { claimSessionId: 'S2', session_id: 'S1' })];
      const base = deps([], { S1: 'u1' });
      const leaky: ObserverDeps = { ...base, findClaimedDevices: async () => rows };
      const result = await resolveObservedPhones(['S1'], member, leaky);
      expect(result).to.deep.equal({ ok: false, status: 404 });
    });

    it('refuses with 404 when another user owns any session', async () => {
      const rows = [
        phone('android-1', { claimSessionId: 'S1' }),
        phone('ios-1', { claimSessionId: 'S2' }),
      ];
      const result = await resolveObservedPhones(
        ['S1', 'S2'],
        member,
        deps(rows, { S1: 'u1', S2: 'u2' }),
      );
      expect(result).to.deep.equal({ ok: false, status: 404 });
    });

    it('refuses with 404 when the owner is null', async () => {
      const rows = [phone('android-1', { claimSessionId: 'S1' })];
      const result = await resolveObservedPhones(['S1'], member, deps(rows, { S1: null }));
      expect(result).to.deep.equal({ ok: false, status: 404 });
    });

    it('refuses with 404 a caller with no user id, even for an ownerless session', async () => {
      const rows = [phone('android-1', { claimSessionId: 'S1' })];
      const result = await resolveObservedPhones(
        ['S1'],
        { userId: null, isAdmin: false },
        deps(rows, { S1: null }),
      );
      expect(result).to.deep.equal({ ok: false, status: 404 });
    });

    it("lets an admin through for another user's and an ownerless session", async () => {
      const rows = [
        phone('android-1', { claimSessionId: 'S1' }),
        phone('ios-1', { claimSessionId: 'S2' }),
      ];
      const result = await resolveObservedPhones(
        ['S1', 'S2'],
        admin,
        deps(rows, { S1: 'u2', S2: null }),
      );
      expect(result).to.deep.equal({
        ok: true,
        phones: [
          { sessionId: 'S1', udid: 'android-1', host: 'http://127.0.0.1:4723' },
          { sessionId: 'S2', udid: 'ios-1', host: 'http://127.0.0.1:4723' },
        ],
      });
    });

    it('refuses two ids naming one phone with 400', async () => {
      // One row, claimed by S1, still showing S2 in session_id would not hold
      // for S2; two rows for one phone are what a stale store could hand back.
      const rows = [
        phone('android-1', { claimSessionId: 'S1' }),
        phone('android-1', { claimSessionId: 'S2' }),
      ];
      const result = await resolveObservedPhones(
        ['S1', 'S2'],
        member,
        deps(rows, { S1: 'u1', S2: 'u1' }),
      );
      expect(result.ok).to.equal(false);
      expect(result).to.have.property('status', 400);
      expect(result).to.have.property('error').that.is.a('string');
    });

    it('treats one phone on two hosts as two phones', async () => {
      const rows = [
        phone('emulator-5554', { claimSessionId: 'S1' }, 'http://hub:4723'),
        phone('emulator-5554', { claimSessionId: 'S2' }, 'http://node:4723'),
      ];
      const result = await resolveObservedPhones(
        ['S1', 'S2'],
        member,
        deps(rows, { S1: 'u1', S2: 'u1' }),
      );
      expect(result.ok).to.equal(true);
    });

    it('refuses a cloud phone (device.cloud) with 409 cloud_phone', async () => {
      const rows = [
        phone('android-1', { claimSessionId: 'S1' }),
        phone('cloud-1', { claimSessionId: 'S2', cloud: 'browserstack' }),
      ];
      const result = await resolveObservedPhones(
        ['S1', 'S2'],
        member,
        deps(rows, { S1: 'u1', S2: 'u1' }),
      );
      expect(result).to.deep.equal({
        ok: false,
        status: 409,
        busyDevices: [{ udid: 'cloud-1', reason: 'cloud_phone' }],
      });
    });

    it("answers 404, not 409, for a cloud phone among another user's sessions", async () => {
      const rows = [
        phone('cloud-1', { claimSessionId: 'S1', cloud: true }),
        phone('android-1', { claimSessionId: 'S2' }),
      ];
      const result = await resolveObservedPhones(
        ['S1', 'S2'],
        member,
        deps(rows, { S1: 'u1', S2: 'u2' }),
      );
      expect(result).to.deep.equal({ ok: false, status: 404 });
    });

    it('answers 404, not 400, when two ids name one phone and another session is unknown', async () => {
      const rows = [
        phone('android-1', { claimSessionId: 'S1' }),
        phone('android-1', { claimSessionId: 'S2' }),
      ];
      const result = await resolveObservedPhones(
        ['S1', 'S2', 'S9'],
        member,
        deps(rows, { S1: 'u1', S2: 'u1', S9: 'u1' }),
      );
      expect(result).to.deep.equal({ ok: false, status: 404 });
    });

    it('looks up every session, whichever fails', async () => {
      const asked: string[] = [];
      const base = deps([phone('android-1', { claimSessionId: 'S2' })], { S2: 'u1' });
      const counting: ObserverDeps = {
        findClaimedDevices: async (id) => {
          asked.push(`claim:${id}`);
          return base.findClaimedDevices(id);
        },
        ownerOf: async (id) => {
          asked.push(`owner:${id}`);
          return base.ownerOf(id);
        },
        canSee: base.canSee,
      };
      const result = await resolveObservedPhones(['S1', 'S2'], member, counting);
      expect(result).to.deep.equal({ ok: false, status: 404 });
      expect(asked.sort()).to.deep.equal(['claim:S1', 'claim:S2', 'owner:S1', 'owner:S2']);
    });
    describe("the caller's teams", () => {
      const own = { S1: 'u1', S2: 'u1' };

      it('asks once, with the resolved phones, after every claim and owner checked out', async () => {
        const rows = [
          phone('android-1', { claimSessionId: 'S1' }),
          phone('ios-1', { claimSessionId: 'S2' }, 'http://node:4723'),
        ];
        const canSee = sinon.stub().resolves(true);
        const result = await resolveObservedPhones(['S1', 'S2'], member, deps(rows, own, canSee));
        expect(result.ok).to.equal(true);
        expect(canSee.calledOnce).to.equal(true);
        expect(canSee.firstCall.args[0].map((d: IDevice) => `${d.udid}@${d.host}`)).to.deep.equal([
          'android-1@http://127.0.0.1:4723',
          'ios-1@http://node:4723',
        ]);
      });

      it('is not asked when a session is already refused', async () => {
        const rows = [phone('android-1', { claimSessionId: 'S1' })];
        const canSee = sinon.stub().resolves(true);
        const result = await resolveObservedPhones(['S1', 'S9'], member, deps(rows, own, canSee));
        expect(result).to.deep.equal({ ok: false, status: 404 });
        expect(canSee.called).to.equal(false);
      });

      it('answers 404, not 409, for a cloud phone the caller cannot see', async () => {
        const rows = [
          phone('android-1', { claimSessionId: 'S1' }),
          phone('cloud-1', { claimSessionId: 'S2', cloud: true }),
        ];
        const result = await resolveObservedPhones(
          ['S1', 'S2'],
          member,
          deps(rows, own, async () => false),
        );
        expect(result).to.deep.equal({ ok: false, status: 404 });
      });

      it('answers 404, not 400, for two sessions on one phone the caller cannot see', async () => {
        const rows = [
          phone('android-1', { claimSessionId: 'S1' }),
          phone('android-1', { claimSessionId: 'S2' }),
        ];
        const result = await resolveObservedPhones(
          ['S1', 'S2'],
          member,
          deps(rows, own, async () => false),
        );
        expect(result).to.deep.equal({ ok: false, status: 404 });
      });

      it('lets a failed team lookup throw', async () => {
        const rows = [phone('android-1', { claimSessionId: 'S1' })];
        const failing = deps(rows, own, async () => {
          throw new Error('store is down');
        });
        let thrown: unknown;
        try {
          await resolveObservedPhones(['S1'], member, failing);
        } catch (e) {
          thrown = e;
        }
        expect((thrown as Error)?.message).to.equal('store is down');
      });
    });
  });

  describe('defaultObserverDeps', () => {
    afterEach(() => sinon.restore());

    it('finds rows by claimSessionId and by session_id, once per phone, where the claim holds', async () => {
      const claimed = phone('android-1', { claimSessionId: 'S1', session_id: 'S1' });
      const preClaim = phone('ios-1', { claimSessionId: null, session_id: 'S1' });
      const movedOn = phone('android-2', { claimSessionId: 'S2', session_id: 'S1' });
      const findDevices = sinon
        .stub()
        .callsFake(async (filter: Partial<IDevice>) =>
          filter.claimSessionId === 'S1'
            ? [claimed]
            : filter.session_id === 'S1'
              ? [claimed, preClaim, movedOn]
              : [],
        );
      sinon.stub(DeviceStoreFactory, 'getStore').returns({ findDevices } as any);

      const found = await defaultObserverDeps().findClaimedDevices('S1');
      expect(found.map((d) => d.udid)).to.deep.equal(['android-1', 'ios-1']);
      expect(findDevices.args.map(([filter]) => filter)).to.deep.equal([
        { claimSessionId: 'S1' },
        { session_id: 'S1' },
      ]);
    });

    it("asks SessionOwnerResolver for the session's owner", async () => {
      const ownerOf = sinon.stub(SessionOwnerResolver.prototype, 'ownerOf').resolves('u1');
      expect(await defaultObserverDeps().ownerOf('S1')).to.equal('u1');
      expect(ownerOf.calledOnceWithExactly('S1')).to.equal(true);
    });
  });

  describe('parseSessionIds', () => {
    it('takes a non-empty array of distinct non-empty strings', () => {
      expect(parseSessionIds(['S1', 'S2'])).to.deep.equal(['S1', 'S2']);
    });

    for (const [label, value] of [
      ['an empty array', []],
      ['a string', 'S1'],
      ['a number entry', [1]],
      ['an empty string entry', ['']],
      ['undefined', undefined],
      ['null', null],
      ['an object', { 0: 'S1' }],
    ] as Array<[string, unknown]>) {
      it(`refuses ${label}`, () => {
        expect(parseSessionIds(value)).to.have.property('error').that.is.a('string');
      });
    }

    it('refuses a duplicate id', () => {
      expect(parseSessionIds(['S1', 'S1']))
        .to.have.property('error')
        .that.is.a('string');
    });
  });
});
