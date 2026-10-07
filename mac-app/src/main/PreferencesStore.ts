import Store from 'electron-store';
import { sanitizePreferences, type Preferences } from '@shared/preferences';

// The person's preferences, persisted as JSON in userData. Preferences are
// disposable, so a file that is not valid JSON is read as empty
// (clearInvalidConfig) rather than stopping the app from opening; the next
// choice is saved over it. Reads go through sanitizePreferences, so a missing
// file, or valid JSON with wrong or unknown fields, still gives a complete set.
export class PreferencesStore {
  private store = new Store<Partial<Preferences>>({ name: 'preferences', clearInvalidConfig: true });

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
