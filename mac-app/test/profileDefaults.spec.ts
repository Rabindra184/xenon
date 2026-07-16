import { describe, expect, it } from 'vitest';
import { NEW_PROFILE_NAME, SEED_PROFILE_NAME, makeDefaultProfile } from '../src/shared/profileDefaults';

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
});
