import React, { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { EmptyState } from '../ui/EmptyState';
import { Input } from '../ui/input';
import { Select } from '../ui/select';
import { Button } from '../ui/button';
import {
  ISelectorListItem,
  ISelectorListResponse,
  SelectorSort,
  SelectorTab,
} from '../../interfaces/IHealingEvent';
import { OpenSelector, SelectorHealthView, selectorKey } from './view-state';
import {
  METHODS,
  METHOD_EXPLANATIONS,
  PLATFORMS,
  SORT_LABELS,
  TAB_LABELS,
  formatDate,
  formatRelative,
  personText,
  shareText,
} from './format';
import { Chip, SelectorText } from './selector-bits';

export const SEARCH_DELAY_MS = 300;

const TABS: SelectorTab[] = ['fix', 'verifying', 'fixed', 'muted'];
const SORTS: SelectorSort[] = ['heals', 'recent', 'time'];

interface Props {
  view: SelectorHealthView;
  data: ISelectorListResponse | null;
  loading: boolean;
  /** The side panel is open: keep the columns that fit beside it. */
  compact: boolean;
  selectedKey: string | null;
  onView: (patch: Partial<SelectorHealthView>) => void;
  onOpen: (s: OpenSelector) => void;
  /** The last request failed. */
  error?: boolean;
}

interface Column {
  key: string;
  label: string;
  /** A CSS width; the selector column takes what is left. */
  width?: string;
  cell: (it: ISelectorListItem) => React.ReactNode;
}

const muted = (text: string) => <span className="text-xs text-[var(--text-muted)]">{text}</span>;

function columns(tab: SelectorTab, compact: boolean, days: number): Column[] {
  const selector: Column = {
    key: 'selector',
    label: 'Selector',
    cell: (it) => (
      <SelectorText
        strategy={it.strategy}
        text={it.selector}
        extra={
          tab === 'fix' && it.state && it.state.brokeAgain > 0 ? (
            <Chip tone="warning">Broke again</Chip>
          ) : null
        }
      />
    ),
  };
  const heals = (label: string): Column => ({
    key: 'heals',
    label,
    width: '96px',
    cell: (it) => (
      <div>
        <div className="font-semibold tabular-nums text-[var(--text)]">
          {it.heals.toLocaleString()}
        </div>
        <div className="text-[11px] text-[var(--text-muted)]">
          {it.sessions} {it.sessions === 1 ? 'session' : 'sessions'}
        </div>
      </div>
    ),
  });
  const last: Column = {
    key: 'last',
    label: 'Last healed',
    width: '104px',
    cell: (it) => muted(formatRelative(it.lastHealedAt)),
  };
  switch (tab) {
    case 'fix':
      return compact
        ? [selector, heals('Heals'), last]
        : [
            selector,
            heals('Heals'),
            last,
            {
              key: 'method',
              label: 'Healed by',
              width: '112px',
              cell: (it) =>
                it.topMethod ? (
                  <Chip title={METHOD_EXPLANATIONS[it.topMethod]}>{it.topMethod}</Chip>
                ) : (
                  muted('—')
                ),
            },
            {
              key: 'fix',
              label: 'Suggested fix',
              width: '34%',
              cell: (it) =>
                it.suggestion ? (
                  <SelectorText
                    strategy={it.suggestion.strategy}
                    text={it.suggestion.selector}
                    extra={
                      <span className="text-[10px] text-[var(--text-muted)]">
                        {shareText(it.suggestion.share)}
                      </span>
                    }
                  />
                ) : (
                  muted('None yet')
                ),
            },
          ];
    case 'verifying': {
      const progress: Column = {
        key: 'progress',
        label: 'Progress',
        width: '150px',
        cell: (it) => (
          <span className="text-xs text-[var(--text)]">
            {it.state?.cleanBuilds ?? 0} of 3 clean builds
          </span>
        ),
      };
      return compact
        ? [selector, progress]
        : [
            selector,
            progress,
            {
              key: 'marked',
              label: 'Marked fixed',
              width: '180px',
              cell: (it) =>
                muted(
                  `${formatRelative(it.state?.fixedAt ?? null)}${personText(it.state?.fixedBy ?? null)}`,
                ),
            },
            heals(`Heals, ${days} days`),
          ];
    }
    case 'fixed': {
      const verified: Column = {
        key: 'verified',
        label: 'Verified',
        width: '140px',
        cell: (it) => muted(formatDate(it.state?.resolvedAt ?? null)),
      };
      return compact ? [selector, verified] : [selector, verified, heals(`Heals, ${days} days`)];
    }
    case 'muted': {
      const when: Column = {
        key: 'muted',
        label: 'Muted',
        width: '180px',
        cell: (it) =>
          muted(`${formatDate(it.state?.mutedAt ?? null)}${personText(it.state?.mutedBy ?? null)}`),
      };
      return compact
        ? [selector, when]
        : [
            selector,
            when,
            {
              key: 'reason',
              label: 'Reason',
              width: '26%',
              cell: (it) =>
                it.state?.muteReason ? (
                  <span className="line-clamp-2 text-xs text-[var(--text)]">
                    {it.state.muteReason}
                  </span>
                ) : (
                  muted('No reason given')
                ),
            },
            heals(`Heals, ${days} days`),
          ];
    }
  }
}

function emptyText(
  tab: SelectorTab,
  q: string,
  days: number,
): { title: string; description: string } {
  if (q)
    return { title: `No selectors match “${q}”`, description: 'Try fewer or different words.' };
  switch (tab) {
    case 'fix':
      return {
        title: `Nothing to fix in the last ${days} days`,
        description: 'Every selector your tests used was found without healing.',
      };
    case 'verifying':
      return {
        title: 'Nothing being verified',
        description: 'When you mark a selector fixed, Xenon watches its next 3 clean builds here.',
      };
    case 'fixed':
      return {
        title: `Nothing fixed in the last ${days} days`,
        description: 'Selectors that pass 3 clean builds after being marked fixed show here.',
      };
    case 'muted':
      return {
        title: 'Nothing muted',
        description: 'A muted selector is left out of this list, the CI gate and the digest.',
      };
  }
}

/** The tabs, the search and filters, and one page of selectors. */
export const SelectorList: React.FC<Props> = ({
  view,
  data,
  loading,
  compact,
  selectedKey,
  onView,
  onOpen,
  error,
}) => {
  const [q, setQ] = useState(view.q);
  useEffect(() => setQ(view.q), [view.q]);
  useEffect(() => {
    if (q === view.q) return undefined;
    const id = setTimeout(() => onView({ q, page: 1 }), SEARCH_DELAY_MS);
    return () => clearTimeout(id);
  }, [q, view.q, onView]);

  const cols = columns(view.tab, compact, view.days);
  // Rows only under their own tab's columns: after a tab switch the previous
  // tab's answer stays in hand until the new one arrives.
  const current = data && data.tab === view.tab ? data : null;
  const items = current?.items ?? [];
  const total = current?.total ?? 0;
  const page = current?.page ?? view.page;
  const size = current?.pageSize ?? 50;
  const lastPage = Math.max(1, Math.ceil(total / size));
  const from = total === 0 ? 0 : (page - 1) * size + 1;
  const to = Math.min(total, page * size);
  const empty = emptyText(view.tab, view.q, view.days);

  return (
    <section
      aria-label="Selectors"
      className="rounded-lg border border-[var(--border)] bg-[var(--surface)]"
    >
      <div
        role="tablist"
        aria-label="Selector status"
        className="flex gap-1 border-b border-[var(--border)] px-3"
      >
        {TABS.map((t) => {
          const active = view.tab === t;
          const count = data?.counts?.[t];
          return (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                if (!active) onView({ tab: t, page: 1 });
              }}
              className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm ${
                active
                  ? 'border-[var(--color-accent)] font-medium text-[var(--text)]'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              {TAB_LABELS[t]}
              <span className="rounded-full bg-[rgb(var(--rgb-fg)/0.08)] px-1.5 text-[11px] tabular-nums">
                {typeof count === 'number' ? count.toLocaleString() : '–'}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-3 py-2.5">
        <div className="relative min-w-[220px] flex-1">
          <Search
            size={14}
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-dim)]"
          />
          <Input
            type="search"
            aria-label="Search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={view.tab === 'fix' ? 'Search selectors and fixes' : 'Search selectors'}
            className="h-8 w-full pl-8 pr-2 text-xs"
          />
        </div>
        {view.tab === 'fix' && (
          <>
            <Select
              selectSize="sm"
              className="!w-auto shrink-0"
              aria-label="Platform"
              value={view.platform}
              onChange={(e) => onView({ platform: e.target.value, page: 1 })}
            >
              <option value="">All platforms</option>
              {PLATFORMS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
            <Select
              selectSize="sm"
              className="!w-auto shrink-0"
              aria-label="Healing method"
              value={view.method}
              onChange={(e) => onView({ method: e.target.value, page: 1 })}
            >
              <option value="">All healing methods</option>
              {METHODS.map((m) => (
                <option key={m} value={m} title={METHOD_EXPLANATIONS[m]}>
                  {m}
                </option>
              ))}
            </Select>
            <Select
              selectSize="sm"
              className="!w-auto shrink-0"
              aria-label="Sort"
              value={view.sort}
              onChange={(e) => onView({ sort: e.target.value as SelectorSort, page: 1 })}
            >
              {SORTS.map((s) => (
                <option key={s} value={s}>
                  {SORT_LABELS[s]}
                </option>
              ))}
            </Select>
          </>
        )}
      </div>

      {!current ? (
        <div className="px-4 py-10 text-center text-xs text-[var(--text-dim)]">
          {error && !loading
            ? "Couldn't load selectors. Try again in a moment."
            : 'Loading selectors…'}
        </div>
      ) : items.length === 0 ? (
        <EmptyState title={empty.title} description={empty.description} />
      ) : (
        <table className="w-full table-fixed text-left">
          <colgroup>
            {cols.map((c) => (
              <col key={c.key} style={c.width ? { width: c.width } : undefined} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {cols.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className="px-3 py-2 text-[11px] font-medium text-[var(--text-muted)]"
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const key = selectorKey(it);
              const selected = key === selectedKey;
              const open = () => onOpen({ strategy: it.strategy, selector: it.selector });
              return (
                <tr
                  key={key}
                  tabIndex={0}
                  data-selector-row=""
                  data-key={key}
                  aria-current={selected ? 'true' : undefined}
                  onClick={open}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      open();
                    }
                  }}
                  className={`cursor-pointer border-t border-[var(--border)] align-top outline-none hover:bg-[rgb(var(--rgb-fg)/0.03)] focus-visible:bg-[rgb(var(--rgb-fg)/0.05)] ${
                    selected ? 'bg-[rgb(var(--rgb-fg)/0.06)]' : ''
                  }`}
                >
                  {cols.map((c) => (
                    <td key={c.key} className="px-3 py-2.5 text-xs">
                      {c.cell(it)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {total > 0 && (
        <div className="flex items-center justify-between border-t border-[var(--border)] px-3 py-2 text-xs text-[var(--text-muted)]">
          <span className="tabular-nums">
            {from}–{to} of {total.toLocaleString()}
          </span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => onView({ page: page - 1 })}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= lastPage}
              onClick={() => onView({ page: page + 1 })}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </section>
  );
};
