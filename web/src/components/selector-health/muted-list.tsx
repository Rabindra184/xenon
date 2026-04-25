import React, { useCallback, useEffect, useState } from 'react';
import { VolumeX, RefreshCw } from 'lucide-react';
import XenonApiService from '../../api-service';
import { formatStrategy } from '../../utils/strategy-labels';
import { formatRelative } from '../../utils/time';
import type { IMutedSelector, IMutedSelectorsResponse } from '../../interfaces/IHealingEvent';

interface Props {
  // The page-level handler that issues `unmute` actions and shows toasts
  // already exists; the list tells it which tuple to act on.
  onUnmute: (strategy: string, selector: string) => Promise<void>;
}

// Dedicated muted-selectors view, sourced from GET /healing/state/muted
// (not the hotspot aggregator) so a selector that hasn't healed in months
// still appears here as long as it's still muted. The backend enriches
// each row with `last_healed_at` from SessionLog so we can hint how long
// ago the silenced behaviour last fired.
export function MutedList({ onUnmute }: Props) {
  const [data, setData] = useState<IMutedSelectorsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = (await XenonApiService.getMutedSelectors({
        limit: 200,
      })) as IMutedSelectorsResponse;
      setData(res ?? null);
    } catch {
      setData({ muted: [], total: 0, limit: 200, offset: 0 });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleUnmute = async (m: IMutedSelector) => {
    if (!window.confirm(`Unmute "${m.original_selector}"?`)) return;
    await onUnmute(m.original_strategy, m.original_selector);
    load();
  };

  if (loading) {
    return (
      <div className="sh-empty">
        <RefreshCw size={18} className="animate-spin" />
        <span>Loading muted selectors…</span>
      </div>
    );
  }

  if (!data || data.muted.length === 0) {
    return (
      <div className="sh-empty sh-empty--clean">
        <VolumeX size={28} />
        <div>
          <div className="sh-empty__title">Nothing muted</div>
          <div className="sh-empty__subtitle">
            Selectors silenced from Hotspots, the CI gate, and digests will appear here.
          </div>
        </div>
      </div>
    );
  }

  return (
    <ul className="sh-muted-list">
      {data.muted.map((m) => (
        <li
          key={`${m.original_strategy}:${m.original_selector}`}
          className="sh-muted-list__item"
        >
          <div className="sh-muted-list__head">
            <VolumeX size={13} className="sh-muted-list__icon" />
            <span className="sh-strategy-badge">{formatStrategy(m.original_strategy)}</span>
            <code className="sh-muted-list__selector" title={m.original_selector}>
              {m.original_selector}
            </code>
          </div>
          <div className="sh-muted-list__meta">
            Muted {formatRelative(m.muted_at)}
            {m.muted_by_api_key ? ` by ${m.muted_by_api_key}` : ''}
            {m.last_healed_at
              ? ` • Last healed ${formatRelative(m.last_healed_at)}`
              : ' • Never healed (pre-emptively muted)'}
            {m.regression_count > 0 ? ` • ${m.regression_count} regression${m.regression_count === 1 ? '' : 's'} on record` : ''}
          </div>
          <div className="sh-muted-list__actions">
            <button
              type="button"
              className="sh-action-btn"
              onClick={() => handleUnmute(m)}
            >
              Unmute
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
