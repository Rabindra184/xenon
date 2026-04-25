import React, { useEffect, useState, useCallback } from 'react';
import { Flame, Copy, Check, RefreshCw, AlertTriangle } from 'lucide-react';
import XenonApiService from '../../api-service';
import {
  IHealingHotspot,
  IHealingHotspotsResponse,
} from '../../interfaces/IHealingEvent';

const WINDOW_DAYS = 30;
const LIMIT = 10;

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

function severityClass(count: number): string {
  if (count >= 10) return 'severe';
  if (count >= 5) return 'warn';
  return 'mild';
}

export const HealingHotspots: React.FC = () => {
  const [hotspots, setHotspots] = useState<IHealingHotspot[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [totalHeals, setTotalHeals] = useState<number>(0);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r: IHealingHotspotsResponse = await XenonApiService.getHealingHotspots(
        WINDOW_DAYS,
        LIMIT,
      );
      if (r) {
        setHotspots(Array.isArray(r.hotspots) ? r.hotspots : []);
        setTotalHeals(typeof r.totalHeals === 'number' ? r.totalHeals : 0);
      }
    } catch {
      /* ignore — UI shows empty state */
    } finally {
      setLoaded(true);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text).catch(() => { });
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1500);
  };

  return (
    <div className="healing-hotspots">
      <div className="healing-hotspots__header">
        <div className="healing-hotspots__title">
          <Flame size={11} />
          <span>Healing Hotspots</span>
          <span className="healing-hotspots__window">last {WINDOW_DAYS}d</span>
        </div>
        <button
          type="button"
          className="healing-hotspots__refresh"
          onClick={load}
          disabled={loading}
          title="Refresh"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {hotspots.length > 0 ? (
        <>
          <div className="healing-hotspots__caption">
            {totalHeals} heal{totalHeals === 1 ? '' : 's'} across {hotspots.length} unique selector
            {hotspots.length === 1 ? '' : 's'}. Rewrite the worst offenders to keep your suite
            honest — auto-heal hides them in CI but they still cost LLM calls and add latency.
          </div>
          <ul className="healing-hotspots__list">
            {hotspots.map((h, i) => {
              const sevCls = severityClass(h.healCount);
              const sharePct =
                h.suggestedRewriteShare !== null
                  ? Math.round(h.suggestedRewriteShare * 100)
                  : null;
              const copyKey = `${i}-${h.originalSelector}`;
              return (
                <li className="healing-hotspot" key={copyKey}>
                  <div className="healing-hotspot__rank">{i + 1}</div>
                  <div className="healing-hotspot__body">
                    <div className="healing-hotspot__row">
                      <code
                        className="healing-hotspot__selector"
                        title={h.originalSelector}
                      >
                        {h.originalSelector}
                      </code>
                      <span className={`healing-hotspot__count ${sevCls}`}>
                        <AlertTriangle size={10} />
                        {h.healCount}× healed
                      </span>
                    </div>
                    <div className="healing-hotspot__meta">
                      <span>
                        {h.sessionCount} session{h.sessionCount === 1 ? '' : 's'}
                      </span>
                      {h.topTier && <span>· {h.topTier}</span>}
                      {h.averageConfidence !== null && (
                        <span>· avg {Math.round(h.averageConfidence * 100)}% confidence</span>
                      )}
                      <span>· last {formatRelative(h.lastHealedAt)}</span>
                    </div>
                    {h.suggestedRewrite && (
                      <div className="healing-hotspot__rewrite">
                        <span className="healing-hotspot__rewrite-label">Suggested rewrite</span>
                        {sharePct !== null && (
                          <span className="healing-hotspot__rewrite-share" title="Share of heals that landed on this selector">
                            {sharePct}%
                          </span>
                        )}
                        <code
                          className="healing-hotspot__rewrite-value"
                          title={h.suggestedRewrite}
                        >
                          {h.suggestedRewrite}
                        </code>
                        <button
                          type="button"
                          className={`healing-hotspot__copy ${copiedKey === copyKey ? 'copied' : ''}`}
                          onClick={() => copy(h.suggestedRewrite!, copyKey)}
                          aria-label="Copy suggested rewrite"
                          title={copiedKey === copyKey ? 'Copied' : 'Copy rewrite'}
                        >
                          {copiedKey === copyKey ? <Check size={11} /> : <Copy size={11} />}
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <div className="healing-hotspots__empty">
          {loaded
            ? `No healed selectors in the last ${WINDOW_DAYS} days — your locator hygiene is clean.`
            : 'Loading hotspots…'}
        </div>
      )}
    </div>
  );
};
