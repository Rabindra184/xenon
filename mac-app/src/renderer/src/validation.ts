import type { Profile, ValidationIssue, XenonSchema } from '@shared/types';
import { buildForm } from './schemaForm';
import { withStoredBounds } from './allSettings';
import { OPTIONS } from './copy/options';
import { SETTINGS } from './copy/settings';

// Client-side validation that mirrors the constraints in schema.json plus a few
// server-level rules. Blocking issues disable Start so a bad config never even
// reaches Appium's own validator.

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export type PortParseResult = { ok: true; value: number } | { ok: false; error: string };

/**
 * Parse the port input's draft text. Keeps NaN out of the profile: the field
 * commits only valid integers, and invalid drafts surface as an error instead.
 */
export function parsePort(text: string): PortParseResult {
  const t = text.trim();
  if (!t) return { ok: false, error: 'Port is required.' };
  const n = Number(t);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    return { ok: false, error: 'Port must be an integer between 1 and 65535.' };
  }
  return { ok: true, value: n };
}

const HUB_ORIGIN_MESSAGE = "Use only the hub's address, like http://hub-mac:4723, without /wd/hub or other paths.";

/** An http(s) address with no path, query, fragment, user name or password. */
function isHubOrigin(hub: string): boolean {
  // A URL parser drops a bare `?` or `#`, so look at the string, not `search` or `hash`.
  if (hub.includes('?') || hub.includes('#')) return false;
  try {
    const u = new URL(hub);
    // The hub is saved in the profile and exported, so credentials don't belong in it.
    return /^https?:$/.test(u.protocol) && u.pathname === '/' && u.username === '' && u.password === '';
  } catch {
    return false;
  }
}

/**
 * A user name or password before the host of an address (`https://user:key@hub.example`), or written
 * with no scheme (`user:key@hub.example`). An address the parser rejects counts when it has an `@`
 * after its scheme, as a key with a slash in it makes one.
 */
function hasCredentials(address: string): boolean {
  if (/^\s*[^\s:/?#@]*:[^\s/?#]*@[\w.-]+/.test(address)) return true;
  try {
    const u = new URL(address.trim());
    return u.username !== '' || u.password !== '';
  } catch {
    return /:\/\/\S*@/.test(address);
  }
}

/** The cloud provider's addresses a person can type a user name and key into, by their dotted path. */
const CLOUD_ADDRESSES = ['cloud.url', 'cloud.apiUrl'] as const;

export function validate(schema: XenonSchema, profile: Profile): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Server-level rules.
  const port = profile.server.port;
  if (!isNum(port) || !Number.isInteger(port) || port < 1 || port > 65535) {
    issues.push({ path: 'server.port', label: 'Port', message: 'Port must be an integer between 1 and 65535.' });
  }
  if (!profile.server.basePath.startsWith('/')) {
    issues.push({ path: 'server.basePath', label: 'Base path', message: "Base path must start with '/'." });
  }

  // Schema-derived numeric ranges, and the bounds All settings adds (I2), for values the user actually set.
  const fields = buildForm(schema).flatMap((s) => s.fields.map((f) => withStoredBounds(f)));
  const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));

  for (const [key, value] of Object.entries(profile.settings)) {
    const field = byKey[key];
    if (!field || value === undefined || value === null || value === '') continue;

    if (field.kind === 'number') {
      if (!isNum(value)) {
        issues.push({ path: key, label: field.label, message: 'Must be a number.' });
        continue;
      }
      if (field.min !== undefined && value < field.min) {
        issues.push({ path: key, label: field.label, message: `Must be ≥ ${field.min}.` });
      }
      if (field.max !== undefined && value > field.max) {
        issues.push({ path: key, label: field.label, message: `Must be ≤ ${field.max}.` });
      }
    }
  }

  // `hub` is the hub's address only (empty = standalone hub): the plugin adds its own paths.
  const hub = profile.settings.hub;
  if (typeof hub === 'string' && hub.trim() && !isHubOrigin(hub)) {
    issues.push({ path: 'hub', label: 'Hub', message: HUB_ORIGIN_MESSAGE });
  }

  // The cloud's addresses hold no user name or key (R55): Xenon builds its own from the cloud user
  // name and the profile's key in Keys & accounts, and a save cuts them out.
  const cloud = profile.settings.cloud;
  if (cloud !== null && typeof cloud === 'object' && !Array.isArray(cloud)) {
    for (const path of CLOUD_ADDRESSES) {
      const address = (cloud as Record<string, unknown>)[path.slice('cloud.'.length)];
      if (typeof address === 'string' && hasCredentials(address)) {
        issues.push({ path, label: OPTIONS.parts[path], message: SETTINGS.allSettings.cloudAddressCredentials });
      }
    }
  }

  return issues;
}
