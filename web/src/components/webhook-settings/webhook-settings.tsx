import * as React from 'react';
import { useState, useEffect } from 'react';
import XenonApiService from '../../api-service';
import './webhook-settings.css';
import '../settings/settings.css';
import {
  Trash2,
  Bell,
  CheckCircle2,
  AlertCircle,
  Plus,
  Zap,
  XCircle,
  Activity,
  RefreshCw,
} from 'lucide-react';
import { FieldGroup } from '../ui/FieldGroup';
import { PageHeader } from '../ui/page-header';
import { useToast } from '../ui/toast';

interface WebhookConfig {
  id: string;
  url: string;
  type: string;
  events: string;
  active: boolean;
}

const AVAILABLE_EVENTS = [
  {
    id: 'device_offline',
    label: 'Device Offline',
    icon: AlertCircle,
    tone: 'red' as const,
  },
  { id: 'device_new', label: 'New Device', icon: Plus, tone: 'green' as const },
  {
    id: 'session_failed',
    label: 'Session Failed',
    icon: XCircle,
    tone: 'amber' as const,
  },
];

const VARIABLES = ['udid', 'host', 'name', 'sessionId', 'failureReason', 'eventType', 'platform'];

export const WebhookSettings: React.FC = () => {
  const { toast } = useToast();
  const [configs, setConfigs] = useState<WebhookConfig[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [newUrl, setNewUrl] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<string[]>([
    'device_offline',
    'session_failed',
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showTemplate, setShowTemplate] = useState(false);
  const [payloadTemplate, setPayloadTemplate] = useState('');

  useEffect(() => {
    loadConfigs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadConfigs = async () => {
    setLoadingList(true);
    try {
      const data = await XenonApiService.getWebhookConfigs();
      setConfigs(data || []);
    } catch (error) {
      console.error('Failed to load webhook configs', error);
      toast('Failed to load webhooks.', 'error');
    } finally {
      setLoadingList(false);
    }
  };

  const handleAdd = async () => {
    if (!newUrl.trim()) {
      toast('Webhook URL is required.', 'error');
      return;
    }
    if (selectedEvents.length === 0) {
      toast('Select at least one trigger event.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      await XenonApiService.addWebhookConfig(
        newUrl.trim(),
        selectedEvents,
        'slack',
        payloadTemplate || undefined,
      );
      setNewUrl('');
      setPayloadTemplate('');
      setShowTemplate(false);
      setSelectedEvents(['device_offline', 'session_failed']);
      await loadConfigs();
      toast('Webhook saved.', 'success');
    } catch (error: any) {
      console.error('Failed to add webhook', error);
      toast(`Failed to add webhook: ${error.message || 'unknown error'}`, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string, url: string) => {
    if (!window.confirm(`Remove webhook for "${url}"?`)) return;
    try {
      await XenonApiService.deleteWebhookConfig(id);
      await loadConfigs();
      toast('Webhook removed.', 'success');
    } catch (error: any) {
      console.error('Failed to delete webhook', error);
      toast(`Failed to delete: ${error.message || 'unknown error'}`, 'error');
    }
  };

  const handleTest = async () => {
    if (!newUrl.trim()) return;
    setTesting(true);
    try {
      await XenonApiService.testWebhook(newUrl.trim(), 'slack');
      toast('Test payload delivered.', 'success');
    } catch (error: any) {
      toast(`Test failed: ${error.message || 'check the URL'}`, 'error');
    } finally {
      setTesting(false);
    }
  };

  const toggleEvent = (eventId: string) => {
    setSelectedEvents((prev) =>
      prev.includes(eventId) ? prev.filter((e) => e !== eventId) : [...prev, eventId],
    );
  };

  const insertVariable = (variable: string) => {
    setPayloadTemplate((prev) => prev + `{{${variable}}} `);
  };

  return (
    <div className="settings-container">
      <PageHeader
        icon={Bell}
        title="Notification Webhooks"
        subtitle="Configure Slack or generic webhooks to receive alerts for critical infrastructure events."
      />

      <div className="settings-content">
        {loadingList ? (
          <div className="settings-loading" style={{ height: 200 }}>
            <RefreshCw className="animate-spin" size={28} />
            <span>Loading webhooks…</span>
          </div>
        ) : configs.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state__icon">
              <Bell size={28} />
            </div>
            <h3 className="empty-state__title">No webhooks configured</h3>
            <p className="empty-state__copy">
              Wire up a Slack incoming webhook or any HTTPS endpoint to receive alerts when
              devices go offline, new devices register, or sessions fail. Configure your first
              webhook below.
            </p>
          </div>
        ) : (
          <div className="webhook-list-grid">
            {configs.map((config) => {
              const events: string[] = (() => {
                try {
                  return JSON.parse(config.events);
                } catch {
                  return [];
                }
              })();
              return (
                <div key={config.id} className="webhook-row-card">
                  <div className="webhook-row-card__header">
                    <span
                      className={`pill-chip ${
                        (config as any).payloadTemplate
                          ? 'pill-chip--admin'
                          : 'pill-chip--scope'
                      }`}
                    >
                      {(config as any).payloadTemplate ? 'CUSTOM' : 'SLACK'}
                    </span>
                    <span className="webhook-row-card__url" title={config.url}>
                      {config.url}
                    </span>
                    <button
                      type="button"
                      className="row-action row-action--danger"
                      onClick={() => handleDelete(config.id, config.url)}
                      aria-label={`Remove webhook for ${config.url}`}
                    >
                      <Trash2 size={13} />
                      <span>Remove</span>
                    </button>
                  </div>
                  <div className="webhook-row-card__events">
                    {events.length === 0 ? (
                      <span className="webhook-row-card__no-events">No triggers</span>
                    ) : (
                      events.map((event: string) => {
                        const def = AVAILABLE_EVENTS.find((e) => e.id === event);
                        const Icon = def?.icon ?? Bell;
                        return (
                          <span
                            key={event}
                            className={`event-pill event-pill--${def?.tone || 'gray'}`}
                          >
                            <Icon size={11} />
                            {def?.label || event}
                          </span>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="add-webhook-card">
          <div className="add-webhook-card__header">
            <Plus size={14} />
            <span>Add a new webhook</span>
          </div>

          <div className="add-webhook-card__body">
            <FieldGroup
              label="Webhook URL"
              description="The endpoint we POST webhook events to."
              htmlFor="webhook-url"
            >
              <div className="setting-input-wrapper">
                <input
                  id="webhook-url"
                  type="url"
                  placeholder="https://hooks.slack.com/services/..."
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                />
              </div>
            </FieldGroup>

            <FieldGroup label="Trigger Events">
              <div className="event-toggle-grid">
                {AVAILABLE_EVENTS.map((event) => {
                  const isSelected = selectedEvents.includes(event.id);
                  const Icon = event.icon;
                  return (
                    <button
                      type="button"
                      key={event.id}
                      role="checkbox"
                      aria-checked={isSelected}
                      className={`event-toggle event-toggle--${event.tone} ${
                        isSelected ? 'is-selected' : ''
                      }`}
                      onClick={() => toggleEvent(event.id)}
                    >
                      <Icon size={14} className="event-toggle__lead" />
                      <span>{event.label}</span>
                      {isSelected && (
                        <CheckCircle2 size={14} className="event-toggle__check" />
                      )}
                    </button>
                  );
                })}
              </div>
            </FieldGroup>

            <div className="template-section">
              <button
                type="button"
                className="template-section__toggle"
                onClick={() => setShowTemplate(!showTemplate)}
                aria-expanded={showTemplate}
              >
                <Zap size={14} className={showTemplate ? 'tone-amber' : 'tone-dim'} />
                <span>Use custom payload (optional)</span>
                <span className="template-section__indicator">{showTemplate ? '−' : '+'}</span>
              </button>

              {showTemplate && (
                <div className="template-editor">
                  <p className="template-editor__hint">
                    Define a JSON or text template. Click a variable below to insert it.
                  </p>
                  <div className="template-editor__chips">
                    {VARIABLES.map((v) => (
                      <button
                        type="button"
                        key={v}
                        className="template-editor__chip"
                        onClick={() => insertVariable(v)}
                      >
                        {`{{${v}}}`}
                      </button>
                    ))}
                  </div>
                  <textarea
                    className="template-editor__textarea"
                    placeholder='Example: { "text": "Alert: Device {{udid}} is offline!" }'
                    value={payloadTemplate}
                    onChange={(e) => setPayloadTemplate(e.target.value)}
                    rows={4}
                  />
                </div>
              )}
            </div>
          </div>

          <div className="add-webhook-card__footer">
            <button
              type="button"
              className="page-header-action page-header-action--ghost"
              onClick={handleTest}
              disabled={!newUrl.trim() || testing}
            >
              {testing ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : (
                <Activity size={14} />
              )}
              <span>Test payload</span>
            </button>
            <button
              type="button"
              className="page-header-action"
              onClick={handleAdd}
              disabled={submitting || !newUrl.trim()}
            >
              {submitting ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : (
                <Plus size={14} />
              )}
              <span>{submitting ? 'Saving…' : 'Save webhook'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
