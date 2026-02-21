import React, { useState, useEffect } from 'react';
import XenonApiService from '../../api-service';
import './settings.css';
import {
  Shield as MaintenanceIcon,
  Save,
  RefreshCw,
  Clock,
  Calendar,
  CheckCircle,
  AlertTriangle,
  RotateCcw,
  Info,
  History,
  Trash2,
} from 'lucide-react';
import { ActionBar, SettingSection } from '../ui/Layouts';

export const MaintenanceSettings: React.FC = () => {
  const [config, setConfig] = useState<{
    buildCleanupDays: number;
    buildCleanupMaxCount: number;
    buildCleanupSchedule: string;
    deleteBuildAssets: boolean;
  }>({
    buildCleanupDays: 30,
    buildCleanupMaxCount: 100,
    buildCleanupSchedule: '0 0 * * *',
    deleteBuildAssets: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const data = await XenonApiService.getGlobalConfig();
      setConfig({
        buildCleanupDays: data.buildCleanupDays || 30,
        buildCleanupMaxCount: data.buildCleanupMaxCount || 100,
        buildCleanupSchedule: data.buildCleanupSchedule || '0 0 * * *',
        deleteBuildAssets: data.deleteBuildAssets !== undefined ? data.deleteBuildAssets : true,
      });
    } catch (error) {
      console.error('Failed to load maintenance settings', error);
      setStatus({ type: 'error', message: 'Failed to access maintenance parameters.' });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (configToSave = config) => {
    setSaving(true);
    setStatus(null);
    try {
      await XenonApiService.updateGlobalConfig(configToSave);
      setStatus({ type: 'success', message: 'Maintenance parameters synchronized across fleet.' });
      setTimeout(() => setStatus(null), 5000);
    } catch (error) {
      console.error('Failed to save maintenance settings', error);
      setStatus({ type: 'error', message: 'Synchronization failed. Check network integrity.' });
    } finally {
      setSaving(false);
    }
  };

  const handleResetToDefaults = async () => {
    const defaultMaintenanceConfig = {
      buildCleanupDays: 30,
      buildCleanupMaxCount: 100,
      buildCleanupSchedule: '0 0 * * *',
      deleteBuildAssets: true,
    };
    setConfig(defaultMaintenanceConfig);
    await handleSave(defaultMaintenanceConfig);
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
    <div className="settings-container mesh-gradient-infra">
      {/* Mission Control Scanline Overlay */}
      <div className="scanline" style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        opacity: 0.05,
        zIndex: 1001
      }}></div>
      <div className="settings-header">
        <div className="settings-title-group">
          <MaintenanceIcon className="settings-icon infra-icon" size={28} />
          <h2>Maintenance & Retention</h2>
        </div>
        <p className="settings-subtitle">
          Manage the lifecycle of test artifacts, automated purging schedules, and storage
          optimization across the global registry.
        </p>
      </div>

      <div className="settings-content">
        <div className="settings-grid">
          <SettingSection
            title="Retention Window"
            description="Number of days to preserve builds and sessions before automatic purging from the system."
          >
            <div className="input-group">
              <input
                type="number"
                value={config.buildCleanupDays}
                onChange={(e) =>
                  setConfig({ ...config, buildCleanupDays: parseInt(e.target.value) })
                }
                min={1}
              />
              <span className="code-font">DAYS</span>
            </div>
            <div className="setting-hint-clean">
              Standard enterprise retention is typically 30-90 days.
            </div>
          </SettingSection>

          <SettingSection
            title="Max Build Capacity"
            description="Cap the maximum number of historical builds stored in the primary database."
          >
            <div className="input-group">
              <input
                type="number"
                value={config.buildCleanupMaxCount}
                onChange={(e) =>
                  setConfig({ ...config, buildCleanupMaxCount: parseInt(e.target.value) })
                }
                min={1}
              />
              <span className="code-font">BUILDS</span>
            </div>
            <div className="setting-hint-clean">
              Protects against database bloat during high-frequency CI bursts.
            </div>
          </SettingSection>

          <SettingSection
            title="Asset Purge Strategy"
            description="Automatically remove binary artifacts (videos, screenshots) when build records are purged."
          >
            <div className="toggle-group">
              <label className="switch">
                <input
                  type="checkbox"
                  checked={config.deleteBuildAssets}
                  onChange={(e) => setConfig({ ...config, deleteBuildAssets: e.target.checked })}
                />
                <span className="slider round"></span>
              </label>
              <span className="toggle-label">
                {config.deleteBuildAssets ? 'ENABLED' : 'DISABLED'}
              </span>
            </div>
            <div className="setting-hint-clean">
              Disabling this will leave orphaned files on disk—use with caution.
            </div>
          </SettingSection>

          <SettingSection
            title="Cleanup Orchestration"
            description="Standardized Cron syntax for scheduling the automated cleanup engine."
          >
            <div className="input-group">
              <input
                type="text"
                placeholder="e.g. 0 0 * * * (Midnight)"
                value={config.buildCleanupSchedule}
                onChange={(e) => setConfig({ ...config, buildCleanupSchedule: e.target.value })}
              />
            </div>

            <div className="cron-presets">
              <div className="presets-grid">
                {[
                  { label: 'Daily (Midnight)', value: '0 0 * * *' },
                  { label: 'Weekly (Sunday)', value: '0 0 * * 0' },
                  { label: 'Bi-Daily (12h)', value: '0 */12 * * *' },
                ].map((p) => (
                  <button
                    key={p.label}
                    className={`preset-chip ${config.buildCleanupSchedule === p.value ? 'active' : ''
                      }`}
                    onClick={() => setConfig({ ...config, buildCleanupSchedule: p.value })}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </SettingSection>
        </div>

        <div
          className="health-monitor-alert"
          style={{
            background: 'rgba(59, 130, 246, 0.05)',
            borderColor: 'rgba(59, 130, 246, 0.2)',
            color: '#60a5fa',
            marginTop: '1.5rem',
          }}
        >
          <Info size={18} />
          <span>
            <strong>Resource Notice:</strong> Bulk purging operations are non-blocking and execute
            at low priority to ensure zero interference with active test execution.
          </span>
        </div>

        {status && (
          <div className={`status-banner ${status.type}`}>
            {status.type === 'success' ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}
            <span>{status.message}</span>
          </div>
        )}
      </div>

      <ActionBar
        onSave={handleSave}
        onDiscard={loadConfig}
        onRestoreDefaults={handleResetToDefaults}
        isSaving={saving}
      />
    </div>
  );
};
