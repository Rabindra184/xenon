import 'reflect-metadata';
import { expect } from 'chai';
import {
  effectiveSettings,
  isValidCron,
  settingsDefaults,
  validateSettingsUpdate,
} from '../../src/services/settings/labSettings';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';

/**
 * The one rule for the settings the dashboard can change: a value saved there,
 * else the plugin option the server started with, else the default.
 */
describe('lab settings', () => {
  describe('the defaults', () => {
    it('are the ones schema.json declares, which Appium fills in', () => {
      expect(settingsDefaults()).to.deep.equal({
        healthCheckIntervalMs: 300000,
        buildCleanupDays: 30,
        buildCleanupMaxCount: 100,
        buildCleanupSchedule: '0 0 * * *',
        deleteBuildAssets: true,
      });
    });

    it('are what the plugin merges under its options', () => {
      for (const [key, value] of Object.entries(settingsDefaults())) {
        expect((DefaultPluginArgs as any)[key], key).to.equal(value);
      }
    });
  });

  describe('the settings in effect', () => {
    it('are the defaults when nothing is saved and nothing was set at startup', () => {
      const { healthCheckSchedule, ...rest } = effectiveSettings({}, {});
      expect(rest).to.deep.equal(settingsDefaults());
      expect(healthCheckSchedule).to.equal(undefined);
    });

    it('take the startup option over the default', () => {
      const s = effectiveSettings(
        {
          buildCleanupDays: 7,
          buildCleanupMaxCount: 20,
          buildCleanupSchedule: '30 1 * * *',
          deleteBuildAssets: false,
          healthCheckIntervalMs: 600000,
          healthCheckSchedule: '0 * * * *',
        },
        {},
      );
      expect(s).to.deep.equal({
        buildCleanupDays: 7,
        buildCleanupMaxCount: 20,
        buildCleanupSchedule: '30 1 * * *',
        deleteBuildAssets: false,
        healthCheckIntervalMs: 600000,
        healthCheckSchedule: '0 * * * *',
      });
    });

    it('take a saved value over the startup option', () => {
      const s = effectiveSettings(
        {
          buildCleanupDays: 7,
          buildCleanupMaxCount: 20,
          buildCleanupSchedule: '30 1 * * *',
          deleteBuildAssets: false,
          healthCheckIntervalMs: 600000,
        },
        {
          buildCleanupDays: 14,
          buildCleanupMaxCount: 50,
          buildCleanupSchedule: '0 4 * * 0',
          deleteBuildAssets: true,
          healthCheckIntervalMs: 120000,
        },
      );
      expect(s).to.include({
        buildCleanupDays: 14,
        buildCleanupMaxCount: 50,
        buildCleanupSchedule: '0 4 * * 0',
        deleteBuildAssets: true,
        healthCheckIntervalMs: 120000,
      });
    });

    it('take each setting from its own source', () => {
      const s = effectiveSettings(
        { buildCleanupDays: 7, buildCleanupMaxCount: 20 },
        { buildCleanupDays: 14 },
      );
      expect(s.buildCleanupDays).to.equal(14);
      expect(s.buildCleanupMaxCount).to.equal(20);
    });

    it('keep a deleteBuildAssets saved as false over a startup true', () => {
      expect(
        effectiveSettings({ deleteBuildAssets: true }, { deleteBuildAssets: false })
          .deleteBuildAssets,
      ).to.equal(false);
    });

    it('skip a saved value that could not work, taking the next source', () => {
      const s = effectiveSettings(
        { buildCleanupDays: 7, buildCleanupMaxCount: 20, buildCleanupSchedule: '30 1 * * *' },
        {
          buildCleanupDays: 0,
          buildCleanupMaxCount: NaN,
          buildCleanupSchedule: 'nightly',
          healthCheckIntervalMs: -5,
        },
      );
      expect(s).to.include({
        buildCleanupDays: 7,
        buildCleanupMaxCount: 20,
        buildCleanupSchedule: '30 1 * * *',
        healthCheckIntervalMs: 300000,
      });
    });

    it('skip a startup value that could not work, taking the default', () => {
      const s = effectiveSettings({ buildCleanupDays: 0, buildCleanupSchedule: 'nightly' }, {});
      expect(s.buildCleanupDays).to.equal(30);
      expect(s.buildCleanupSchedule).to.equal('0 0 * * *');
    });

    it('let a health schedule that was cleared in the dashboard stay cleared', () => {
      expect(
        effectiveSettings({ healthCheckSchedule: '0 * * * *' }, { healthCheckSchedule: '' })
          .healthCheckSchedule,
      ).to.equal(undefined);
      expect(
        effectiveSettings({ healthCheckSchedule: '0 * * * *' }, {}).healthCheckSchedule,
      ).to.equal('0 * * * *');
      expect(
        effectiveSettings(
          { healthCheckSchedule: '0 * * * *' },
          { healthCheckSchedule: '*/10 * * * *' },
        ).healthCheckSchedule,
      ).to.equal('*/10 * * * *');
    });
  });

  describe('a cron expression', () => {
    for (const ok of [
      '0 0 * * *',
      '*/15 * * * *',
      '0 2 * * 0',
      '0 */12 * * *',
      '30 1 1 jan *',
      '*/5 * * * * *',
    ]) {
      it(`accepts ${JSON.stringify(ok)}`, () => expect(isValidCron(ok)).to.equal(true));
    }
    for (const bad of [
      '',
      'nightly',
      '0 0 * *',
      '60 * * * *',
      '0 0 31 2 *',
      '* * * * * * *',
      '2030-01-01',
      'Jan 1 2030 10:00:00',
      null,
      42,
      undefined,
    ]) {
      it(`refuses ${JSON.stringify(bad)}`, () => expect(isValidCron(bad)).to.equal(false));
    }
  });

  describe('an update', () => {
    it('is accepted when every cleanup field is sound, or none is sent', () => {
      expect(validateSettingsUpdate({})).to.equal(null);
      expect(
        validateSettingsUpdate({
          buildCleanupDays: 14,
          buildCleanupMaxCount: 50,
          buildCleanupSchedule: '0 2 * * *',
          deleteBuildAssets: false,
        }),
      ).to.equal(null);
    });

    it('is not held to a rule for the settings the cleanup job does not act on', () => {
      expect(
        validateSettingsUpdate({
          healthCheckIntervalMs: 300000,
          aiProvider: 'gemini',
          enableSelfHealing: true,
        }),
      ).to.equal(null);
    });

    it('names the field a refused value was sent for', () => {
      expect(validateSettingsUpdate({ buildCleanupDays: 0 })?.field).to.equal('buildCleanupDays');
      expect(validateSettingsUpdate({ buildCleanupMaxCount: 1.5 })?.field).to.equal(
        'buildCleanupMaxCount',
      );
      expect(validateSettingsUpdate({ buildCleanupSchedule: 'x' })?.field).to.equal(
        'buildCleanupSchedule',
      );
      expect(validateSettingsUpdate({ deleteBuildAssets: 1 })?.field).to.equal('deleteBuildAssets');
    });

    it('treats a field sent as null as sent', () => {
      expect(validateSettingsUpdate({ buildCleanupDays: null })?.field).to.equal(
        'buildCleanupDays',
      );
    });
  });
});
