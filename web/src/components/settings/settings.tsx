import React, { useState, useEffect } from 'react';
import XenonApiService from '../../api-service';
import './settings.css';
import {
  Shield as InfrastructureIcon,
  Save,
  RefreshCw,
  Clock,
  Calendar,
  CheckCircle,
  AlertTriangle,
  MousePointer2,
  RotateCcw,
  Info,
  Brain,
} from 'lucide-react';

export const Settings: React.FC = () => {
  const [config, setConfig] = useState<{
    healthCheckIntervalMs: number;
    healthCheckSchedule: string;
    enableSelfHealing: boolean;
  }>({
    healthCheckIntervalMs: 30000,
    healthCheckSchedule: '',
    enableSelfHealing: true,
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
        healthCheckIntervalMs: data.healthCheckIntervalMs || 30000,
        healthCheckSchedule: data.healthCheckSchedule || '',
        enableSelfHealing: data.enableSelfHealing !== undefined ? data.enableSelfHealing : true,
      });
    } catch (error) {
      console.error('Failed to load settings', error);
      setStatus({ type: 'error', message: 'Failed to access infrastructure parameters.' });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (configToSave = config) => {
    setSaving(true);
    setStatus(null);
    try {
      await XenonApiService.updateGlobalConfig(configToSave);
      setStatus({ type: 'success', message: 'Infrastructure parameters synchronized across fleet.' });
      setTimeout(() => setStatus(null), 5000);
    } catch (error) {
      console.error('Failed to save settings', error);
      setStatus({ type: 'error', message: 'Synchronization failed. Check network integrity.' });
    } finally {
      setSaving(false);
    }
  };

  const handleResetToDefaults = async () => {
    const defaultWebConfig = {
      healthCheckIntervalMs: 30000,
      healthCheckSchedule: '',
      enableSelfHealing: true,
    };
    setConfig(defaultWebConfig);
    await handleSave(defaultWebConfig);
    try {
      await XenonApiService.resetMetrics();
    } catch (e) {
      console.error('Failed to reset metrics', e);
    }
  };

  const presets = [
    { label: 'Battery Saver (2 AM)', value: '0 2 * * *' },
    { label: 'Standard (Hourly)', value: '0 * * * *' },
    { label: 'Operational Coverage (30m)', value: '*/30 * * * *' },
    { label: 'High Performance (10m)', value: '*/10 * * * *' },
    { label: 'Disable Schedule', value: '' },
  ];

  const getSchedulePreview = (cron: string) => {
    if (!cron) return 'Using Idle Health Frequency (Continuous/Passive mode).';
    const parts = cron.split(' ').filter((p) => p !== '');
    if (parts.length !== 5) return 'Invalid Cron format (needs 5 parts)';

    if (cron === '0 2 * * *') return 'Quiet hours: Daily at 2:00 AM';
    if (cron === '0 * * * *') return 'Standard rotation: Start of every hour';
    if (cron === '*/30 * * * *') return 'Balanced: Every 30 minutes';
    if (cron === '*/10 * * * *') return 'Intensive: Every 10 minutes';

    return `Custom orchestration: ${cron}`;
  };

  if (loading) {
    return (
      <div className="settings-loading">
        <RefreshCw className="animate-spin" size={32} />
        <span>Synchronizing Global Infrastructure...</span>
      </div>
    );
  }

  return (
    <div className="settings-container mesh-gradient-infra">
      <div className="settings-header">
        <div className="settings-title-group">
          <InfrastructureIcon className="settings-icon infra-icon" size={28} />
          <h2>Infrastructure Control</h2>
        </div>
        <p className="settings-subtitle">
          Manage core farm parameters, heartbeat frequency, and maintenance orchestrations across the global registry.
        </p>
      </div>

      <div className="settings-content">
        <section className="settings-section">
          <div className="settings-grid">
            <div className="setting-card stagger-1">
              <div className="setting-card-header">
                <Clock size={16} />
                <h4>Idle Health Frequency</h4>
              </div>
              <p>Frequency of passive health pings when the system is in idle state.</p>
              <div className="input-group">
                <input
                  type="number"
                  value={config.healthCheckIntervalMs}
                  onChange={(e) =>
                    setConfig({ ...config, healthCheckIntervalMs: parseInt(e.target.value) })
                  }
                  min={5000}
                  step={5000}
                />
                <span className="code-font">MS</span>
              </div>
              <div className="setting-hint-clean">Minimum safe value: 5000ms. Note: This frequency is overridden when a schedule is active.</div>
            </div>

            <div className="setting-card stagger-2">
              <div className="setting-card-header">
                <Calendar size={16} />
                <h4>Deep Diagnostic Schedule</h4>
              </div>
              <p>Execute intensive reliability bursts (WDA restarts, Cache purges) using standardized Cron syntax.</p>

              <div className="input-group">
                <input
                  type="text"
                  placeholder="e.g. 0 * * * * (At internal min 0)"
                  value={config.healthCheckSchedule}
                  onChange={(e) => setConfig({ ...config, healthCheckSchedule: e.target.value })}
                />
              </div>

              <div className="cron-preview">
                <span className="preview-label">Active Logic:</span>
                <span className="preview-value">
                  {getSchedulePreview(config.healthCheckSchedule)}
                </span>
              </div>

              <div className="cron-presets">
                <div className="presets-label">
                  <MousePointer2 size={12} />
                  <span>Intent-Based Presets:</span>
                </div>
                <div className="presets-grid">
                  {presets.map((p) => (
                    <button
                      key={p.label}
                      className={`preset-chip ${config.healthCheckSchedule === p.value ? 'active' : ''
                        }`}
                      onClick={() => setConfig({ ...config, healthCheckSchedule: p.value })}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="setting-card stagger-3">
              <div className="setting-card-header">
                <Brain size={16} />
                <h4>AI Self-Healing</h4>
              </div>
              <p>Automatically intercept and recover from failing locators using Xenon's 5-tier strategy.</p>

              <div className="toggle-group">
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={config.enableSelfHealing}
                    onChange={(e) => setConfig({ ...config, enableSelfHealing: e.target.checked })}
                  />
                  <span className="slider round"></span>
                </label>
                <span className="toggle-label">{config.enableSelfHealing ? 'ENABLED' : 'DISABLED'}</span>
              </div>

              <div className="setting-hint-clean">
                When enabled, Xenon will attempt to find elements via Fuzzy XML, OCR, Visual AI, and LLM before failing a test.
              </div>
            </div>
          </div>
        </section>

        {status && (
          <div className={`status-banner ${status.type}`}>
            {status.type === 'success' ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}
            <span>{status.message}</span>
          </div>
        )}

      </div>

      <div className="settings-footer stagger-4">
        <div className="footer-left">
          <button
            className="reset-to-defaults-btn"
            onClick={handleResetToDefaults}
            disabled={saving}
            style={{ padding: '12px 20px', fontSize: '0.875rem' }}
          >
            <RotateCcw size={16} />
            Restore Defaults
          </button>
        </div>
        <div className="footer-right">
          <button className="reset-btn" onClick={loadConfig} disabled={saving}>
            Discard
          </button>
          <button className="save-btn" onClick={() => handleSave()} disabled={saving}>
            {saving ? <RefreshCw className="animate-spin" size={18} /> : <Save size={18} />}
            {saving ? 'Saving...' : 'Save Configuration'}
          </button>
        </div>
      </div>
    </div>
  );
};
