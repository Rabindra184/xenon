import type { LibraryFilter } from '../../services/recording/recordingSummary';
import { readHostParam } from '../../middleware/controlDevice';

const DEFAULT_LIBRARY_LIMIT = 50;
const MAX_LIBRARY_LIMIT = 200;

/** Pure request parsing for the recordings router, kept testable without Express. */
export function parseClearBody(
  body: unknown,
): { ok: true; timecodeMs: number } | { ok: false; error: string } {
  const t = (body as { timecodeMs?: unknown } | null | undefined)?.timecodeMs;
  if (typeof t !== 'number' || !Number.isFinite(t) || t < 0) {
    return { ok: false, error: 'timecodeMs must be a finite number >= 0' };
  }
  return { ok: true, timecodeMs: Math.round(t) };
}

/** A phone a recording request names: its udid, and its host when given. */
export interface PhoneEntry {
  udid: string;
  host?: string;
}

/**
 * POST /recordings's `udids`: a non-empty array whose entries are each a udid
 * (a non-empty string) or `{ udid, host? }`. A udid alone names the one phone
 * of that udid the caller can see; a host names the phone filed under it (an
 * emulator's udid repeats across servers). Shape only: which phone each names
 * is the route's question. `invalid_host` for a host that isn't a non-empty
 * string, as /control answers `?host=`.
 */
export function parsePhoneEntries(value: unknown): PhoneEntry[] | { error: string } {
  if (!Array.isArray(value) || value.length === 0) {
    return { error: 'udids must be a non-empty array' };
  }
  const out: PhoneEntry[] = [];
  for (const entry of value) {
    if (typeof entry === 'string' && entry.length > 0) {
      out.push({ udid: entry });
      continue;
    }
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return { error: 'every udid must be a non-empty string' };
    }
    const { udid, host: named } = entry as { udid?: unknown; host?: unknown };
    if (typeof udid !== 'string' || udid.length === 0) {
      return { error: 'every udid must be a non-empty string' };
    }
    const host = readHostParam(named);
    if (host === null) return { error: 'invalid_host' };
    out.push(host === undefined ? { udid } : { udid, host });
  }
  return out;
}

/** GET /recordings's query: filters, a bounded page size and the cursor. */
export function parseLibraryQuery(
  q: Record<string, unknown>,
):
  | { ok: true; limit: number; cursor?: string; filter: LibraryFilter }
  | { ok: false; error: string } {
  const str = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);
  let limit = DEFAULT_LIBRARY_LIMIT;
  if (q.limit !== undefined) {
    const n = Number(q.limit);
    if (!Number.isInteger(n) || n < 1)
      return { ok: false, error: 'limit must be a whole number from 1' };
    limit = Math.min(n, MAX_LIBRARY_LIMIT);
  }
  let since: number | undefined;
  const s = str(q.since);
  if (s !== undefined) {
    since = Date.parse(s);
    if (!Number.isFinite(since)) return { ok: false, error: 'since must be an ISO time' };
  }
  const filter: LibraryFilter = {};
  if (str(q.udid)) filter.udid = str(q.udid);
  if (str(q.startedBy)) filter.startedBy = str(q.startedBy);
  if (since !== undefined) filter.since = since;
  if (str(q.q)) filter.q = str(q.q);
  if (str(q.sessionId)) filter.sessionId = str(q.sessionId);
  const out: { ok: true; limit: number; cursor?: string; filter: LibraryFilter } = {
    ok: true,
    limit,
    filter,
  };
  if (str(q.cursor)) out.cursor = str(q.cursor);
  return out;
}
