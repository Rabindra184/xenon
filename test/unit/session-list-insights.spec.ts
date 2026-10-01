import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import { Container } from 'typedi';
import request from '../helpers/loopbackRequest';
import { useScratchDatabase } from '../helpers/scratch-database';
import { PluginContext } from '../../src/PluginContext';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';
import DashboardRouter from '../../src/app/routers/dashboard';

/**
 * What the Sessions page reads besides the rows themselves: the period filter
 * on the list, who ran each session and where, the period summary, and the
 * per-build counts. Real queries against a scratch database, because each of
 * these is a Prisma filter a stub would only echo.
 */
describe('Sessions page data', () => {
  const scratch = useScratchDatabase();
  const HOUR = 60 * 60 * 1000;
  const MIN = 60 * 1000;
  let context: PluginContext;
  let saved: Partial<PluginContext>;
  let now: number;
  let caller: Record<string, unknown>;
  // An admin: teamIds undefined, so every session is visible.
  const ADMIN = { kind: 'user-session', userId: 'admin-1', role: 'SUPER_ADMIN', scopes: 'admin' };

  beforeEach(async () => {
    context = Container.get(PluginContext);
    saved = { ...context };
    context.setContext(
      { ...DefaultPluginArgs, bindHostOrIp: '127.0.0.1' } as any,
      4723,
      'hub-1',
      '',
    );
    now = Date.now();
    caller = ADMIN;
    for (const model of ['session', 'build', 'apiKey', 'user', 'device'] as const) {
      await (scratch.db as any)[model].deleteMany({});
    }
  });

  afterEach(() => {
    Object.assign(context, saved);
  });

  const app = () => {
    const a = express();
    a.use(express.json());
    a.use((req: any, _res, next) => {
      req.auth = caller;
      next();
    });
    DashboardRouter.register(a as any);
    return a;
  };

  let seq = 0;
  const session = (fields: Record<string, unknown>) => {
    seq += 1;
    return scratch.db.session.create({
      data: {
        id: `s-${seq}`,
        status: 'success',
        desired_capabilities: '{}',
        session_capabilities: '{}',
        node_id: 'hub-1',
        has_live_video: false,
        device_udid: 'phone-1',
        device_platform: 'android',
        device_version: '14',
        ...fields,
      } as any,
    });
  };
  const ago = (ms: number) => new Date(now - ms);
  const user = (id: string, name: string, email: string) =>
    scratch.db.user.create({
      data: { id, name, email, passwordHash: 'x', accessKey: `ak-${id}` },
    });

  describe('GET /session', () => {
    // Pages, newest first: limit, and a cursor at the last row of the page
    // before (before = its createdAt, beforeId = its id). The id breaks ties,
    // so rows created in the same millisecond are neither skipped nor repeated.
    describe('paging', () => {
      const t = (min: number) => new Date(now - min * MIN);
      const ids = (res: any) => res.body.map((r: any) => r.id);
      beforeEach(async () => {
        await session({ id: 'a', createdAt: t(1) });
        await session({ id: 'b', createdAt: t(2) });
        await session({ id: 'c', createdAt: t(2) });
        await session({ id: 'd', createdAt: t(3) });
      });

      it('keeps to the limit, newest first, the id breaking ties', async () => {
        expect(ids(await request(app()).get('/session?limit=2'))).to.deep.equal(['a', 'c']);
      });

      it('continues after the cursor, neither skipping nor repeating a row', async () => {
        const res = await request(app()).get(
          `/session?limit=2&before=${t(2).toISOString()}&beforeId=c`,
        );
        expect(ids(res)).to.deep.equal(['b', 'd']);
      });

      it('takes a cursor with no id as everything older than its time', async () => {
        const res = await request(app()).get(`/session?before=${t(2).toISOString()}`);
        expect(ids(res)).to.deep.equal(['d']);
      });

      it('refuses a limit or a cursor it cannot read', async () => {
        for (const q of ['limit=abc', 'limit=0', 'limit=-5', 'limit=2.5']) {
          const res = await request(app()).get(`/session?${q}`);
          expect(res.status, q).to.equal(400);
          expect(res.body.error, q).to.equal('invalid_limit');
        }
        const res = await request(app()).get('/session?before=soon');
        expect(res.status).to.equal(400);
        expect(res.body.error).to.equal('invalid_before');
      });

      it('answers a limit over the most with the most, not an error', async () => {
        const res = await request(app()).get('/session?limit=999999');
        expect(res.status).to.equal(200);
        expect(ids(res)).to.deep.equal(['a', 'c', 'b', 'd']);
      });
    });

    it('keeps the sessions created since the given time, newest first', async () => {
      await session({ id: 'old', createdAt: ago(3 * HOUR) });
      await session({ id: 'recent', createdAt: ago(30 * MIN) });
      await session({ id: 'newest', createdAt: ago(5 * MIN) });

      const res = await request(app()).get(`/session?since=${ago(HOUR).toISOString()}`);

      expect(res.status).to.equal(200);
      expect(res.body.map((s: any) => s.id)).to.deep.equal(['newest', 'recent']);
      const all = await request(app()).get('/session');
      expect(all.body.map((s: any) => s.id)).to.deep.equal(['newest', 'recent', 'old']);
    });

    it('refuses a since that is not a date', async () => {
      const res = await request(app()).get('/session?since=yesterday-ish');
      expect(res.status).to.equal(400);
      expect(res.body.error).to.equal('invalid_since');
    });

    it('names who ran each session: its user, or an older row’s key owner', async () => {
      await user('u-priya', 'Priya Shah', 'priya@example.com');
      await user('u-alex', '', 'alex@example.com');
      await scratch.db.apiKey.create({
        data: { id: 'key-1', name: 'ci', keyHash: 'h1', scopes: 'sessions', userId: 'u-alex' },
      });
      await session({ id: 'by-user', user_id: 'u-priya', createdAt: ago(4 * MIN) });
      await session({ id: 'by-key', api_key_id: 'key-1', createdAt: ago(3 * MIN) });
      await session({ id: 'gone-user', user_id: 'u-deleted', createdAt: ago(2 * MIN) });
      await session({ id: 'nobody', createdAt: ago(1 * MIN) });

      const res = await request(app()).get('/session');

      const owner = Object.fromEntries(res.body.map((s: any) => [s.id, s.owner]));
      expect(owner['by-user']).to.deep.equal({ name: 'Priya Shah', email: 'priya@example.com' });
      // No name on record: the email stands in for it.
      expect(owner['by-key']).to.deep.equal({
        name: 'alex@example.com',
        email: 'alex@example.com',
      });
      expect(owner['gone-user']).to.equal(null);
      expect(owner['nobody']).to.equal(null);
    });

    it('says where each session ran: here, a node by its host, or not known', async () => {
      await scratch.db.device.create({
        data: {
          udid: 'own-phone',
          host: 'http://127.0.0.1:4723',
          nodeId: 'hub-1',
          platform: 'android',
        } as any,
      });
      await scratch.db.device.create({
        data: {
          udid: 'node-phone',
          host: 'http://10.0.0.9:4725',
          nodeId: 'node-2',
          platform: 'ios',
        } as any,
      });
      await session({
        id: 'this-boot',
        node_id: 'hub-1',
        device_udid: 'own-phone',
        createdAt: ago(5 * MIN),
      });
      // Node ids are new on every boot, so an older session of this server's
      // own phone carries an id nothing matches any more; its phone's row says.
      await session({
        id: 'last-boot',
        node_id: 'old-boot',
        device_udid: 'own-phone',
        createdAt: ago(4 * MIN),
      });
      await session({
        id: 'on-node',
        node_id: 'node-2',
        device_udid: 'node-phone',
        createdAt: ago(3 * MIN),
      });
      await session({
        id: 'node-restarted',
        node_id: 'node-2-old',
        device_udid: 'node-phone',
        createdAt: ago(2 * MIN),
      });
      await session({
        id: 'phone-gone',
        node_id: 'node-9',
        device_udid: 'unplugged',
        createdAt: ago(1 * MIN),
      });

      const res = await request(app()).get('/session');

      const ranOn = Object.fromEntries(res.body.map((s: any) => [s.id, s.ranOn]));
      expect(ranOn).to.deep.equal({
        'this-boot': 'here',
        'last-boot': 'here',
        'on-node': '10.0.0.9:4725',
        'node-restarted': '10.0.0.9:4725',
        'phone-gone': null,
      });
    });

    it('does not guess when the same udid is on more than one server', async () => {
      await scratch.db.device.create({
        data: {
          udid: 'emulator-5554',
          host: 'http://127.0.0.1:4723',
          nodeId: 'hub-1',
          platform: 'android',
        } as any,
      });
      await scratch.db.device.create({
        data: {
          udid: 'emulator-5554',
          host: 'http://10.0.0.9:4725',
          nodeId: 'node-2',
          platform: 'android',
        } as any,
      });
      await session({ id: 'which', node_id: 'old-boot', device_udid: 'emulator-5554' });

      const res = await request(app()).get('/session');

      expect(res.body[0].ranOn).to.equal(null);
    });
  });

  describe('GET /session/:id', () => {
    // The detail page's header names who ran the session and where, as its row does.
    it('says who ran the session and where, as the list does', async () => {
      await user('u-priya', 'Priya Shah', 'priya@example.com');
      await scratch.db.device.create({
        data: {
          udid: 'node-phone',
          host: 'http://10.0.0.9:4725',
          nodeId: 'node-2',
          platform: 'ios',
        } as any,
      });
      await session({
        id: 'one',
        user_id: 'u-priya',
        node_id: 'node-2',
        device_udid: 'node-phone',
      });

      const res = await request(app()).get('/session/one');

      expect(res.status).to.equal(200);
      expect(res.body.id).to.equal('one');
      expect(res.body.owner).to.deep.equal({ name: 'Priya Shah', email: 'priya@example.com' });
      expect(res.body.ranOn).to.equal('10.0.0.9:4725');
    });
  });

  describe('GET /session-summary', () => {
    it('summarizes the period and the one before it, of the same length', async () => {
      const build = await scratch.db.build.create({ data: { name: 'nightly' } });
      const inPeriod = (status: string, minutesAgo: number, durationS?: number, udid = 'phone-1') =>
        session({
          status,
          build_id: build.id,
          device_udid: udid,
          createdAt: ago(minutesAgo * MIN),
          startTime: ago(minutesAgo * MIN),
          endTime:
            durationS === undefined ? null : new Date(now - minutesAgo * MIN + durationS * 1000),
        });
      // The period: the last hour.
      await inPeriod('success', 50, 10);
      await inPeriod('passed', 45, 20);
      await inPeriod('ended', 40, 30);
      await inPeriod('failed', 35, 40);
      await inPeriod('error', 30, 50);
      await inPeriod('timeout', 25, 600);
      await inPeriod('unmarked', 20, 5);
      await inPeriod('running', 10, undefined, 'phone-1');
      await inPeriod('running', 5, undefined, 'phone-2');
      // The hour before it.
      await inPeriod('success', 90, 10);
      await inPeriod('failed', 80, 10);
      // Older than both, still running: running now, but in neither period.
      await inPeriod('running', 300, undefined, 'phone-1');

      const res = await request(app()).get(`/session-summary?since=${ago(HOUR).toISOString()}`);

      expect(res.status).to.equal(200);
      expect(res.body.since).to.equal(ago(HOUR).toISOString());
      expect(res.body.current).to.deep.equal({
        total: 9,
        passed: 3,
        failed: 3,
        running: 2,
        // Of every session in it that has ended, verdict or not: 5, 10, 20,
        // 30, 40, 50 and 600 s. Nearest rank: the 4th and the 7th of 7.
        medianMs: 30_000,
        p90Ms: 600_000,
      });
      expect(res.body.previous).to.deep.equal({ total: 2, passed: 1, failed: 1, running: 0 });
      expect(res.body.runningNow).to.deep.equal({ sessions: 3, devices: 2 });
    });

    it('covers one build, with no period before it, when asked for a build', async () => {
      const mine = await scratch.db.build.create({ data: { name: 'mine' } });
      const other = await scratch.db.build.create({ data: { name: 'other' } });
      await session({
        build_id: mine.id,
        status: 'success',
        startTime: ago(2 * MIN),
        endTime: ago(MIN),
      });
      await session({ build_id: mine.id, status: 'running' });
      await session({ build_id: other.id, status: 'failed' });
      await session({ build_id: other.id, status: 'running', device_udid: 'phone-9' });

      const res = await request(app()).get(`/session-summary?buildId=${mine.id}`);

      expect(res.body.since).to.equal(null);
      expect(res.body.current).to.deep.equal({
        total: 2,
        passed: 1,
        failed: 0,
        running: 1,
        medianMs: 60_000,
        p90Ms: 60_000,
      });
      expect(res.body.previous).to.equal(null);
      expect(res.body.runningNow).to.deep.equal({ sessions: 1, devices: 1 });
    });

    it('has no durations to report when nothing has finished', async () => {
      await session({ status: 'running' });
      const res = await request(app()).get('/session-summary');
      expect(res.body.current.medianMs).to.equal(null);
      expect(res.body.current.p90Ms).to.equal(null);
    });

    it('counts only the sessions the caller may see', async () => {
      const team = await scratch.db.team.create({ data: { name: 'b-team' } });
      await scratch.db.device.create({
        data: {
          udid: 'shared',
          host: 'http://127.0.0.1:4723',
          nodeId: 'hub-1',
          platform: 'android',
        } as any,
      });
      await scratch.db.device.create({
        data: {
          udid: 'team-b',
          host: 'http://127.0.0.1:4723',
          nodeId: 'hub-1',
          platform: 'android',
          teamId: team.id,
        } as any,
      });
      await session({ device_udid: 'shared', status: 'success' });
      await session({ device_udid: 'team-b', status: 'failed' });
      await session({ device_udid: 'team-b', status: 'running' });
      caller = {
        kind: 'user-session',
        userId: 'member-1',
        role: 'MEMBER',
        scopes: 'sessions',
        teamIds: [],
      };

      const res = await request(app()).get('/session-summary');

      expect(res.body.current).to.include({ total: 1, passed: 1, failed: 0, running: 0 });
      expect(res.body.runningNow).to.deep.equal({ sessions: 0, devices: 0 });
    });

    it('refuses a since that is not a date', async () => {
      const res = await request(app()).get('/session-summary?since=soon');
      expect(res.status).to.equal(400);
      expect(res.body.error).to.equal('invalid_since');
    });
  });

  describe('GET /build', () => {
    // The page's pass/fail bar and the session rows must agree on a verdict.
    it('counts every failing status as failed and every passing one as passed', async () => {
      const build = await scratch.db.build.create({ data: { name: 'nightly' } });
      for (const status of [
        'success',
        'passed',
        'ended',
        'failed',
        'error',
        'timeout',
        'running',
        'unmarked',
      ]) {
        await session({ build_id: build.id, status });
      }

      const res = await request(app()).get('/build');

      expect(res.body[0]).to.include({
        sessionCount: 8,
        passedCount: 3,
        failedCount: 3,
        runningCount: 1,
      });
    });
  });
});
