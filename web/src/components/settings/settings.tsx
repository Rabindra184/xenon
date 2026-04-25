import React, { useState, useEffect } from 'react';
import XenonApiService from '../../api-service';
import './settings.css';
import { ActionBar } from '../ui/Layouts';
import {
  Shield as InfrastructureIcon,
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
} from 'lucide-react';
import { SettingCard } from '../ui/SettingCard';
import { PageHeader } from '../ui/page-header';
import { useToast } from '../ui/toast';

interface InfraConfig {
  healthCheckIntervalMs: number;
  healthCheckSchedule: string;
  enableSelfHealing: boolean;
}

const DEFAULTS: InfraConfig = {
  healthCheckIntervalMs: 30000,
  healthCheckSchedule: '',
  enableSelfHealing: true,
};

const MIN_INTERVAL_MS = 5000;

const PRESETS = [
  { label: 'Battery Saver (2 AM)', value: '0 2 * * *' },
  { label: 'Standard (Hourly)', value: '0 * * * *' },
  { label: 'Operational Coverage (30m)', value: '*/30 * * * *' },
  { label: 'High Performance (10m)', value: '*/10 * * * *' },
];

// Recent healing events — sample data; wire to a real API once it lands.
const SAMPLE_HEALING_EVENTS = [
  { kind: 'Visual AI', message: 'Recovered missing login button locator', when: '2m ago' },
  { kind: 'OCR', message: 'Text fallback used for navigation menu', when: '1h ago' },
  { kind: 'Fuzzy XML', message: 'Healed dynamic ID change in form', when: '5h ago' },
];

const cfgEqual = (a: InfraConfig, b: InfraConfig) =>
  a.healthCheckIntervalMs === b.healthCheckIntervalMs &&
  a.healthCheckSchedule === b.healthCheckSchedule &&
  a.enableSelfHealing === b.enableSelfHealing;

export const Settings: React.FC = () => {
  const { toast } = useToast();
  const [config, setConfig] = useState<InfraConfig>(DEFAULTS);
  const [baseline, setBaseline] = useState<InfraConfig>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const data = await XenonApiService.getGlobalConfig();
      const next: InfraConfig = {
        healthCheckIntervalMs: data.healthCheckIntervalMs || 30000,
        healthCheckSchedule: data.healthCheckSchedule || '',
        enableSelfHealing: data.enableSelfHealing !== undefined ? data.enableSelfHealing : true,
      };
      setConfig(next);
      setBaseline(next);
    } catch (error) {
      console.error('Failed to load settings', error);
      toast('Failed to access infrastructure parameters.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const isDirty = !cfgEqual(config, baseline);
  const intervalError =
    Number.isNaN(config.healthCheckIntervalMs) || config.healthCheckIntervalMs < MIN_INTERVAL_MS
      ? `Below minimum safe value of ${MIN_INTERVAL_MS}ms.`
      : null;
  const canSave = isDirty && !intervalError;

  const dirty = {
    interval: config.healthCheckIntervalMs !== baseline.healthCheckIntervalMs,
    schedule: config.healthCheckSchedule !== baseline.healthCheckSchedule,
    healing: config.enableSelfHealing !== baseline.enableSelfHealing,
  };

  const handleSave = async (override?: InfraConfig) => {
    const payload = override ?? config;
    if (!override && intervalError) {
      toast(intervalError, 'error');
      return;
    }
    setSaving(true);
    try {
      await XenonApiService.updateGlobalConfig(payload);
      setBaseline(payload);
      setConfig(payload);
      toast('Infrastructure parameters synchronized across fleet.', 'success');
    } catch (error) {
      console.error('Failed to save settings', error);
      toast('Synchronization failed. Check network integrity.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleResetToDefaults = async () => {
    setConfig(DEFAULTS);
    await handleSave(DEFAULTS);
    try {
      await XenonApiService.resetMetrics();
    } catch (e) {
      console.error('Failed to reset metrics', e);
    }
  };

  const handleDiscard = () => {
    setConfig(baseline);
  };

  const scheduleActive = config.healthCheckSchedule !== '';

  if (loading) {
    return (
      <div className="settings-loading">
        <RefreshCw className="animate-spin" size={32} />
        <span>Synchronizing Global Infrastructure...</span>
      </div>
    );
  }

  return (
    <div className="settings-container">
      <PageHeader
        icon={InfrastructureIcon}
        title="Infrastructure Control"
        subtitle="Manage core farm parameters, heartbeat frequency, and maintenance orchestrations across the global registry."
      />

      <div className="settings-content">
        <div className="settings-grid settings-grid--three">
          <SettingCard
            icon={<Clock size={16} />}
            title={
              <span className="card-title-row">
                Idle Health Frequency
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
                Deep Diagnostic Schedule
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
                placeholder="e.g. 0 * * * * (At internal min 0)"
                value={config.healthCheckSchedule}
                onChange={(e) =>
                  setConfig({ ...config, healthCheckSchedule: e.target.value })
                }
              />
            </div>

            <div className="cron-presets">
              <div className="presets-label">
                <MousePointer2 size={12} />
                <span>Intent-Based Presets</span>
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
                AI Self-Healing
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
                  aria-label="Toggle AI Self-Healing"
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
              {config.enableSelfHealing ? 'ENABLED' : 'DISABLED'}
            </div>
            <p className="setting-card-description">
              Automatically intercept and recover from failing locators using Xenon&apos;s 5-tier
              strategy. When enabled, Xenon will attempt to find elements via Fuzzy XML, OCR,
              Visual AI, and LLM before failing a test.
            </p>

            {config.enableSelfHealing && (
              <div className="healing-events">
                <div className="healing-events__header">
                  <FileText size={11} />
                  <span>Recent Healing Events</span>
                </div>
                <ul className="healing-events__list">
                  {SAMPLE_HEALING_EVENTS.map((ev) => (
                    <li className="healing-event" key={ev.kind}>
                      <CheckCircle2 size={14} className="healing-event__icon" />
                      <div className="healing-event__body">
                        <div className="healing-event__row">
                          <span className="healing-event__kind">{ev.kind}</span>
                          <span className="healing-event__when">{ev.when}</span>
                        </div>
                        <div className="healing-event__message">{ev.message}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </SettingCard>
        </div>
      </div>

      {(isDirty || saving) && (
        <ActionBar
          onSave={() => handleSave()}
          onDiscard={handleDiscard}
          onRestoreDefaults={handleResetToDefaults}
          isSaving={saving}
          isValidating={!!intervalError}
          isDirty={isDirty}
          saveLabel={canSave ? 'Save Configuration' : 'Resolve errors to save'}
        />
      )}
    </div>
  );
};
