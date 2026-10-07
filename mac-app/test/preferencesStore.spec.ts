import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreferencesStore } from '../src/main/PreferencesStore';
import { DEFAULT_PREFERENCES } from '../src/shared/preferences';

// electron-store needs Electron to find the userData folder. Its base class,
// conf, does the real reading and writing, so the store runs on that, in a
// throwaway folder, with the options PreferencesStore passes.
const folder = vi.hoisted(() => ({ path: '' }));

vi.mock('electron-store', async () => {
  const { default: Conf } = await vi.importActual<{ default: new (options: object) => object }>('conf');
  return {
    default: class extends Conf {
      constructor(options: { name?: string }) {
        super({ ...options, configName: options.name, cwd: folder.path, projectVersion: '0.0.0' });
      }
    }
  };
});

describe('PreferencesStore', () => {
  beforeEach(() => {
    folder.path = mkdtempSync(join(tmpdir(), 'xenon-prefs-'));
  });

  afterEach(() => {
    rmSync(folder.path, { recursive: true, force: true });
  });

  const file = () => join(folder.path, 'preferences.json');

  it('saves and reads back a choice', () => {
    new PreferencesStore().set({ appearance: 'dark' });
    expect(new PreferencesStore().get()).toEqual({ ...DEFAULT_PREFERENCES, appearance: 'dark' });
  });

  // Preferences are disposable: a damaged file must not stop the app from opening.
  it('starts from the defaults when the saved file is not valid JSON', () => {
    writeFileSync(file(), '{"appearance": "dark",');
    const store = new PreferencesStore();
    expect(store.get()).toEqual(DEFAULT_PREFERENCES);
    // And the next choice is saved over the damaged file.
    store.set({ appearance: 'light' });
    expect(JSON.parse(readFileSync(file(), 'utf8'))).toMatchObject({ appearance: 'light' });
  });
});
