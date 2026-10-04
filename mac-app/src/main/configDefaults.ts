import type { XenonSchema } from '@shared/types';

/**
 * The plugin args schema.json marked `required` until the plugin dropped the
 * list. Appium checks a --config file against the installed plugin's schema
 * before it applies defaults, so a plugin from before then refuses a file that
 * leaves any of these out. The plugin this launcher starts is whatever is
 * installed in APPIUM_HOME, which can be older than the bundled snapshot, so
 * the generated config keeps carrying them. Only these: the schema forbids
 * unknown keys, and an older plugin doesn't know args added since.
 */
export const LEGACY_REQUIRED_PLUGIN_ARGS: readonly string[] = [
  'platform',
  'androidDeviceType',
  'iosDeviceType',
  'skipChromeDownload',
  'maxSessions',
  'deviceAvailabilityTimeoutMs',
  'deviceAvailabilityQueryIntervalMs',
  'sendNodeDevicesToHubIntervalMs',
  'checkStaleDevicesIntervalMs',
  'checkBlockedDevicesIntervalMs',
  'newCommandTimeoutSec',
  'bindHostOrIp',
  'enableDashboard',
  'bootedSimulators',
  'removeDevicesFromDatabaseBeforeRunningThePlugin',
  'healthCheckIntervalMs',
  'enableSelfHealing',
  'buildCleanupDays',
  'buildCleanupMaxCount',
  'buildCleanupSchedule',
  'deleteBuildAssets',
  'sessionHeartbeatIntervalMs',
  'enableJsonLogging'
];

/**
 * Defaults for the args a generated launch config must carry: the schema's own
 * `required` list when it has one, else LEGACY_REQUIRED_PLUGIN_ARGS. Filling
 * them from schema defaults also keeps each launch config complete and
 * reproducible.
 */
export function requiredDefaults(schema: XenonSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of schema.required ?? LEGACY_REQUIRED_PLUGIN_ARGS) {
    const prop = schema.properties[key];
    if (prop && prop.default !== undefined) out[key] = prop.default;
  }
  return out;
}
