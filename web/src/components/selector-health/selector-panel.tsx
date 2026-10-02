import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Link2, X } from 'lucide-react';
import XenonApiService from '../../api-service';
import { useToast } from '../ui/toast';
import { Button } from '../ui/button';
import { LineChart } from '../session-detail/line-chart';
import { platformLabel } from '../../lib/labels';
import {
  ISelectorActivity,
  ISelectorDetailResponse,
  ISelectorStateView,
} from '../../interfaces/IHealingEvent';
import { CopyButton } from './copy-language-modal';
import { CancelVerificationDialog, MarkFixedDialog, MuteDialog } from './selector-dialogs';
import { Chip } from './selector-bits';
import { OpenSelector } from './view-state';
import {
  METHOD_EXPLANATIONS,
  activityText,
  formatDate,
  formatDay,
  formatDuration,
  formatRelative,
  shareText,
  statusText,
  strategyLabel,
} from './format';

type Action = 'mark_fixed' | 'mute' | 'unmute' | 'cancel_verification';
type Dialog = 'mark_fixed' | 'mute' | 'cancel_verification' | null;

const DONE: Record<Action, string> = {
  mark_fixed: 'Marked fixed. Xenon is watching the next 3 clean builds.',
  mute: 'Muted.',
  unmute: 'Unmuted.',
  cancel_verification: 'Verification cancelled.',
};

interface Props {
  target: OpenSelector;
  days: number;
  tz: number;
  /** Bumped by the page to ask again (a live event, an action). */
  refreshKey: number;
  onClose: () => void;
  /** After an action, so the page can refresh the list. */
  onChanged: () => void;
}

const STATUS_TONE: Record<string, string> = {
  pending: 'border-[var(--color-info)] text-[var(--color-info)]',
  resolved: 'border-[var(--color-success)] text-[var(--color-success)]',
  muted: 'border-[var(--border-strong)] text-[var(--text-muted)]',
};

const StatusPill: React.FC<{ state: ISelectorStateView | null }> = ({ state }) => (
  <span
    className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
      STATUS_TONE[state?.status ?? ''] ?? 'border-[var(--color-danger)] text-[var(--color-danger)]'
    }`}
  >
    {statusText(state)}
  </span>
);

const IconButton: React.FC<{ label: string; onClick: () => void; children: React.ReactNode }> = ({
  label,
  onClick,
  children,
}) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    onClick={onClick}
    className="rounded p-1.5 text-[var(--text-muted)] hover:bg-[rgb(var(--rgb-fg)/0.06)] hover:text-[var(--text)]"
  >
    {children}
  </button>
);

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section aria-label={title}>
    <h3 className="mb-2 text-xs font-semibold text-[var(--text)]">{title}</h3>
    {children}
  </section>
);

const Breakdown: React.FC<{
  title: string;
  rows: Array<{ key: string; label: string; count: number }>;
}> = ({ title, rows }) =>
  rows.length === 0 ? null : (
    <div className="mb-3">
      <div className="mb-1 text-[11px] text-[var(--text-dim)]">{title}</div>
      {rows.map((r) => (
        <div key={r.key} className="flex justify-between gap-3 py-0.5 text-xs">
          <span className="min-w-0 truncate text-[var(--text)]" title={r.label}>
            {r.label}
          </span>
          <span className="shrink-0 tabular-nums text-[var(--text-muted)]">
            {r.count.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );

const ActivityList: React.FC<{ activity: ISelectorActivity[] }> = ({ activity }) => (
  <Section title="Activity">
    {activity.length === 0 ? (
      <p className="text-xs text-[var(--text-muted)]">No changes recorded yet.</p>
    ) : (
      <ul>
        {activity.map((a, i) => (
          <li key={`${a.at}-${i}`} className="flex justify-between gap-3 py-1 text-[11px]">
            <span className="min-w-0">
              <span className="text-[var(--text)]">{activityText(a)}</span>
              {a.reason && <span className="text-[var(--text-muted)]">: “{a.reason}”</span>}
            </span>
            <span className="shrink-0 text-[var(--text-dim)]">{formatDate(a.at)}</span>
          </li>
        ))}
      </ul>
    )}
  </Section>
);

/**
 * One selector beside the list: its status and actions, the fixes the
 * healer found, its numbers, where it heals, its latest heals and who did
 * what to it.
 */
export const SelectorPanel: React.FC<Props> = ({
  target,
  days,
  tz,
  refreshKey,
  onClose,
  onChanged,
}) => {
  const { toast } = useToast();
  const [detail, setDetail] = useState<ISelectorDetailResponse | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'missing' | 'failed'>('loading');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);

  // Another selector: clear the old one, rather than show it under the new name.
  useEffect(() => {
    setDetail(null);
    setPhase('loading');
  }, [target.strategy, target.selector]);

  useEffect(() => {
    let alive = true;
    XenonApiService.getSelectorPanel(target.strategy, target.selector, days, tz)
      .then(({ status, body }) => {
        if (!alive) return;
        if (status === 404) {
          setDetail(null);
          setPhase('missing');
        } else if (status === 200 && body) {
          setDetail(body);
          setPhase('ready');
        } else {
          setPhase('failed');
        }
      })
      .catch(() => {
        if (alive) setPhase('failed');
      });
    return () => {
      alive = false;
    };
  }, [target.strategy, target.selector, days, tz, refreshKey]);

  const act = async (action: Action, reason?: string) => {
    setBusy(true);
    try {
      await XenonApiService.postSelectorStateAction({
        original_strategy: target.strategy,
        original_selector: target.selector,
        action,
        ...(reason ? { reason } : {}),
      });
      toast(DONE[action], 'success');
    } catch (err) {
      const status = (err as { status?: number }).status;
      toast(
        status === 409
          ? 'Someone changed this selector just now. It has been refreshed.'
          : status === 404
            ? "This selector isn't available any more."
            : "That didn't work. Try again.",
        'error',
      );
    } finally {
      setBusy(false);
      setDialog(null);
      onChanged();
    }
  };

  const copy = async (text: string, done: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(done, 'success');
    } catch {
      toast("Couldn't copy: your browser blocked it.", 'error');
    }
  };

  const status = detail?.state?.status ?? 'active';
  const chart = useMemo(() => {
    const daily = detail?.daily ?? [];
    const start = daily[0]?.t ?? 0;
    return { start, times: daily.map((d) => d.t - start), values: daily.map((d) => d.heals) };
  }, [detail]);

  return (
    <aside
      aria-label="Selector details"
      className="sticky top-4 flex max-h-[calc(100vh-7rem)] w-[480px] shrink-0 flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]"
    >
      <header className="border-b border-[var(--border)] p-4">
        <div className="flex items-center gap-2">
          <Chip>{strategyLabel(target.strategy)}</Chip>
          {detail && <StatusPill state={detail.state} />}
          <span className="ml-auto flex items-center gap-0.5">
            <IconButton
              label="Copy selector"
              onClick={() => void copy(target.selector, 'Selector copied')}
            >
              <Copy size={14} />
            </IconButton>
            <IconButton
              label="Copy link to this selector"
              onClick={() => void copy(window.location.href, 'Link copied')}
            >
              <Link2 size={14} />
            </IconButton>
            <IconButton label="Close" onClick={onClose}>
              <X size={14} />
            </IconButton>
          </span>
        </div>
        <code className="mt-2 block break-all font-mono text-xs leading-relaxed text-[var(--text)]">
          {target.selector}
        </code>
        {detail?.canAct && (
          <div className="mt-3 flex flex-wrap gap-2">
            {/* A selector recorded with no type can't be verified: new runs record one. */}
            {status === 'active' && target.strategy !== '' && (
              <Button size="sm" onClick={() => setDialog('mark_fixed')}>
                Mark fixed
              </Button>
            )}
            {status === 'pending' && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setDialog('cancel_verification')}
              >
                Cancel verification
              </Button>
            )}
            {status !== 'muted' && (
              <Button size="sm" variant="secondary" onClick={() => setDialog('mute')}>
                Mute…
              </Button>
            )}
            {status === 'muted' && (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => void act('unmute')}
              >
                Unmute
              </Button>
            )}
          </div>
        )}
      </header>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        {phase === 'loading' && <p className="text-xs text-[var(--text-dim)]">Loading…</p>}
        {phase === 'missing' && (
          <p className="text-sm text-[var(--text-muted)]">
            This selector isn&apos;t available. It may belong to another team, or Xenon has no heals
            on record for it.
          </p>
        )}
        {phase === 'failed' && (
          <p className="text-sm text-[var(--text-muted)]">
            Couldn&apos;t load this selector. Try again in a moment.
          </p>
        )}
        {detail && detail.heals === 0 && (
          <p className="text-sm text-[var(--text-muted)]">No heals in the last {days} days.</p>
        )}
        {detail && detail.heals > 0 && (
          <>
            <Section title="Suggested fix">
              {detail.suggestions.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)]">
                  Xenon found the element without a selector it can suggest.
                </p>
              ) : (
                <ul className="space-y-2">
                  {detail.suggestions.map((s, i) => (
                    <li
                      key={`${s.strategy ?? ''}\u0000${s.selector}`}
                      className={`rounded-md border p-2.5 ${
                        i === 0 ? 'border-[var(--color-success)]' : 'border-[var(--border)]'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                            <Chip>{strategyLabel(s.strategy)}</Chip>
                            <span>{shareText(s.share)}</span>
                            {s.methods.length > 0 && (
                              <span
                                title={s.methods.map((m) => METHOD_EXPLANATIONS[m] ?? m).join('. ')}
                              >
                                · {s.methods.join(', ')}
                              </span>
                            )}
                            {s.averageConfidence !== null && (
                              <span>· {Math.round(s.averageConfidence * 100)}% confidence</span>
                            )}
                          </div>
                          <code className="mt-1 block break-all font-mono text-[11px] text-[var(--text)]">
                            {s.selector}
                          </code>
                        </div>
                        <CopyButton
                          strategy={s.strategy ?? target.strategy}
                          value={s.selector}
                          onCopied={(lang) => toast(`Copied as ${lang}`, 'success')}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title={`In the last ${days} days`}>
              <div className="grid grid-cols-3 gap-2">
                {[
                  {
                    label: detail.heals === 1 ? 'heal' : 'heals',
                    value: detail.heals.toLocaleString(),
                  },
                  {
                    label: detail.sessions === 1 ? 'session' : 'sessions',
                    value: detail.sessions.toLocaleString(),
                  },
                  { label: 'spent healing', value: formatDuration(detail.timeSpentMs) },
                ].map((s) => (
                  <div
                    key={s.label}
                    className="rounded-md bg-[rgb(var(--rgb-fg)/0.04)] px-2.5 py-2"
                  >
                    <div className="text-sm font-semibold tabular-nums text-[var(--text)]">
                      {s.value}
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)]">{s.label}</div>
                  </div>
                ))}
              </div>
              {chart.times.length > 1 && (
                <div className="mt-3">
                  <LineChart
                    times={chart.times}
                    series={[
                      {
                        key: 'heals',
                        label: 'Heals',
                        color: 'var(--color-info)',
                        values: chart.values,
                      },
                    ]}
                    formatValue={(v) => String(Math.round(v))}
                    formatTime={(t) => formatDay(chart.start + t)}
                    ariaLabel="Heals per day for this selector"
                    height={56}
                  />
                </div>
              )}
            </Section>

            <Section title="Where it happens">
              <Breakdown
                title="Platforms"
                rows={detail.platforms.map((p) => ({
                  key: p.name,
                  label: platformLabel(p.name),
                  count: p.count,
                }))}
              />
              <Breakdown
                title="Builds"
                rows={detail.builds.map((b) => ({
                  key: b.id ?? '',
                  label: b.name,
                  count: b.count,
                }))}
              />
              <Breakdown
                title="Devices"
                rows={detail.devices.map((d) => ({ key: d.udid, label: d.name, count: d.count }))}
              />
            </Section>

            <Section title="Recent heals">
              <ul className="divide-y divide-[var(--border)]">
                {detail.recent.map((r) => (
                  <li key={r.id} className="py-2 text-[11px]">
                    <div className="flex items-center gap-1.5 text-[var(--text-muted)]">
                      <span>{formatRelative(r.at)}</span>
                      {r.device && <span className="min-w-0 truncate">· {r.device}</span>}
                      {r.method && (
                        <span title={METHOD_EXPLANATIONS[r.method]}>
                          · {r.method}
                          {r.confidence !== null ? ` ${Math.round(r.confidence * 100)}%` : ''}
                        </span>
                      )}
                      <Link
                        className="ml-auto shrink-0 text-[var(--color-accent)] hover:underline"
                        to={`/builds/${encodeURIComponent(r.buildId ?? 'none')}/sessions/${encodeURIComponent(r.sessionId)}`}
                      >
                        Session
                      </Link>
                    </div>
                    {r.healedSelector && (
                      <code
                        className="mt-0.5 block truncate font-mono text-[var(--text)]"
                        title={r.healedSelector}
                      >
                        {r.healedSelector}
                      </code>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          </>
        )}
        {detail && <ActivityList activity={detail.activity} />}
      </div>

      <MarkFixedDialog
        open={dialog === 'mark_fixed'}
        busy={busy}
        onClose={() => setDialog(null)}
        onConfirm={() => void act('mark_fixed')}
      />
      <CancelVerificationDialog
        open={dialog === 'cancel_verification'}
        busy={busy}
        onClose={() => setDialog(null)}
        onConfirm={() => void act('cancel_verification')}
      />
      <MuteDialog
        open={dialog === 'mute'}
        busy={busy}
        onClose={() => setDialog(null)}
        onConfirm={(reason) => void act('mute', reason || undefined)}
      />
    </aside>
  );
};
