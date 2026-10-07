import { describe, expect, it } from 'vitest';
import { profileSummary } from '../src/renderer/src/profileSummary';
import { makeDefaultProfile } from '../src/shared/profileDefaults';
import type { Profile } from '../src/shared/types';

const withPlatform = (platform: unknown, port = 4723): Profile => {
  const p = makeDefaultProfile({ id: 'p', now: 0 });
  const settings = { ...p.settings };
  if (platform === undefined) delete settings.platform;
  else settings.platform = platform;
  return { ...p, settings, server: { ...p.server, port } };
};

describe('profileSummary', () => {
  it('says Android for an Android-only profile', () => {
    expect(profileSummary(withPlatform('android'))).toBe('Android · port 4723');
  });

  it('says iPhone for an iOS-only profile', () => {
    expect(profileSummary(withPlatform('ios'))).toBe('iPhone · port 4723');
  });

  it('says both for a profile that uses both', () => {
    expect(profileSummary(withPlatform('both'))).toBe('Android and iPhone · port 4723');
  });

  it('says both when the platform is unset, as Xenon does', () => {
    expect(profileSummary(withPlatform(undefined))).toBe('Android and iPhone · port 4723');
  });

  it('names the profile’s own port', () => {
    expect(profileSummary(withPlatform('android', 4799))).toBe('Android · port 4799');
  });
});
