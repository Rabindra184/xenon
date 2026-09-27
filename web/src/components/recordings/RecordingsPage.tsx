import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Film, RefreshCw } from 'lucide-react';
import { PageHeader } from '../ui/page-header';
import { Table, TBody, TD, TH, THead, TR } from '../ui/Table';
import { Button } from '../ui/button';
import { EmptyState } from '../ui/EmptyState';
import { Input } from '../ui/input';
import { FilterMenu } from '../device-explorer/FilterMenu';
import {
  listRecordings,
  type LibraryResponse,
  type RecordingSummary,
} from '../../api-service/recordings';
import { formatClock } from './playback';
import { formatWhen } from './recordingFormat';
import {
  isLibraryFiltered,
  libraryFiltersToParams,
  libraryQuery,
  NO_LIBRARY_FILTERS,
  parseLibraryFilters,
  WHEN_LABEL,
  type LibraryFilters,
  type WhenFilter,
} from './libraryFilters';
import './recordings.css';

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 250;

/** "Galaxy S9+, iPhone 17 +1", with every name for the tooltip. */
export function phoneNames(s: RecordingSummary): { text: string; title: string } {
  const names = s.phones.map((p) => p.name);
  return {
    text:
      names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', '),
    title: names.join('\n'),
  };
}

const hrefFor = (s: RecordingSummary) =>
  s.status === 'recording' ? '/devices/live' : `/recordings/${encodeURIComponent(s.groupId)}`;

export default function RecordingsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const filters = parseLibraryFilters(params);
  const queryKey = libraryFiltersToParams(filters).toString();
  const [data, setData] = React.useState<LibraryResponse | null>(null);
  // The filters `data` was fetched for. Until a new filter's first page
  // arrives, `data.nextCursor` belongs to the old one and must not be sent.
  const [dataKey, setDataKey] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<RecordingSummary[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [reloadKey, setReloadKey] = React.useState(0);
  // Generation counter: bumped on every fetch effect run, so a stale
  // response (older filter, or a Load-more that lost a race with a newer
  // first page) can be told apart from the latest one.
  const request = React.useRef(0);
  // Flips false in the fetch effect's cleanup and stays false only when that
  // cleanup ran because the component unmounted (a dep change immediately
  // flips it back true at the top of the next effect run).
  const mounted = React.useRef(true);

  const write = (next: LibraryFilters) =>
    setParams(libraryFiltersToParams(next), { replace: true });

  React.useEffect(() => {
    mounted.current = true;
    const id = ++request.current;
    const t = window.setTimeout(() => {
      listRecordings({ ...libraryQuery(filters, Date.now()), limit: PAGE_SIZE })
        .then((res) => {
          if (!mounted.current || id !== request.current) return;
          setData(res);
          setRows(res.recordings);
          setError(null);
          setDataKey(queryKey);
        })
        .catch((e) => {
          if (!mounted.current || id !== request.current) return;
          setError(e instanceof Error ? e.message : String(e));
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(t);
      mounted.current = false;
    };
    // queryKey is the filters; reloadKey is Retry.
  }, [queryKey, reloadKey]);

  const nextCursor = dataKey === queryKey ? (data?.nextCursor ?? null) : null;

  const loadMore = async () => {
    if (!nextCursor) return;
    const id = request.current;
    setLoadingMore(true);
    try {
      const res = await listRecordings({
        ...libraryQuery(filters, Date.now()),
        limit: PAGE_SIZE,
        cursor: nextCursor,
      });
      if (!mounted.current || id !== request.current) return;
      setData(res);
      setRows((prev) => prev.concat(res.recordings));
    } catch (e) {
      if (!mounted.current || id !== request.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) setLoadingMore(false);
    }
  };

  const f = data?.facets;
  const phoneOptions = [
    { value: '', label: 'Any phone', count: f?.when.any ?? 0 },
    ...(f?.phones ?? []).map((p) => ({ value: p.udid, label: p.name, count: p.count })),
  ];
  const byOptions = [
    { value: '', label: 'Anyone', count: f?.when.any ?? 0 },
    ...(f?.people ?? []).map((p) => ({ value: p.id, label: p.name, count: p.count })),
    ...(f && f.unknownCount > 0
      ? [{ value: 'unknown', label: 'Unknown', count: f.unknownCount }]
      : []),
  ];
  const whenOptions = (['any', '24h', '7d', '30d'] as WhenFilter[]).map((w) => ({
    value: w,
    label: WHEN_LABEL[w],
    count: f?.when[w] ?? 0,
  }));

  const total = data?.total ?? 0;
  return (
    <div className="rec-page">
      <PageHeader
        icon={Film}
        title="Recordings"
        subtitle={data ? `${total} recording${total === 1 ? '' : 's'}` : undefined}
      />
      <div className="rec-toolbar">
        <Input
          type="text"
          className="rec-search"
          aria-label="Search recordings"
          placeholder="Search phones and bookmarks"
          value={filters.q}
          onChange={(e) => write({ ...filters, q: e.target.value })}
        />
        <FilterMenu
          name="Phone"
          value={filters.phone}
          anyValue=""
          options={phoneOptions}
          onChange={(v) => write({ ...filters, phone: v })}
        />
        <FilterMenu
          name="Recorded by"
          value={filters.by}
          anyValue=""
          options={byOptions}
          onChange={(v) => write({ ...filters, by: v })}
        />
        <FilterMenu<WhenFilter>
          name="When"
          value={filters.when}
          anyValue="any"
          options={whenOptions}
          onChange={(v) => write({ ...filters, when: v })}
        />
      </div>

      {error ? (
        <EmptyState
          title="Couldn't load recordings"
          description={error}
          action={
            <Button variant="secondary" onClick={() => setReloadKey((k) => k + 1)}>
              <RefreshCw size={14} aria-hidden="true" />
              Retry
            </Button>
          }
        />
      ) : !data ? (
        <EmptyState title="Loading recordings…" />
      ) : rows.length === 0 ? (
        isLibraryFiltered(filters) ? (
          <EmptyState
            title="No recordings match"
            action={
              <Button variant="secondary" onClick={() => write(NO_LIBRARY_FILTERS)}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            title="No recordings yet"
            description="Record phones from Live devices."
            action={
              <Link className="rec-link" to="/devices/live">
                Open Live devices
              </Link>
            }
          />
        )
      ) : (
        <>
          <Table className="rec-table">
            <caption className="sr-only">Recordings, {rows.length} shown</caption>
            <THead>
              <TR>
                <TH scope="col">When</TH>
                <TH scope="col">Phones</TH>
                <TH scope="col">Length</TH>
                <TH scope="col">Recorded by</TH>
                <TH scope="col">Bookmarks</TH>
                <TH scope="col">Status</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((s) => {
                const phones = phoneNames(s);
                const href = hrefFor(s);
                return (
                  <TR
                    key={s.groupId}
                    className="rec-row"
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest('a')) return;
                      navigate(href);
                    }}
                  >
                    <TD>
                      <Link to={href} className="rec-link">
                        {formatWhen(s.startedAt)}
                      </Link>
                    </TD>
                    <TD title={phones.title}>{phones.text}</TD>
                    <TD className="rec-num">
                      {s.durationMs === null ? '—' : formatClock(s.durationMs)}
                    </TD>
                    <TD>{s.startedBy?.name ?? 'Unknown'}</TD>
                    <TD className="rec-num">{s.bookmarkCount}</TD>
                    <TD>
                      {s.status === 'recording'
                        ? 'Recording…'
                        : s.status === 'failed'
                          ? 'Failed'
                          : ''}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
          {nextCursor && (
            <div className="rec-more">
              <Button variant="secondary" onClick={loadMore} disabled={loadingMore}>
                Load more
              </Button>
            </div>
          )}
        </>
      )}
      {data && (
        <p className="rec-footnote">
          Recordings are kept for {data.retention.days} days, up to the newest{' '}
          {data.retention.maxCount}.
        </p>
      )}
    </div>
  );
}
