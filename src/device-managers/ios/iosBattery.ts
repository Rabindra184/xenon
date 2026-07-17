/**
 * Parse the current battery charge level from
 * `ideviceinfo -q com.apple.mobile.battery` output.
 *
 * iOS exposes battery capacity (0–100 via `BatteryCurrentCapacity`) through
 * libimobiledevice, but not a thermal/temperature reading — so only the level
 * is collected for iOS device telemetry (Android additionally reports thermal
 * state via `dumpsys battery`).
 *
 * Returns undefined when the field is absent or unparseable, so callers can
 * treat battery telemetry as best-effort.
 */
export function parseBatteryCapacity(ideviceinfoOutput: string): number | undefined {
  const match = /BatteryCurrentCapacity:\s*(\d+)/.exec(ideviceinfoOutput ?? '');
  if (!match) return undefined;
  const value = parseInt(match[1], 10);
  if (Number.isNaN(value)) return undefined;
  return Math.max(0, Math.min(100, value));
}
