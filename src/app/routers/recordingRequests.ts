import type { LibraryFilter } from '../../services/recording/recordingSummary';

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
  const out: { ok: true; limit: number; cursor?: string; filter: LibraryFilter } = {
    ok: true,
    limit,
    filter,
  };
  if (str(q.cursor)) out.cursor = str(q.cursor);
  return out;
}
