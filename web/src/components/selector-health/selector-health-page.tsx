import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { HeartPulse, Send } from 'lucide-react';
import XenonApiService from '../../api-service';
import { PageHeader } from '../ui/page-header';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Button } from '../ui/button';
import { useToast } from '../ui/toast';
import { useSocket } from '../../hooks/useSocket';
import { useAuth } from '../../auth/auth-context';
import { IHealingSummaryResponse, ISelectorListResponse } from '../../interfaces/IHealingEvent';
import { RegressionBanner } from './regression-banner';
import { SummaryStrip } from './summary-strip';
import { TrendChart } from './trend-chart';
import { SelectorList } from './selector-list';
import { SelectorPanel } from './selector-panel';
import {
  OpenSelector,
  PERIODS,
  PeriodDays,
  SelectorHealthView,
  readView,
  selectorKey,
  writeView,
} from './view-state';

/** Live events arrive in bursts (one per heal): ask again at most once a second. */
export const LIVE_REFRESH_MS = 1000;

const LIVE_EVENTS = [
  'healing_event',
  'selector_fixed',
  'selector_resolved',
  'selector_regressed',
  'selector_cancelled',
  'selector_muted',
  'selector_unmuted',
  'selector_progress',
];

const isTyping = (el: Element | null): boolean =>
  !!el &&
  (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || (el as HTMLElement).isContentEditable);

const SelectorHealthPage: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const view = useMemo(() => readView(params), [params]);
  const tz = useMemo(() => -new Date().getTimezoneOffset(), []);
  const { on } = useSocket();
  const { toast } = useToast();
  const { me } = useAuth();
  const isAdmin = !!me && (me.role === 'ADMIN' || me.role === 'SUPER_ADMIN' || !!me.authDisabled);

  const [summary, setSummary] = useState<IHealingSummaryResponse | null>(null);
  const [list, setList] = useState<ISelectorListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sending, setSending] = useState(false);

  const setView = useCallback(
    (patch: Partial<SelectorHealthView>, replace = false) =>
      setParams(writeView({ ...readView(params), ...patch }), { replace }),
    [params, setParams],
  );

  useEffect(() => {
    let alive = true;
    XenonApiService.getHealingSummary(view.days, tz)
      .then((s: IHealingSummaryResponse) => {
        if (alive) setSummary(s ?? null);
      })
      .catch(() => {
        if (alive) setSummary(null);
      });
    return () => {
      alive = false;
    };
  }, [view.days, tz, refreshKey]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    XenonApiService.getHealingSelectors({
      tab: view.tab,
      days: view.days,
      q: view.q,
      platform: view.platform,
      method: view.method,
      sort: view.sort,
      page: view.page,
    })
      .then((r: ISelectorListResponse) => {
        if (alive) setList(r ?? null);
      })
      .catch(() => {
        if (alive) setList(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [view.tab, view.days, view.q, view.platform, view.method, view.sort, view.page, refreshKey]);

  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const bump = () => {
      if (pending.current) return;
      pending.current = setTimeout(() => {
        pending.current = null;
        setRefreshKey((k) => k + 1);
      }, LIVE_REFRESH_MS);
    };
    const unsubs = LIVE_EVENTS.map((e) => on(e, bump));
    return () => {
      unsubs.forEach((u) => u && u());
      if (pending.current) clearTimeout(pending.current);
      pending.current = null;
    };
  }, [on]);

  const open = useCallback((s: OpenSelector) => setView({ open: s }), [setView]);

  const close = useCallback(() => {
    const key = view.open ? selectorKey(view.open) : null;
    setView({ open: null });
    // Back to the row the panel was opened from.
    setTimeout(() => {
      const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-selector-row]'));
      rows.find((r) => r.dataset.key === key)?.focus();
    }, 0);
  }, [view.open, setView]);

  const move = useCallback(
    (dir: 1 | -1) => {
      const items = list?.items ?? [];
      if (items.length === 0) return;
      const at = view.open
        ? items.findIndex((it) => selectorKey(it) === selectorKey(view.open as OpenSelector))
        : -1;
      const next = items[at < 0 ? 0 : Math.min(items.length - 1, Math.max(0, at + dir))];
      setView({ open: { strategy: next.strategy, selector: next.selector } }, true);
    },
    [list, view.open, setView],
  );

  useEffect(() => {
    if (!view.open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        isTyping(document.activeElement) ||
        document.querySelector('[role="dialog"]')
      )
        return;
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        move(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        move(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view.open, close, move]);

  const sendDigest = async () => {
    setSending(true);
    try {
      const r = (await XenonApiService.sendHealingDigest({
        windowDays: view.days,
        limit: 5,
        minHealCount: 2,
      })) as {
        sent?: number;
      };
      const sent = r?.sent ?? 0;
      if (sent === 0) toast('No webhook gets the digest yet. Add one in Notifications.', 'error');
      else toast(`Digest sent to ${sent} webhook${sent === 1 ? '' : 's'}.`, 'success');
    } catch {
      toast("Couldn't send the digest. Try again.", 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <PageHeader
        icon={HeartPulse}
        eyebrow="Test quality"
        title="Selector health"
        subtitle="Selectors your tests could only find with self-healing. Fix the ones that heal most."
        action={
          <div className="flex items-center gap-2">
            <SegmentedControl<string>
              size="sm"
              label="Period"
              value={String(view.days)}
              onChange={(v) => setView({ days: Number(v) as PeriodDays, page: 1 })}
              segments={PERIODS.map((d) => ({ value: String(d), label: `${d} days` }))}
            />
            {isAdmin && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void sendDigest()}
                disabled={sending}
              >
                <Send size={14} /> Send digest
              </Button>
            )}
          </div>
        }
      />
      <div className="space-y-4 px-6 pb-8 pt-4">
        <RegressionBanner />
        <SummaryStrip summary={summary} days={view.days} />
        <TrendChart trend={summary ? (summary.trend ?? []) : null} days={view.days} />
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <SelectorList
              view={view}
              data={list}
              loading={loading}
              compact={!!view.open}
              selectedKey={view.open ? selectorKey(view.open) : null}
              onView={setView}
              onOpen={open}
            />
          </div>
          {view.open && (
            <SelectorPanel
              target={view.open}
              days={view.days}
              tz={tz}
              refreshKey={refreshKey}
              onClose={close}
              onChanged={() => setRefreshKey((k) => k + 1)}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default SelectorHealthPage;
