import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Container } from 'typedi';
import request from '../helpers/loopbackRequest';
import dashboard from '../../src/app/routers/dashboard';
import { CleanupService } from '../../src/services/CleanupService';
import { PluginContext } from '../../src/PluginContext';
import { config } from '../../src/config';
import { DefaultPluginArgs, IPluginArgs } from '../../src/interfaces/IPluginArgs';
import { stopAllTimers } from '../../src/device-utils';
import { useScratchDatabase } from '../helpers/scratch-database';

/**
 * The Maintenance page's path from end to end, against a real (scratch)
 * database: what POST /config saves is what the next cleanup run acts on,
 * whatever the server was started with. (Saving more than one setting used to
 * fail outright, see web-config-service.spec.ts.)
 */
describe('a retention window saved on the Maintenance page', () => {
  const scratch = useScratchDatabase();
  const DAY_MS = 24 * 60 * 60 * 1000;
  let context: PluginContext;
  let savedArgs: IPluginArgs;
  let savedRecordings: string;
  let tmp: string;

  beforeEach(async () => {
    context = Container.get(PluginContext);
    savedArgs = context.pluginArgs;
    context.pluginArgs = {
      ...DefaultPluginArgs,
      buildCleanupDays: 30,
      buildCleanupMaxCount: 100,
    };
    savedRecordings = config.recordingsAssetsPath;
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-cleanup-db-'));
    config.recordingsAssetsPath = path.join(tmp, 'recordings');
    await scratch.db.webConfig.deleteMany({});
    await scratch.db.build.deleteMany({});
    const ago = (days: number) => new Date(Date.now() - days * DAY_MS);
    await scratch.db.build.create({ data: { id: 'b-10-days', createdAt: ago(10) } });
    await scratch.db.build.create({ data: { id: 'b-1-day', createdAt: ago(1) } });
  });

  afterEach(() => {
    stopAllTimers();
    context.pluginArgs = savedArgs;
    config.recordingsAssetsPath = savedRecordings;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

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

  const buildIds = async () =>
    (await scratch.db.build.findMany({ select: { id: true } })).map((b) => b.id).sort();

  it('is what the next cleanup run purges by, over the 30 days the server started with', async () => {
    const saved = await request(app())
      .post('/config')
      .send({ buildCleanupDays: 5, buildCleanupMaxCount: 50, deleteBuildAssets: false })
      .timeout(5000);
    expect(saved.status).to.equal(200);

    const shown = await request(app()).get('/config').timeout(5000);
    expect(shown.body).to.include({
      buildCleanupDays: 5,
      buildCleanupMaxCount: 50,
      deleteBuildAssets: false,
    });

    await Container.get(CleanupService).runCleanup(context.pluginArgs);

    expect(await buildIds()).to.deep.equal(['b-1-day']);
  });

  it('leaves both builds when nothing was saved and the server started with 30 days', async () => {
    await Container.get(CleanupService).runCleanup(context.pluginArgs);

    expect(await buildIds()).to.deep.equal(['b-1-day', 'b-10-days']);
  });

  it('purges by a cap saved over the 100 the server started with', async () => {
    await request(app()).post('/config').send({ buildCleanupMaxCount: 1 }).timeout(5000);

    await Container.get(CleanupService).runCleanup(context.pluginArgs);

    expect(await buildIds()).to.deep.equal(['b-1-day']);
  });
});
