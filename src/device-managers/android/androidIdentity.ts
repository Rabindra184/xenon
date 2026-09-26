import type { DeviceIdentity } from '../deviceIdentity';

/**
 * One `adb shell` call for everything the device card shows, as key=value
 * lines. `settings global device_name` is the name on the phone's About
 * screen: the marketing name by default ("Galaxy S9+"), or whatever the lab
 * renamed it to.
 */
export const ANDROID_IDENTITY_COMMAND = [
  'echo model=$(getprop ro.product.model)',
  'echo manufacturer=$(getprop ro.product.manufacturer)',
  'echo characteristics=$(getprop ro.build.characteristics)',
  'echo device_name=$(settings get global device_name)',
  'echo avd_name=$(getprop ro.boot.qemu.avd_name)',
].join('; ');

export function parseAndroidIdentity(
  stdout: string,
  opts: { realDevice: boolean },
): DeviceIdentity {
  const values = new Map<string, string>();
  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    const eq = line.indexOf('=');
    if (eq > 0) values.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
  }
  // `settings get` prints "null" for an unset value.
  const read = (key: string) => {
    const v = (values.get(key) ?? '').trim();
    return v && v !== 'null' ? v : null;
  };

  // An emulator's device name is its system image ("sdk_gphone64_arm64");
  // the AVD name is what people chose.
  const avdName = read('avd_name');
  const marketingName =
    !opts.realDevice && avdName ? avdName.replace(/_/g, ' ') : read('device_name');

  const traits = (read('characteristics') ?? '').split(',').map((t) => t.trim());
  const formFactor = traits.includes('tablet')
    ? 'tablet'
    : traits.includes('tv')
      ? 'tv'
      : values.size > 0
        ? 'phone'
        : null;

  return { marketingName, model: read('model'), manufacturer: read('manufacturer'), formFactor };
}
