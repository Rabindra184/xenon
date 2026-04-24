import * as React from 'react';
import { useState, useEffect } from 'react';
import XenonApiService from '../../api-service';
import './webhook-settings.css';
import { Trash2, Bell, CheckCircle, AlertCircle, Plus, Zap, XCircle } from 'lucide-react';
import { FieldGroup } from '../ui/FieldGroup';

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
    icon: <AlertCircle size={14} className="text-red-400" />,
  },
  { id: 'device_new', label: 'New Device', icon: <Plus size={14} className="text-green-400" /> },
  {
    id: 'session_failed',
    label: 'Session Failed',
    icon: <XCircle size={14} className="text-orange-400" />,
  },
];

export const WebhookSettings: React.FC = () => {
  const [configs, setConfigs] = useState<WebhookConfig[]>([]);
  const [newUrl, setNewUrl] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<string[]>([
    'device_offline',
    'session_failed',
  ]);
  const [loading, setLoading] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [showTemplate, setShowTemplate] = useState(false);
  const [payloadTemplate, setPayloadTemplate] = useState('');

  useEffect(() => {
    loadConfigs();
  }, []);

  const loadConfigs = async () => {
    try {
      const data = await XenonApiService.getWebhookConfigs();
      setConfigs(data || []);
    } catch (error) {
      console.error('Failed to load webhook configs', error);
    }
  };

  const handleAdd = async () => {
    if (!newUrl) return;
    setLoading(true);
    try {
      await XenonApiService.addWebhookConfig(
        newUrl,
        selectedEvents,
        'slack',
        payloadTemplate || undefined,
      );
      setNewUrl('');
      setPayloadTemplate('');
      setShowTemplate(false);
      setSelectedEvents(['device_offline', 'session_failed']);
      await loadConfigs();
    } catch (error) {
      console.error('Failed to add webhook', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await XenonApiService.deleteWebhookConfig(id);
      await loadConfigs();
    } catch (error) {
      console.error('Failed to delete webhook', error);
    }
  };

  const handleTest = async () => {
    if (!newUrl) return;
    setTestStatus('idle');
    try {
      await XenonApiService.testWebhook(newUrl, 'slack');
      setTestStatus('success');
      setTimeout(() => setTestStatus('idle'), 3000);
    } catch (error) {
      setTestStatus('error');
      setTimeout(() => setTestStatus('idle'), 3000);
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
    <div className="webhook-settings-container">
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
      <div className="webhook-header">
        <div className="webhook-title">
          <Bell className="webhook-icon" size={20} />
          <h2>Notification Webhooks</h2>
        </div>
        <p className="webhook-subtitle">
          Configure Slack or generic webhooks to receive alerts for critical infrastructure events.
        </p>
      </div>

      <div className="webhook-list">
        {configs.map((config: WebhookConfig) => (
          <div key={config.id} className="webhook-card">
            <div className="webhook-card-header">
              <div className="webhook-url-display">
                <span className="platform-tag">
                  {(config as any).payloadTemplate ? 'CUSTOM' : 'SLACK'}
                </span>
                <span className="url-text">{config.url}</span>
              </div>
              <button className="delete-btn" onClick={() => handleDelete(config.id)}>
                <Trash2 size={16} />
              </button>
            </div>
            <div className="webhook-events-list">
              {JSON.parse(config.events).map((event: string) => {
                const eventDef = AVAILABLE_EVENTS.find((e) => e.id === event);
                return (
                  <span key={event} className="event-pill">
                    {eventDef?.icon}
                    {eventDef?.label || event}
                  </span>
                );
              })}
            </div>
          </div>
        ))}
        {configs.length === 0 && (
          <div className="empty-webhook-state">
            <Bell size={48} className="empty-icon" />
            <p>No webhooks configured yet.</p>
          </div>
        )}
      </div>

      <div className="add-webhook-form">
        <div className="form-scrollable-content">
          <h3>Add New Webhook</h3>
          <FieldGroup
            label="Webhook URL"
            description="The endpoint we POST webhook events to."
            htmlFor="webhook-url"
          >
            <input
              id="webhook-url"
              type="text"
              className="webhook-input"
              placeholder="https://hooks.slack.com/services/..."
              value={newUrl}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewUrl(e.target.value)}
            />
          </FieldGroup>

          <FieldGroup label="Trigger Events">
            <fieldset
              role="group"
              aria-label="Trigger Events"
              style={{ border: 'none', margin: 0, padding: 0 }}
            >
              <div className="events-grid">
                {AVAILABLE_EVENTS.map((event) => {
                  const isSelected = selectedEvents.includes(event.id);
                  return (
                    <div
                      key={event.id}
                      role="checkbox"
                      aria-checked={isSelected}
                      tabIndex={0}
                      className={`event-checkbox ${isSelected ? 'selected' : ''}`}
                      onClick={() => toggleEvent(event.id)}
                      onKeyDown={(e) => {
                        if (e.key === ' ' || e.key === 'Enter') {
                          e.preventDefault();
                          toggleEvent(event.id);
                        }
                      }}
                    >
                      {event.icon}
                      <span>{event.label}</span>
                      {isSelected && <CheckCircle size={14} className="check-icon" />}
                    </div>
                  );
                })}
              </div>
            </fieldset>
          </FieldGroup>

          <div className="template-section">
            <div className="template-header" onClick={() => setShowTemplate(!showTemplate)}>
              <div className="template-toggle">
                <Zap size={16} className={showTemplate ? 'text-yellow-400' : 'text-gray-400'} />
                <span>Use Custom Payload (Optional)</span>
              </div>
              <span className="toggle-indicator">{showTemplate ? '−' : '+'}</span>
            </div>

            {showTemplate && (
              <div className="template-editor">
                <p className="template-hint">
                  Define a JSON or text template. Use variables like <code>{'{{udid}}'}</code> to
                  insert dynamic data.
                </p>
                <div className="variable-chips">
                  {[
                    'udid',
                    'host',
                    'name',
                    'sessionId',
                    'failureReason',
                    'eventType',
                    'platform',
                  ].map((v: string) => (
                    <span key={v} className="variable-chip" onClick={() => insertVariable(v)}>
                      {v}
                    </span>
                  ))}
                </div>
                <textarea
                  className="template-textarea"
                  placeholder='Example JSON: { "text": "Alert: Device {{udid}} is offline!" }'
                  value={payloadTemplate}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                    setPayloadTemplate(e.target.value)
                  }
                  rows={3}
                />
              </div>
            )}
          </div>
        </div>

        <div className="form-actions">
          <button className={`test-btn ${testStatus}`} onClick={handleTest} disabled={!newUrl}>
            {testStatus === 'success'
              ? 'Sent!'
              : testStatus === 'error'
                ? 'Failed'
                : 'Test Payload'}
          </button>
          <button className="add-btn" onClick={handleAdd} disabled={!newUrl || loading}>
            {loading ? 'Saving...' : 'Save Configuration'}
          </button>
        </div>
      </div>
    </div>
  );
};
