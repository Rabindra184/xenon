import React, { useState, useEffect } from 'react';
import XenonApiService from '../../api-service';
import './settings.css';
import {
  Settings as SettingsIcon,
  Save,
  RefreshCw,
  Clock,
  Calendar,
  CheckCircle,
  AlertTriangle,
  Zap,
  MousePointer2,
  RotateCcw,
} from 'lucide-react';

export const Settings: React.FC = () => {
  const [config, setConfig] = useState<{
    healthCheckIntervalMs: number;
    healthCheckSchedule: string;
  }>({
    healthCheckIntervalMs: 30000,
    healthCheckSchedule: '',
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
      });
    } catch (error) {
      console.error('Failed to load settings', error);
      setStatus({ type: 'error', message: 'Failed to access infrastructure configuration.' });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (configToSave = config) => {
    setSaving(true);
    setStatus(null);
    try {
      await XenonApiService.updateGlobalConfig(configToSave);
      setStatus({ type: 'success', message: 'Infrastructure parameters updated successfully!' });
      setTimeout(() => setStatus(null), 5000);
    } catch (error) {
      console.error('Failed to save settings', error);
      setStatus({ type: 'error', message: 'Failed to persist configuration changes.' });
    } finally {
      setSaving(false);
    }
  };

  const handleResetToDefaults = async () => {
    const defaultWebConfig = {
      healthCheckIntervalMs: 30000,
      healthCheckSchedule: '',
    };
    setConfig(defaultWebConfig);
    await handleSave(defaultWebConfig);
    // Also reset healing metrics
    try {
      await XenonApiService.resetMetrics();
    } catch (e) {
      console.error('Failed to reset metrics', e);
    }
  };

  const presets = [
    { label: 'Off-Peak (2 AM)', value: '0 2 * * *' },
    { label: 'Hourly', value: '0 * * * *' },
    { label: 'Every 30m', value: '*/30 * * * *' },
    { label: 'Fast (10m)', value: '*/10 * * * *' },
    { label: 'Disable Schedule', value: '' },
  ];

  const getSchedulePreview = (cron: string) => {
    if (!cron) return 'Using Pulse Interval only.';
    const parts = cron.split(' ').filter((p) => p !== '');
    if (parts.length !== 5) return 'Invalid Cron format (needs 5 parts)';

    if (cron === '0 2 * * *') return 'Daily at 2:00 AM';
    if (cron === '0 * * * *') return 'At the start of every hour';
    if (cron === '*/30 * * * *') return 'Every 30 minutes';
    if (cron === '*/10 * * * *') return 'Every 10 minutes';
    if (cron.startsWith('0') && parts[1] === '*') return 'At minute 0 of every hour';

    return `Active expression: ${cron}`;
  };

  if (loading) {
    return (
      <div className="settings-loading">
        <RefreshCw className="animate-spin" size={32} />
        <span>Synchronizing infrastructure state...</span>
      </div>
    );
  }

  return (
    <div className="settings-container">
      <div className="settings-header">
        <div className="settings-title-group">
          <SettingsIcon className="settings-icon" size={28} />
          <h2>Infrastructure Settings</h2>
          <div
            className="brand-font"
            style={{
              fontSize: '10px',
              padding: '2px 8px',
              background: 'var(--primary-soft)',
              color: 'var(--primary)',
              borderRadius: '20px',
              border: '1px solid var(--primary-glow)',
              marginLeft: '12px',
              textTransform: 'uppercase',
              letterSpacing: '1px',
              fontWeight: 800,
            }}
          >
            Enterprise
          </div>
        </div>
        <p className="settings-subtitle">
          Manage global farm parameters. Configurations are synchronized across all nodes in
          real-time.
        </p>
      </div>

      <div className="settings-content">
        <section className="settings-section">
          <h3>
            <Zap size={20} className="text-primary" />
            Health & Monitoring
          </h3>
          <p className="section-description">
            Define the heartbeat frequency and maintenance windows for the device ecosystem.
          </p>

          <div className="settings-grid">
            <div className="setting-card">
              <div className="setting-card-header">
                <Clock size={16} />
                <h4>Pulse Interval</h4>
              </div>
              <p>Frequency of health checks when no specific schedule is active.</p>
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
              <div className="setting-hint">Optimized for stability. Minimum 5000ms.</div>
            </div>

            <div className="setting-card">
              <div className="setting-card-header">
                <Calendar size={16} />
                <h4>Maintenance Window</h4>
              </div>
              <p>Execute intensive diagnostic bursts using standardized Cron syntax.</p>

              <div className="input-group">
                <input
                  type="text"
                  placeholder="e.g. 0 * * * * (Hourly)"
                  value={config.healthCheckSchedule}
                  onChange={(e) => setConfig({ ...config, healthCheckSchedule: e.target.value })}
                />
              </div>

              <div className="cron-preview">
                <span className="preview-label">Schedule Summary:</span>
                <span className="preview-value">
                  {getSchedulePreview(config.healthCheckSchedule)}
                </span>
              </div>

              <div className="cron-presets">
                <div className="presets-label">
                  <MousePointer2 size={12} />
                  <span>Quick Presets:</span>
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
          </div>

          <div className="health-monitor-alert">
            <AlertTriangle size={18} />
            <span>
              <strong>Technical Override:</strong> Health checks are automatically deferred during
              active CI sessions to prevent performance jitter.
            </span>
          </div>
        </section>

        {status && (
          <div className={`status-banner ${status.type}`}>
            {status.type === 'success' ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}
            <span>{status.message}</span>
          </div>
        )}

        <div className="settings-footer">
          <div className="footer-left">
            <button
              className="reset-to-defaults-btn"
              onClick={handleResetToDefaults}
              disabled={saving}
            >
              <RotateCcw size={16} />
              Reset All to Factory Defaults
            </button>
          </div>
          <div className="footer-right">
            <button className="reset-btn" onClick={loadConfig} disabled={saving}>
              Discard Changes
            </button>
            <button className="save-btn" onClick={handleSave as any} disabled={saving}>
              {saving ? <RefreshCw className="animate-spin" size={18} /> : <Save size={18} />}
              {saving ? 'Synchronizing...' : 'Save & Propagate Settings'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
