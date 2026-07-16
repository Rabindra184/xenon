import React, { useState, useEffect } from 'react';
import XenonApiService from '../../api-service';
import './settings.css';
import { ActionBar } from '../ui/Layouts';
import {
  Brain,
  ShieldCheck,
  RefreshCw,
  Lock,
  Server,
  Cpu,
  Globe,
  CheckCircle2,
  Sliders,
  Activity,
} from 'lucide-react';
import { SettingCard } from '../ui/SettingCard';
import { PageHeader } from '../ui/page-header';
import { useToast } from '../ui/toast';

interface AIConfig {
  aiProvider: string;
  aiModel: string;
  aiBaseUrl: string;
  geminiModel: string;
  openaiModel: string;
  anthropicModel: string;
  ollamaModel: string;
  geminiSet: boolean;
  openaiSet: boolean;
  anthropicSet: boolean;
  aiTemperature: number;
  aiMaxTokens: number;
  aiTopP: number;
}

const DEFAULTS: AIConfig = {
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
  aiTemperature: 1.0,
  aiMaxTokens: 4096,
  aiTopP: 1.0,
};

interface ProviderInfo {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  isConfigured: boolean;
}

const cfgEqual = (a: AIConfig, b: AIConfig) =>
  a.aiProvider === b.aiProvider &&
  a.aiTemperature === b.aiTemperature &&
  a.aiMaxTokens === b.aiMaxTokens &&
  a.aiTopP === b.aiTopP;

const getModelDefault = (providerId?: string) => {
  switch (providerId) {
    case 'gemini':
      return 'gemini-3-flash-preview';
    case 'openai':
      return 'gpt-4o';
    case 'anthropic':
      return 'claude-sonnet-4-6';
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

export const AISettings: React.FC = () => {
  const { toast } = useToast();
  const [config, setConfig] = useState<AIConfig>(DEFAULTS);
  const [baseline, setBaseline] = useState<AIConfig>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    loadConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const data: any = await XenonApiService.getGlobalConfig();
      const next: AIConfig = {
        aiProvider: data.aiProvider || 'gemini',
        aiModel: data.aiModel || '',
        aiBaseUrl: data.aiBaseUrl || '',
        geminiModel: data.geminiModel || '',
        openaiModel: data.openaiModel || '',
        anthropicModel: data.anthropicModel || '',
        ollamaModel: data.ollamaModel || '',
        geminiSet: !!data.geminiSet,
        openaiSet: !!data.openaiSet,
        anthropicSet: !!data.anthropicSet,
        aiTemperature: typeof data.aiTemperature === 'number' ? data.aiTemperature : 1.0,
        aiMaxTokens: typeof data.aiMaxTokens === 'number' ? data.aiMaxTokens : 4096,
        aiTopP: typeof data.aiTopP === 'number' ? data.aiTopP : 1.0,
      };
      setConfig(next);
      setBaseline(next);
    } catch (error) {
      console.error('Failed to load AISettings', error);
      toast('Failed to access AI configuration.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await XenonApiService.updateGlobalConfig({
        aiProvider: config.aiProvider,
        aiTemperature: config.aiTemperature,
        aiMaxTokens: config.aiMaxTokens,
        aiTopP: config.aiTopP,
      } as any);
      setBaseline(config);
      toast('AI engine configuration saved.', 'success');
    } catch (error) {
      console.error('Failed to save AISettings', error);
      toast('Failed to persist updates.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    const startedAt = Date.now();
    try {
      const result: { success: boolean; message: string } = await XenonApiService.testAIConfig({
        aiProvider: config.aiProvider,
      });
      const ms = Date.now() - startedAt;
      if (result.success) {
        toast(`${result.message} (${ms}ms)`, 'success');
      } else {
        toast(result.message, 'error');
      }
    } catch (err: any) {
      toast(`Connection failed: ${err?.message || 'unknown error'}`, 'error');
    } finally {
      setTesting(false);
    }
  };

  const providers: ProviderInfo[] = [
    {
      id: 'gemini',
      name: 'Google Gemini',
      description: `${getModelDefault('gemini')} — Multimodal reasoning`,
      icon: <span className="ai-provider-glyph">G</span>,
      isConfigured: !!config.geminiSet,
    },
    {
      id: 'openai',
      name: 'OpenAI',
      description: `${getModelDefault('openai')} — OpenAI v1 compatible`,
      icon: <Cpu size={18} />,
      isConfigured: !!config.openaiSet,
    },
    {
      id: 'anthropic',
      name: 'Anthropic',
      description: `${getModelDefault('anthropic')} — Advanced analysis`,
      icon: <ShieldCheck size={18} />,
      isConfigured: !!config.anthropicSet,
    },
    {
      id: 'ollama',
      name: 'Ollama',
      description: 'Local / self-hosted — no API key required',
      icon: <Server size={18} />,
      isConfigured: !!config.ollamaModel || !!config.aiModel || !!config.aiBaseUrl,
    },
  ];

  const activeProvider = providers.find((p) => p.id === config.aiProvider);
  const configuredCount = providers.filter((p) => p.isConfigured).length;
  const isDirty = !cfgEqual(config, baseline);

  if (loading) {
    return (
      <div className="settings-loading">
        <RefreshCw className="animate-spin" size={32} />
        <span>Synchronizing Global State...</span>
      </div>
    );
  }

  return (
    <div className="settings-container">
      <PageHeader
        icon={Brain}
        title="AI Engine Configuration"
        subtitle={
          <>
            All credentials and endpoints are managed via environment variables.
            <span className="page-header-subnote">
              <Lock size={12} />
              Select the active provider from configured options below.
            </span>
          </>
        }
      />

      <div className="settings-content">
        <div className="settings-grid settings-grid--two-equal">
          <SettingCard
            icon={<ShieldCheck size={16} />}
            title="Provider Registry"
            titleExtra={
              <span
                className={`provider-count-pill ${configuredCount > 0 ? 'is-ok' : 'is-empty'}`}
              >
                {configuredCount} / {providers.length} CONFIGURED
              </span>
            }
            description="Providers are activated via environment variables. Select a configured engine to activate."
          >
            <div className="provider-list">
              {providers.map((provider) => {
                const isActive = config.aiProvider === provider.id;
                const isSelectable = provider.isConfigured;
                return (
                  <button
                    type="button"
                    key={provider.id}
                    className={`provider-row ${isActive ? 'is-active' : ''} ${
                      !isSelectable ? 'is-disabled' : ''
                    }`}
                    onClick={() =>
                      isSelectable && setConfig({ ...config, aiProvider: provider.id })
                    }
                    disabled={!isSelectable}
                    title={
                      isSelectable
                        ? `Activate ${provider.name}`
                        : `Set XENON_${provider.id.toUpperCase()}_API_KEY to enable`
                    }
                  >
                    <div className="provider-row__icon">{provider.icon}</div>
                    <div className="provider-row__body">
                      <div className="provider-row__name">{provider.name}</div>
                      <div className="provider-row__desc">{provider.description}</div>
                      <div className="provider-row__status">
                        {isActive ? (
                          <span className="provider-status provider-status--active">
                            <CheckCircle2 size={11} />
                            {provider.isConfigured ? 'ACTIVE' : 'ACTIVE — NO KEY'}
                          </span>
                        ) : provider.isConfigured ? (
                          <span className="provider-status provider-status--ready">
                            <CheckCircle2 size={11} />
                            READY
                          </span>
                        ) : (
                          <span className="provider-status provider-status--off">
                            <Lock size={10} />
                            NOT SET
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </SettingCard>

          <SettingCard
            icon={<Globe size={16} />}
            title="Runtime Configuration"
            description="Environmental overrides for AI model endpoints and identifiers."
          >
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
                  <span>
                    {config.aiProvider === 'gemini' &&
                      (config.geminiModel || config.aiModel || getModelDefault('gemini'))}
                    {config.aiProvider === 'openai' &&
                      (config.openaiModel || config.aiModel || getModelDefault('openai'))}
                    {config.aiProvider === 'anthropic' &&
                      (config.anthropicModel ||
                        config.aiModel ||
                        getModelDefault('anthropic'))}
                    {config.aiProvider === 'ollama' &&
                      (config.ollamaModel || config.aiModel || getModelDefault('ollama'))}
                  </span>
                  <span className="ai-config-default">DEFAULT</span>
                </span>
              </div>
              <div className="ai-config-row">
                <span className="ai-config-label">Base URL</span>
                <span className="ai-config-value mono">
                  <span>{config.aiBaseUrl || getBaseUrlDefault(config.aiProvider)}</span>
                  {!config.aiBaseUrl && <span className="ai-config-default">DEFAULT</span>}
                </span>
              </div>
            </div>

            <div className="model-params">
              <div className="model-params__header">
                <Sliders size={14} />
                <span>Model Parameters</span>
              </div>

              <div className="model-param">
                <div className="model-param__label-row">
                  <label htmlFor="ai-temp">TEMPERATURE</label>
                  <span className="model-param__value">{config.aiTemperature.toFixed(1)}</span>
                </div>
                <input
                  id="ai-temp"
                  type="range"
                  min={0}
                  max={2}
                  step={0.1}
                  value={config.aiTemperature}
                  onChange={(e) =>
                    setConfig({ ...config, aiTemperature: parseFloat(e.target.value) })
                  }
                  className="model-param__slider"
                />
              </div>

              <div className="model-param">
                <div className="model-param__label-row">
                  <label htmlFor="ai-max-tokens">MAX TOKENS</label>
                </div>
                <div className="setting-input-wrapper">
                  <input
                    id="ai-max-tokens"
                    type="number"
                    min={256}
                    step={128}
                    value={config.aiMaxTokens}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        aiMaxTokens: parseInt(e.target.value, 10) || 0,
                      })
                    }
                  />
                </div>
              </div>

              <div className="model-param">
                <div className="model-param__label-row">
                  <label htmlFor="ai-top-p">TOP P</label>
                  <span className="model-param__value">{config.aiTopP.toFixed(2)}</span>
                </div>
                <input
                  id="ai-top-p"
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={config.aiTopP}
                  onChange={(e) =>
                    setConfig({ ...config, aiTopP: parseFloat(e.target.value) })
                  }
                  className="model-param__slider"
                />
              </div>
            </div>

            <button
              type="button"
              className="test-connection-btn"
              onClick={handleTestConnection}
              disabled={testing || !activeProvider?.isConfigured}
            >
              {testing ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : (
                <Activity size={14} />
              )}
              <span>Test Connection</span>
            </button>
          </SettingCard>
        </div>
      </div>

      {(isDirty || saving) && (
        <ActionBar
          onSave={handleSave}
          onDiscard={() => setConfig(baseline)}
          isSaving={saving}
          isDirty={isDirty}
          saveLabel="Save Configuration"
        />
      )}
    </div>
  );
};
