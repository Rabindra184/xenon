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
  Activity,
} from 'lucide-react';
import { SettingCard } from '../ui/SettingCard';
import { PageHeader } from '../ui/page-header';
import { useToast } from '../ui/toast';
import { toastSaveError } from '../../api-service/api-client';

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
};

interface ProviderInfo {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  isConfigured: boolean;
  /** What the server needs before the provider can be chosen. */
  setupHint: string;
}

// The page chooses the provider; the rest comes from the server's settings.
const cfgEqual = (a: AIConfig, b: AIConfig) => a.aiProvider === b.aiProvider;

/** The model the server sets for a provider: its own, else the one for every provider. */
const configuredModel = (config: AIConfig, providerId: string) => {
  const own: Record<string, string> = {
    gemini: config.geminiModel,
    openai: config.openaiModel,
    anthropic: config.anthropicModel,
    ollama: config.ollamaModel,
  };
  return own[providerId] || config.aiModel;
};

/** Only these send their calls to a base URL; Gemini and Anthropic use their own. */
const USES_BASE_URL = ['openai', 'ollama'];

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
      await XenonApiService.updateGlobalConfig({ aiProvider: config.aiProvider });
      setBaseline(config);
      toast('AI engine configuration saved.', 'success');
    } catch (error) {
      console.error('Failed to save AISettings', error);
      toastSaveError(toast, error);
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
      setupHint: 'Set XENON_GEMINI_API_KEY on the server to use Google Gemini',
    },
    {
      id: 'openai',
      name: 'OpenAI',
      description: `${getModelDefault('openai')} — OpenAI v1 compatible`,
      icon: <Cpu size={18} />,
      isConfigured: !!config.openaiSet,
      setupHint: 'Set XENON_OPENAI_API_KEY on the server to use OpenAI',
    },
    {
      id: 'anthropic',
      name: 'Anthropic',
      description: `${getModelDefault('anthropic')} — Advanced analysis`,
      icon: <ShieldCheck size={18} />,
      isConfigured: !!config.anthropicSet,
      setupHint: 'Set XENON_ANTHROPIC_API_KEY on the server to use Anthropic',
    },
    {
      id: 'ollama',
      name: 'Ollama',
      description: 'Local / self-hosted — no API key required',
      icon: <Server size={18} />,
      isConfigured: !!config.ollamaModel || !!config.aiModel || !!config.aiBaseUrl,
      // Ollama needs no key: the server needs to know the model or the address.
      setupHint: 'Set XENON_OLLAMA_MODEL or XENON_AI_BASE_URL on the server to use Ollama',
    },
  ];

  const activeProvider = providers.find((p) => p.id === config.aiProvider);
  const model = configuredModel(config, config.aiProvider);
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
        title="AI engine"
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
            title="Provider registry"
            titleExtra={
              <span
                className={`provider-count-pill ${configuredCount > 0 ? 'is-ok' : 'is-empty'}`}
              >
                {configuredCount} / {providers.length} configured
              </span>
            }
            description="Providers are set up on the server. The one you save here replaces the server's own choice, and stays after a restart."
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
                    title={isSelectable ? `Activate ${provider.name}` : provider.setupHint}
                  >
                    <div className="provider-row__icon">{provider.icon}</div>
                    <div className="provider-row__body">
                      <div className="provider-row__name">{provider.name}</div>
                      <div className="provider-row__desc">{provider.description}</div>
                      <div className="provider-row__status">
                        {isActive ? (
                          <span className="provider-status provider-status--active">
                            <CheckCircle2 size={11} />
                            {provider.isConfigured ? 'Active' : 'Active — no key'}
                          </span>
                        ) : provider.isConfigured ? (
                          <span className="provider-status provider-status--ready">
                            <CheckCircle2 size={11} />
                            READY
                          </span>
                        ) : (
                          <span className="provider-status provider-status--off">
                            <Lock size={10} />
                            Not set
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
            title="Runtime configuration"
            description="The model and address the active provider uses, from the server's settings."
          >
            <div className="ai-config-display">
              <div className="ai-config-row">
                <span className="ai-config-label">Active provider</span>
                <span className="ai-config-value">
                  {activeProvider?.icon}
                  {activeProvider?.name || '—'}
                </span>
              </div>
              <div className="ai-config-row">
                <span className="ai-config-label">Model</span>
                <span className="ai-config-value mono">
                  <span>{model || getModelDefault(config.aiProvider)}</span>
                  {!model && <span className="ai-config-default">Default</span>}
                </span>
              </div>
              {USES_BASE_URL.includes(config.aiProvider) && (
                <div className="ai-config-row">
                  <span className="ai-config-label">Base URL</span>
                  <span className="ai-config-value mono">
                    <span>{config.aiBaseUrl || getBaseUrlDefault(config.aiProvider)}</span>
                    {!config.aiBaseUrl && <span className="ai-config-default">Default</span>}
                  </span>
                </div>
              )}
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
          saveLabel="Save configuration"
        />
      )}
    </div>
  );
};
