import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { TabNav, Tab } from './tab-nav';
import { formatStrategy } from '../../utils/strategy-labels';
import { CopyButton } from './copy-language-modal';
import { PendingRow } from './pending-row';
import { ResolvedRow } from './resolved-row';
import { MutedList } from './muted-list';
import { RegressionBanner } from './regression-banner';
import {
  HeartPulse,
  RefreshCw,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  ChevronRight,
  Filter,
  Send,
  Info,
  ExternalLink,
  Hourglass,
} from 'lucide-react';
import { EmptyState } from '../ui/EmptyState';
import XenonApiService from '../../api-service';
import { PageHeader } from '../ui/page-header';
import { SegmentedControl } from '../ui/SegmentedControl';
import { useToast } from '../ui/toast';
import {
  IHealingHotspot,
  IHealingHotspotsResponse,
  IHealingPeriodAggregate,
  IHealingSummaryResponse,
} from '../../interfaces/IHealingEvent';
import { useSocket } from '../../hooks/useSocket';
import './selector-health.css';

type WindowDays = 7 | 30 | 90;
type TierFilter = '' | 'Native' | 'Resilio' | 'Fuzzy XML' | 'OCR' | 'Visual AI' | 'LLM';
type PlatformFilter = '' | 'ios' | 'android' | 'tvos';

const WINDOW_OPTIONS: Array<{ value: WindowDays; label: string }> = [
  { value: 7, label: '7d' },
  { value: 30, label: '30d' },
  { value: 90, label: '90d' },
];

const TIER_OPTIONS: TierFilter[] = ['', 'LLM', 'Visual AI', 'OCR', 'Fuzzy XML', 'Resilio', 'Native'];
const PLATFORM_OPTIONS: PlatformFilter[] = ['', 'ios', 'android', 'tvos'];

function formatRelative(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const diff = Math.max(0, Date.now() - t);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function formatCost(usd: number): string {
  if (usd === 0) return '$0';
  if (usd < 0.01) return '<$0.01';
  if (usd < 1) return `$${usd.toFixed(2)}`;
  if (usd < 100) return `$${usd.toFixed(2)}`;
  return `$${Math.round(usd)}`;
}

function severityClass(count: number): string {
  if (count >= 10) return 'severe';
  if (count >= 5) return 'warn';
  return 'mild';
}

interface DeltaProps {
  current: number;
  prior: number;
  // Higher=worse for heal counts ("more heals is bad"), but for some metrics
  // (e.g. distinct selectors recovered) higher could be neutral. Caller picks.
  invertColor?: boolean;
}

const Delta: React.FC<DeltaProps> = ({ current, prior, invertColor = false }) => {
  if (prior === 0 && current === 0) {
    return <span className="sh-delta neutral"><Minus size={11} />no change</span>;
  }
  if (prior === 0) {
    return (
      <span className={`sh-delta ${invertColor ? 'good' : 'bad'}`}>
        <ArrowUpRight size={11} />new
      </span>
    );
  }
  const pct = Math.round(((current - prior) / prior) * 100);
  if (pct === 0) {
    return <span className="sh-delta neutral"><Minus size={11} />flat</span>;
  }
  const isUp = pct > 0;
  // For heal counts: up = bad. For "good" metrics: up = good.
  const isGood = invertColor ? isUp : !isUp;
  return (
    <span className={`sh-delta ${isGood ? 'good' : 'bad'}`}>
      {isUp ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
      {Math.abs(pct)}%
    </span>
  );
};

interface KpiTileProps {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  delta?: React.ReactNode;
  tone?: 'neutral' | 'warn' | 'critical';
  size?: 'md' | 'hero';
  hint?: string;
}

const KpiTile: React.FC<KpiTileProps> = ({ label, value, sub, delta, tone = 'neutral', size = 'md', hint }) => (
  <div className={`sh-kpi sh-kpi--${tone} sh-kpi--${size}`}>
    <div className="sh-kpi__label">
      {label}
      {hint && (
        <span className="sh-kpi__info" title={hint} aria-label={hint} role="img">
          <Info size={11} />
        </span>
      )}
    </div>
    <div className="sh-kpi__value">{value}</div>
    {(sub || delta) && (
      <div className="sh-kpi__foot">
        {sub && <span className="sh-kpi__sub">{sub}</span>}
        {delta && <span className="sh-kpi__delta">{delta}</span>}
      </div>
    )}
  </div>
);

const KPI_HINTS = {
  brittle: 'Distinct selectors that needed at least one heal in the window. Lower is better.',
  totalHeals: "Number of times Xenon's self-heal kicked in within the selected window.",
  llm: 'Heals that escalated all the way to an LLM. The most expensive tier — keep this small.',
  cost: 'Estimated dollar spend on LLM heals in the window.',
} as const;

const KpiStrip: React.FC<{ summary: IHealingSummaryResponse | null; loading: boolean }> = ({
  summary,
  loading,
}) => {
  const cur: IHealingPeriodAggregate = summary?.current ?? {
    totalHeals: 0,
    distinctSelectors: 0,
    sessionsTouched: 0,
    byTier: {},
    estCostUsd: 0,
  };
  const prior: IHealingPeriodAggregate = summary?.prior ?? {
    totalHeals: 0,
    distinctSelectors: 0,
    sessionsTouched: 0,
    byTier: {},
    estCostUsd: 0,
  };
  const llmHeals = cur.byTier?.LLM ?? 0;
  const llmShare = cur.totalHeals > 0 ? Math.round((llmHeals / cur.totalHeals) * 100) : 0;
  return (
    <div className="sh-kpi-strip">
      <KpiTile
        size="hero"
        label="Brittle selectors"
        hint={KPI_HINTS.brittle}
        value={loading ? '—' : cur.distinctSelectors.toLocaleString()}
        sub="distinct selectors needing attention"
        delta={
          !loading && <Delta current={cur.distinctSelectors} prior={prior.distinctSelectors} />
        }
        tone={cur.distinctSelectors > 50 ? 'warn' : 'neutral'}
      />
      <KpiTile
        label="Total heals"
        hint={KPI_HINTS.totalHeals}
        value={loading ? '—' : cur.totalHeals.toLocaleString()}
        sub={`${summary?.windowDays ?? 30}d window`}
        delta={!loading && <Delta current={cur.totalHeals} prior={prior.totalHeals} />}
        tone={cur.totalHeals > prior.totalHeals && prior.totalHeals > 0 ? 'warn' : 'neutral'}
      />
      <KpiTile
        label="Sessions touched"
        value={loading ? '—' : cur.sessionsTouched.toLocaleString()}
        sub="by self-heal"
        delta={!loading && <Delta current={cur.sessionsTouched} prior={prior.sessionsTouched} />}
      />
      <KpiTile
        label="LLM heals"
        hint={KPI_HINTS.llm}
        value={loading ? '—' : llmHeals.toLocaleString()}
        sub={`${llmShare}% of total`}
        tone={llmShare > 30 ? 'critical' : llmShare > 10 ? 'warn' : 'neutral'}
      />
      <KpiTile
        label="Est. cost"
        hint={KPI_HINTS.cost}
        value={loading ? '—' : formatCost(cur.estCostUsd)}
        sub="this window"
        delta={
          !loading && (
            <Delta
              current={Math.round(cur.estCostUsd * 100)}
              prior={Math.round(prior.estCostUsd * 100)}
            />
          )
        }
      />
      <KpiTile
        label="Resolved"
        value={loading ? '—' : (summary?.resolvedCount ?? 0).toLocaleString()}
        sub={`last ${summary?.windowDays ?? 30}d`}
        delta={
          !loading && typeof summary?.pendingCount === 'number' ? (
            <span className="sh-kpi__delta sh-kpi__delta--with-icon">
              <Hourglass size={11} style={{ color: 'var(--accent, #60a5fa)' }} />
              {summary.pendingCount} pending
            </span>
          ) : undefined
        }
        tone="neutral"
      />
    </div>
  );
};

const SelectorHealthPage: React.FC = () => {
  const navigate = useNavigate();
  const { on } = useSocket();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  // URL-persisted lifecycle tab. The aggregator's `status` filter mirrors
  // the tab id, so each tab's fetch returns just that bucket. 'muted' is
  // a separate view in Task 20 — for Phase 1 of this task, all four tabs
  // share the existing hotspot table and the per-tab UX layers on later.
  const tab: Tab = ((searchParams.get('tab') as Tab) ?? 'active');
  const [windowDays, setWindowDays] = useState<WindowDays>(30);
  const [tier, setTier] = useState<TierFilter>('');
  const [platform, setPlatform] = useState<PlatformFilter>('');
  const [summary, setSummary] = useState<IHealingSummaryResponse | null>(null);
  const [hotspots, setHotspots] = useState<IHealingHotspot[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [sendingDigest, setSendingDigest] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, h] = await Promise.all([
        XenonApiService.getHealingSummary(windowDays) as Promise<IHealingSummaryResponse>,
        XenonApiService.getHealingHotspots({
          windowDays,
          limit: 50,
          tier: tier || undefined,
          platform: platform || undefined,
          status: tab,
        }) as Promise<IHealingHotspotsResponse>,
      ]);
      setSummary(s ?? null);
      setHotspots(Array.isArray(h?.hotspots) ? h.hotspots : []);
    } catch {
      /* swallow — UI shows zero state */
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [windowDays, tier, platform, tab]);

  useEffect(() => {
    load();
  }, [load]);

  // Live refresh on heal + lifecycle events. Keeping it simple: re-fetch
  // on each event. If volume gets noisy we can debounce. The page already
  // routes the data through `status=tab`, so the new bucket / new
  // metadata appears on the right tab without further wiring.
  useEffect(() => {
    const events = [
      'healing_event',
      'selector_fixed',
      'selector_resolved',
      'selector_regressed',
      'selector_cancelled',
      'selector_muted',
      'selector_unmuted',
      'selector_progress',
    ];
    const unsubs = events.map((e) => on(e, () => load()));
    return () => {
      unsubs.forEach((u) => u && u());
    };
  }, [on, load]);

  const openSelector = (selector: string) => {
    navigate(`/selector-health/detail?value=${encodeURIComponent(selector)}&windowDays=${windowDays}`);
  };

  // Mark Fixed / Mute action dispatcher. Uses window.confirm() as a
  // placeholder until a proper confirm modal lands; the API request itself
  // is idempotent on the backend so a misclick recovers via the inverse
  // action (Mute -> Unmute, Mark Fixed -> Cancel verification).
  const handleAction = useCallback(
    async (
      kind: 'mark_fixed' | 'mute' | 'unmute' | 'cancel_verification',
      h: IHealingHotspot,
    ) => {
      const confirmMsg = (() => {
        switch (kind) {
          case 'mark_fixed':
            return `Mark this selector as fixed? Xenon will move it to Pending Verification and watch for 3 clean CI builds.`;
          case 'mute':
            return `Mute this selector? It will be hidden from Hotspots, the CI gate, and digests until you unmute.`;
          case 'unmute':
            return `Unmute this selector?`;
          case 'cancel_verification':
            return `Cancel verification? The selector returns to Active and the clean-build counter resets.`;
        }
      })();
      if (!window.confirm(confirmMsg)) return;
      try {
        await XenonApiService.postSelectorStateAction({
          original_strategy: h.originalStrategy ?? '',
          original_selector: h.originalSelector,
          action: kind,
        });
        const successMsg = (() => {
          switch (kind) {
            case 'mark_fixed':
              return 'Marked fixed. Watching for clean builds.';
            case 'mute':
              return 'Muted.';
            case 'unmute':
              return 'Unmuted.';
            case 'cancel_verification':
              return 'Verification cancelled.';
          }
        })();
        toast(successMsg, 'success');
        load();
      } catch (err: any) {
        const detail = err?.currentStatus
          ? ` (currently ${err.currentStatus})`
          : '';
        toast(`${err?.message ?? 'Action failed'}${detail}`, 'error');
      }
    },
    [load, toast],
  );

  const sendDigest = async () => {
    setSendingDigest(true);
    try {
      const r = await XenonApiService.sendHealingDigest({ windowDays, limit: 5, minHealCount: 2 });
      const sent = (r as any)?.sent ?? 0;
      const included = (r as any)?.hotspotsIncluded ?? 0;
      if (sent === 0) {
        toast(
          'No webhook is subscribed to selector_health_digest yet. Add one in Notifications.',
          'error',
        );
      } else {
        toast(
          `Digest sent to ${sent} webhook${sent === 1 ? '' : 's'} (${included} hotspot${included === 1 ? '' : 's'} included).`,
          'success',
        );
      }
    } catch {
      toast('Failed to send digest. Check the server logs.', 'error');
    } finally {
      setSendingDigest(false);
    }
  };

  const filtersActive = !!tier || !!platform;
  const headerSubtitle = useMemo(
    () =>
      `Surface the selectors your suite quietly relies on auto-heal for. Rewrite the worst offenders to keep tests fast, cheap, and portable.`,
    [],
  );

  return (
    <div className="selector-health-page">
      <PageHeader
        icon={HeartPulse}
        eyebrow="Test Quality"
        title="Selector Health"
        subtitle={headerSubtitle}
        action={
          <>
            <button
              type="button"
              className="sh-ghost-btn"
              onClick={sendDigest}
              disabled={sendingDigest}
              title={sendingDigest ? 'Sending digest…' : 'Send digest to subscribed webhooks'}
              aria-label="Send digest"
            >
              <Send size={14} className={sendingDigest ? 'animate-spin' : ''} />
            </button>
            <button
              type="button"
              className="sh-ghost-btn"
              onClick={load}
              disabled={loading}
              title="Refresh hotspots"
              aria-label="Refresh"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </>
        }
      />

      <div className="sh-content">
        <RegressionBanner />
        <KpiStrip summary={summary} loading={loading && !loaded} />

        <TabNav current={tab} counts={{ [tab]: hotspots.length }} />

        {tab === 'muted' ? (
          <MutedList
            onUnmute={async (strategy, selector) => {
              await handleAction('unmute', {
                originalStrategy: strategy,
                originalSelector: selector,
              } as IHealingHotspot);
            }}
          />
        ) : (
        <>
        <div className="sh-filter-bar">
          <span className="sh-filter-bar__lead">Filter results</span>
          <div className="sh-filter-bar__group">
            <span className="sh-filter-bar__label">Window</span>
            <SegmentedControl<string>
              size="sm"
              value={String(windowDays)}
              onChange={(v) => setWindowDays(parseInt(v, 10) as WindowDays)}
              segments={WINDOW_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))}
            />
          </div>
          <div className="sh-filter-bar__group">
            <span className="sh-filter-bar__label">Tier</span>
            <select
              className="sh-select"
              value={tier}
              onChange={(e) => setTier(e.target.value as TierFilter)}
            >
              {TIER_OPTIONS.map((t) => (
                <option key={t || 'all'} value={t}>
                  {t || 'All tiers'}
                </option>
              ))}
            </select>
          </div>
          <div className="sh-filter-bar__group">
            <span className="sh-filter-bar__label">Platform</span>
            <select
              className="sh-select"
              value={platform}
              onChange={(e) => setPlatform(e.target.value as PlatformFilter)}
            >
              {PLATFORM_OPTIONS.map((p) => (
                <option key={p || 'all'} value={p}>
                  {p ? p.toUpperCase() : 'All platforms'}
                </option>
              ))}
            </select>
          </div>
          {filtersActive && (
            <button
              type="button"
              className="sh-filter-bar__clear"
              onClick={() => { setTier(''); setPlatform(''); }}
            >
              <Filter size={11} /> Clear filters
            </button>
          )}
        </div>

        {loading && !loaded ? (
          <div className="sh-empty">
            <RefreshCw size={18} className="animate-spin" />
            <span>Loading hotspots…</span>
          </div>
        ) : hotspots.length === 0 ? (
          <EmptyState
            icon={
              <HeartPulse
                size={32}
                color={tab === 'active' ? 'var(--green)' : 'var(--text-dim)'}
              />
            }
            title={
              tab === 'pending'
                ? 'Nothing pending'
                : tab === 'resolved'
                  ? 'Nothing resolved yet'
                  : 'Locator hygiene is clean'
            }
            description={
              tab === 'pending'
                ? 'When you mark a selector fixed, it shows here while we watch for 3 clean CI builds.'
                : tab === 'resolved'
                  ? 'Fix a hot selector and Xenon will track its verification here.'
                  : `No selectors required healing in the last ${windowDays} days${filtersActive ? ' for the active filters' : ''}.`
            }
            action={
              <div className="sh-empty-actions">
                {filtersActive && tab === 'active' && (
                  <button
                    type="button"
                    className="sh-ghost-btn sh-ghost-btn--inline"
                    onClick={() => { setTier(''); setPlatform(''); }}
                  >
                    <Filter size={12} /> Reset filters
                  </button>
                )}
                <a
                  href="/xenon/api-docs"
                  target="_blank"
                  rel="noreferrer"
                  className="sh-ghost-btn sh-ghost-btn--inline"
                >
                  <ExternalLink size={12} /> View API docs
                </a>
              </div>
            }
          />
        ) : tab === 'pending' ? (
          <div className="sh-pending-list">
            {hotspots.map((h) => (
              <PendingRow
                key={`${h.originalStrategy ?? ''} ${h.originalSelector}`}
                hotspot={h}
                onCancel={(hot) => handleAction('cancel_verification', hot)}
                onMute={(hot) => handleAction('mute', hot)}
                onOpen={openSelector}
              />
            ))}
          </div>
        ) : tab === 'resolved' ? (
          <div className="sh-pending-list">
            {hotspots.map((h) => (
              <ResolvedRow
                key={`${h.originalStrategy ?? ''} ${h.originalSelector}`}
                hotspot={h}
                onMute={(hot) => handleAction('mute', hot)}
                onOpen={openSelector}
              />
            ))}
          </div>
        ) : (
          <div className="sh-table">
            <div className="sh-table__head">
              <div className="sh-th sh-th--rank">#</div>
              <div className="sh-th sh-th--selector">Original selector</div>
              <div className="sh-th sh-th--count">Heals</div>
              <div className="sh-th sh-th--meta">Sessions</div>
              <div className="sh-th sh-th--meta">Top tier</div>
              <div className="sh-th sh-th--meta">Avg conf.</div>
              <div className="sh-th sh-th--meta">Last seen</div>
              <div className="sh-th sh-th--rewrite">Suggested rewrite</div>
              <div className="sh-th sh-th--actions"></div>
            </div>
            {hotspots.map((h, i) => {
              const sevCls = severityClass(h.healCount);
              const sharePct =
                h.suggestedRewriteShare !== null
                  ? Math.round(h.suggestedRewriteShare * 100)
                  : null;
              const copyKey = `${i}-${h.originalSelector}`;
              return (
                <div
                  key={copyKey}
                  className="sh-table__row"
                  onClick={() => openSelector(h.originalSelector)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      openSelector(h.originalSelector);
                    }
                  }}
                >
                  <div className="sh-td sh-td--rank">{i + 1}</div>
                  <div className="sh-td sh-td--selector">
                    <span className="sh-strategy-badge">
                      {formatStrategy(h.originalStrategy)}
                    </span>
                    <code title={h.originalSelector}>{h.originalSelector}</code>
                  </div>
                  <div className="sh-td sh-td--count">
                    <span className={`sh-count-badge ${sevCls}`}>
                      <AlertTriangle size={10} />
                      {h.healCount}
                    </span>
                  </div>
                  <div className="sh-td sh-td--meta">{h.sessionCount}</div>
                  <div className="sh-td sh-td--meta">
                    {h.topTier ? <span className="sh-tier-pill">{h.topTier}</span> : '—'}
                  </div>
                  <div className="sh-td sh-td--meta">
                    {h.averageConfidence !== null
                      ? `${Math.round(h.averageConfidence * 100)}%`
                      : '—'}
                  </div>
                  <div className="sh-td sh-td--meta">{formatRelative(h.lastHealedAt)}</div>
                  <div className="sh-td sh-td--rewrite">
                    {h.suggestedRewrite ? (
                      <>
                        {sharePct !== null && (
                          <span className="sh-rewrite-share" title="Share of heals that landed on this selector">
                            {sharePct}%
                          </span>
                        )}
                        {h.suggestedStrategy && (
                          <span
                            className="sh-strategy-badge sh-strategy-badge--rewrite"
                            title="Strategy of the suggested rewrite"
                          >
                            {formatStrategy(h.suggestedStrategy)}
                          </span>
                        )}
                        <code className="sh-rewrite-value" title={h.suggestedRewrite}>
                          {h.suggestedRewrite}
                        </code>
                      </>
                    ) : (
                      <span className="sh-rewrite-empty">—</span>
                    )}
                  </div>
                  <div className="sh-td sh-td--actions">
                    {h.suggestedRewrite && (
                      <CopyButton
                        hotspot={h}
                        onCopied={(lang) => {
                          setCopiedKey(copyKey);
                          setTimeout(
                            () =>
                              setCopiedKey((current) =>
                                current === copyKey ? null : current,
                              ),
                            1500,
                          );
                          toast(`Copied as ${lang}`, 'success');
                        }}
                      />
                    )}
                    {tab === 'active' && (
                      <>
                        <button
                          type="button"
                          className="sh-action-btn sh-action-btn--primary"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAction('mark_fixed', h);
                          }}
                          title="Move to Pending Verification"
                        >
                          Mark Fixed
                        </button>
                        <button
                          type="button"
                          className="sh-action-btn sh-action-btn--ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAction('mute', h);
                          }}
                          title="Hide from Hotspots, CI gate, and digests"
                        >
                          Mute
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      className="sh-icon-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        openSelector(h.originalSelector);
                      }}
                      aria-label="Open selector detail"
                      title="Drill in"
                    >
                      <ChevronRight size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        </>
        )}
      </div>
    </div>
  );
};

export default SelectorHealthPage;
