import type { Profile, SecretKey } from '@shared/types';
import { SECRET_SETTINGS, isSecretKey, secretForEnvName } from '@shared/secrets';

// A profile is plain JSON on disk and goes whole into an export, so a secret
// value belongs in the Keychain (SecretsStore), never in a profile. Profiles
// held them in two places: a secret-bearing setting (the Database URL field
// Settings used to show, or an AI key in an imported profile), which the launch
// never passed to the server, and an environment variable named like a secret
// (DATABASE_URL under Environment variables), which it did.

/** The part of SecretsStore the move uses. `set` throws when the Keychain is unavailable. */
export interface SecretVault {
  has(key: SecretKey): boolean;
  reveal(key: SecretKey): string | null;
  set(key: SecretKey, value: string): void;
}

type Slot = { kind: 'empty' } | { kind: 'unreadable' } | { kind: 'value'; value: string };

// An imported profile can hold anything in these fields. The launch iterates
// `secretRefs` (a string injects nothing; an object throws), so anything but an
// array injects nothing here either.
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const refsOf = (p: Profile): SecretKey[] => (isRecord(p) && Array.isArray(p.secretRefs) ? p.secretRefs : []);
const envOf = (p: Profile): Record<string, unknown> => (isRecord(p) && isRecord(p.env) ? p.env : {});
const settingsOf = (p: Profile): Record<string, unknown> => (isRecord(p) && isRecord(p.settings) ? p.settings : {});

function slotOf(vault: SecretVault, key: SecretKey): Slot {
  const value = vault.reveal(key);
  if (value !== null) return { kind: 'value', value };
  return vault.has(key) ? { kind: 'unreadable' } : { kind: 'empty' };
}

function withoutSetting(profile: Profile, setting: string): Profile {
  const settings = { ...settingsOf(profile) };
  delete settings[setting];
  return { ...profile, settings };
}

/** The env var gone, and the secret of the same name injected in its place. */
function injectedInsteadOfEnv(profile: Profile, key: SecretKey): Profile {
  const env = { ...envOf(profile) } as Record<string, string>;
  delete env[key];
  const refs = refsOf(profile);
  return { ...profile, env, secretRefs: refs.includes(key) ? refs : [...refs, key] };
}

/**
 * Moves the secret values profiles hold in plain text into the Keychain,
 * without changing what any profile's launch passes to the server:
 *
 * - An environment variable named like a secret was passed at launch. It moves
 *   when the Keychain holds no value for it or the same one, and the profile
 *   then injects the secret, so the server gets the same value. One that the
 *   profile's injected secret already overrides is dropped. Otherwise (another
 *   value stored, not injected) it stays: moving it would change, say, which
 *   database the server opens.
 * - A secret-bearing setting was never passed. It moves into an empty Keychain
 *   slot without being injected, since turning it on now would open another
 *   database than the one in use, and is dropped when the Keychain already
 *   holds a value.
 *
 * Every profile's env vars go before any setting, so a value that was never
 * used can't take a slot ahead of one in use. A value is stored only into an
 * empty slot, and only when no profile would start receiving it: every profile
 * that injects that secret must already pass the same value. A stored value
 * that can't be read is never overwritten, and with the Keychain unavailable
 * everything stays where it is. Only a secret's own name moves: an older name
 * Xenon also reads (OPENAI_API_KEY) would reach the server under another name.
 * Profiles are never mutated; an unchanged one is returned as given.
 */
export function moveSecretsToKeychain(input: Profile[], vault: SecretVault): { profiles: Profile[]; changed: boolean } {
  const profiles = [...input];
  let changed = false;

  // Secrets are app-wide, and a profile injecting one that isn't stored gets
  // nothing (or its env var). Storing a value is safe only if every profile
  // injecting it passes that value already.
  const safeToStore = (key: SecretKey, value: string): boolean =>
    profiles.every((p) => !refsOf(p).includes(key) || envOf(p)[key] === value);
  const store = (key: SecretKey, value: string): boolean => {
    try {
      vault.set(key, value);
      return true;
    } catch {
      return false;
    }
  };

  // The env vars first: they were in use, so they decide what a slot holds.
  for (let i = 0; i < profiles.length; i++) {
    for (const [name, value] of Object.entries(envOf(profiles[i]))) {
      if (!isSecretKey(name) || typeof value !== 'string' || value === '') continue;
      const slot = slotOf(vault, name);
      const overridden = slot.kind === 'value' && refsOf(profiles[i]).includes(name);
      const same = slot.kind === 'value' && slot.value === value;
      const stored = slot.kind === 'empty' && safeToStore(name, value) && store(name, value);
      if (!overridden && !same && !stored) continue;
      profiles[i] = injectedInsteadOfEnv(profiles[i], name);
      changed = true;
    }
  }

  for (let i = 0; i < profiles.length; i++) {
    for (const [setting, key] of Object.entries(SECRET_SETTINGS)) {
      const settings = settingsOf(profiles[i]);
      if (!Object.prototype.hasOwnProperty.call(settings, setting)) continue;
      const value = settings[setting];
      if (typeof value === 'string' && value !== '') {
        const slot = slotOf(vault, key);
        const kept = slot.kind === 'value' || (slot.kind === 'empty' && safeToStore(key, value) && store(key, value));
        if (!kept) continue;
      } else if (value !== undefined && value !== null && value !== '') {
        continue; // not a string, so not a value the Keychain could hold
      }
      profiles[i] = withoutSetting(profiles[i], setting);
      changed = true;
    }
  }
  return { profiles, changed };
}

// Env vars an export leaves out, beyond the secrets the Keychain holds: a name
// that ends in a secret word (alone, or after an underscore: KEY, API_KEY,
// DB_PASS), PGPASSWORD, and the OpenTelemetry exporter's headers (for every
// signal), which carry its credentials. Names are matched without regard to case.
const SECRET_ENV_WORD = /(^|_)(KEY|APIKEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|PASS)$/i;
const SECRET_ENV_NAME = /^(PGPASSWORD|OTEL_EXPORTER_OTLP_(\w+_)?HEADERS)$/i;

/** True for an environment variable whose value an export leaves out: it is named like a secret, or is one the Keychain holds. */
export function isSecretLikeEnvName(name: string): boolean {
  return SECRET_ENV_WORD.test(name) || SECRET_ENV_NAME.test(name) || secretForEnvName(name) !== null;
}

// The `user:pass@` of an address: after the scheme, up to the last `@` before the path.
const USERINFO = /^(\s*[a-z][a-z0-9+.-]*:\/\/)[^/?#\\]*@/i;
// A proxy written without a scheme, as `user:pass@host` or `user:pass@host:port`.
const SCHEMELESS_USERINFO = /^(\s*)[^\s:/?#@]+:[^\s/?#]*@(?=[\w.-]+(?::\d+)?\s*$)/;

/** The address when it has a user name or password in it, whatever its scheme. */
function addressWithCredentials(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.username !== '' || url.password !== '' ? url : null;
  } catch {
    return null;
  }
}

/**
 * An address without its `user:pass@`, so a proxy URL such as HTTPS_PROXY keeps
 * its host: any URL the parser reads a user name or password from (http, socks,
 * redis, postgres, smtp...), and a proxy given as `user:pass@host:port`. Any
 * other value is returned as it is: a list (NO_PROXY), an address with no
 * credentials, and text that isn't an address, which the parser rejects.
 */
export function stripUrlCredentials(value: string): string {
  const url = addressWithCredentials(value);
  if (!url) return value.replace(SCHEMELESS_USERINFO, '$1');
  // Cut the credentials out of the text so the rest stays as written (the parser
  // would add a slash, lowercase the host and so on); an odd spelling it can't
  // cut falls back to the parsed address.
  const cut = value.replace(USERINFO, '$1');
  if (!addressWithCredentials(cut)) return cut;
  url.username = '';
  url.password = '';
  return url.href;
}

/** The object without `key`; the same object when it has none. */
function without(obj: Record<string, unknown>, key: string): Record<string, unknown> {
  if (!Object.prototype.hasOwnProperty.call(obj, key)) return obj;
  const copy = { ...obj };
  delete copy[key];
  return copy;
}

/**
 * The profile as it is exported, with no secret value, and the names of the env
 * vars left out so whoever imports it knows what to enter again:
 *
 * - no secret-bearing setting, no `cloud.apiKey`, no `proxy.auth.password`;
 * - no env var named like a secret (see isSecretLikeEnvName);
 * - an env var holding an address keeps it without its `user:pass@`. It is not
 *   listed, since the address itself is still there.
 */
export function exportableProfile(profile: Profile): { profile: Profile; strippedEnv: string[] } {
  const settings = { ...settingsOf(profile) };
  for (const setting of Object.keys(SECRET_SETTINGS)) delete settings[setting];
  const { cloud, proxy } = settings;
  if (isRecord(cloud)) settings.cloud = without(cloud, 'apiKey');
  if (isRecord(proxy) && isRecord(proxy.auth)) settings.proxy = { ...proxy, auth: without(proxy.auth, 'password') };

  // An imported profile's value can be anything; only text can hold an address.
  const kept: [string, unknown][] = [];
  const strippedEnv: string[] = [];
  for (const [name, value] of Object.entries(envOf(profile))) {
    if (isSecretLikeEnvName(name)) strippedEnv.push(name);
    else kept.push([name, typeof value === 'string' ? stripUrlCredentials(value) : value]);
  }
  const env = Object.fromEntries(kept) as Record<string, string>;
  return { profile: { ...profile, settings, env }, strippedEnv: strippedEnv.sort() };
}

/**
 * A profile's export. It names the secrets the profile injects (`secretRefs`)
 * and carries none of their values, and lists the env vars it left out under
 * `strippedEnv` when there were any (older versions ignore the key).
 */
export function profileExportJson(profile: Profile): string {
  const { profile: exported, strippedEnv } = exportableProfile(profile);
  return JSON.stringify(
    { type: 'xenon-control-profile', version: 1, profile: exported, ...(strippedEnv.length > 0 ? { strippedEnv } : {}) },
    null,
    2
  );
}
