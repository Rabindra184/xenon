import Store from 'electron-store';
import type { LastRun } from '@shared/types';
import { sanitizeLastRun } from './lastRun';

// How each profile's last run ended, persisted as JSON in userData and keyed by
// profile id. Home says it ("Stopped unexpectedly, 3 minutes ago"), so it
// outlives the window and the app. The file is read and written whole: a
// profile id is never taken for a dotted path into it. A file that is not valid
// JSON is read as empty (clearInvalidConfig), and an entry that is not a run
// reads as no run, so a damaged file never stops the app from opening.
export class LastRunStore {
  private store = new Store<Record<string, unknown>>({ name: 'last-runs', clearInvalidConfig: true });

  /** How the profile's last run ended, or null when it has not run (or what is stored is not a run). */
  get(profileId: string): LastRun | null {
    const all = this.store.store;
    return Object.hasOwn(all, profileId) ? sanitizeLastRun(all[profileId]) : null;
  }

  /** Keeps this as the profile's last run, in place of the one before. */
  set(profileId: string, run: LastRun): void {
    this.store.store = { ...this.store.store, [profileId]: run };
  }

  /** Drops what is kept for a profile, as when the profile is deleted. */
  forget(profileId: string): void {
    const { [profileId]: _gone, ...rest } = this.store.store;
    this.store.store = rest;
  }
}
