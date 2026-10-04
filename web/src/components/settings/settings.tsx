import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import XenonApiService from '../../api-service';
import './settings.css';
import { ActionBar } from '../ui/Layouts';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/button';
import {
  Settings as InfrastructureIcon,
  RefreshCw,
  Clock,
  Calendar,
  MousePointer2,
  Brain,
  Check,
  Activity,
  AlertCircle,
  CheckCircle2,
  FileText,
  ArrowUpRight,
} from 'lucide-react';
import { SettingCard } from '../ui/SettingCard';
import { PageHeader } from '../ui/page-header';
import { useToast } from '../ui/toast';
import { IHealingEvent, IHealingEventsResponse } from '../../interfaces/IHealingEvent';
import { useSocket } from '../../hooks/useSocket';
import { toastSaveError } from '../../api-service/api-client';

interface InfraConfig {
  healthCheckIntervalMs: number;
  healthCheckSchedule: string;
  enableSelfHealing: boolean;
}

/**
 * What "restore defaults" goes back to. The interval is the server's own
 * default, sent with the settings (GET /config `defaults`): the page used to
 * carry a number of its own, 30000 ms, where the server runs 300000.
 */
const defaultsFrom = (serverDefaults: { healthCheckIntervalMs: number }): InfraConfig => ({
  healthCheckIntervalMs: serverDefaults.healthCheckIntervalMs,
  healthCheckSchedule: '',
  enableSelfHealing: true,
});

const MIN_INTERVAL_MS = 5000;

const PRESETS = [
  { label: 'Battery saver (2 AM)', value: '0 2 * * *' },
  { label: 'Standard (hourly)', value: '0 * * * *' },
  { label: 'Operational coverage (30m)', value: '*/30 * * * *' },
  { label: 'High performance (10m)', value: '*/10 * * * *' },
];

const MAX_HEALING_EVENTS = 5;

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

function healingEventDescription(ev: IHealingEvent): string {
  const original = ev.originalSelector?.trim();
  const healed = ev.healedSelector?.trim();
  // When tier is the chip, prefix with the command so the row still
  // explains *what* was healed instead of just how.
  const cmdPrefix = ev.tier && ev.commandName ? `${ev.commandName}: ` : '';
  if (original && healed && original !== healed) {
    return `${cmdPrefix}${original} → ${healed}`;
  }
  if (healed) return `${cmdPrefix}Recovered locator ${healed}`;
  if (original) return `${cmdPrefix}Recovered locator ${original}`;
  const conf = typeof ev.confidence === 'number' ? ` (${Math.round(ev.confidence * 100)}%)` : '';
  return `${cmdPrefix || ''}Self-healed${conf}`;
}

function healingEventKindLabel(ev: IHealingEvent): string {
  if (ev.tier) return ev.tier;
  if (ev.commandName) return ev.commandName;
  if (ev.deviceName) return ev.deviceName;
  return 'Self-heal';
}

const cfgEqual = (a: InfraConfig, b: InfraConfig) =>
  a.healthCheckIntervalMs === b.healthCheckIntervalMs &&
  a.healthCheckSchedule === b.healthCheckSchedule &&
  a.enableSelfHealing === b.enableSelfHealing;

/**
 * Only what the person changed. A setting sent is saved as the lab's own and
 * from then on hides whatever the server is started with, so one that was
 * never touched must not be sent along with one that was.
 */
const changedFields = (config: InfraConfig, baseline: InfraConfig): Partial<InfraConfig> => {
  const changed: Partial<InfraConfig> = {};
  if (config.healthCheckIntervalMs !== baseline.healthCheckIntervalMs) {
    changed.healthCheckIntervalMs = config.healthCheckIntervalMs;
  }
  if (config.healthCheckSchedule !== baseline.healthCheckSchedule) {
    changed.healthCheckSchedule = config.healthCheckSchedule;
  }
  if (config.enableSelfHealing !== baseline.enableSelfHealing) {
    changed.enableSelfHealing = config.enableSelfHealing;
  }
  return changed;
};

export const Settings: React.FC = () => {
  const { toast } = useToast();
  const [config, setConfig] = useState<InfraConfig | null>(null);
  const [baseline, setBaseline] = useState<InfraConfig | null>(null);
  const [defaults, setDefaults] = useState<InfraConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [healingEvents, setHealingEvents] = useState<IHealingEvent[]>([]);
  const [healingLoaded, setHealingLoaded] = useState(false);
  const { on } = useSocket();

  useEffect(() => {
    loadConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    XenonApiService.getRecentHealingEvents(MAX_HEALING_EVENTS)
      .then((r: IHealingEventsResponse) => {
        if (cancelled || !r) return;
        const events = Array.isArray(r.events) ? r.events.slice(0, MAX_HEALING_EVENTS) : [];
        setHealingEvents(events);
      })
      .catch(() => { /* ignore */ })
      .finally(() => {
        if (!cancelled) setHealingLoaded(true);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const unsub = on('healing_event', (payload: any) => {
      const ev = payload as IHealingEvent;
      if (!ev || !ev.id) return;
      setHealingEvents((prev) => {
        if (prev.some((e) => e.id === ev.id)) return prev;
        return [ev, ...prev].slice(0, MAX_HEALING_EVENTS);
      });
    });
    return () => { unsub && unsub(); };
  }, [on]);

  const loadConfig = async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const data = await XenonApiService.getGlobalConfig();
      // The server's answer carries its defaults. Without them (an error body,
      // which a read resolves with) there is nothing true to show.
      if (!data || !data.defaults) throw new Error(data?.message || 'No settings in the answer');
      const serverDefaults = defaultsFrom(data.defaults);
      const next: InfraConfig = {
        healthCheckIntervalMs: data.healthCheckIntervalMs ?? serverDefaults.healthCheckIntervalMs,
        healthCheckSchedule: data.healthCheckSchedule || '',
        enableSelfHealing: data.enableSelfHealing !== undefined ? data.enableSelfHealing : true,
      };
      setDefaults(serverDefaults);
      setConfig(next);
      setBaseline(next);
    } catch (error) {
      console.error('Failed to load settings', error);
      setLoadFailed(true);
      toast('Failed to access infrastructure parameters.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const isDirty = config !== null && baseline !== null && !cfgEqual(config, baseline);
  const intervalError =
    config !== null &&
    (Number.isNaN(config.healthCheckIntervalMs) || config.healthCheckIntervalMs < MIN_INTERVAL_MS)
      ? `Below minimum safe value of ${MIN_INTERVAL_MS}ms.`
      : null;
  const canSave = isDirty && !intervalError;

  const dirty = {
    interval: config?.healthCheckIntervalMs !== baseline?.healthCheckIntervalMs,
    schedule: config?.healthCheckSchedule !== baseline?.healthCheckSchedule,
    healing: config?.enableSelfHealing !== baseline?.enableSelfHealing,
  };

  const handleSave = async (override?: InfraConfig) => {
    if (!config || !baseline) return;
    if (!override && intervalError) {
      toast(intervalError, 'error');
      return;
    }
    // A save sends what changed; restoring defaults is a choice of every value.
    const payload = override ?? changedFields(config, baseline);
    const next = override ?? config;
    setSaving(true);
    try {
      await XenonApiService.updateGlobalConfig(payload);
      setBaseline(next);
      setConfig(next);
      toast('Infrastructure parameters synchronized across fleet.', 'success');
    } catch (error) {
      console.error('Failed to save settings', error);
      toastSaveError(toast, error);
    } finally {
      setSaving(false);
    }
  };

  const handleResetToDefaults = async () => {
    if (!defaults) return;
    setConfig(defaults);
    await handleSave(defaults);
    try {
      await XenonApiService.resetMetrics();
    } catch (e) {
      console.error('Failed to reset metrics', e);
    }
  };

  const handleDiscard = () => {
    setConfig(baseline);
  };

  if (loading) {
    return (
      <div className="settings-loading">
        <RefreshCw className="animate-spin" size={32} />
        <span>Synchronizing Global Infrastructure...</span>
      </div>
    );
  }

  // No form of made-up numbers: saving one would change how the lab runs.
  if (loadFailed || !config || !defaults) {
    return (
      <div className="settings-loading" role="alert">
        <AlertCircle size={32} />
        <span>Couldn&apos;t load the settings from the server.</span>
        <Button variant="secondary" onClick={() => loadConfig()}>
          Try again
        </Button>
      </div>
    );
  }

  const scheduleActive = config.healthCheckSchedule !== '';

  return (
    <div className="settings-container">
      <PageHeader
        icon={InfrastructureIcon}
        title="Settings"
        subtitle="Manage core farm parameters, heartbeat frequency, and maintenance orchestrations across the global registry."
      />

      <div className="settings-content">
        <div className="settings-grid settings-grid--three">
          <SettingCard
            icon={<Clock size={16} />}
            title={
              <span className="card-title-row">
                Idle health frequency
                {dirty.interval && <span className="modified-dot" aria-label="Modified" />}
              </span>
            }
            description="Frequency of passive health pings when the system is in idle state."
            hint="Minimum safe value: 5000ms. Note: This frequency is overridden when a schedule is active."
          >
            <div className="card-spacer" />
            <div className={`input-group ${intervalError ? 'has-error' : ''}`}>
              <input
                type="number"
                value={config.healthCheckIntervalMs}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    healthCheckIntervalMs: parseInt(e.target.value, 10),
                  })
                }
                min={MIN_INTERVAL_MS}
                step={5000}
                aria-invalid={!!intervalError}
                aria-describedby={intervalError ? 'interval-error' : 'interval-status'}
              />
              <span className="code-font">MS</span>
            </div>
            {intervalError ? (
              <div id="interval-error" className="input-status input-status--error" role="alert">
                <AlertCircle size={12} />
                <span>{intervalError}</span>
              </div>
            ) : (
              <div id="interval-status" className="input-status input-status--ok">
                <CheckCircle2 size={12} />
                <span>Valid frequency</span>
              </div>
            )}
          </SettingCard>

          <SettingCard
            icon={<Calendar size={16} />}
            title={
              <span className="card-title-row">
                Deep diagnostic schedule
                {dirty.schedule && <span className="modified-dot" aria-label="Modified" />}
              </span>
            }
            titleExtra={
              scheduleActive ? (
                <span className="active-pill">
                  <Activity size={11} />
                  <span>Active</span>
                </span>
              ) : null
            }
            description="Execute intensive reliability bursts (WDA restarts, Cache purges) using standardized Cron syntax."
          >
            <div className="setting-input-wrapper">
              <input
                type="text"
                placeholder="e.g. 0 * * * * (hourly, at minute 0)"
                value={config.healthCheckSchedule}
                onChange={(e) =>
                  setConfig({ ...config, healthCheckSchedule: e.target.value })
                }
              />
            </div>

            <div className="cron-presets">
              <div className="presets-label">
                <MousePointer2 size={12} />
                <span>Intent-based presets</span>
              </div>
              <div className="presets-grid presets-grid--stacked">
                {PRESETS.map((p) => {
                  const active = config.healthCheckSchedule === p.value;
                  return (
                    <button
                      type="button"
                      key={p.label}
                      className={`preset-chip ${active ? 'active' : ''}`}
                      onClick={() => setConfig({ ...config, healthCheckSchedule: p.value })}
                      aria-pressed={active}
                    >
                      {active && <Check size={11} className="preset-chip__check" />}
                      <span>{p.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </SettingCard>

          <SettingCard
            icon={<Brain size={16} />}
            title={
              <span className="card-title-row">
                AI self-healing
                {dirty.healing && <span className="modified-dot" aria-label="Modified" />}
              </span>
            }
            titleExtra={
              <label className="switch switch--header">
                <input
                  type="checkbox"
                  checked={config.enableSelfHealing}
                  onChange={(e) =>
                    setConfig({ ...config, enableSelfHealing: e.target.checked })
                  }
                  aria-label="Toggle AI self-healing"
                />
                <span className="slider round"></span>
              </label>
            }
          >
            <div
              className={`healing-state ${
                config.enableSelfHealing ? 'is-on' : 'is-off'
              }`}
            >
              {config.enableSelfHealing ? 'Enabled' : 'Disabled'}
            </div>
            <p className="setting-card-description">
              Automatically intercept and recover from failing locators using Xenon&apos;s 6-tier
              strategy: etalon recovery, native retry, fuzzy XML, OCR, visual AI, and LLM —
              before failing a test.
            </p>

            {config.enableSelfHealing && (
              <div className="healing-events">
                <div className="healing-events__header">
                  <FileText size={11} />
                  <span>Recent healing events</span>
                  <Link to="/selector-health" className="healing-events__link">
                    Selector health <ArrowUpRight size={10} />
                  </Link>
                </div>
                {healingEvents.length > 0 ? (
                  <ul className="healing-events__list">
                    {healingEvents.map((ev) => (
                      <li className="healing-event" key={ev.id}>
                        <CheckCircle2 size={14} className="healing-event__icon" />
                        <div className="healing-event__body">
                          <div className="healing-event__row">
                            <span className="healing-event__kind">{healingEventKindLabel(ev)}</span>
                            <span className="healing-event__when">{formatRelative(ev.createdAt)}</span>
                          </div>
                          <div className="healing-event__message" title={healingEventDescription(ev)}>
                            {healingEventDescription(ev)}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="healing-events__empty">
                    {healingLoaded
                      ? 'No healing events recorded yet — the dashboard will populate as locators are recovered.'
                      : 'Loading recent events…'}
                  </div>
                )}
              </div>
            )}
          </SettingCard>
        </div>
      </div>

      {(isDirty || saving) && (
        <ActionBar
          onSave={() => handleSave()}
          onDiscard={handleDiscard}
          // Confirm first: it writes the server config and zeroes metrics,
          // and it sits one button away from Discard.
          onRestoreDefaults={() => setConfirmingReset(true)}
          isSaving={saving}
          isValidating={!!intervalError}
          isDirty={isDirty}
          saveLabel={canSave ? 'Save Configuration' : 'Resolve errors to save'}
        />
      )}

      <Modal
        open={confirmingReset}
        onClose={() => setConfirmingReset(false)}
        title="Restore default settings?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmingReset(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                setConfirmingReset(false);
                await handleResetToDefaults();
              }}
            >
              Restore defaults
            </Button>
          </>
        }
      >
        <p className="text-sm text-[var(--text-muted)]">This saves immediately and can't be undone:</p>
        <ul className="mt-2 list-disc pl-5 text-sm text-[var(--text)] space-y-1">
          <li>Idle health frequency goes back to {defaults.healthCheckIntervalMs.toLocaleString()} ms</li>
          <li>The diagnostic schedule is cleared</li>
          <li>AI self-healing is turned on</li>
          <li>Every device's healed-selector count is reset to zero</li>
        </ul>
      </Modal>
    </div>
  );
};
