import Store from 'electron-store';
import { sanitizePreferences, type Preferences } from '@shared/preferences';

// The person's preferences, persisted as JSON in userData. Reads go through
// sanitizePreferences, so a missing or hand-edited file still gives a complete,
// valid set.
export class PreferencesStore {
  private store = new Store<Partial<Preferences>>({ name: 'preferences' });

  get(): Preferences {
    return sanitizePreferences(this.store.store);
  }

  /** Apply a partial change and return the full result. An invalid field in the patch takes its default. */
  set(patch: Partial<Preferences>): Preferences {
    const next = sanitizePreferences({ ...this.get(), ...patch });
    this.store.set(next);
    return next;
  }
}
