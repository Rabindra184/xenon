/**
 * Plugin args that are always present at runtime, so IPluginArgs types them as
 * non-optional. Appium fills every schema default after it validates a config
 * file, and XenonPlugin merges DefaultPluginArgs as well.
 *
 * Used only by scripts/generate-types-from-schema.js, which marks these
 * required for type generation. schema.json itself has no `required` list:
 * Appium checks a config file against it before applying defaults, so a
 * required arg made it refuse any file that left one out (the README sample
 * included). These are the 23 args that were required until then; keep it to
 * them. test/unit/schema-required-args.spec.ts checks each still has a default.
 *
 * `enableJsonLogging` left the list when its default did: with no default,
 * nothing fills it in, and an unset option is how XENON_JSON_LOGGING is told
 * from a choice (see XenonPlugin's constructor).
 */
const ALWAYS_PRESENT_PLUGIN_ARGS = [
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
];

module.exports = { ALWAYS_PRESENT_PLUGIN_ARGS };
