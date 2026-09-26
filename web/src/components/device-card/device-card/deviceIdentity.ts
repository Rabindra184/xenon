import { platformLabel } from '../../../lib/labels';
import type { IDevice } from '../../../interfaces/IDevice';

export type IdentityInput = Pick<
  IDevice,
  | 'name'
  | 'platform'
  | 'sdk'
  | 'deviceType'
  | 'marketingName'
  | 'model'
  | 'manufacturer'
  | 'formFactor'
>;

/** What people call the device; today's name (often a codename) when unknown. */
export function deviceTitle(d: IdentityInput): string {
  return d.marketingName?.trim() || d.name;
}

/** "Samsung SM-G965F · Android 10", "Emulator · Android 14", or just the OS. */
export function deviceSubtitle(d: IdentityInput): string {
  const os = [platformLabel(d.platform), d.sdk].filter(Boolean).join(' ');
  if (d.deviceType === 'emulator') return `Emulator · ${os}`;
  if (d.deviceType === 'simulator') return `Simulator · ${os}`;
  const maker = d.manufacturer
    ? d.manufacturer.charAt(0).toUpperCase() + d.manufacturer.slice(1)
    : '';
  const hardware = [maker, d.model].filter(Boolean).join(' ');
  return hardware ? `${hardware} · ${os}` : os;
}

export function deviceFormFactor(d: IdentityInput): 'phone' | 'tablet' | 'tv' {
  return d.formFactor === 'tablet' || d.formFactor === 'tv' ? d.formFactor : 'phone';
}
