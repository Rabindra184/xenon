import { describe, expect, it } from 'vitest';
import { KEY_ORDER, keyRows } from '../src/renderer/src/keyRows';
import { KEYS } from '../src/renderer/src/copy/keys';
import { SECRET_DESCRIPTORS } from '../src/shared/secrets';
import { findJargon } from './e2e/jargon';

// Keys & accounts: every Keychain secret, in the brief's order, in plain words.

describe('keyRows', () => {
  it('lists every Keychain secret once, in the brief’s order', () => {
    expect(KEY_ORDER).toEqual([
      'XENON_GEMINI_API_KEY',
      'XENON_OPENAI_API_KEY',
      'XENON_ANTHROPIC_API_KEY',
      'XENON_HUB_ACCESS_KEY',
      'XENON_HUB_TOKEN',
      'XENON_SMTP_URL',
      'CLOUD_KEY',
      'PROXY_PASSWORD',
      'DATABASE_URL'
    ]);
    expect([...KEY_ORDER].sort()).toEqual(SECRET_DESCRIPTORS.map((d) => d.key).sort());
  });

  it('shows the database file only with technical details on', () => {
    expect(keyRows(true)).toEqual(KEY_ORDER);
    expect(keyRows(false)).toEqual(KEY_ORDER.filter((k) => k !== 'DATABASE_URL'));
  });
});

describe('copy/keys', () => {
  it('names each secret and says what it is for, in the brief’s words', () => {
    const words = Object.fromEntries(KEY_ORDER.map((k) => [k, [KEYS.secrets[k].label, KEYS.secrets[k].purpose]]));
    expect(words).toEqual({
      XENON_GEMINI_API_KEY: ['Gemini key', 'Lets AI repair broken element lookups with Gemini.'],
      XENON_OPENAI_API_KEY: ['OpenAI key', 'Lets AI repair broken element lookups with OpenAI.'],
      XENON_ANTHROPIC_API_KEY: ['Claude key', 'Lets AI repair broken element lookups with Claude.'],
      XENON_HUB_ACCESS_KEY: ['Hub access key', 'Lets this Mac join a lab hub. Used with the hub token.'],
      XENON_HUB_TOKEN: ['Hub token', 'Lets this Mac join a lab hub. Used with the access key.'],
      XENON_SMTP_URL: ['Email for password resets', 'Sends password-reset emails to people who sign in.'],
      CLOUD_KEY: ['Cloud access key', 'Lets Xenon use phones from your cloud provider.'],
      PROXY_PASSWORD: ['Proxy password', 'The password for the proxy this server uses.'],
      DATABASE_URL: ['Database file', 'Where Xenon keeps its data.']
    });
  });

  it('asks before clearing, in the brief’s words', () => {
    expect(KEYS.clearConfirm('Gemini key')).toBe('Clear the Gemini key?');
    expect(KEYS.saved).toBe('Saved');
    expect(KEYS.notSet).toBe('Not set');
    expect(KEYS.usedByProfile).toBe('Used by this profile');
  });

  it('says the cloud key and the proxy password belong to this profile (R54)', () => {
    expect(KEYS.forThisProfile(KEYS.secrets.CLOUD_KEY.label)).toBe('Cloud access key — for this profile');
    expect(KEYS.forThisProfile(KEYS.secrets.PROXY_PASSWORD.label)).toBe('Proxy password — for this profile');
    expect(KEYS.savedForProfile).toBe('Saved for this profile');
    expect(KEYS.clearConfirmHelpOwn).toBe('This profile starts without it until a new one is saved.');
    expect(KEYS.intro).toContain('never in a file');
  });

  it('says the Keychain is not available when that is why a save failed, in plain words', () => {
    const text = KEYS.keychainUnavailable('Proxy password');
    expect(text).toBe('Couldn’t save the Proxy password: this Mac’s Keychain isn’t available, so it wasn’t saved anywhere. Try again later.');
    expect(findJargon(text, [])).toEqual([]);
  });

  it('gives every Used by this profile switch a name of its own that starts with what it shows', () => {
    const names = KEY_ORDER.map((k) => KEYS.usedByProfileName(KEYS.secrets[k].label));
    expect(new Set(names).size).toBe(KEY_ORDER.length);
    for (const name of names) expect(name.startsWith(KEYS.usedByProfile)).toBe(true);
  });

  it('has no option key, environment name, command or path in its words', () => {
    const text = KEY_ORDER.flatMap((k) => [KEYS.secrets[k].label, KEYS.secrets[k].purpose, KEYS.secrets[k].placeholder ?? '']).join('\n');
    expect(findJargon(text, ['databaseUrl', 'geminiApiKey'])).toEqual([]);
  });
});
