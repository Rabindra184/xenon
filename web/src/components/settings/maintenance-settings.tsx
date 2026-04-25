import React, { useState, useEffect } from 'react';
import XenonApiService from '../../api-service';
import './settings.css';
import {
  Shield as MaintenanceIcon,
  RefreshCw,
  Calendar,
  Info,
  History,
  Trash2,
  ShieldCheck,
  Check,
} from 'lucide-react';
import { ActionBar } from '../ui/Layouts';
import { SettingCard } from '../ui/SettingCard';
import { PageHeader } from '../ui/page-header';
import { useToast } from '../ui/toast';

interface MaintenanceConfig {
  buildCleanupDays: number;
  buildCleanupMaxCount: number;
  buildCleanupSchedule: string;
  deleteBuildAssets: boolean;
}

const DEFAULTS: MaintenanceConfig = {
  buildCleanupDays: 30,
  buildCleanupMaxCount: 100,
  buildCleanupSchedule: '0 0 * * *',
  deleteBuildAssets: true,
};

const SCHEDULE_PRESETS = [
  { label: 'Daily (Midnight)', value: '0 0 * * *' },
  { label: 'Weekly (Sunday)', value: '0 0 * * 0' },
  { label: 'Bi-Daily (12h)', value: '0 */12 * * *' },
];

const cfgEqual = (a: MaintenanceConfig, b: MaintenanceConfig) =>
  a.buildCleanupDays === b.buildCleanupDays &&
  a.buildCleanupMaxCount === b.buildCleanupMaxCount &&
  a.buildCleanupSchedule === b.buildCleanupSchedule &&
  a.deleteBuildAssets === b.deleteBuildAssets;

export const MaintenanceSettings: React.FC = () => {
  const { toast } = useToast();
  const [config, setConfig] = useState<MaintenanceConfig>(DEFAULTS);
  const [baseline, setBaseline] = useState<MaintenanceConfig>(DEFAULTS);
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
      const next: MaintenanceConfig = {
        buildCleanupDays: data.buildCleanupDays || 30,
        buildCleanupMaxCount: data.buildCleanupMaxCount || 100,
        buildCleanupSchedule: data.buildCleanupSchedule || '0 0 * * *',
        deleteBuildAssets:
          data.deleteBuildAssets !== undefined ? data.deleteBuildAssets : true,
      };
      setConfig(next);
      setBaseline(next);
    } catch (error) {
      console.error('Failed to load maintenance settings', error);
      toast('Failed to access maintenance parameters.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (override?: MaintenanceConfig) => {
    const payload = override ?? config;
    setSaving(true);
    try {
      await XenonApiService.updateGlobalConfig(payload);
      setBaseline(payload);
      setConfig(payload);
      toast('Maintenance parameters synchronized across fleet.', 'success');
    } catch (error) {
      console.error('Failed to save maintenance settings', error);
      toast('Synchronization failed. Check network integrity.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleResetToDefaults = async () => {
    setConfig(DEFAULTS);
    await handleSave(DEFAULTS);
  };

  const handleDiscard = () => {
    setConfig(baseline);
  };

  const isDirty = !cfgEqual(config, baseline);
  const dirty = {
    days: config.buildCleanupDays !== baseline.buildCleanupDays,
    max: config.buildCleanupMaxCount !== baseline.buildCleanupMaxCount,
    purge: config.deleteBuildAssets !== baseline.deleteBuildAssets,
    schedule: config.buildCleanupSchedule !== baseline.buildCleanupSchedule,
  };

  if (loading) {
    return (
      <div className="settings-loading">
        <RefreshCw className="animate-spin" size={32} />
        <span>Synchronizing Maintenance Parameters...</span>
      </div>
    );
  }

  return (
    <div className="settings-container">
      <PageHeader
        icon={MaintenanceIcon}
        title="Maintenance & Retention"
        subtitle="Manage the lifecycle of test artifacts, automated purging schedules, and storage optimization across the global registry."
      />

      <div className="settings-content">
        <div className="settings-grid">
          <SettingCard
            icon={<History size={16} />}
            title={
              <span className="card-title-row">
                Retention Window
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
              <span className="code-font">DAYS</span>
            </div>
          </SettingCard>

          <SettingCard
            icon={<Trash2 size={16} />}
            title={
              <span className="card-title-row">
                Max Build Capacity
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
              <span className="code-font">BUILDS</span>
            </div>
          </SettingCard>

          <SettingCard
            icon={<ShieldCheck size={16} />}
            title={
              <span className="card-title-row">
                Asset Purge Strategy
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
                {config.deleteBuildAssets ? 'ENABLED' : 'DISABLED'}
              </span>
            </div>
          </SettingCard>

          <SettingCard
            icon={<Calendar size={16} />}
            title={
              <span className="card-title-row">
                Cleanup Orchestration
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
      </div>

      {(isDirty || saving) && (
        <ActionBar
          onSave={() => handleSave()}
          onDiscard={handleDiscard}
          onRestoreDefaults={handleResetToDefaults}
          isSaving={saving}
          isDirty={isDirty}
          saveLabel="Save Configuration"
        />
      )}
    </div>
  );
};
