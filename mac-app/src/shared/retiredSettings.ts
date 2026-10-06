/**
 * Settings Xenon still accepts but ignores: the form no longer shows them and a
 * launch never writes them, so a profile saved with one keeps starting. Xenon
 * keeps all data in SQLite, so `databaseProvider` can't change anything.
 */
export const RETIRED_SETTINGS: ReadonlySet<string> = new Set(['databaseProvider']);
