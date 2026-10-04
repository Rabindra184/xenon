import 'reflect-metadata';
import { expect } from 'chai';
import { Container } from 'typedi';
import { WebConfigService } from '../../src/data-service/web-config-service';
import { useScratchDatabase } from '../helpers/scratch-database';

/**
 * WebConfig holds the dashboard's saved settings, one row each. Its `id`
 * column is the table's primary key and defaulted to 'global', and every
 * setting was written with that id, so the table could hold one setting:
 * saving a second failed with "Unique constraint failed on the fields (`id`)".
 * These run the service against a real (scratch) database.
 */
describe('WebConfigService', () => {
  const scratch = useScratchDatabase();
  const service = () => Container.get(WebConfigService);

  beforeEach(async () => {
    await scratch.db.webConfig.deleteMany({});
  });

  it('saves every setting of one update', async () => {
    await service().setConfig({
      buildCleanupDays: 7,
      buildCleanupMaxCount: 5,
      buildCleanupSchedule: '0 3 * * *',
      deleteBuildAssets: false,
    });
    expect(await service().getConfig()).to.deep.equal({
      buildCleanupDays: 7,
      buildCleanupMaxCount: 5,
      buildCleanupSchedule: '0 3 * * *',
      deleteBuildAssets: false,
    });
  });

  it('saves settings from separate updates, as two pages save them', async () => {
    await service().setConfig({ healthCheckIntervalMs: 600000 });
    await service().setConfig({ buildCleanupDays: 7 });
    await service().setConfig({ healthCheckSchedule: '0 * * * *', deleteBuildAssets: true });
    expect(await service().getConfig()).to.deep.equal({
      healthCheckIntervalMs: 600000,
      buildCleanupDays: 7,
      healthCheckSchedule: '0 * * * *',
      deleteBuildAssets: true,
    });
  });

  it('keeps the self-healing switch, off as well as on', async () => {
    await service().setConfig({ enableSelfHealing: false });
    expect(await service().getConfig()).to.deep.equal({ enableSelfHealing: false });
    await service().setConfig({ enableSelfHealing: true });
    expect(await service().getConfig()).to.deep.equal({ enableSelfHealing: true });
  });

  it('changes a setting saved before', async () => {
    await service().setConfig({ buildCleanupDays: 7, buildCleanupMaxCount: 5 });
    await service().setConfig({ buildCleanupDays: 14 });
    expect(await service().getConfig()).to.deep.equal({
      buildCleanupDays: 14,
      buildCleanupMaxCount: 5,
    });
  });

  it('still reads the row an earlier version saved under the id "global"', async () => {
    await scratch.db.webConfig.create({
      data: { id: 'global', name: 'buildCleanupDays', value: '9' },
    });
    await service().setConfig({ buildCleanupMaxCount: 5 });
    expect(await service().getConfig()).to.deep.equal({
      buildCleanupDays: 9,
      buildCleanupMaxCount: 5,
    });
  });
});
