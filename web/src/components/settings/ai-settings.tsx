import React, { useState, useEffect } from 'react';
import XenonApiService from '../../api-service';
import './settings.css';
import {
  Brain,
  Save,
  RefreshCw,
  Key,
  Link,
  Zap,
  CheckCircle,
  AlertTriangle,
  RotateCcw,
  Eye,
  EyeOff,
  ShieldCheck,
  HelpCircle,
} from 'lucide-react';
import { ActionBar, SettingSection } from '../ui/Layouts';

export const AISettings: React.FC = () => {
  const [config, setConfig] = useState<{
    aiProvider?: string;
    aiModel?: string;
    aiBaseUrl?: string;
    geminiApiKey?: string;
    openaiApiKey?: string;
    anthropicApiKey?: string;
  }>({
    aiProvider: 'gemini',
    aiModel: '',
    aiBaseUrl: '',
    geminiApiKey: '',
    openaiApiKey: '',
    anthropicApiKey: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

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
        geminiApiKey: data.geminiApiKey || '',
        openaiApiKey: data.openaiApiKey || '',
        anthropicApiKey: data.anthropicApiKey || '',
      });
    } catch (error) {
      console.error('Failed to load AISettings', error);
      setStatus({ type: 'error', message: 'Failed to access AI configuration.' });
    } finally {
      setLoading(false);
    }
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await XenonApiService.testAIConfig(config);
      setTestResult(result);
    } catch (error: any) {
      setTestResult({ success: false, message: 'Network error while testing connection.' });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async (configToSave = config) => {
    setSaving(true);
    setStatus(null);
    try {
      await XenonApiService.updateGlobalConfig(configToSave);
      setStatus({ type: 'success', message: 'AI Intelligence engine synchronized successfully!' });
      setTimeout(() => setStatus(null), 5000);
    } catch (error) {
      console.error('Failed to save AISettings', error);
      setStatus({ type: 'error', message: 'Failed to persist updates.' });
    } finally {
      setSaving(false);
    }
  };

  const handleResetToDefaults = async () => {
    const defaultAIConfig = {
      aiProvider: 'gemini',
      aiModel: '',
      aiBaseUrl: '',
      geminiApiKey: '',
      openaiApiKey: '',
      anthropicApiKey: '',
    };
    setConfig(defaultAIConfig);
    await handleSave(defaultAIConfig);
  };

  if (loading) {
    return (
      <div className="settings-loading">
        <RefreshCw className="animate-spin" size={32} />
        <span>Synchronizing Global State...</span>
      </div>
    );
  }

  const isCustomProvider = config.aiProvider === 'ollama' || config.aiProvider === 'openai'; // OpenAI can also use custom base URL

  return (
    <div className="settings-container mesh-gradient-ai">
      <div className="settings-header">
        <div className="settings-title-group">
          <Brain className="settings-icon ai-engine-icon" size={28} />
          <h2>AI Intelligence</h2>
        </div>
        <p className="settings-subtitle">
          Harness autonomous multi-modal analysis to diagnose hardware failures and complex test
          anomalies with human-level precision.
        </p>
        <div
          className="health-monitor-alert"
          style={{
            marginTop: '1rem',
            background: 'rgba(16, 185, 129, 0.05)',
            border: '1px solid rgba(16, 185, 129, 0.1)',
            color: 'var(--primary)',
          }}
        >
          <ShieldCheck size={18} />
          <span>
            Secure Architecture: Your API keys are encrypted at rest and never leave your local
            environment.
          </span>
        </div>
      </div>

      <div className="settings-content">
        <div className="settings-grid">
          {/* Phase 1: Engine Selection */}
          <SettingSection
            title="Inference Engine"
            description="Select the foundation model provider. Cloud engines offer global scale, while local instances provide maximum data privacy."
            icon={Brain}
          >
            <div className="input-group">
              <select
                value={config.aiProvider}
                onChange={(e) => setConfig({ ...config, aiProvider: e.target.value })}
              >
                <option value="gemini">Google Gemini (Default & Recommended)</option>
                <option value="openai">OpenAI (GPT-4o / O1)</option>
                <option value="anthropic">Anthropic (Claude-3.5 Sonnet)</option>
                <option value="ollama">Ollama (Private Local Instance)</option>
              </select>
            </div>
            <div className="setting-hint-clean">
              {config.aiProvider === 'gemini' &&
                "Gemini 1.5 is optimized for Xenon's multi-modal video diagnosis."}
              {config.aiProvider === 'openai' &&
                'World-class reasoning for complex logistical and hardware failures.'}
              {config.aiProvider === 'ollama' &&
                'Zero-data-leakage analysis for high-security laboratory environments.'}
            </div>
          </SettingSection>

          {/* Phase 2: Secure Authentication */}
          <SettingSection
            title="Security & Secrets"
            description="Configure secure access to your selected intelligence provider. Keys are encrypted at rest."
            icon={Key}
          >
            <div className="input-group" style={{ position: 'relative' }}>
              {config.aiProvider === 'gemini' && (
                <input
                  type={showKey ? 'text' : 'password'}
                  placeholder="Enter GEMINI_API_KEY (AI_V1...)"
                  value={config.geminiApiKey}
                  onChange={(e) => setConfig({ ...config, geminiApiKey: e.target.value })}
                />
              )}
              {config.aiProvider === 'openai' && (
                <input
                  type={showKey ? 'text' : 'password'}
                  placeholder="Enter OPENAI_API_KEY (sk...)"
                  value={config.openaiApiKey}
                  onChange={(e) => setConfig({ ...config, openaiApiKey: e.target.value })}
                />
              )}
              {config.aiProvider === 'anthropic' && (
                <input
                  type={showKey ? 'text' : 'password'}
                  placeholder="Enter ANTHROPIC_API_KEY (sk-ant...)"
                  value={config.anthropicApiKey}
                  onChange={(e) => setConfig({ ...config, anthropicApiKey: e.target.value })}
                />
              )}
              {config.aiProvider !== 'ollama' && (
                <button
                  onClick={() => setShowKey(!showKey)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--text-dim)',
                    padding: '0 8px',
                  }}
                >
                  {showKey ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              )}
              {config.aiProvider === 'ollama' && (
                <div
                  style={{
                    color: 'var(--text-dim)',
                    fontSize: '0.875rem',
                    fontWeight: 500,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  <ShieldCheck size={16} style={{ color: 'var(--primary)' }} /> Secure local-only
                  session (No external key required).
                </div>
              )}
            </div>
            <div className="setting-hint-clean">
              <HelpCircle size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
              Xenon uses hardware-level encryption for API key persistence.
            </div>
          </SettingSection>

          {isCustomProvider && (
            <SettingSection
              title="Infrastructure"
              description={`Direct established traffic to your ${config.aiProvider === 'ollama' ? 'local Ollama' : 'custom proxy'} host.`}
              icon={Link}
            >
              <div className="input-group">
                <input
                  type="text"
                  placeholder={
                    config.aiProvider === 'ollama'
                      ? 'http://localhost:11434'
                      : 'https://custom-proxy.internal'
                  }
                  value={config.aiBaseUrl}
                  onChange={(e) => setConfig({ ...config, aiBaseUrl: e.target.value })}
                />
              </div>
              <div className="setting-hint-clean">
                Default:{' '}
                {config.aiProvider === 'ollama'
                  ? 'http://localhost:11434'
                  : 'Standard API Endpoint'}
              </div>
            </SettingSection>
          )}

          <SettingSection
            title="Model Optimization"
            description="Fine-tune the intelligence engine with specific model-level overrides."
            icon={Zap}
          >
            <div className="input-group">
              <input
                type="text"
                placeholder={
                  config.aiProvider === 'gemini'
                    ? 'gemini-1.5-flash-latest'
                    : config.aiProvider === 'openai'
                      ? 'gpt-4o'
                      : config.aiProvider === 'anthropic'
                        ? 'claude-3-5-sonnet-latest'
                        : 'llama3'
                }
                value={config.aiModel}
                onChange={(e) => setConfig({ ...config, aiModel: e.target.value })}
              />
            </div>
            <div className="setting-hint-clean">
              Leave empty for Xenon binary-optimized defaults.
            </div>
          </SettingSection>
        </div>

        {/* Validation Actions */}
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1.5rem' }}>
          <button
            className="reset-btn"
            onClick={handleTestConnection}
            disabled={isTesting || saving}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              border: '1px solid var(--primary-soft)',
              color: 'var(--primary)',
            }}
          >
            {isTesting ? (
              <RefreshCw className="animate-spin" size={16} />
            ) : (
              <ShieldCheck size={16} />
            )}
            {isTesting ? 'Verifying...' : 'Validate Connection'}
          </button>
          {testResult && (
            <div
              className={`status-banner ${testResult.success ? 'success' : 'error'}`}
              style={{ margin: 0, padding: '8px 16px' }}
            >
              {testResult.success ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
              <span style={{ fontSize: '0.875rem' }}>{testResult.message}</span>
            </div>
          )}
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
        isValidating={isTesting}
      />
    </div>
  );
};
