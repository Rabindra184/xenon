// What the person has chosen about how Xenon Control looks and behaves. Kept
// in its own file, saved by the main process, and shared with the renderer by
// type only, so this module imports nothing from Node or Electron.

/** 'system' follows the Mac's own light or dark setting. */
export type Appearance = 'system' | 'light' | 'dark';

export interface Preferences {
  /** Show option keys, commands and paths next to the plain-words text. */
  technicalDetails: boolean;
  appearance: Appearance;
}

export const DEFAULT_PREFERENCES: Preferences = { technicalDetails: false, appearance: 'system' };

const APPEARANCES: readonly Appearance[] = ['system', 'light', 'dark'];

/**
 * Whatever was stored (or sent), as a complete Preferences. A field that is
 * missing, or not of the right type, takes its default; fields we do not know
 * are dropped. Always a fresh object.
 */
export function sanitizePreferences(raw: unknown): Preferences {
  const stored = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    technicalDetails:
      typeof stored.technicalDetails === 'boolean' ? stored.technicalDetails : DEFAULT_PREFERENCES.technicalDetails,
    appearance: APPEARANCES.includes(stored.appearance as Appearance)
      ? (stored.appearance as Appearance)
      : DEFAULT_PREFERENCES.appearance
  };
}
