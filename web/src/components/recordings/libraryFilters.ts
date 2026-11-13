import type { LibraryQuery, PhoneFacet } from '../../api-service/recordings';
import { phoneKey, serverLabel } from '../../lib/phone';

export type WhenFilter = 'any' | '24h' | '7d' | '30d';

/** The library's filters, as the link carries them ('' = any). */
export interface LibraryFilters {
  /** The phone's udid. */
  phone: string;
  /** With `phone`, its server, for a udid two servers have ('' = not needed). */
  host: string;
  by: string;
  when: WhenFilter;
  q: string;
}

export const NO_LIBRARY_FILTERS: LibraryFilters = {
  phone: '',
  host: '',
  by: '',
  when: 'any',
  q: '',
};

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
    host: params.get('host') ?? '',
    by: params.get('by') ?? '',
    when: when && WHENS.includes(when) ? when : 'any',
    q: params.get('q') ?? '',
  };
}

export function libraryFiltersToParams(f: LibraryFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.phone) p.set('phone', f.phone);
  if (f.phone && f.host) p.set('host', f.host);
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
    host: (f.phone && f.host) || undefined,
    startedBy: f.by || undefined,
    since: f.when === 'any' ? undefined : new Date(now - WHEN_MS[f.when]).toISOString(),
    q: f.q.trim() || undefined,
  };
}

/** A phone facet's value in the Phone menu: its udid, or its key when it has a host. */
export function phoneFacetValue(p: Pick<PhoneFacet, 'udid' | 'host'>): string {
  return p.host ? phoneKey({ udid: p.udid, host: p.host }) : p.udid;
}

/**
 * A phone facet's label in the Phone menu. A facet with a host is one of two
 * servers' phones of a udid; the answer names it `<name> (<host>)`, and the
 * menu says `<name> on <server>` (serverLabel) instead. The answer's `name`
 * is left as it is.
 */
export function phoneFacetLabel(p: Pick<PhoneFacet, 'udid' | 'host' | 'name'>): string {
  if (!p.host) return p.name;
  const suffix = ` (${p.host})`;
  const name = p.name.endsWith(suffix) ? p.name.slice(0, -suffix.length) : p.name;
  return `${name} on ${serverLabel(p.host)}`;
}

/** The Phone menu's value for the filters. */
export function phoneChoiceOf(f: LibraryFilters): string {
  return phoneFacetValue({ udid: f.phone, host: f.host || undefined });
}

/** The filters with the phone the menu's `value` names, its host included. */
export function withPhoneChoice(
  f: LibraryFilters,
  value: string,
  phones: PhoneFacet[],
): LibraryFilters {
  const facet = phones.find((p) => phoneFacetValue(p) === value);
  return { ...f, phone: facet?.udid ?? value, host: facet?.host ?? '' };
}
