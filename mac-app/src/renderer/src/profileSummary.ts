import type { Profile } from '@shared/types';

/** Which phones a profile is for, in words. Unset is both, as Xenon reads it. */
const PHONES: Record<string, string> = {
  android: 'Android',
  ios: 'iPhone'
};

/** One line that tells profiles apart: which phones, and the port ("Android and iPhone · port 4723"). */
export function profileSummary(p: Profile): string {
  const platform = p.settings.platform;
  const phones = (typeof platform === 'string' && PHONES[platform]) || 'Android and iPhone';
  return `${phones} · port ${p.server.port}`;
}
