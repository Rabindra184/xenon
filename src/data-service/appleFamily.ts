import type { IDevice } from '../interfaces/IDevice';

/** The two families `appium:iPhoneOnly` and `appium:iPadOnly` pick between. */
export type AppleFamily = 'iphone' | 'ipad';

type Identity = Pick<IDevice, 'platform' | 'name'> &
  Partial<Pick<IDevice, 'model' | 'formFactor' | 'marketingName'>>;

/** Whichever of the two words a name carries; iPad first, as "iPad" holds no "iPhone". */
function familyInName(name: string | null | undefined): AppleFamily | undefined {
  const lower = (name ?? '').toLowerCase();
  if (lower.includes('ipad')) return 'ipad';
  if (lower.includes('iphone')) return 'iphone';
  return undefined;
}

/**
 * Whether a phone is an iPhone or an iPad, or neither (an Android device, an
 * Apple TV). Read from what the phone reports, in order of how far it can be
 * trusted:
 *
 *  1. its model, lockdown's ProductType ("iPhone17,3", "iPad13,4");
 *  2. its form factor, which a simulator gets from its own name and a real
 *     phone from its DeviceClass;
 *  3. its marketing name, then its name, for a row written before the
 *     identity columns existed.
 *
 * A real phone's own name is whatever its owner typed ("QA-Phone-3", or
 * "iPhone spare" for an iPad), so it is the last resort, not the first.
 */
export function appleFamilyOf(device: Identity): AppleFamily | undefined {
  if ((device.platform ?? '').toLowerCase() !== 'ios') return undefined;

  const model = device.model ?? '';
  if (/^iPhone/i.test(model)) return 'iphone';
  if (/^iPad/i.test(model)) return 'ipad';

  if (device.formFactor === 'phone') return 'iphone';
  if (device.formFactor === 'tablet') return 'ipad';
  if (device.formFactor === 'tv') return undefined;

  return familyInName(device.marketingName) ?? familyInName(device.name);
}
