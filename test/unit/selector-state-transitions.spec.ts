import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { useScratchDatabase } from '../helpers/scratch-database';
import { SelectorVerificationJob } from '../../src/services/SelectorVerificationJob';
import {
  SelectorStateConflictError,
  SelectorStateService,
} from '../../src/services/SelectorStateService';
import { stateView } from '../../src/services/selector-health/stateView';

const HOUR = 60 * 60 * 1000;
const STRATEGY = 'xpath';

/**
 * A selector's status changes from several places at once: the verification
 * job, the heal write path, and people on the dashboard. Through 2.36 the job
 * wrote what it decided from the rows it read at the start of its run, and the
 * heal hook from a read made outside its transaction, so a change made in
 * between was overwritten: a muted selector came back verified (still muted
 * since), a selector marked fixed again was verified on the builds of its
 * previous fix, and two heals of one selector at once counted two regressions.
 *
 * Each race here is played out in order: the competing change runs between the
 * writer's read and its write, on a scratch database.
 */
describe('SelectorState transitions hold against a change made meanwhile', function () {
  this.timeout(90_000);
  const scratch = useScratchDatabase();
  let socket: { emitToDashboardForSelector: sinon.SinonStub };

  const now = Date.now();
  const fixedAt = new Date(now - 48 * HOUR);
  const builds = ['st-b1', 'st-b2', 'st-b3'];

  before(async () => {
    for (const b of builds) {
      await scratch.db.build.create({ data: { id: b, name: b } });
      await scratch.db.session.create({
        data: {
          id: `st-s-${b}`,
          build_id: b,
          device_udid: 'st-phone',
          device_platform: 'android',
          device_version: '14',
          desired_capabilities: '{}',
          session_capabilities: '{}',
          node_id: 'localhost',
          has_live_video: false,
        },
      });
    }
  });

  beforeEach(async () => {
    await scratch.db.selectorEvent.deleteMany();
    await scratch.db.selectorState.deleteMany();
    await scratch.db.sessionLog.deleteMany();
    socket = { emitToDashboardForSelector: sinon.stub().resolves() };
  });

  const ctx = (selector: string) => ({ strategy: STRATEGY, selector, apiKeyId: '' });
  const service = () => new SelectorStateService(scratch.db as never, socket);

  const cleanFind = (build: string, selector: string) =>
    scratch.db.sessionLog.create({
      data: {
        session_id: `st-s-${build}`,
        command_name: 'findElement',
        url: '/element',
        method: 'POST',
        title: 'Find element',
        response: '{"value":{"ELEMENT":"e"}}',
        is_healed: false,
        original_strategy: STRATEGY,
        original_selector: selector,
        createdAt: new Date(now - HOUR),
      },
    });

  const pending = (selector: string, extra: Record<string, unknown> = {}) =>
    scratch.db.selectorState.create({
      data: {
        original_strategy: STRATEGY,
        original_selector: selector,
        status: 'pending',
        fixed_at: fixedAt,
        clean_builds_count: 0,
        ...extra,
      },
    });

  const rowOf = (selector: string) =>
    scratch.db.selectorState.findUnique({
      where: {
        original_strategy_original_selector: {
          original_strategy: STRATEGY,
          original_selector: selector,
        },
      },
    });

  const actionsOf = async (selector: string) =>
    (
      await scratch.db.selectorEvent.findMany({
        where: { original_selector: selector },
        orderBy: { createdAt: 'asc' },
      })
    ).map((e) => e.action);

  const emitted = () => socket.emitToDashboardForSelector.getCalls().map((c) => c.args[0]);

  /** The scratch client, with `$queryRaw` running `meanwhile` once it has answered. */
  function dbWithQueryThen(meanwhile: () => Promise<unknown>) {
    const db = scratch.db as any;
    return new Proxy(db, {
      get(target, prop) {
        if (prop === '$queryRaw') {
          return async (...args: unknown[]) => {
            const result = await target.$queryRaw(...args);
            await meanwhile();
            return result;
          };
        }
        const value = Reflect.get(target, prop);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }

  /** The scratch client, with each `$transaction` waiting for `before()` first. */
  function dbWithBeforeTransaction(before: () => Promise<unknown>) {
    const db = scratch.db as any;
    return new Proxy(db, {
      get(target, prop) {
        if (prop === '$transaction') {
          return async (fn: unknown) => {
            await before();
            return target.$transaction(fn);
          };
        }
        const value = Reflect.get(target, prop);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }

  const runJobWith = (db: unknown) => new SelectorVerificationJob(db as never, socket).run();

  describe('the verification job', () => {
    it('leaves a selector muted during its run muted, not verified', async () => {
      const sel = '//job/muted';
      await pending(sel);
      for (const b of builds) await cleanFind(b, sel);

      await runJobWith(dbWithQueryThen(() => service().mute(ctx(sel))));

      const row = await rowOf(sel);
      expect(row!.status).to.equal('muted');
      expect(row!.resolved_at).to.equal(null);
      expect(await actionsOf(sel)).to.deep.equal(['muted']);
      expect(emitted()).to.not.include('selector_resolved');
    });

    it('leaves a verification cancelled during its run cancelled', async () => {
      const sel = '//job/cancelled';
      await pending(sel, { regression_count: 1 });
      for (const b of builds) await cleanFind(b, sel);

      await runJobWith(dbWithQueryThen(() => service().cancelVerification(ctx(sel))));

      const row = await rowOf(sel);
      expect(row!.status).to.equal('active');
      expect(row!.fixed_at).to.equal(null);
      expect(row!.resolved_at).to.equal(null);
      expect(await actionsOf(sel)).to.deep.equal(['verification_cancelled']);
      expect(emitted()).to.not.include('selector_resolved');
    });

    it('does not verify a selector marked fixed again during its run on the old builds', async () => {
      const sel = '//job/remarked';
      await pending(sel);
      for (const b of builds) await cleanFind(b, sel);

      await runJobWith(dbWithQueryThen(() => service().markFixed(ctx(sel))));

      const row = await rowOf(sel);
      expect(row!.status).to.equal('pending');
      expect(row!.fixed_at!.getTime()).to.be.greaterThan(fixedAt.getTime());
      expect(row!.clean_builds_count).to.equal(0);
      expect(await actionsOf(sel)).to.deep.equal(['marked_fixed']);
      expect(emitted()).to.not.include('selector_resolved');
    });

    it('does not verify a selector that broke again during its run', async () => {
      const sel = '//job/regressed';
      await pending(sel);
      for (const b of builds) await cleanFind(b, sel);

      await runJobWith(
        dbWithQueryThen(() =>
          service().onHealRecorded({ strategy: STRATEGY, selector: sel, sessionId: 'st-s-st-b1' }),
        ),
      );

      const row = await rowOf(sel);
      expect(row!.status).to.equal('active');
      expect(row!.fixed_at).to.equal(null);
      expect(row!.resolved_at).to.equal(null);
      expect(row!.regression_count).to.equal(1);
      expect(await actionsOf(sel)).to.deep.equal(['broke_again']);
      expect(emitted()).to.not.include('selector_resolved');
    });

    it("does not write the previous fix's progress over a new fix", async () => {
      const sel = '//job/progress';
      await pending(sel);
      await cleanFind(builds[0], sel);

      await runJobWith(dbWithQueryThen(() => service().markFixed(ctx(sel))));

      const row = await rowOf(sel);
      expect(row!.status).to.equal('pending');
      expect(row!.clean_builds_count).to.equal(0);
      expect(emitted()).to.not.include('selector_progress');
    });

    it('still verifies and counts when nothing changed meanwhile', async () => {
      const verified = '//job/plain-verified';
      const counting = '//job/plain-counting';
      await pending(verified);
      await pending(counting);
      for (const b of builds) await cleanFind(b, verified);
      await cleanFind(builds[0], counting);

      await runJobWith(scratch.db);

      expect((await rowOf(verified))!.status).to.equal('resolved');
      expect(await actionsOf(verified)).to.deep.equal(['verified']);
      expect((await rowOf(counting))!.clean_builds_count).to.equal(1);
      expect(emitted()).to.include.members(['selector_resolved', 'selector_progress']);
    });
  });

  describe('a heal of a selector being verified', () => {
    it('counts one regression when two heals of it land at once', async () => {
      const sel = '//heal/twice';
      await pending(sel);
      // Both heals read the row before either writes.
      let arrived = 0;
      let release!: () => void;
      const bothRead = new Promise<void>((resolve) => (release = resolve));
      const db = dbWithBeforeTransaction(async () => {
        arrived += 1;
        if (arrived === 2) release();
        await bothRead;
      });
      const svc = new SelectorStateService(db as never, socket);
      const heal = () => svc.onHealRecorded({ strategy: STRATEGY, selector: sel, sessionId: 's' });

      await Promise.all([heal(), heal()]);

      const row = await rowOf(sel);
      expect(row!.status).to.equal('active');
      expect(row!.regression_count).to.equal(1);
      expect(await actionsOf(sel)).to.deep.equal(['broke_again']);
      expect(emitted().filter((e) => e === 'selector_regressed')).to.have.length(1);
    });

    it('leaves a selector muted between its read and its write muted', async () => {
      const sel = '//heal/muted';
      await pending(sel);
      let muted = false;
      const db = dbWithBeforeTransaction(async () => {
        if (muted) return;
        muted = true;
        await service().mute(ctx(sel));
      });

      await new SelectorStateService(db as never, socket).onHealRecorded({
        strategy: STRATEGY,
        selector: sel,
        sessionId: 's',
      });

      const row = await rowOf(sel);
      expect(row!.status).to.equal('muted');
      expect(row!.muted_at).to.be.instanceOf(Date);
      expect(row!.regression_count).to.equal(0);
      expect(await actionsOf(sel)).to.deep.equal(['muted']);
      expect(emitted()).to.not.include('selector_regressed');
    });
  });

  /**
   * The scratch client, with `meanwhile` run once, right after the first
   * SelectorState read, whether that read is made outside a transaction or
   * inside one. Inside one the change goes through the transaction's own
   * client (SQLite has one writer, so another connection would wait for it):
   * it stands for a change another server committed between the read and the
   * write.
   */
  function dbWithChangeAfterFirstRead(meanwhile: (db: any) => Promise<unknown>) {
    let done = false;
    const once = async (db: any) => {
      if (done) return;
      done = true;
      await meanwhile(db);
    };
    const withReadHook = (client: any) =>
      new Proxy(client.selectorState, {
        get(target, prop) {
          if (prop === 'findUnique') {
            return async (args: unknown) => {
              const result = await target.findUnique(args);
              await once(client);
              return result;
            };
          }
          const value = Reflect.get(target, prop);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    const wrapClient = (client: any): any =>
      new Proxy(client, {
        get(target, prop) {
          if (prop === 'selectorState') return withReadHook(target);
          if (prop === '$transaction') {
            return (fn: (tx: unknown) => Promise<unknown>) =>
              target.$transaction((tx: unknown) => fn(wrapClient(tx)));
          }
          const value = Reflect.get(target, prop);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    return wrapClient(scratch.db);
  }

  const keyOf = (selector: string) => ({
    original_strategy_original_selector: {
      original_strategy: STRATEGY,
      original_selector: selector,
    },
  });

  /** What a mute committed elsewhere leaves on the row. */
  const mutedElsewhere = (selector: string) => (db: any) =>
    db.selectorState.update({
      where: keyOf(selector),
      data: {
        status: 'muted',
        muted_at: new Date(),
        fixed_at: null,
        resolved_at: null,
        clean_builds_count: 0,
      },
    });

  /** What a heal committed elsewhere leaves on a row being verified. */
  const healedElsewhere = (selector: string) => (db: any) =>
    db.selectorState.update({
      where: keyOf(selector),
      data: {
        status: 'active',
        fixed_at: null,
        resolved_at: null,
        clean_builds_count: 0,
        regression_count: { increment: 1 },
      },
    });

  const conflictOf = async (change: Promise<unknown>) => {
    try {
      await change;
    } catch (err) {
      return err;
    }
    return null;
  };

  describe('a change people make', () => {
    it('does not mark fixed a selector muted between its read and its write', async () => {
      const sel = '//people/fix-after-mute';
      await scratch.db.selectorState.create({
        data: {
          original_strategy: STRATEGY,
          original_selector: sel,
          status: 'active',
          regression_count: 1,
        },
      });
      const svc = new SelectorStateService(dbWithChangeAfterFirstRead(mutedElsewhere(sel)), socket);

      const err = await conflictOf(svc.markFixed(ctx(sel)));

      expect(err).to.be.instanceOf(SelectorStateConflictError);
      expect((err as SelectorStateConflictError).currentStatus).to.equal('muted');
      const row = await rowOf(sel);
      expect(row!.status).to.equal('muted');
      expect(row!.fixed_at).to.equal(null);
      expect(await actionsOf(sel)).to.deep.equal([]);
      expect(emitted()).to.deep.equal([]);
    });

    it('does not mark fixed a selector first muted after it read no row', async () => {
      const sel = '//people/fix-after-new-mute';
      const svc = new SelectorStateService(
        dbWithChangeAfterFirstRead((db) =>
          db.selectorState.create({
            data: {
              original_strategy: STRATEGY,
              original_selector: sel,
              status: 'muted',
              muted_at: new Date(),
            },
          }),
        ),
        socket,
      );

      const err = await conflictOf(svc.markFixed(ctx(sel)));

      expect(err).to.be.instanceOf(SelectorStateConflictError);
      expect((await rowOf(sel))!.status).to.equal('muted');
      expect(await actionsOf(sel)).to.deep.equal([]);
    });

    it('marks fixed a selector whose row was written after it read none', async () => {
      const sel = '//people/fix-after-new-row';
      const svc = new SelectorStateService(
        dbWithChangeAfterFirstRead((db) =>
          db.selectorState.create({
            data: {
              original_strategy: STRATEGY,
              original_selector: sel,
              status: 'active',
              regression_count: 2,
            },
          }),
        ),
        socket,
      );

      const row = await svc.markFixed(ctx(sel));

      expect(row.status).to.equal('pending');
      expect(row.fixed_at).to.be.instanceOf(Date);
      expect(row.regression_count).to.equal(2);
      expect(await actionsOf(sel)).to.deep.equal(['marked_fixed']);
    });

    it('does not cancel, or delete, a verification a heal ended meanwhile', async () => {
      const sel = '//people/cancel-after-heal';
      await pending(sel);
      const svc = new SelectorStateService(
        dbWithChangeAfterFirstRead(healedElsewhere(sel)),
        socket,
      );

      const err = await conflictOf(svc.cancelVerification(ctx(sel)));

      expect(err).to.be.instanceOf(SelectorStateConflictError);
      expect((err as SelectorStateConflictError).currentStatus).to.equal('active');
      const row = await rowOf(sel);
      expect(row!.status).to.equal('active');
      expect(row!.regression_count).to.equal(1);
      expect(await actionsOf(sel)).to.deep.equal([]);
      expect(emitted()).to.deep.equal([]);
    });

    it('answers an unmute another unmute beat with the row as it is, recording nothing', async () => {
      const sel = '//people/unmute-twice';
      await scratch.db.selectorState.create({
        data: {
          original_strategy: STRATEGY,
          original_selector: sel,
          status: 'muted',
          muted_at: new Date(),
          regression_count: 1,
        },
      });
      const svc = new SelectorStateService(
        dbWithChangeAfterFirstRead((db) =>
          db.selectorState.update({
            where: keyOf(sel),
            data: { status: 'active', muted_at: null },
          }),
        ),
        socket,
      );

      const row = await svc.unmute(ctx(sel));

      expect(row!.status).to.equal('active');
      expect(await actionsOf(sel)).to.deep.equal([]);
      expect(emitted()).to.deep.equal([]);
    });

    it('answers an unmute of a row deleted meanwhile with nothing, recording nothing', async () => {
      const sel = '//people/unmute-deleted';
      await scratch.db.selectorState.create({
        data: {
          original_strategy: STRATEGY,
          original_selector: sel,
          status: 'muted',
          muted_at: new Date(),
        },
      });
      const svc = new SelectorStateService(
        dbWithChangeAfterFirstRead((db) => db.selectorState.delete({ where: keyOf(sel) })),
        socket,
      );

      expect(await svc.unmute(ctx(sel))).to.equal(null);
      expect(await actionsOf(sel)).to.deep.equal([]);
      expect(emitted()).to.deep.equal([]);
    });
  });

  describe('a selector back to fix carries no fix', () => {
    it('drops the fix when muted, and the row when unmuted with nothing else to show', async () => {
      const sel = '//history/pending-unmuted';
      await pending(sel);

      const muted = await service().mute(ctx(sel));
      expect(muted.fixed_at).to.equal(null);
      expect(muted.resolved_at).to.equal(null);
      expect(muted.clean_builds_count).to.equal(0);

      expect(await service().unmute(ctx(sel))).to.equal(null);
      expect(await rowOf(sel)).to.equal(null);
    });

    it('unmutes a verified selector to fix, not to "fixed by" someone', async () => {
      const sel = '//history/resolved-unmuted';
      await pending(sel, {
        status: 'resolved',
        resolved_at: new Date(now - HOUR),
        clean_builds_count: 3,
      });

      await service().mute(ctx(sel));
      expect(await service().unmute(ctx(sel))).to.equal(null);
    });

    it('keeps the row of a selector that broke again, with no fix on it', async () => {
      const sel = '//history/regressed-unmuted';
      await pending(sel, { regression_count: 2 });

      await service().mute(ctx(sel));
      const row = await service().unmute(ctx(sel));

      expect(row!.status).to.equal('active');
      expect(row!.regression_count).to.equal(2);
      expect(row!.fixed_at).to.equal(null);
      expect(row!.fixed_by_api_key).to.equal(null);
      expect(row!.resolved_at).to.equal(null);
      expect(row!.muted_at).to.equal(null);
    });

    it('applies the same rule when a verification is cancelled', async () => {
      const kept = '//history/cancel-kept';
      const gone = '//history/cancel-gone';
      await pending(kept, { regression_count: 1 });
      // Written through 2.36: a pending row that kept an old resolved_at.
      await pending(gone, { resolved_at: new Date(now - 72 * HOUR) });

      const row = await service().cancelVerification(ctx(kept));
      expect(row!.status).to.equal('active');
      expect(row!.fixed_at).to.equal(null);
      expect(row!.resolved_at).to.equal(null);

      expect(await service().cancelVerification(ctx(gone))).to.equal(null);
      expect(await rowOf(gone)).to.equal(null);
    });

    it('shows no fix on an active or muted row written through 2.36 with one', async () => {
      const sel = '//history/legacy';
      await pending(sel, { status: 'active', regression_count: 1, clean_builds_count: 2 });
      const people = new Map([['u1', { id: 'u1', name: 'Asha' }]]);

      const view = stateView((await rowOf(sel))!, { fixed: { user_id: 'u1' } }, people);

      expect(view).to.include({
        status: 'active',
        fixedAt: null,
        resolvedAt: null,
        cleanBuilds: 0,
      });
      expect(view!.fixedBy).to.equal(null);
      expect(view!.brokeAgain).to.equal(1);
    });
  });
});
