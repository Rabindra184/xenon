import { EMPTY_IDENTITY, type DeviceIdentity } from '../deviceIdentity';

/**
 * ProductType → marketing name, for devices a lab is likely to hold.
 *
 * Add a code only when it is confirmed (Apple's list, or read off a real
 * device with appium-ios-device's getDeviceInfo). An unknown code yields no
 * name, and the card falls back to the device's own name, rather than a guess
 * from the digits.
 */
export const APPLE_MODEL_NAMES: Record<string, string> = {
  'iPhone12,1': 'iPhone 11',
  'iPhone12,3': 'iPhone 11 Pro',
  'iPhone12,5': 'iPhone 11 Pro Max',
  'iPhone12,8': 'iPhone SE (2nd generation)',
  'iPhone13,1': 'iPhone 12 mini',
  'iPhone13,2': 'iPhone 12',
  'iPhone13,3': 'iPhone 12 Pro',
  'iPhone13,4': 'iPhone 12 Pro Max',
  'iPhone14,4': 'iPhone 13 mini',
  'iPhone14,5': 'iPhone 13',
  'iPhone14,2': 'iPhone 13 Pro',
  'iPhone14,3': 'iPhone 13 Pro Max',
  'iPhone14,6': 'iPhone SE (3rd generation)',
  'iPhone14,7': 'iPhone 14',
  'iPhone14,8': 'iPhone 14 Plus',
  'iPhone15,2': 'iPhone 14 Pro',
  'iPhone15,3': 'iPhone 14 Pro Max',
  'iPhone15,4': 'iPhone 15',
  'iPhone15,5': 'iPhone 15 Plus',
  'iPhone16,1': 'iPhone 15 Pro',
  'iPhone16,2': 'iPhone 15 Pro Max',
  'iPhone17,1': 'iPhone 16 Pro',
  'iPhone17,2': 'iPhone 16 Pro Max',
  'iPhone17,3': 'iPhone 16',
  'iPhone17,4': 'iPhone 16 Plus',
  'iPhone17,5': 'iPhone 16e',
  'iPad11,6': 'iPad (8th generation)',
  'iPad11,7': 'iPad (8th generation)',
  'iPad12,1': 'iPad (9th generation)',
  'iPad12,2': 'iPad (9th generation)',
  'iPad13,18': 'iPad (10th generation)',
  'iPad13,19': 'iPad (10th generation)',
  'iPad13,1': 'iPad Air (4th generation)',
  'iPad13,2': 'iPad Air (4th generation)',
  'iPad13,16': 'iPad Air (5th generation)',
  'iPad13,17': 'iPad Air (5th generation)',
  'iPad14,8': 'iPad Air 11-inch (M2)',
  'iPad14,9': 'iPad Air 11-inch (M2)',
  'iPad14,10': 'iPad Air 13-inch (M2)',
  'iPad14,11': 'iPad Air 13-inch (M2)',
  'iPad14,1': 'iPad mini (6th generation)',
  'iPad14,2': 'iPad mini (6th generation)',
  'iPad13,4': 'iPad Pro 11-inch (3rd generation)',
  'iPad13,5': 'iPad Pro 11-inch (3rd generation)',
  'iPad13,6': 'iPad Pro 11-inch (3rd generation)',
  'iPad13,7': 'iPad Pro 11-inch (3rd generation)',
  'iPad13,8': 'iPad Pro 12.9-inch (5th generation)',
  'iPad13,9': 'iPad Pro 12.9-inch (5th generation)',
  'iPad13,10': 'iPad Pro 12.9-inch (5th generation)',
  'iPad13,11': 'iPad Pro 12.9-inch (5th generation)',
  'iPad14,3': 'iPad Pro 11-inch (4th generation)',
  'iPad14,4': 'iPad Pro 11-inch (4th generation)',
  'iPad14,5': 'iPad Pro 12.9-inch (6th generation)',
  'iPad14,6': 'iPad Pro 12.9-inch (6th generation)',
  'iPad16,3': 'iPad Pro 11-inch (M4)',
  'iPad16,4': 'iPad Pro 11-inch (M4)',
  'iPad16,5': 'iPad Pro 13-inch (M4)',
  'iPad16,6': 'iPad Pro 13-inch (M4)',
};

const FORM_FACTOR_BY_CLASS: Record<string, DeviceIdentity['formFactor']> = {
  iPhone: 'phone',
  iPod: 'phone',
  iPad: 'tablet',
  AppleTV: 'tv',
};

/** From lockdown's ProductType ("iPhone16,2") and DeviceClass ("iPhone"). */
export function appleIdentity(
  info: { ProductType?: string; DeviceClass?: string } | null | undefined,
): DeviceIdentity {
  if (!info || (!info.ProductType && !info.DeviceClass)) return { ...EMPTY_IDENTITY };
  const model = info.ProductType?.trim() || null;
  return {
    marketingName: (model && APPLE_MODEL_NAMES[model]) || null,
    model,
    manufacturer: 'Apple',
    formFactor: (info.DeviceClass && FORM_FACTOR_BY_CLASS[info.DeviceClass]) || null,
  };
}

/** A simulator's name is already its marketing name ("iPhone 16 Pro"). */
export function simulatorIdentity(name: string | undefined): DeviceIdentity {
  const n = name?.trim();
  if (!n) return { ...EMPTY_IDENTITY };
  const lower = n.toLowerCase();
  const formFactor = lower.includes('ipad') ? 'tablet' : lower.includes('tv') ? 'tv' : 'phone';
  return { marketingName: n, model: null, manufacturer: null, formFactor };
}
