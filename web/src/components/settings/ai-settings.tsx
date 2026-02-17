import React, { useState, useEffect } from 'react';
import XenonApiService from '../../api-service';
import './settings.css';
import {
  Brain,
  ShieldCheck,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  Lock,
  Save,
  Server,
  Cpu,
  Globe,
} from 'lucide-react';

interface ProviderInfo {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  isConfigured: boolean;
}

export const AISettings: React.FC = () => {
  const [config, setConfig] = useState<{
    aiProvider?: string;
    aiModel?: string;
    aiBaseUrl?: string;
    geminiSet?: boolean;
    openaiSet?: boolean;
    anthropicSet?: boolean;
  }>({
    aiProvider: 'gemini',
    aiModel: '',
    aiBaseUrl: '',
    geminiSet: false,
    openaiSet: false,
    anthropicSet: false,
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
        aiProvider: data.aiProvider || 'gemini',
        aiModel: data.aiModel || '',
        aiBaseUrl: data.aiBaseUrl || '',
        geminiSet: data.geminiSet || false,
        openaiSet: data.openaiSet || false,
        anthropicSet: data.anthropicSet || false,
      });
    } catch (error) {
      console.error('Failed to load AISettings', error);
      setStatus({ type: 'error', message: 'Failed to access AI configuration.' });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setStatus(null);
    try {
      await XenonApiService.updateGlobalConfig({ aiProvider: config.aiProvider });
      setStatus({ type: 'success', message: 'Active provider updated successfully.' });
      setTimeout(() => setStatus(null), 5000);
    } catch (error) {
      console.error('Failed to save AISettings', error);
      setStatus({ type: 'error', message: 'Failed to persist updates.' });
    } finally {
      setSaving(false);
    }
  };

  const providers: ProviderInfo[] = [
    {
      id: 'gemini',
      name: 'Google Gemini',
      description: 'Gemini 1.5 Pro — Multimodal reasoning',
      icon: <Brain size={18} />,
      isConfigured: !!config.geminiSet,
    },
    {
      id: 'openai',
      name: 'OpenAI',
      description: 'GPT-4o — OpenAI v1 compatible',
      icon: <Cpu size={18} />,
      isConfigured: !!config.openaiSet,
    },
    {
      id: 'anthropic',
      name: 'Anthropic',
      description: 'Claude 3.5 Sonnet — Advanced analysis',
      icon: <ShieldCheck size={18} />,
      isConfigured: !!config.anthropicSet,
    },
    {
      id: 'ollama',
      name: 'Ollama',
      description: 'Local / Self-hosted — No API key required',
      icon: <Server size={18} />,
      isConfigured: !!config.aiModel || !!config.aiBaseUrl,
    },
  ];

  const activeProvider = providers.find((p) => p.id === config.aiProvider);
  const configuredCount = providers.filter((p) => p.isConfigured).length;

  const getModelDefault = (providerId?: string) => {
    switch (providerId) {
      case 'gemini': return 'gemini-3-flash-preview';
      case 'openai': return 'gpt-4o';
      case 'anthropic': return 'claude-3-5-sonnet-20240620';
      case 'ollama': return 'llama3';
      default: return '—';
    }
  };

  const getBaseUrlDefault = (providerId?: string) => {
    switch (providerId) {
      case 'ollama': return 'http://localhost:11434';
      default: return 'Provider default';
    }
  };


  if (loading) {
    return (
      <div className="settings-loading">
        <RefreshCw className="animate-spin" size={32} />
        <span>Synchronizing Global State...</span>
      </div>
    );
  }

  return (
    <div className="settings-container mesh-gradient-ai">
      <div className="settings-header">
        <div className="settings-title-group">
          <Brain className="settings-icon ai-engine-icon" size={28} />
          <h2>AI Engine Configuration</h2>
          <span className="badge-elite">Enterprise v3.0</span>
        </div>
        <p className="settings-subtitle">
          All credentials and endpoints are managed via environment variables.
          <br />
          <span style={{ fontSize: '0.85rem', opacity: 0.7 }}>
            <Lock size={12} style={{ display: 'inline', marginBottom: -2, marginRight: 4 }} />
            Select the active provider from configured options below.
          </span>
        </p>
      </div>

      <div className="settings-content">
        {/* Section 1: Provider Registry */}
        <section className="setting-card">
          <div className="card-header-dense">
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <ShieldCheck size={20} style={{ color: 'var(--primary-enterprise)' }} />
              <h3 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-h1)' }}>
                Provider Registry
              </h3>
              <span className="badge-elite" style={{ marginLeft: 'auto' }}>
                {configuredCount} / {providers.length} CONFIGURED
              </span>
            </div>
            <p className="section-description-dense">
              Providers are activated by setting their API key as an environment variable.
              Select one of the configured providers to use as the active engine.
            </p>
          </div>

          <div className="ai-provider-grid">
            {providers.map((provider) => {
              const isActive = config.aiProvider === provider.id;
              const isSelectable = provider.isConfigured;

              return (
                <button
                  key={provider.id}
                  className={`ai-provider-card ${isActive ? 'active' : ''} ${!isSelectable ? 'disabled' : ''}`}
                  onClick={() => isSelectable && setConfig({ ...config, aiProvider: provider.id })}
                  disabled={!isSelectable}
                  title={!isSelectable ? `Set XENON_${provider.id.toUpperCase()}_API_KEY or model/URL to enable` : `Select ${provider.name}`}
                >
                  <div className="ai-provider-card-header">
                    <div className="ai-provider-icon">{provider.icon}</div>
                    <div className="ai-provider-info">
                      <span className="ai-provider-name">{provider.name}</span>
                      <span className="ai-provider-desc">{provider.description}</span>
                    </div>
                  </div>
                  <div className="ai-provider-status">
                    {isActive ? (
                      <span className="status-badge success-filled" style={{ height: '28px', fontSize: '0.7rem', padding: '0 10px', width: 'auto' }}>
                        <div className="live-signal" style={{ width: 6, height: 6, marginRight: 4 }} />
                        ACTIVE
                      </span>
                    ) : provider.isConfigured ? (
                      <span className="status-badge success-filled" style={{ height: '28px', fontSize: '0.7rem', padding: '0 10px', width: 'auto' }}>
                        <div className="live-signal" style={{ width: 6, height: 6, marginRight: 4 }} />
                        READY
                      </span>
                    ) : (
                      <span className="status-badge error-filled" style={{ height: '28px', fontSize: '0.7rem', padding: '0 10px', width: 'auto' }}>
                        <Lock size={10} />
                        NOT SET
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Section 2: Runtime Configuration (Read-Only) */}
        <section className="setting-card">
          <div className="card-header-dense">
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Globe size={20} style={{ color: 'var(--primary-enterprise)' }} />
              <h3 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-h1)' }}>
                Runtime Configuration
              </h3>
            </div>
            <p className="section-description-dense">
              Values sourced from environment variables. Set <code style={{ color: 'var(--primary-enterprise)', background: 'rgba(34,197,94,0.1)', padding: '2px 6px', borderRadius: '4px', fontSize: '0.8rem' }}>XENON_AI_MODEL</code> and <code style={{ color: 'var(--primary-enterprise)', background: 'rgba(34,197,94,0.1)', padding: '2px 6px', borderRadius: '4px', fontSize: '0.8rem' }}>XENON_AI_BASE_URL</code> to override defaults.
            </p>
          </div>

          <div className="ai-config-display">
            <div className="ai-config-row">
              <span className="ai-config-label">Active Provider</span>
              <span className="ai-config-value">
                {activeProvider?.icon}
                {activeProvider?.name || '—'}
              </span>
            </div>
            <div className="ai-config-row">
              <span className="ai-config-label">Model</span>
              <span className="ai-config-value mono">
                {config.aiModel || getModelDefault(config.aiProvider)}
                {!config.aiModel && <span className="ai-config-default">default</span>}
              </span>
            </div>
            <div className="ai-config-row">
              <span className="ai-config-label">Base URL</span>
              <span className="ai-config-value mono">
                {config.aiBaseUrl || getBaseUrlDefault(config.aiProvider)}
                {!config.aiBaseUrl && <span className="ai-config-default">default</span>}
              </span>
            </div>
          </div>
        </section>

        {status && (
          <div className={`status-banner ${status.type}`} style={{ borderRadius: 'var(--radius-enterprise)', padding: 'var(--gap-2)', marginTop: 'var(--gap-3)', justifyContent: 'center' }}>
            {status.type === 'success' ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
            <span style={{ fontWeight: 600 }}>{status.message}</span>
          </div>
        )}
      </div>

      <footer className="settings-footer">
        <div className="footer-dock">
          <button className="ghost-btn" onClick={loadConfig}>
            <RefreshCw size={16} /> Refresh Environment
          </button>
          <button
            className="save-btn primary"
            onClick={handleSave}
            disabled={saving || !activeProvider?.isConfigured}
            title={!activeProvider?.isConfigured ? 'The selected provider is not configured in the environment' : 'Save active provider selection'}
          >
            {saving ? <RefreshCw className="animate-spin" size={16} /> : <Save size={16} />}
            {saving ? 'Applying...' : 'Save Configuration'}
          </button>
        </div>
      </footer>
    </div>
  );
};
