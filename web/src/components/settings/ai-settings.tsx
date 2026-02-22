import React, { useState, useEffect } from 'react';
import XenonApiService from '../../api-service';
import './settings.css';
import { ActionBar, SettingSection } from '../ui/Layouts';
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
    geminiModel?: string;
    openaiModel?: string;
    anthropicModel?: string;
    ollamaModel?: string;
    geminiSet?: boolean;
    openaiSet?: boolean;
    anthropicSet?: boolean;
  }>({
    aiProvider: 'gemini',
    aiModel: '',
    aiBaseUrl: '',
    geminiModel: '',
    openaiModel: '',
    anthropicModel: '',
    ollamaModel: '',
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
        geminiModel: data.geminiModel || '',
        openaiModel: data.openaiModel || '',
        anthropicModel: data.anthropicModel || '',
        ollamaModel: data.ollamaModel || '',
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
      isConfigured: !!config.ollamaModel || !!config.aiModel || !!config.aiBaseUrl,
    },
  ];

  const activeProvider = providers.find((p) => p.id === config.aiProvider);
  const configuredCount = providers.filter((p) => p.isConfigured).length;

  const getModelDefault = (providerId?: string) => {
    switch (providerId) {
      case 'gemini':
        return 'gemini-3-flash-preview';
      case 'openai':
        return 'gpt-4o';
      case 'anthropic':
        return 'claude-3-5-sonnet-20240620';
      case 'ollama':
        return 'llama3';
      default:
        return '—';
    }
  };

  const getBaseUrlDefault = (providerId?: string) => {
    switch (providerId) {
      case 'ollama':
        return 'http://localhost:11434';
      default:
        return 'Provider default';
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
      {/* Mission Control Scanline Overlay */}
      <div
        className="scanline"
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          opacity: 0.05,
          zIndex: 1001,
        }}
      ></div>
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
        <div className="settings-grid">
          {/* Section 1: Provider Registry */}
          <div className="setting-card stagger-1">
            <div className="setting-card-header">
              <ShieldCheck size={16} />
              <h4>Provider Registry</h4>
              <span className="badge-elite" style={{ marginLeft: 'auto' }}>
                {configuredCount} / {providers.length} CONFIGURED
              </span>
            </div>
            <p className="section-description-dense">
              Providers are activated via environment variables. Select a configured engine to
              activate.
            </p>

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
                    title={
                      !isSelectable
                        ? `Set XENON_${provider.id.toUpperCase()}_API_KEY or model/URL to enable`
                        : `Select ${provider.name}`
                    }
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
                        <span className="status-badge success-filled">
                          <div className="live-signal" />
                          ACTIVE
                        </span>
                      ) : provider.isConfigured ? (
                        <span className="status-badge success-filled">
                          <div className="live-signal" />
                          READY
                        </span>
                      ) : (
                        <span className="status-badge error-filled">
                          <Lock size={10} />
                          NOT SET
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Section 2: Runtime Configuration (Read-Only) */}
          <div className="setting-card stagger-2">
            <div className="setting-card-header">
              <Globe size={16} />
              <h4>Runtime Configuration</h4>
            </div>
            <p className="section-description-dense">
              Environmental overrides for AI model endpoints and identifiers.
            </p>

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
                  {config.aiProvider === 'gemini' &&
                    (config.geminiModel || config.aiModel || getModelDefault('gemini'))}
                  {config.aiProvider === 'openai' &&
                    (config.openaiModel || config.aiModel || getModelDefault('openai'))}
                  {config.aiProvider === 'anthropic' &&
                    (config.anthropicModel || config.aiModel || getModelDefault('anthropic'))}
                  {config.aiProvider === 'ollama' &&
                    (config.ollamaModel || config.aiModel || getModelDefault('ollama'))}
                  {!config.aiModel &&
                    !config.geminiModel &&
                    !config.openaiModel &&
                    !config.anthropicModel &&
                    !config.ollamaModel && <span className="ai-config-default">default</span>}
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
          </div>
        </div>

        {status && (
          <div
            className={`status-banner ${status.type}`}
            style={{
              borderRadius: 'var(--radius-enterprise)',
              padding: 'var(--gap-2)',
              marginTop: 'var(--gap-3)',
              justifyContent: 'center',
            }}
          >
            {status.type === 'success' ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
            <span style={{ fontWeight: 600 }}>{status.message}</span>
          </div>
        )}
      </div>

      <ActionBar
        onSave={handleSave}
        onDiscard={loadConfig}
        isSaving={saving}
        saveLabel="Save Configuration"
      />
    </div>
  );
};
