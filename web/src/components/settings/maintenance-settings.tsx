import React, { useState, useEffect } from 'react';
import XenonApiService from '../../api-service';
import './settings.css';
import {
  ShieldCheck as MaintenanceIcon,
  RefreshCw,
  Calendar,
  Info,
  History,
  Trash2,
  ShieldCheck,
  Check,
  AlertCircle,
} from 'lucide-react';
import { ActionBar } from '../ui/Layouts';
import { Button } from '../ui/button';
import { SettingCard } from '../ui/SettingCard';
import { PageHeader } from '../ui/page-header';
import { useToast } from '../ui/toast';
import { toastSaveError } from '../../api-service/api-client';

interface MaintenanceConfig {
  buildCleanupDays: number;
  buildCleanupMaxCount: number;
  buildCleanupSchedule: string;
  deleteBuildAssets: boolean;
}

/**
 * What "restore defaults" goes back to: the server's own defaults, sent with
 * the settings (GET /config `defaults`), not numbers kept here.
 */
const defaultsFrom = (serverDefaults: MaintenanceConfig): MaintenanceConfig => ({
  buildCleanupDays: serverDefaults.buildCleanupDays,
  buildCleanupMaxCount: serverDefaults.buildCleanupMaxCount,
  buildCleanupSchedule: serverDefaults.buildCleanupSchedule,
  deleteBuildAssets: serverDefaults.deleteBuildAssets,
});

const SCHEDULE_PRESETS = [
  { label: 'Daily (midnight)', value: '0 0 * * *' },
  { label: 'Weekly (Sunday)', value: '0 0 * * 0' },
  { label: 'Every 12 hours', value: '0 */12 * * *' },
];

const cfgEqual = (a: MaintenanceConfig, b: MaintenanceConfig) =>
  a.buildCleanupDays === b.buildCleanupDays &&
  a.buildCleanupMaxCount === b.buildCleanupMaxCount &&
  a.buildCleanupSchedule === b.buildCleanupSchedule &&
  a.deleteBuildAssets === b.deleteBuildAssets;

/**
 * Only what the person changed. A value sent is saved as the lab's own and
 * from then on replaces what the server was started with, so one that was
 * never touched must not be sent along with one that was.
 */
const changedFields = (
  config: MaintenanceConfig,
  baseline: MaintenanceConfig,
): Partial<MaintenanceConfig> => {
  const changed: Partial<MaintenanceConfig> = {};
  if (config.buildCleanupDays !== baseline.buildCleanupDays) {
    changed.buildCleanupDays = config.buildCleanupDays;
  }
  if (config.buildCleanupMaxCount !== baseline.buildCleanupMaxCount) {
    changed.buildCleanupMaxCount = config.buildCleanupMaxCount;
  }
  if (config.buildCleanupSchedule !== baseline.buildCleanupSchedule) {
    changed.buildCleanupSchedule = config.buildCleanupSchedule;
  }
  if (config.deleteBuildAssets !== baseline.deleteBuildAssets) {
    changed.deleteBuildAssets = config.deleteBuildAssets;
  }
  return changed;
};

export const MaintenanceSettings: React.FC = () => {
  const { toast } = useToast();
  const [config, setConfig] = useState<MaintenanceConfig | null>(null);
  const [baseline, setBaseline] = useState<MaintenanceConfig | null>(null);
  const [defaults, setDefaults] = useState<MaintenanceConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadConfig = async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const data = await XenonApiService.getGlobalConfig();
      // The server's answer carries its defaults. Without them (an error body,
      // which a read resolves with) there is nothing true to show.
      if (!data || !data.defaults) throw new Error(data?.message || 'No settings in the answer');
      const serverDefaults = defaultsFrom(data.defaults);
      const next: MaintenanceConfig = {
        buildCleanupDays: data.buildCleanupDays ?? serverDefaults.buildCleanupDays,
        buildCleanupMaxCount: data.buildCleanupMaxCount ?? serverDefaults.buildCleanupMaxCount,
        buildCleanupSchedule: data.buildCleanupSchedule || serverDefaults.buildCleanupSchedule,
        deleteBuildAssets: data.deleteBuildAssets ?? serverDefaults.deleteBuildAssets,
      };
      setDefaults(serverDefaults);
      setConfig(next);
      setBaseline(next);
    } catch (error) {
      console.error('Failed to load maintenance settings', error);
      setLoadFailed(true);
      toast('Failed to access maintenance parameters.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (override?: MaintenanceConfig) => {
    if (!config || !baseline) return;
    // A save sends what changed; restoring defaults is a choice of every value.
    const payload = override ?? changedFields(config, baseline);
    const next = override ?? config;
    setSaving(true);
    try {
      await XenonApiService.updateGlobalConfig(payload);
      setBaseline(next);
      setConfig(next);
      toast('Maintenance parameters synchronized across fleet.', 'success');
    } catch (error) {
      console.error('Failed to save maintenance settings', error);
      toastSaveError(toast, error);
    } finally {
      setSaving(false);
    }
  };

  const handleResetToDefaults = async () => {
    if (!defaults) return;
    setConfig(defaults);
    await handleSave(defaults);
  };

  const handleDiscard = () => {
    setConfig(baseline);
  };

  const isDirty = config !== null && baseline !== null && !cfgEqual(config, baseline);
  const dirty = {
    days: config?.buildCleanupDays !== baseline?.buildCleanupDays,
    max: config?.buildCleanupMaxCount !== baseline?.buildCleanupMaxCount,
    purge: config?.deleteBuildAssets !== baseline?.deleteBuildAssets,
    schedule: config?.buildCleanupSchedule !== baseline?.buildCleanupSchedule,
  };

  if (loading) {
    return (
      <div className="settings-loading">
        <RefreshCw className="animate-spin" size={32} />
        <span>Synchronizing Maintenance Parameters...</span>
      </div>
    );
  }

  // No form of made-up numbers: saving one would change what gets deleted.
  if (loadFailed || !config || !defaults) {
    return (
      <div className="settings-loading" role="alert">
        <AlertCircle size={32} />
        <span>Couldn&apos;t load the maintenance settings from the server.</span>
        <Button variant="secondary" onClick={() => loadConfig()}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="settings-container">
      <PageHeader
        icon={MaintenanceIcon}
        title="Maintenance"
        subtitle="Manage the lifecycle of test artifacts, automated purging schedules, and storage optimization across the global registry."
      />

      <div className="settings-content">
        <div className="settings-grid settings-grid--two-equal">
          <SettingCard
            icon={<History size={16} />}
            title={
              <span className="card-title-row">
                Retention window
                {dirty.days && <span className="modified-dot" aria-label="Modified" />}
              </span>
            }
            description="Number of days to preserve builds and sessions before automatic purging from the system."
            hint="Standard enterprise retention is typically 30-90 days."
          >
            <div className="input-group">
              <input
                type="number"
                value={config.buildCleanupDays}
                onChange={(e) =>
                  setConfig({ ...config, buildCleanupDays: parseInt(e.target.value, 10) })
                }
                min={1}
              />
              <span className="code-font">days</span>
            </div>
          </SettingCard>

          <SettingCard
            icon={<Trash2 size={16} />}
            title={
              <span className="card-title-row">
                Max build capacity
                {dirty.max && <span className="modified-dot" aria-label="Modified" />}
              </span>
            }
            description="Cap the maximum number of historical builds stored in the primary database."
            hint="Protects against database bloat during high-frequency CI bursts."
          >
            <div className="input-group">
              <input
                type="number"
                value={config.buildCleanupMaxCount}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    buildCleanupMaxCount: parseInt(e.target.value, 10),
                  })
                }
                min={1}
              />
              <span className="code-font">builds</span>
            </div>
          </SettingCard>

          <SettingCard
            icon={<ShieldCheck size={16} />}
            title={
              <span className="card-title-row">
                Asset purge strategy
                {dirty.purge && <span className="modified-dot" aria-label="Modified" />}
              </span>
            }
            description="Automatically remove binary artifacts (videos, screenshots) when build records are purged."
            hint="Disabling this will leave orphaned files on disk—use with caution."
          >
            <div className="toggle-group">
              <label className="switch">
                <input
                  type="checkbox"
                  checked={config.deleteBuildAssets}
                  onChange={(e) =>
                    setConfig({ ...config, deleteBuildAssets: e.target.checked })
                  }
                />
                <span className="slider round"></span>
              </label>
              <span className="toggle-label">
                {config.deleteBuildAssets ? 'Enabled' : 'Disabled'}
              </span>
            </div>
          </SettingCard>

          <SettingCard
            icon={<Calendar size={16} />}
            title={
              <span className="card-title-row">
                Cleanup orchestration
                {dirty.schedule && <span className="modified-dot" aria-label="Modified" />}
              </span>
            }
            description="Standardized Cron syntax for scheduling the automated cleanup engine."
          >
            <div className="setting-input-wrapper">
              <input
                type="text"
                placeholder="e.g. 0 0 * * * (Midnight)"
                value={config.buildCleanupSchedule}
                onChange={(e) =>
                  setConfig({ ...config, buildCleanupSchedule: e.target.value })
                }
              />
            </div>

            <div className="cron-presets">
              <div className="presets-grid">
                {SCHEDULE_PRESETS.map((p) => {
                  const active = config.buildCleanupSchedule === p.value;
                  return (
                    <button
                      type="button"
                      key={p.label}
                      className={`preset-chip ${active ? 'active' : ''}`}
                      onClick={() =>
                        setConfig({ ...config, buildCleanupSchedule: p.value })
                      }
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
        </div>

        <div className="health-monitor-alert maintenance-notice">
          <Info size={18} />
          <span>
            <strong>Resource Notice:</strong> Bulk purging operations are non-blocking and
            execute at low priority to ensure zero interference with active test execution.
          </span>
        </div>
        <div className="health-monitor-alert maintenance-notice">
          <Info size={18} />
          <span>
            Values saved here replace the values the server started with. Retention changes apply at
            the next cleanup run, and a new schedule starts at once.
          </span>
        </div>
      </div>

      {(isDirty || saving) && (
        <ActionBar
          onSave={() => handleSave()}
          onDiscard={handleDiscard}
          onRestoreDefaults={handleResetToDefaults}
          isSaving={saving}
          isDirty={isDirty}
          saveLabel="Save configuration"
        />
      )}
    </div>
  );
};
