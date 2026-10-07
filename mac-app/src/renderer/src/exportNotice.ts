import { PROFILES } from './copy/profiles';

/**
 * What an export tells the person once the file is saved: how many secret
 * values it left out (null when none, so there is nothing to say). With
 * technical details on, the names follow the sentence ("…: DATABASE_URL, cloud.apiKey").
 */
export function exportNotice(leftOut: string[], technical: boolean): string | null {
  if (leftOut.length === 0) return null;
  const sentence = leftOut.length === 1 ? PROFILES.exportNotice.one : PROFILES.exportNotice.many(leftOut.length);
  return technical ? `${sentence}: ${leftOut.join(', ')}` : sentence;
}
