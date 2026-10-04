import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import sinon from 'sinon';
import { Container } from 'typedi';
import nodeSchedule from 'node-schedule';
import request from '../helpers/loopbackRequest';
import dashboard from '../../src/app/routers/dashboard';
import { prisma } from '../../src/prisma';
import { CleanupService } from '../../src/services/CleanupService';
import { WebConfigService, IWebConfig } from '../../src/data-service/web-config-service';
import { PluginContext } from '../../src/PluginContext';
import { DefaultPluginArgs, IPluginArgs } from '../../src/interfaces/IPluginArgs';
import { setupCronCleanupBuilds, stopAllTimers } from '../../src/device-utils';

/**
 * The Maintenance page saves the cleanup values (POST /config -> WebConfig),
 * but the cleanup job read only the plugin options the server started with,
 * so a saved retention window, build cap, asset purge or schedule did
 * nothing until it matched what the server was started with, and never took
 * effect at all. These pin the rule that replaced it: a value saved in the
 * dashboard wins over the startup option, applies at the next run without a
 * restart, and a new schedule replaces the old timer at once.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function startupArgs(over: Partial<IPluginArgs> = {}): IPluginArgs {
  return {
    ...DefaultPluginArgs,
    buildCleanupDays: 30,
    buildCleanupMaxCount: 100,
    buildCleanupSchedule: '0 0 * * *',
    deleteBuildAssets: true,
    ...over,
  };
}

/** How many days back the first build query looks: the retention window the run used. */
function daysBack(findMany: sinon.SinonStub): number {
  const cutoff: Date = findMany.firstCall.args[0].where.createdAt.lt;
  return Math.round((Date.now() - cutoff.getTime()) / DAY_MS);
}

/** A WebConfig table in memory: what POST /config saves is what GET reads. */
function fakeWebConfig(initial: IWebConfig = {}) {
  const saved: IWebConfig = { ...initial };
  const svc = Container.get(WebConfigService);
  sinon.stub(svc, 'getConfig').callsFake(async () => ({ ...saved }));
  sinon.stub(svc, 'setConfig').callsFake(async (c: IWebConfig) => {
    for (const [k, v] of Object.entries(c)) if (v !== undefined) (saved as any)[k] = v;
  });
  return saved;
}

describe('cleanup settings saved in the dashboard', () => {
  let context: PluginContext;
  let savedArgs: IPluginArgs;

  beforeEach(() => {
    context = Container.get(PluginContext);
    savedArgs = context.pluginArgs;
  });

  afterEach(() => {
    stopAllTimers();
    context.pluginArgs = savedArgs;
    sinon.restore();
  });

  describe('the cleanup run', () => {
    function stubDatabase() {
      const findMany = sinon.stub(prisma.build, 'findMany').resolves([]);
      sinon.stub(prisma.build, 'count').resolves(0);
      const service = Container.get(CleanupService);
      const purgeBuild = sinon.stub(service, 'purgeBuild').resolves();
      sinon.stub(service as any, 'purgeOrphanSessions').resolves();
      sinon.stub(service as any, 'purgeRecordings').resolves();
      return { service, findMany, purgeBuild };
    }

    it('uses the retention window saved in the dashboard, not the startup option', async () => {
      fakeWebConfig({ buildCleanupDays: 7 });
      const { service, findMany } = stubDatabase();

      await service.runCleanup(startupArgs({ buildCleanupDays: 30 }));

      expect(daysBack(findMany)).to.equal(7);
    });

    it('uses the build cap and the asset purge saved in the dashboard', async () => {
      fakeWebConfig({ buildCleanupMaxCount: 2, deleteBuildAssets: false });
      const { service, findMany, purgeBuild } = stubDatabase();
      (prisma.build.count as sinon.SinonStub).resolves(3);
      findMany.callsFake((async (args: any) => {
        if (args?.take === 2) return [{ id: 'b3' }, { id: 'b2' }];
        if (args?.where?.createdAt) return [];
        return [{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }];
      }) as any);

      await service.runCleanup(startupArgs({ buildCleanupMaxCount: 100, deleteBuildAssets: true }));

      expect(purgeBuild.calledOnce).to.equal(true);
      expect(purgeBuild.firstCall.args).to.deep.equal(['b1', false]);
    });

    it('falls back to the startup options when nothing was saved', async () => {
      fakeWebConfig({});
      const { service, findMany } = stubDatabase();

      await service.runCleanup(startupArgs({ buildCleanupDays: 12 }));

      expect(daysBack(findMany)).to.equal(12);
    });

    it('still runs on the startup options when the saved settings cannot be read', async () => {
      sinon.stub(Container.get(WebConfigService), 'getConfig').rejects(new Error('db down'));
      const { service, findMany } = stubDatabase();

      await service.runCleanup(startupArgs({ buildCleanupDays: 12 }));

      expect(daysBack(findMany)).to.equal(12);
    });

    it('ignores a saved value that would purge everything', async () => {
      fakeWebConfig({ buildCleanupDays: 0, buildCleanupMaxCount: 0 });
      const { service, findMany } = stubDatabase();

      await service.runCleanup(startupArgs({ buildCleanupDays: 12 }));

      expect(daysBack(findMany)).to.equal(12);
    });
  });

  describe('the schedule', () => {
    it('starts on the schedule saved in the dashboard', async () => {
      fakeWebConfig({ buildCleanupSchedule: '0 3 * * *' });
      const scheduleJob = sinon.spy(nodeSchedule, 'scheduleJob');

      await setupCronCleanupBuilds(startupArgs({ buildCleanupSchedule: '0 0 * * *' }));

      expect(scheduleJob.firstCall.args[0]).to.equal('0 3 * * *');
    });

    it('starts on the startup schedule when none was saved', async () => {
      fakeWebConfig({});
      const scheduleJob = sinon.spy(nodeSchedule, 'scheduleJob');

      await setupCronCleanupBuilds(startupArgs({ buildCleanupSchedule: '30 1 * * *' }));

      expect(scheduleJob.firstCall.args[0]).to.equal('30 1 * * *');
    });
  });

  describe('POST /config', () => {
    function app() {
      const a = express();
      a.use(express.json());
      a.use((req, _res, next) => {
        (req as any).auth = {
          kind: 'user-session',
          userId: 'usr_x',
          role: 'SUPER_ADMIN',
          scopes: 'admin,devices,sessions,read',
          rateLimit: 1000,
        };
        next();
      });
      dashboard.register(a as any);
      return a;
    }

    it('replaces the running cleanup timer when the schedule changes', async () => {
      fakeWebConfig({});
      context.pluginArgs = startupArgs({ buildCleanupSchedule: '0 0 * * *' });
      const scheduleJob = sinon.spy(nodeSchedule, 'scheduleJob');
      await setupCronCleanupBuilds(context.pluginArgs);
      const running = scheduleJob.firstCall.returnValue;
      const cancelRunning = sinon.spy(running, 'cancel');

      const r = await request(app())
        .post('/config')
        .send({ buildCleanupSchedule: '0 4 * * *' })
        .timeout(5000);

      expect(r.status).to.equal(200);
      expect(cancelRunning.calledOnce, 'the old timer was cancelled').to.equal(true);
      expect(scheduleJob.lastCall.args[0]).to.equal('0 4 * * *');
      expect(scheduleJob.lastCall.returnValue).to.not.equal(running);
    });

    it('does not touch the timer when the schedule is not in the request', async () => {
      fakeWebConfig({});
      context.pluginArgs = startupArgs();
      const scheduleJob = sinon.spy(nodeSchedule, 'scheduleJob');

      const r = await request(app()).post('/config').send({ buildCleanupDays: 14 }).timeout(5000);

      expect(r.status).to.equal(200);
      expect(scheduleJob.called).to.equal(false);
    });

    for (const [label, body] of [
      ['a retention window of zero', { buildCleanupDays: 0 }],
      ['a negative retention window', { buildCleanupDays: -3 }],
      ['a fractional build cap', { buildCleanupMaxCount: 2.5 }],
      ['a build cap that is not a number', { buildCleanupMaxCount: null }],
      ['a schedule that is not a cron expression', { buildCleanupSchedule: 'every night' }],
      ['an asset purge that is not a boolean', { deleteBuildAssets: 'yes' }],
    ] as Array<[string, Record<string, unknown>]>) {
      it(`refuses ${label} and saves nothing`, async () => {
        const saved = fakeWebConfig({});
        context.pluginArgs = startupArgs();

        const r = await request(app()).post('/config').send(body).timeout(5000);

        expect(r.status).to.equal(400);
        expect(r.body.error).to.equal('invalid_setting');
        expect(r.body.message).to.be.a('string').and.not.equal('');
        expect(saved).to.deep.equal({});
      });
    }
  });

  describe('GET /config', () => {
    function app() {
      const a = express();
      a.use((req, _res, next) => {
        (req as any).auth = {
          kind: 'user-session',
          userId: 'usr_x',
          role: 'ADMIN',
          scopes: 'admin,read',
          rateLimit: 1000,
        };
        next();
      });
      dashboard.register(a as any);
      return a;
    }

    it('shows the value the server runs with when nothing was saved', async () => {
      fakeWebConfig({});
      context.pluginArgs = startupArgs({
        buildCleanupDays: 12,
        buildCleanupSchedule: '30 1 * * *',
      });

      const r = await request(app()).get('/config').timeout(5000);

      expect(r.status).to.equal(200);
      expect(r.body.buildCleanupDays).to.equal(12);
      expect(r.body.buildCleanupSchedule).to.equal('30 1 * * *');
    });

    it('shows the saved value over the startup one', async () => {
      fakeWebConfig({ buildCleanupDays: 7 });
      context.pluginArgs = startupArgs({ buildCleanupDays: 12 });

      const r = await request(app()).get('/config').timeout(5000);

      expect(r.body.buildCleanupDays).to.equal(7);
    });

    it("sends the server's own defaults, so no page needs a number of its own", async () => {
      fakeWebConfig({});
      context.pluginArgs = startupArgs();

      const r = await request(app()).get('/config').timeout(5000);

      expect(r.body.defaults).to.deep.equal({
        enableSelfHealing: true,
        healthCheckIntervalMs: 300000,
        buildCleanupDays: 30,
        buildCleanupMaxCount: 100,
        buildCleanupSchedule: '0 0 * * *',
        deleteBuildAssets: true,
      });
      expect(r.body.healthCheckIntervalMs).to.equal(300000);
    });
  });
});
