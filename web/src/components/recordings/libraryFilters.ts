import type { LibraryQuery } from '../../api-service/recordings';

export type WhenFilter = 'any' | '24h' | '7d' | '30d';

/** The library's filters, as the link carries them ('' = any). */
export interface LibraryFilters {
  phone: string;
  by: string;
  when: WhenFilter;
  q: string;
}

export const NO_LIBRARY_FILTERS: LibraryFilters = { phone: '', by: '', when: 'any', q: '' };

const WHENS: WhenFilter[] = ['any', '24h', '7d', '30d'];
const DAY = 86_400_000;
const WHEN_MS: Record<Exclude<WhenFilter, 'any'>, number> = {
  '24h': DAY,
  '7d': 7 * DAY,
  '30d': 30 * DAY,
};

export const WHEN_LABEL: Record<WhenFilter, string> = {
  any: 'Any time',
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
};

export function parseLibraryFilters(params: URLSearchParams): LibraryFilters {
  const when = params.get('when') as WhenFilter | null;
  return {
    phone: params.get('phone') ?? '',
    by: params.get('by') ?? '',
    when: when && WHENS.includes(when) ? when : 'any',
    q: params.get('q') ?? '',
  };
}

export function libraryFiltersToParams(f: LibraryFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.phone) p.set('phone', f.phone);
  if (f.by) p.set('by', f.by);
  if (f.when !== 'any') p.set('when', f.when);
  if (f.q.trim()) p.set('q', f.q);
  return p;
}

export function isLibraryFiltered(f: LibraryFilters): boolean {
  return !!(f.phone || f.by || f.when !== 'any' || f.q.trim());
}

export function libraryQuery(f: LibraryFilters, now: number): LibraryQuery {
  return {
    udid: f.phone || undefined,
    startedBy: f.by || undefined,
    since: f.when === 'any' ? undefined : new Date(now - WHEN_MS[f.when]).toISOString(),
    q: f.q.trim() || undefined,
  };
}
