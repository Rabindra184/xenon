import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  HeartPulse,
  ChevronLeft,
  Copy,
  Check,
  RefreshCw,
  ExternalLink,
  AlertTriangle,
  Layers,
} from 'lucide-react';
import XenonApiService from '../../api-service';
import { PageHeader } from '../ui/page-header';
import { IHealingSelectorDetail } from '../../interfaces/IHealingEvent';
import './selector-health.css';

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
  return `$${usd.toFixed(2)}`;
}

const SelectorDetailPage: React.FC = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const value = params.get('value') ?? '';
  const windowDays = parseInt(params.get('windowDays') ?? '30', 10) || 30;

  const [detail, setDetail] = useState<IHealingSelectorDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!value) return;
    setLoading(true);
    try {
      const r: IHealingSelectorDetail = await XenonApiService.getHealingSelectorDetail(
        value,
        windowDays,
      );
      setDetail(r ?? null);
    } catch {
      setDetail(null);
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [value, windowDays]);

  useEffect(() => {
    load();
  }, [load]);

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text).catch(() => { });
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1500);
  };

  if (!value) {
    return (
      <div className="selector-health-page">
        <PageHeader
          icon={HeartPulse}
          eyebrow="Test Quality"
          title="Selector Detail"
          subtitle="No selector specified."
        />
        <div className="sh-content">
          <button className="sh-back-btn" onClick={() => navigate('/selector-health')}>
            <ChevronLeft size={12} /> Back to Selector Health
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="selector-health-page">
      <PageHeader
        icon={HeartPulse}
        eyebrow="Test Quality / Selector"
        title={
          <span className="sh-detail-title">
            <code title={value}>{value}</code>
          </span>
        }
        subtitle={`All heals for this selector over the last ${windowDays} days.`}
        action={
          <>
            <button className="sh-back-btn" onClick={() => navigate('/selector-health')}>
              <ChevronLeft size={12} /> Back
            </button>
            <button
              className="sh-refresh-btn"
              onClick={load}
              disabled={loading}
              title="Refresh"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </>
        }
      />

      <div className="sh-content">
        {loading && !loaded ? (
          <div className="sh-empty">
            <RefreshCw size={18} className="animate-spin" />
            <span>Loading detail…</span>
          </div>
        ) : !detail || detail.healCount === 0 ? (
          <div className="sh-empty sh-empty--clean">
            <HeartPulse size={28} />
            <div>
              <div className="sh-empty__title">No heals recorded</div>
              <div className="sh-empty__subtitle">
                This selector has no healing events in the last {windowDays} days.
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="sh-detail-stats">
              <div className="sh-detail-stat">
                <span className="sh-detail-stat__label">Heals</span>
                <span className="sh-detail-stat__value">{detail.healCount}</span>
              </div>
              <div className="sh-detail-stat">
                <span className="sh-detail-stat__label">Sessions</span>
                <span className="sh-detail-stat__value">{detail.sessionCount}</span>
              </div>
              <div className="sh-detail-stat">
                <span className="sh-detail-stat__label">Est. cost</span>
                <span className="sh-detail-stat__value">{formatCost(detail.estCostUsd)}</span>
              </div>
              <div className="sh-detail-stat">
                <span className="sh-detail-stat__label">Tiers used</span>
                <span className="sh-detail-stat__value">
                  {Object.keys(detail.byTier).length || '—'}
                </span>
              </div>
            </div>

            <div className="sh-detail-grid">
              <section className="sh-card">
                <header className="sh-card__head">
                  <Layers size={12} />
                  <span>Suggested rewrites</span>
                  <span className="sh-card__hint">
                    every alternate the healer landed on, ranked by frequency
                  </span>
                </header>
                <ul className="sh-alternates">
                  {detail.alternates.length === 0 && (
                    <li className="sh-alternates__empty">
                      No healed selectors recorded — only the failure was captured.
                    </li>
                  )}
                  {detail.alternates.map((a, idx) => {
                    const sharePct = Math.round(a.share * 100);
                    const copyKey = `alt-${idx}`;
                    return (
                      <li key={a.healedSelector} className="sh-alternate">
                        <div className="sh-alternate__top">
                          <span className="sh-alternate__share">{sharePct}%</span>
                          <code className="sh-alternate__value" title={a.healedSelector}>
                            {a.healedSelector}
                          </code>
                          <button
                            type="button"
                            className={`sh-icon-btn ${copiedKey === copyKey ? 'copied' : ''}`}
                            onClick={() => copy(a.healedSelector, copyKey)}
                            aria-label="Copy alternate"
                            title={copiedKey === copyKey ? 'Copied' : 'Copy'}
                          >
                            {copiedKey === copyKey ? <Check size={11} /> : <Copy size={11} />}
                          </button>
                        </div>
                        <div className="sh-alternate__meta">
                          <span>{a.count} heal{a.count === 1 ? '' : 's'}</span>
                          {a.averageConfidence !== null && (
                            <span>· avg {Math.round(a.averageConfidence * 100)}% confidence</span>
                          )}
                          {a.tiers.length > 0 && (
                            <span>· via {a.tiers.join(', ')}</span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>

              <section className="sh-card">
                <header className="sh-card__head">
                  <AlertTriangle size={12} />
                  <span>Breakdown</span>
                </header>
                <div className="sh-breakdown">
                  <div className="sh-breakdown__group">
                    <div className="sh-breakdown__label">By tier</div>
                    {Object.entries(detail.byTier)
                      .sort((a, b) => b[1] - a[1])
                      .map(([t, c]) => (
                        <div key={t} className="sh-breakdown__row">
                          <span className="sh-tier-pill">{t}</span>
                          <span className="sh-breakdown__count">{c}</span>
                        </div>
                      ))}
                    {Object.keys(detail.byTier).length === 0 && (
                      <div className="sh-breakdown__empty">none recorded</div>
                    )}
                  </div>
                  <div className="sh-breakdown__group">
                    <div className="sh-breakdown__label">By platform</div>
                    {Object.entries(detail.byPlatform)
                      .sort((a, b) => b[1] - a[1])
                      .map(([p, c]) => (
                        <div key={p} className="sh-breakdown__row">
                          <span className="sh-platform-pill">{p}</span>
                          <span className="sh-breakdown__count">{c}</span>
                        </div>
                      ))}
                  </div>
                  <div className="sh-breakdown__group">
                    <div className="sh-breakdown__label">By build</div>
                    {detail.byBuild.slice(0, 8).map((b) => (
                      <div key={b.buildId} className="sh-breakdown__row">
                        <span className="sh-build-pill" title={b.buildId}>
                          {b.buildId === 'unattached'
                            ? 'unattached'
                            : b.buildId.length > 12
                              ? b.buildId.slice(0, 8) + '…'
                              : b.buildId}
                        </span>
                        <span className="sh-breakdown__count">{b.count}</span>
                      </div>
                    ))}
                    {detail.byBuild.length === 0 && (
                      <div className="sh-breakdown__empty">none recorded</div>
                    )}
                  </div>
                </div>
              </section>
            </div>

            <section className="sh-card">
              <header className="sh-card__head">
                <span>Timeline</span>
                <span className="sh-card__hint">
                  most recent {detail.timeline.length} of {detail.healCount} heal
                  {detail.healCount === 1 ? '' : 's'}
                </span>
              </header>
              <div className="sh-timeline">
                {detail.timeline.map((t) => (
                  <div key={t.id} className="sh-timeline__row">
                    <span className="sh-timeline__when">{formatRelative(t.createdAt)}</span>
                    {t.tier && <span className="sh-tier-pill">{t.tier}</span>}
                    <span className="sh-timeline__cmd">{t.commandName ?? '—'}</span>
                    <span className="sh-timeline__device">{t.deviceName ?? t.deviceUdid ?? '—'}</span>
                    <code className="sh-timeline__healed" title={t.healedSelector ?? ''}>
                      {t.healedSelector ?? '—'}
                    </code>
                    {t.confidence !== null && (
                      <span className="sh-timeline__conf">
                        {Math.round(t.confidence * 100)}%
                      </span>
                    )}
                    {t.buildId && t.sessionId && (
                      <a
                        className="sh-timeline__link"
                        href={`/xenon/builds/${encodeURIComponent(t.buildId)}/sessions/${encodeURIComponent(t.sessionId)}`}
                        title="Open session detail"
                      >
                        <ExternalLink size={11} />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
};

export default SelectorDetailPage;
