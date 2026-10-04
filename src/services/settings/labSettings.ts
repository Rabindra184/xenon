import { Container } from 'typedi';
import nodeSchedule from 'node-schedule';
import schema from '../../../schema.json';
import log from '../../logger';
import { IPluginArgs } from '../../interfaces/IPluginArgs';
import { PluginContext } from '../../PluginContext';
import { IWebConfig, WebConfigService } from '../../data-service/web-config-service';

/**
 * The lab settings the dashboard can change (Settings and Maintenance), and the
 * one rule for what a running server uses.
 *
 * Each also exists as a plugin option the server was started with. A value
 * saved in the dashboard (the `WebConfig` table, written by `POST /config`)
 * wins over the option, from the next time it is read: no restart. With
 * nothing saved, the option applies, and with neither, the default in
 * schema.json, the same one Appium fills in. Through 2.13 only the health
 * check honoured a saved value; the cleanup job read the startup options
 * alone, so the Maintenance page's values did nothing. The AI self-healing
 * switch was the same: the Settings page's toggle was neither stored nor read.
 */

export interface LabSettings {
  /** Whether a failed findElement goes on to the healing tiers (Settings page). */
  enableSelfHealing: boolean;
  /** Milliseconds between device health checks; a schedule, when set, replaces it. */
  healthCheckIntervalMs: number;
  /** A cron expression for the health check; absent when there is none. */
  healthCheckSchedule?: string;
  buildCleanupDays: number;
  buildCleanupMaxCount: number;
  buildCleanupSchedule: string;
  deleteBuildAssets: boolean;
}

export type CleanupSettings = Pick<
  LabSettings,
  'buildCleanupDays' | 'buildCleanupMaxCount' | 'buildCleanupSchedule' | 'deleteBuildAssets'
>;

/** What the dashboard may send, by the field a refused value is named after. */
export interface SettingsProblem {
  field: string;
  message: string;
}

const schemaProperties = schema.properties as unknown as Record<string, { default?: unknown }>;

function schemaDefault<T>(key: keyof LabSettings): T {
  return schemaProperties[key].default as T;
}

/** The defaults schema.json declares, which Appium fills in: the server's own. */
export function settingsDefaults(): Omit<LabSettings, 'healthCheckSchedule'> {
  return {
    enableSelfHealing: schemaDefault<boolean>('enableSelfHealing'),
    healthCheckIntervalMs: schemaDefault<number>('healthCheckIntervalMs'),
    buildCleanupDays: schemaDefault<number>('buildCleanupDays'),
    buildCleanupMaxCount: schemaDefault<number>('buildCleanupMaxCount'),
    buildCleanupSchedule: schemaDefault<string>('buildCleanupSchedule'),
    deleteBuildAssets: schemaDefault<boolean>('deleteBuildAssets'),
  };
}

/**
 * Whether a string is a cron expression the scheduler will run: five or six
 * fields. node-schedule alone also takes a date ("2030-01-01") as a one-off
 * job, which is not a schedule that repeats.
 */
export function isValidCron(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const fields = value.trim().split(/\s+/);
  if (fields.length < 5 || fields.length > 6) return false;
  if (!fields.every((field) => /^[0-9A-Za-z*/,\-?#]+$/.test(field))) return false;
  const job = new nodeSchedule.Job(() => undefined);
  const ok = job.schedule(value.trim());
  job.cancel();
  return ok;
}

const wholeNumberAtLeastOne = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1;
const positiveNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0;

const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean';

/** The first value that is usable, in the order given. */
function firstValid<T>(valid: (v: unknown) => v is T, ...candidates: unknown[]): T | undefined {
  return candidates.find(valid) as T | undefined;
}

/**
 * Whether self-healing runs: the value saved in the dashboard, else the plugin
 * option, else the default (on). The same rule `effectiveSettings` applies,
 * on its own because the command interceptor asks at every command and
 * `effectiveSettings` also checks cron expressions. A value that is not a
 * boolean is no choice, so `"false"` as an option does not turn healing off.
 */
export function selfHealingEnabled(startupOption: unknown, saved: unknown): boolean {
  const fallback = schemaDefault<boolean>('enableSelfHealing');
  return firstValid(isBoolean, saved, startupOption, fallback) ?? fallback;
}

/**
 * The settings in effect: saved in the dashboard, else the plugin option the
 * server started with, else the default. A saved or started-with value that
 * could not work (a retention window of 0 would purge everything) is skipped,
 * so a bad row never reaches the cleanup job.
 */
export function effectiveSettings(startup: Partial<IPluginArgs>, saved: IWebConfig): LabSettings {
  const defaults = settingsDefaults();
  const out: LabSettings = {
    enableSelfHealing: selfHealingEnabled(startup.enableSelfHealing, saved.enableSelfHealing),
    healthCheckIntervalMs:
      firstValid(
        positiveNumber,
        saved.healthCheckIntervalMs,
        startup.healthCheckIntervalMs,
        defaults.healthCheckIntervalMs,
      ) ?? defaults.healthCheckIntervalMs,
    buildCleanupDays:
      firstValid(
        wholeNumberAtLeastOne,
        saved.buildCleanupDays,
        startup.buildCleanupDays,
        defaults.buildCleanupDays,
      ) ?? defaults.buildCleanupDays,
    buildCleanupMaxCount:
      firstValid(
        wholeNumberAtLeastOne,
        saved.buildCleanupMaxCount,
        startup.buildCleanupMaxCount,
        defaults.buildCleanupMaxCount,
      ) ?? defaults.buildCleanupMaxCount,
    buildCleanupSchedule:
      firstValid(
        isValidCron,
        saved.buildCleanupSchedule,
        startup.buildCleanupSchedule,
        defaults.buildCleanupSchedule,
      ) ?? defaults.buildCleanupSchedule,
    deleteBuildAssets:
      firstValid(
        isBoolean,
        saved.deleteBuildAssets,
        startup.deleteBuildAssets,
        defaults.deleteBuildAssets,
      ) ?? defaults.deleteBuildAssets,
  };
  // A saved schedule of '' is the person clearing it, to go back to the
  // interval; only an unsaved one falls through to the startup option.
  const schedule =
    typeof saved.healthCheckSchedule === 'string'
      ? saved.healthCheckSchedule
      : startup.healthCheckSchedule;
  if (typeof schedule === 'string' && schedule.trim() !== '') {
    out.healthCheckSchedule = schedule;
  }
  return out;
}

/** The settings in effect now: what is saved, over what the server started with. */
export async function loadEffectiveSettings(
  startup: Partial<IPluginArgs> = Container.get(PluginContext).pluginArgs,
): Promise<LabSettings> {
  let saved: IWebConfig = {};
  try {
    saved = await Container.get(WebConfigService).getConfig();
  } catch (err: any) {
    // A cleanup that can't read the dashboard's values still runs, on the
    // startup options: skipping a night's cleanup helps nobody.
    log.warn(`Could not read the saved settings, using the startup options: ${err?.message}`);
  }
  return effectiveSettings(startup, saved);
}

/**
 * What is wrong with a settings update, or null. The cleanup fields are held to
 * a rule because a retention window of 0, or a cap of 0, would purge every
 * build, and these values used to be inert; the self-healing switch because
 * anything but true or false is no answer to "on or off". The other fields are
 * not checked. Fields not sent are not checked either.
 */
export function validateSettingsUpdate(body: Record<string, unknown>): SettingsProblem | null {
  const has = (key: string) => body[key] !== undefined;
  for (const field of ['buildCleanupDays', 'buildCleanupMaxCount']) {
    if (has(field) && !wholeNumberAtLeastOne(body[field])) {
      return { field, message: `${field} must be a whole number of at least 1.` };
    }
  }
  if (has('buildCleanupSchedule') && !isValidCron(body.buildCleanupSchedule)) {
    return {
      field: 'buildCleanupSchedule',
      message:
        'buildCleanupSchedule must be a cron expression with five or six fields, ' +
        "such as '0 0 * * *' for midnight.",
    };
  }
  if (has('deleteBuildAssets') && typeof body.deleteBuildAssets !== 'boolean') {
    return { field: 'deleteBuildAssets', message: 'deleteBuildAssets must be true or false.' };
  }
  if (has('enableSelfHealing') && typeof body.enableSelfHealing !== 'boolean') {
    return { field: 'enableSelfHealing', message: 'enableSelfHealing must be true or false.' };
  }
  return null;
}
