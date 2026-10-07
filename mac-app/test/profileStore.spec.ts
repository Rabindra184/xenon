import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileStore } from '../src/main/ProfileStore';
import type { SecretVault } from '../src/main/profileSecrets';

// electron-store needs Electron to find the userData folder. Its base class,
// conf, does the real reading and writing, so the store runs on that, in a
// throwaway folder, as preferencesStore.spec does.
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

const vault: SecretVault = { has: () => false, reveal: () => null, set: () => undefined };

describe('ProfileStore: the profile the window had open', () => {
  beforeEach(() => {
    folder.path = mkdtempSync(join(tmpdir(), 'xenon-profiles-'));
  });

  afterEach(() => {
    rmSync(folder.path, { recursive: true, force: true });
  });

  it('is none until one is opened', () => {
    expect(new ProfileStore(vault).openId()).toBeNull();
  });

  // A window closed and opened again, or the next launch, is a new store reading the same file.
  it('is remembered on this Mac, across a reopened window and a relaunch', () => {
    new ProfileStore(vault).setOpenId('profile-b');
    expect(new ProfileStore(vault).openId()).toBe('profile-b');
  });

  it('follows the latest profile opened, and can be cleared', () => {
    const store = new ProfileStore(vault);
    store.setOpenId('profile-a');
    store.setOpenId('profile-b');
    expect(new ProfileStore(vault).openId()).toBe('profile-b');
    store.setOpenId(null);
    expect(new ProfileStore(vault).openId()).toBeNull();
  });

  it('never touches the profiles themselves', () => {
    const store = new ProfileStore(vault);
    const before = store.list();
    store.setOpenId('profile-b');
    expect(store.list()).toEqual(before);
  });
});
