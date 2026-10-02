import { SelectorSort, SelectorTab } from '../../interfaces/IHealingEvent';

export const PERIODS = [7, 30, 90] as const;
export type PeriodDays = (typeof PERIODS)[number];

/** The selector open in the side panel. `strategy` is '' for a heal recorded with no strategy. */
export interface OpenSelector {
  strategy: string;
  selector: string;
}

/** Everything the page shows, held in the address so it can be bookmarked or shared. */
export interface SelectorHealthView {
  tab: SelectorTab;
  days: PeriodDays;
  q: string;
  platform: string;
  method: string;
  sort: SelectorSort;
  page: number;
  open: OpenSelector | null;
}

export const DEFAULT_VIEW: SelectorHealthView = {
  tab: 'fix',
  days: 30,
  q: '',
  platform: '',
  method: '',
  sort: 'heals',
  page: 1,
  open: null,
};

const TABS: readonly SelectorTab[] = ['fix', 'verifying', 'fixed', 'muted'];
const SORTS: readonly SelectorSort[] = ['heals', 'recent', 'time'];
/** The tab names links used before the redesign. */
const OLD_TABS: Record<string, SelectorTab> = {
  active: 'fix',
  pending: 'verifying',
  resolved: 'fixed',
  muted: 'muted',
};

const periodOf = (raw: string | null): PeriodDays =>
  PERIODS.find((d) => String(d) === raw) ?? DEFAULT_VIEW.days;

export function readView(params: URLSearchParams): SelectorHealthView {
  const tabRaw = params.get('tab') ?? '';
  const sortRaw = params.get('sort') ?? '';
  const page = Number(params.get('page'));
  const selector = params.get('selector');
  return {
    tab: TABS.find((t) => t === tabRaw) ?? OLD_TABS[tabRaw] ?? DEFAULT_VIEW.tab,
    days: periodOf(params.get('days')),
    q: params.get('q') ?? '',
    platform: params.get('platform') ?? '',
    method: params.get('method') ?? '',
    sort: SORTS.find((s) => s === sortRaw) ?? DEFAULT_VIEW.sort,
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    open: selector ? { strategy: params.get('strategy') ?? '', selector } : null,
  };
}

/** The address for `view`, leaving out what is the default. */
export function writeView(view: SelectorHealthView): URLSearchParams {
  const p = new URLSearchParams();
  if (view.tab !== DEFAULT_VIEW.tab) p.set('tab', view.tab);
  if (view.days !== DEFAULT_VIEW.days) p.set('days', String(view.days));
  if (view.q) p.set('q', view.q);
  if (view.platform) p.set('platform', view.platform);
  if (view.method) p.set('method', view.method);
  if (view.sort !== DEFAULT_VIEW.sort) p.set('sort', view.sort);
  if (view.page !== 1) p.set('page', String(view.page));
  if (view.open) {
    p.set('strategy', view.open.strategy);
    p.set('selector', view.open.selector);
  }
  return p;
}

/**
 * Where a link to the retired detail page (`/selector-health/detail?value=
 * &strategy=&windowDays=`) goes now: the panel, or a search for the selector
 * when the link named no strategy, since a selector is found by both.
 */
export function legacyDetailTarget(params: URLSearchParams): string {
  const value = params.get('value') ?? '';
  const strategy = params.get('strategy');
  const days = periodOf(params.get('windowDays'));
  const view: SelectorHealthView = !value
    ? { ...DEFAULT_VIEW, days }
    : strategy !== null
      ? { ...DEFAULT_VIEW, days, open: { strategy, selector: value } }
      : { ...DEFAULT_VIEW, days, q: value };
  const qs = writeView(view).toString();
  return qs ? `/selector-health?${qs}` : '/selector-health';
}

/** One key per selector, the server's own: strategy and value. */
export const selectorKey = (s: OpenSelector): string => `${s.strategy}\u0000${s.selector}`;

/**
 * Where the note about fixed selectors that broke again leads: "To fix", in
 * the period and order already chosen, with no search or filter that could
 * hide them, and the selector open when there is only one.
 */
export function brokeAgainView(selectors: OpenSelector[]): Partial<SelectorHealthView> {
  const keys = new Set(selectors.map(selectorKey));
  return {
    tab: 'fix',
    q: '',
    platform: '',
    method: '',
    page: 1,
    open: keys.size === 1 ? selectors[0] : null,
  };
}
