import { describe, expect, it } from 'vitest';
import { clearSecret, saveSecret, secretsStatus, type SecretsApiDeps } from '../src/main/secretsApi';

// The window's secrets:* calls (R54): app-wide secrets by name, a profile's own
// cloud key and proxy password by the profile's id. Fake values only.

function deps(values: Record<string, string> = {}, opts: { available?: boolean; profiles?: string[] } = {}) {
  const profiles = new Set(opts.profiles ?? ['A', 'B']);
  const vault = {
    available: opts.available ?? true,
    has: (slot: string) => slot in values,
    reveal: (slot: string) => values[slot] ?? null,
    set: (slot: string, value: string) => {
      if (!vault.available) throw new Error('OS encryption (Keychain) is unavailable');
      values[slot] = value;
    },
    clear: (slot: string) => {
      delete values[slot];
    }
  };
  const d: SecretsApiDeps = { vault, profileExists: (id) => profiles.has(id) };
  return { d, values, vault };
}

describe('secretsStatus', () => {
  it('answers an app-wide secret for the app, and a profile’s own for that profile only', () => {
    const { d } = deps({ XENON_HUB_TOKEN: 't-test-1', 'CLOUD_KEY@A': 'k-test-A', 'PROXY_PASSWORD@B': 'p-test-B' });
    const keys = ['XENON_HUB_TOKEN', 'XENON_GEMINI_API_KEY', 'CLOUD_KEY', 'PROXY_PASSWORD'];
    expect(secretsStatus(d, keys, 'A').saved).toEqual({
      XENON_HUB_TOKEN: true,
      XENON_GEMINI_API_KEY: false,
      CLOUD_KEY: true,
      PROXY_PASSWORD: false
    });
    expect(secretsStatus(d, keys, 'B').saved).toEqual({
      XENON_HUB_TOKEN: true,
      XENON_GEMINI_API_KEY: false,
      CLOUD_KEY: false,
      PROXY_PASSWORD: true
    });
  });

  it('says a profile’s own secret is not set for no profile, or one that is not saved', () => {
    const { d } = deps({ 'CLOUD_KEY@C': 'k-test-C' });
    for (const id of [null, undefined, '', 'C', 42]) expect(secretsStatus(d, ['CLOUD_KEY'], id).saved).toEqual({ CLOUD_KEY: false });
  });

  it('never answers with a value, and ignores names that are not secrets', () => {
    const { d } = deps({ 'PROXY_PASSWORD@A': 'p-test:A', XENON_HUB_TOKEN: 't-test-1' });
    const status = secretsStatus(d, ['PROXY_PASSWORD', 'XENON_HUB_TOKEN', 'CLOUD_KEY@B', 'constructor', 7], 'A');
    expect(status.saved).toEqual({ PROXY_PASSWORD: true, XENON_HUB_TOKEN: true });
    expect(JSON.stringify(status)).not.toMatch(/p-test|t-test/);
    expect(secretsStatus(d, 'PROXY_PASSWORD', 'A').saved).toEqual({});
  });

  it('says whether the profile’s own proxy password has a colon in it (R53)', () => {
    const { d } = deps({ 'PROXY_PASSWORD@A': 'p-test:A', 'PROXY_PASSWORD@B': 'p-test-B', PROXY_PASSWORD: 'p:app' });
    expect(secretsStatus(d, [], 'A').proxyPasswordHasColon).toBe(true);
    expect(secretsStatus(d, [], 'B').proxyPasswordHasColon).toBe(false);
    // Another profile's, or an old app-wide one, is not this profile's.
    expect(secretsStatus(d, [], 'C').proxyPasswordHasColon).toBe(false);
    expect(secretsStatus(d, [], null).proxyPasswordHasColon).toBe(false);
  });
});

describe('saveSecret', () => {
  it('saves an app-wide secret in its own slot, whatever profile is named', () => {
    const { d, values } = deps();
    expect(saveSecret(d, 'XENON_GEMINI_API_KEY', 'g-test-1', 'A')).toBe('saved');
    expect(saveSecret(d, 'XENON_HUB_TOKEN', 't-test-1', null)).toBe('saved');
    expect(values).toEqual({ XENON_GEMINI_API_KEY: 'g-test-1', XENON_HUB_TOKEN: 't-test-1' });
  });

  it('saves a profile’s own key or password in that profile’s slot, and no other', () => {
    const { d, values } = deps({ 'CLOUD_KEY@B': 'k-test-B' });
    expect(saveSecret(d, 'CLOUD_KEY', 'k-test-A', 'A')).toBe('saved');
    expect(saveSecret(d, 'PROXY_PASSWORD', 'p-test-A', 'A')).toBe('saved');
    expect(values).toEqual({ 'CLOUD_KEY@B': 'k-test-B', 'CLOUD_KEY@A': 'k-test-A', 'PROXY_PASSWORD@A': 'p-test-A' });
  });

  it('refuses a profile’s own secret without a saved profile, a name that is not a secret, and an empty value', () => {
    const { d, values } = deps();
    expect(saveSecret(d, 'CLOUD_KEY', 'k-test-1', null)).toBe('failed');
    expect(saveSecret(d, 'CLOUD_KEY', 'k-test-1', 'gone')).toBe('failed');
    expect(saveSecret(d, 'CLOUD_KEY@B', 'k-test-1', 'A')).toBe('failed');
    expect(saveSecret(d, 'SOMETHING_ELSE', 'x', 'A')).toBe('failed');
    expect(saveSecret(d, 'XENON_HUB_TOKEN', '', 'A')).toBe('failed');
    expect(saveSecret(d, 'XENON_HUB_TOKEN', 42, 'A')).toBe('failed');
    expect(values).toEqual({});
  });

  it('says so when this Mac’s Keychain is not available', () => {
    const { d, values } = deps({}, { available: false });
    expect(saveSecret(d, 'PROXY_PASSWORD', 'p-test-A', 'A')).toBe('keychain-unavailable');
    expect(saveSecret(d, 'XENON_HUB_TOKEN', 't-test-1', null)).toBe('keychain-unavailable');
    expect(values).toEqual({});
  });
});

describe('clearSecret', () => {
  it('clears the app-wide secret, or the named profile’s own, and nothing else', () => {
    const { d, values } = deps({ XENON_HUB_TOKEN: 't', 'PROXY_PASSWORD@A': 'p-A', 'PROXY_PASSWORD@B': 'p-B' });
    expect(clearSecret(d, 'PROXY_PASSWORD', 'A')).toBe(true);
    expect(values).toEqual({ XENON_HUB_TOKEN: 't', 'PROXY_PASSWORD@B': 'p-B' });
    expect(clearSecret(d, 'XENON_HUB_TOKEN', 'B')).toBe(true);
    expect(values).toEqual({ 'PROXY_PASSWORD@B': 'p-B' });
  });

  it('clears nothing for a profile’s own secret without a saved profile, or a name that is not a secret', () => {
    const { d, values } = deps({ PROXY_PASSWORD: 'p-dev', 'PROXY_PASSWORD@B': 'p-B' });
    expect(clearSecret(d, 'PROXY_PASSWORD', null)).toBe(false);
    expect(clearSecret(d, 'PROXY_PASSWORD@B', 'A')).toBe(false);
    expect(values).toEqual({ PROXY_PASSWORD: 'p-dev', 'PROXY_PASSWORD@B': 'p-B' });
  });
});
