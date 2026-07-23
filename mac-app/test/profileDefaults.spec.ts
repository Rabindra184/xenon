import { describe, expect, it } from 'vitest';
import type { Profile } from '../src/shared/types';
import {
  NEW_PROFILE_NAME,
  SEED_PROFILE_NAME,
  makeDefaultProfile,
  migrateProfile
} from '../src/shared/profileDefaults';

describe('makeDefaultProfile', () => {
  const base = { id: 'id-1', now: 1_700_000_000_000 };

  it('defaults iOS discovery to booted-only simulators', () => {
    // Xenon leases one WDA port per discovered simulator from a 100-port pool,
    // so a host with many installed sims fails discovery outright unless this is on.
    expect(makeDefaultProfile(base).settings.bootedSimulators).toBe(true);
  });

  it('carries the shared starter settings', () => {
    const p = makeDefaultProfile(base);
    expect(p.settings.platform).toBe('both');
    expect(p.settings.enableDashboard).toBe(true);
    expect(p.settings.maxSessions).toBe(8);
    expect(p.server).toEqual({ port: 4723, basePath: '/wd/hub', appiumHome: '', keepAliveTimeout: 800 });
    expect(p.secretRefs).toEqual([]);
    expect(p.env).toEqual({});
  });

  it('uses the id and timestamps it is given', () => {
    const p = makeDefaultProfile(base);
    expect(p.id).toBe('id-1');
    expect(p.createdAt).toBe(base.now);
    expect(p.updatedAt).toBe(base.now);
  });

  it('names the profile, defaulting to the new-profile name', () => {
    expect(makeDefaultProfile(base).name).toBe(NEW_PROFILE_NAME);
    expect(makeDefaultProfile({ ...base, name: SEED_PROFILE_NAME }).name).toBe(SEED_PROFILE_NAME);
  });

  it('produces independent objects (no shared nested state)', () => {
    const a = makeDefaultProfile(base);
    const b = makeDefaultProfile({ ...base, id: 'id-2' });
    a.settings.platform = 'ios';
    a.env.FOO = 'bar';
    expect(b.settings.platform).toBe('both');
    expect(b.env).toEqual({});
  });

  it('defaults Android H.264 (scrcpy) live preview on', () => {
    expect(makeDefaultProfile(base).settings.streaming).toEqual({ androidH264: true });
  });
});

describe('migrateProfile', () => {
  const bare = (settings: Record<string, unknown>): Profile =>
    ({
      id: 'p',
      name: 'p',
      settings,
      server: { port: 4723, basePath: '/wd/hub', appiumHome: '', keepAliveTimeout: 800 },
      secretRefs: [],
      env: {},
      createdAt: 0,
      updatedAt: 0
    }) as Profile;

  it('backfills streaming.androidH264 on for a profile that predates it', () => {
    const migrated = migrateProfile(bare({ platform: 'android' }));
    expect(migrated.settings.streaming).toEqual({ androidH264: true });
    expect(migrated.settings.platform).toBe('android'); // existing settings preserved
  });

  it('does not override a profile that already set streaming (e.g. toggled off)', () => {
    const migrated = migrateProfile(bare({ streaming: { androidH264: false } }));
    expect(migrated.settings.streaming).toEqual({ androidH264: false });
  });

  it('backfills missing env/secretRefs without dropping settings', () => {
    const p = bare({ maxSessions: 3 });
    // simulate an even older profile missing these
    delete (p as any).env;
    delete (p as any).secretRefs;
    const migrated = migrateProfile(p);
    expect(migrated.env).toEqual({});
    expect(migrated.secretRefs).toEqual([]);
    expect(migrated.settings.maxSessions).toBe(3);
  });
});
