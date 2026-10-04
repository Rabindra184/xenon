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
  HeartPulse,
} from 'lucide-react';
import { FieldGroup } from '../ui/FieldGroup';
import { Select } from '../ui/select';
import { PageHeader } from '../ui/page-header';
import { useToast } from '../ui/toast';
import { WEBHOOK_VARIABLE_HELP, templateVariables } from './webhookEvents';

interface WebhookConfig {
  id: string;
  url: string;
  type: string;
  events: string;
  active: boolean;
  payloadTemplate?: string | null;
}

/** What goes out when there is no custom payload. */
const FORMATS = [
  { id: 'slack', label: 'Slack message' },
  { id: 'webhook', label: 'JSON (event and payload)' },
];

/** What a saved webhook sends: its own payload, or one of the formats. */
function formatLabel(config: WebhookConfig): string {
  if (config.payloadTemplate) return 'CUSTOM';
  return config.type === 'slack' ? 'SLACK' : 'JSON';
}

const AVAILABLE_EVENTS = [
  {
    id: 'device_offline',
    label: 'Device offline',
    icon: AlertCircle,
    tone: 'red' as const,
  },
  { id: 'device_new', label: 'New device', icon: Plus, tone: 'green' as const },
  {
    id: 'session_failed',
    label: 'Session failed',
    icon: XCircle,
    tone: 'amber' as const,
  },
  {
    id: 'selector_health_digest',
    label: 'Selector health digest',
    icon: HeartPulse,
    tone: 'green' as const,
  },
];

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
  const [format, setFormat] = useState('slack');

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
        format,
        payloadTemplate || undefined,
      );
      setNewUrl('');
      setPayloadTemplate('');
      setShowTemplate(false);
      setFormat('slack');
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

  // A sample of each selected event, sent the way that event is really sent:
  // in this format, through this template. Each event fills a template its
  // own way ({{failureReason}} exists only for a failed session), so testing
  // one would say nothing about the others.
  const handleTest = async () => {
    if (!newUrl.trim() || selectedEvents.length === 0) return;
    setTesting(true);
    const labelOf = (id: string) => AVAILABLE_EVENTS.find((e) => e.id === id)?.label ?? id;
    try {
      for (const event of selectedEvents) {
        try {
          await XenonApiService.testWebhook(
            newUrl.trim(),
            format,
            payloadTemplate || undefined,
            event,
          );
        } catch (error: any) {
          toast(`Test failed for ${labelOf(event)}: ${error.message || 'check the URL'}`, 'error');
          return;
        }
      }
      toast(
        selectedEvents.length === 1
          ? `Test message delivered: ${labelOf(selectedEvents[0])}.`
          : `Test messages delivered: ${selectedEvents.map(labelOf).join(', ')}.`,
        'success',
      );
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
        title="Notifications"
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
                        config.payloadTemplate ? 'pill-chip--admin' : 'pill-chip--scope'
                      }`}
                    >
                      {formatLabel(config)}
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

            <FieldGroup
              label="Message format"
              description={
                payloadTemplate.trim()
                  ? 'Your custom payload is sent as written, whatever the format.'
                  : 'Slack message for a Slack incoming webhook; JSON for anything else.'
              }
              htmlFor="webhook-format"
            >
              <Select
                id="webhook-format"
                value={format}
                onChange={(e) => setFormat(e.target.value)}
              >
                {FORMATS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </Select>
            </FieldGroup>

            <FieldGroup label="Trigger events">
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
                    Define a JSON or text template. Click a name below to insert it; the names are
                    the ones your selected events carry.
                  </p>
                  <div className="template-editor__chips">
                    {templateVariables(selectedEvents).map((v) => (
                      <button
                        type="button"
                        key={v}
                        className="template-editor__chip"
                        aria-label={`{{${v}}}`}
                        title={WEBHOOK_VARIABLE_HELP[v]}
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
              disabled={!newUrl.trim() || selectedEvents.length === 0 || testing}
              aria-label="Send test"
              title={
                selectedEvents.length === 0
                  ? 'Select a trigger event to send a sample of'
                  : 'Sends a sample message for each selected event'
              }
            >
              {testing ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : (
                <Activity size={14} />
              )}
              <span>Send test</span>
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
