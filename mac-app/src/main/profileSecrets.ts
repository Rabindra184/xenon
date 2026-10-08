import type { Profile, SecretKey } from '@shared/types';
import { SECRET_SETTINGS, SECRET_SETTING_PARTS, SECRETS_NOT_IN_ENV, isSecretKey, secretForEnvName } from '@shared/secrets';
import { proxyStringCredentials, proxyStringWithoutPassword } from './proxyEnv';

// A profile is plain JSON on disk and goes whole into an export, so a secret
// value belongs in the Keychain (SecretsStore), never in a profile. Profiles
// held them in three places: a secret-bearing setting (the Database URL field
// Settings used to show, or an AI key in an imported profile), which the launch
// never passed to the server; an environment variable named like a secret
// (DATABASE_URL under Environment variables), which it did; and a secret part
// of a setting, the cloud key (`cloud.apiKey`) and the proxy password
// (`proxy.auth.password`, or the password in a proxy written as one address).

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

/** A secret part of the settings: where it sits, and the secret that holds it instead. */
interface SecretPart {
  key: SecretKey;
  /** The value the settings hold there; undefined when they hold none. */
  read(settings: Record<string, unknown>): unknown;
  /** The settings without it, copying each object on the way. */
  remove(settings: Record<string, unknown>): Record<string, unknown>;
}

/** The settings object holding the last step of `path`, when every step on the way is an object. */
function holderOf(settings: Record<string, unknown>, path: readonly string[]): Record<string, unknown> | null {
  let at: unknown = settings;
  for (const step of path.slice(0, -1)) {
    if (!isRecord(at)) return null;
    at = at[step];
  }
  return isRecord(at) ? at : null;
}

/** The part at a dotted path (`cloud.apiKey`). */
function partAt(dotted: string, key: SecretKey): SecretPart {
  const path = dotted.split('.');
  const last = path[path.length - 1];
  const drop = (obj: Record<string, unknown>, rest: readonly string[]): Record<string, unknown> => {
    const copy = { ...obj };
    if (rest.length === 1) delete copy[rest[0]];
    else copy[rest[0]] = drop(obj[rest[0]] as Record<string, unknown>, rest.slice(1));
    return copy;
  };
  return {
    key,
    read: (settings) => {
      const holder = holderOf(settings, path);
      return holder !== null && Object.prototype.hasOwnProperty.call(holder, last) ? holder[last] : undefined;
    },
    remove: (settings) => drop(settings, path)
  };
}

/**
 * The password in a proxy written as one address (`http://qa:pw@host:3128`). It
 * moves only with a user name to go with it, which the address keeps, so the
 * launch can put the Keychain's password back in (LaunchBuilder).
 */
const PROXY_STRING_PASSWORD: SecretPart = {
  key: 'PROXY_PASSWORD',
  read: (settings) => {
    if (typeof settings.proxy !== 'string') return undefined;
    const credentials = proxyStringCredentials(settings.proxy);
    return credentials && credentials.username !== '' && credentials.password !== '' ? credentials.password : undefined;
  },
  remove: (settings) => ({ ...settings, proxy: proxyStringWithoutPassword(settings.proxy as string) })
};

const SECRET_PARTS: readonly SecretPart[] = [
  ...Object.entries(SECRET_SETTING_PARTS).map(([dotted, key]) => partAt(dotted, key)),
  PROXY_STRING_PASSWORD
];

function withoutPart(profile: Profile, part: SecretPart): Profile {
  return { ...profile, settings: part.remove(settingsOf(profile)) };
}

/** The profile not injecting `key`; the same profile when it doesn't. */
function notInjecting(profile: Profile, key: SecretKey): Profile {
  const refs = refsOf(profile);
  return refs.includes(key) ? { ...profile, secretRefs: refs.filter((k) => k !== key) } : profile;
}

/** `vault.set`, false when the Keychain is unavailable. */
function storeIn(vault: SecretVault, key: SecretKey, value: string): boolean {
  try {
    vault.set(key, value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Storing `value` as `key` starts no profile receiving another value: every
 * one of `profiles` that injects it passes that value already. No profile
 * passes PROXY_PASSWORD in its env: an env var of that name is not the proxy's
 * password.
 */
function safeToStoreFor(profiles: readonly Profile[], key: SecretKey, value: string): boolean {
  return profiles.every((p) => !refsOf(p).includes(key) || (!SECRETS_NOT_IN_ENV.has(key) && envOf(p)[key] === value));
}

/** The profile injecting `key`, added to its secretRefs when it isn't there yet. */
function injecting(profile: Profile, key: SecretKey): Profile {
  const refs = refsOf(profile);
  return refs.includes(key) ? profile : { ...profile, secretRefs: [...refs, key] };
}

/** The env var gone, and the secret of the same name injected in its place. */
function injectedInsteadOfEnv(profile: Profile, key: SecretKey): Profile {
  const env = { ...envOf(profile) } as Record<string, string>;
  delete env[key];
  const refs = refsOf(profile);
  return { ...profile, env, secretRefs: refs.includes(key) ? refs : [...refs, key] };
}

/**
 * Moves the secret values profiles hold in plain text into the Keychain, when
 * they are loaded (listed, imported, or about to start: `only` names the one
 * profile to move). What a profile's launch passes to the server stays the
 * same, except for the secret parts of settings (below): the cloud key is
 * passed from now on, and a different value already stored can win over the
 * profile's own.
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
 * - A secret part of a setting, `cloud.apiKey` (to CLOUD_KEY), or the proxy's
 *   password, `proxy.auth.password` or the one in a proxy written as one
 *   address (to PROXY_PASSWORD), moves and the profile injects it: the launch
 *   passes the cloud key as CLOUD_KEY, which Xenon reads (it never read
 *   `cloud.apiKey`), and the proxy password inside the proxy's address
 *   (LaunchBuilder). It moves into an empty slot, or when the Keychain holds
 *   the same value or one the profile injects already. A different value
 *   stored wins (the profile's is dropped and it injects the stored one) only
 *   when no other profile injects that secret (safeToStore); otherwise the
 *   profile keeps its own. An empty one is removed.
 *
 * Every profile's env vars go before any setting, so a value that was never
 * used can't take a slot ahead of one in use. A value is stored only into an
 * empty slot, and only when no profile would start receiving it: every profile
 * that injects that secret must already pass the same value. A stored value
 * that can't be read is never overwritten, and with the Keychain unavailable
 * everything stays where it is. Only a secret's own name moves: an older name
 * Xenon also reads (OPENAI_API_KEY) would reach the server under another name,
 * and an env var named PROXY_PASSWORD, which no one reads, would become the
 * proxy's password. Profiles are never mutated; an unchanged one is returned
 * as given. A save follows other rules (moveSecretsOnSave).
 */
export function moveSecretsToKeychain(
  input: Profile[],
  vault: SecretVault,
  opts: { only?: string } = {}
): { profiles: Profile[]; changed: boolean } {
  const profiles = [...input];
  let changed = false;
  const moving = (p: Profile): boolean => opts.only === undefined || (isRecord(p) && p.id === opts.only);

  // Secrets are app-wide, and a profile injecting one that isn't stored gets
  // nothing (or its env var).
  const safeToStore = (key: SecretKey, value: string): boolean => safeToStoreFor(profiles, key, value);
  const store = (key: SecretKey, value: string): boolean => storeIn(vault, key, value);

  // The env vars first: they were in use, so they decide what a slot holds.
  for (let i = 0; i < profiles.length; i++) {
    if (!moving(profiles[i])) continue;
    for (const [name, value] of Object.entries(envOf(profiles[i]))) {
      if (!isSecretKey(name) || SECRETS_NOT_IN_ENV.has(name) || typeof value !== 'string' || value === '') continue;
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
    if (!moving(profiles[i])) continue;
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

  for (let i = 0; i < profiles.length; i++) {
    if (!moving(profiles[i])) continue;
    for (const part of SECRET_PARTS) {
      const value = part.read(settingsOf(profiles[i]));
      if (value === undefined) continue;
      const { key } = part;
      if (typeof value === 'string' && value !== '') {
        const slot = slotOf(vault, key);
        if (slot.kind === 'unreadable') continue;
        const moved =
          slot.kind === 'value'
            ? slot.value === value || refsOf(profiles[i]).includes(key) || safeToStore(key, value)
            : safeToStore(key, value) && store(key, value);
        if (!moved) continue;
        profiles[i] = injecting(withoutPart(profiles[i], part), key);
      } else if (value !== null && value !== '') {
        continue; // not a string, so not a value the Keychain could hold
      } else {
        profiles[i] = withoutPart(profiles[i], part);
      }
      changed = true;
    }
  }
  return { profiles, changed };
}

/**
 * The profile being saved, with its secret values moved into the Keychain. The
 * window saves while someone types, and what a save carries is their newest
 * word, so the rules differ from loading (moveSecretsToKeychain). Only this
 * profile changes; `others` are the rest, for what they inject.
 *
 * - An env var named like a secret is only taken out when the Keychain holds
 *   that very value or the profile's injected secret overrides it. No new value
 *   is stored: it would keep the first letters typed. The next load or start
 *   moves it.
 * - A secret-bearing setting (an AI key, the Database URL) moves as on load:
 *   no form edits one, so a save carries one only from an older copy.
 * - A secret part (the cloud key, the proxy password) moves into an empty slot
 *   or one holding the same value, and the profile injects it. A different
 *   value stored is replaced, the person having typed a new one, unless another
 *   profile injects that secret: then this profile keeps its own value and no
 *   longer injects the secret, so its launch passes its own value (LaunchBuilder).
 *   So does a value the Keychain can't take or a stored value it can't read.
 *
 * The profile is never mutated; an unchanged one is returned as given.
 */
export function moveSecretsOnSave(input: Profile, others: readonly Profile[], vault: SecretVault): Profile {
  let profile = input;
  const store = (key: SecretKey, value: string): boolean => storeIn(vault, key, value);

  for (const [name, value] of Object.entries(envOf(profile))) {
    if (!isSecretKey(name) || SECRETS_NOT_IN_ENV.has(name) || typeof value !== 'string' || value === '') continue;
    const slot = slotOf(vault, name);
    if (slot.kind === 'value' && (slot.value === value || refsOf(profile).includes(name))) {
      profile = injectedInsteadOfEnv(profile, name);
    }
  }

  for (const [setting, key] of Object.entries(SECRET_SETTINGS)) {
    const settings = settingsOf(profile);
    if (!Object.prototype.hasOwnProperty.call(settings, setting)) continue;
    const value = settings[setting];
    if (typeof value === 'string' && value !== '') {
      const slot = slotOf(vault, key);
      const kept =
        slot.kind === 'value' ||
        (slot.kind === 'empty' && safeToStoreFor([profile, ...others], key, value) && store(key, value));
      if (!kept) continue;
    } else if (value !== undefined && value !== null && value !== '') {
      continue; // not a string, so not a value the Keychain could hold
    }
    profile = withoutSetting(profile, setting);
  }

  for (const part of SECRET_PARTS) {
    const value = part.read(settingsOf(profile));
    if (value === undefined) continue;
    const { key } = part;
    if (typeof value === 'string' && value !== '') {
      const slot = slotOf(vault, key);
      const othersInject = others.some((p) => refsOf(p).includes(key));
      const moved =
        slot.kind === 'value'
          ? slot.value === value || (!othersInject && store(key, value))
          : slot.kind === 'empty' && safeToStoreFor(others, key, value) && store(key, value);
      profile = moved ? injecting(withoutPart(profile, part), key) : notInjecting(profile, key);
    } else if (value === null || value === '') {
      profile = withoutPart(profile, part);
    }
  }
  return profile;
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
// The `user:pass@` after any `scheme://` in a text, up to the next `/`, `?`, `#` or `@`, so an `@` in a
// path or query (https://medium.com/@user, ?email=a@b) is not taken for one. Global: it cleans every
// address in a value (a list, a flag, a quoted address). Only the `://` is matched, after a character a
// scheme can hold: a scheme pattern tried from every position makes this quadratic on a long value, and
// a profile can be imported from anywhere.
const ADDRESS_USERINFO = /(?<=[a-z0-9+.-])(:\/\/)[^\s"'/?#@]*@/gi;
// A `scheme://` that follows a character a scheme can hold.
const SCHEME_SEPARATOR = /(?<=[a-z0-9+.-]):\/\//i;

/** The address when it has a user name or password in it, whatever its scheme; `null` when the parser rejects it. */
function parseAddress(value: string): URL | null {
  try {
    return new URL(value.trim());
  } catch {
    return null;
  }
}

const hasCredentials = (url: URL | null): boolean => url !== null && (url.username !== '' || url.password !== '');

/**
 * For text the parser rejects (a raw `/`, `?` or `#` in a password, a host list):
 * in each run of text without spaces or quotes, everything between the first
 * `scheme://` and the last `@`. A run is cut once, so this stays linear.
 */
function cutToLastAt(value: string): string {
  return value.replace(/[^\s"']+/g, (run) => {
    const at = run.lastIndexOf('@');
    if (at < 0) return run;
    const separator = run.slice(0, at).search(SCHEME_SEPARATOR);
    return separator < 0 ? run : run.slice(0, separator + 3) + run.slice(at + 1);
  });
}

/**
 * An address without its `user:pass@`, so a proxy URL such as HTTPS_PROXY keeps
 * its host: any URL the parser reads a user name or password from (http, socks,
 * redis, postgres, smtp...), a proxy given as `user:pass@host:port`, and every
 * `scheme://user:pass@` in the text, so a value that holds several addresses, a
 * quoted one or a flag such as -Dhttp.proxy=... is cleaned too. Text the parser
 * rejects (a host list, a slash in the password) is cut up to its last `@`.
 * Any other value is returned as it is: a list (NO_PROXY), an address with no
 * credentials (an `@` in its path or query stays), and text with no address in it.
 */
export function stripUrlCredentials(value: string): string {
  const url = parseAddress(value);
  let cut: string;
  if (url !== null && hasCredentials(url)) {
    // Cut the credentials out of the text so the rest stays as written (the parser
    // would add a slash, lowercase the host and so on); an odd spelling it can't
    // cut falls back to the parsed address.
    cut = value.replace(USERINFO, '$1');
    if (hasCredentials(parseAddress(cut))) {
      url.username = '';
      url.password = '';
      cut = url.href;
    }
  } else {
    cut = value.replace(SCHEMELESS_USERINFO, '$1');
    if (url === null) cut = cutToLastAt(cut);
  }
  return cut.replace(ADDRESS_USERINFO, '$1');
}

/** The object without `key`; the same object when it has none. */
function without(obj: Record<string, unknown>, key: string): Record<string, unknown> {
  if (!Object.prototype.hasOwnProperty.call(obj, key)) return obj;
  const copy = { ...obj };
  delete copy[key];
  return copy;
}

/** The object with each of `keys` that holds text cut down to its address without `user:pass@`; the same object when none changes. */
function withoutCredentialsIn(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  let copy = obj;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value !== 'string') continue;
    const stripped = stripUrlCredentials(value);
    if (stripped === value) continue;
    if (copy === obj) copy = { ...obj };
    copy[key] = stripped;
  }
  return copy;
}

/** True when a removed setting held something: an empty string, null or nothing is not a value that was left out. */
const heldValue = (v: unknown): boolean => v !== undefined && v !== null && v !== '';

/**
 * The profile as it is exported, with no secret value, and the names of what
 * was left out so whoever imports it knows what to enter again:
 *
 * - no secret-bearing setting, no `cloud.apiKey`, no `proxy.auth.password`,
 *   and a proxy written as one address without its credentials. Those that
 *   held a value are listed under `strippedSettings` by their dotted path
 *   (`geminiApiKey`, `cloud.apiKey`, `proxy.auth.password`, `proxy`), sorted;
 * - no env var named like a secret (see isSecretLikeEnvName), listed under
 *   `strippedEnv`, sorted;
 * - an env var holding an address keeps it without its `user:pass@`. It is not
 *   listed, since the address itself is still there. The same goes for the
 *   address settings (`hub`, `aiBaseUrl`, `cloud.url`, `cloud.apiUrl`), which
 *   are typed text that can carry a user name and password.
 */
export function exportableProfile(profile: Profile): {
  profile: Profile;
  strippedEnv: string[];
  strippedSettings: string[];
} {
  const settings = withoutCredentialsIn({ ...settingsOf(profile) }, ['hub', 'aiBaseUrl']);
  const strippedSettings: string[] = [];
  const leave = (path: string, value: unknown) => {
    if (heldValue(value)) strippedSettings.push(path);
  };
  for (const setting of Object.keys(SECRET_SETTINGS)) {
    leave(setting, settings[setting]);
    delete settings[setting];
  }
  const { cloud, proxy } = settings;
  if (isRecord(cloud)) {
    leave('cloud.apiKey', cloud.apiKey);
    settings.cloud = withoutCredentialsIn(without(cloud, 'apiKey'), ['url', 'apiUrl']);
  }
  if (isRecord(proxy) && isRecord(proxy.auth)) {
    leave('proxy.auth.password', proxy.auth.password);
    settings.proxy = { ...proxy, auth: without(proxy.auth, 'password') };
  }
  if (typeof proxy === 'string') {
    // A proxy written as one address: its password was left out, not only its address's credentials.
    leave('proxy', proxyStringCredentials(proxy)?.password);
    settings.proxy = stripUrlCredentials(proxy);
  }

  // An imported profile's value can be anything; only text can hold an address.
  const kept: [string, unknown][] = [];
  const strippedEnv: string[] = [];
  for (const [name, value] of Object.entries(envOf(profile))) {
    if (isSecretLikeEnvName(name)) strippedEnv.push(name);
    else kept.push([name, typeof value === 'string' ? stripUrlCredentials(value) : value]);
  }
  const env = Object.fromEntries(kept) as Record<string, string>;
  return {
    profile: { ...profile, settings, env },
    strippedEnv: strippedEnv.sort(),
    strippedSettings: strippedSettings.sort()
  };
}

/**
 * A profile's export: the file's text and the names of what it left out (the
 * env vars and then the settings, as `exportableProfile` lists them). The file
 * names the secrets the profile injects (`secretRefs`) and carries none of
 * their values, and lists the env vars it left out under `strippedEnv` when
 * there were any (older versions ignore the key).
 */
export function profileExport(profile: Profile): { json: string; leftOut: string[] } {
  const { profile: exported, strippedEnv, strippedSettings } = exportableProfile(profile);
  const json = JSON.stringify(
    { type: 'xenon-control-profile', version: 1, profile: exported, ...(strippedEnv.length > 0 ? { strippedEnv } : {}) },
    null,
    2
  );
  return { json, leftOut: [...strippedEnv, ...strippedSettings] };
}

/** The file's text alone; see profileExport. */
export function profileExportJson(profile: Profile): string {
  return profileExport(profile).json;
}
