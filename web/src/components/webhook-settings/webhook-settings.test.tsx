import * as React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getWebhookConfigs: vi.fn(),
  addWebhookConfig: vi.fn(),
  deleteWebhookConfig: vi.fn(),
  testWebhook: vi.fn(),
}));
const toast = vi.hoisted(() => vi.fn(() => 'toast-id'));
vi.mock('../../api-service', () => ({ default: api }));
vi.mock('../ui/toast', () => ({ useToast: () => ({ toast, removeToast: vi.fn() }) }));

import { WebhookSettings } from './webhook-settings';

const URL = 'https://hooks.slack.com/services/T000/B000/XXXX';

beforeEach(() => {
  vi.clearAllMocks();
  api.getWebhookConfigs.mockResolvedValue([]);
  api.addWebhookConfig.mockResolvedValue({});
  api.testWebhook.mockResolvedValue({ success: true });
});

async function openForm() {
  render(<WebhookSettings />);
  await screen.findByText('No webhooks configured');
  fireEvent.change(screen.getByLabelText('Webhook URL'), { target: { value: URL } });
}

const openTemplate = () => fireEvent.click(screen.getByRole('button', { name: /custom payload/i }));
const chips = () =>
  Array.from(document.querySelectorAll('.template-editor__chip')).map((c) => c.textContent);
const eventToggle = (name: string) => screen.getByRole('checkbox', { name });
const textarea = () => screen.getByPlaceholderText(/Alert/) as HTMLTextAreaElement;

describe('webhook settings: template chips', () => {
  it('offers the names the selected events carry, which the server fills in', async () => {
    await openForm();
    openTemplate();

    // Selected by default: Device offline and Session failed.
    expect(chips()).toEqual(
      expect.arrayContaining([
        '{{eventType}}',
        '{{udid}}',
        '{{host}}',
        '{{sessionId}}',
        '{{failureReason}}',
        '{{deviceName}}',
      ]),
    );
    expect(chips()).not.toContain('{{windowDays}}');
  });

  it('follows the selection: another event adds its names, one deselected takes its own away', async () => {
    await openForm();
    openTemplate();

    fireEvent.click(eventToggle('Selector health digest'));
    expect(chips()).toContain('{{totalHeals}}');

    fireEvent.click(eventToggle('Session failed'));
    expect(chips()).not.toContain('{{failureReason}}');
    expect(chips()).not.toContain('{{sessionId}}');
    expect(chips()).toContain('{{udid}}'); // Device offline still has it
  });

  it('lists a name once however many selected events have it', async () => {
    await openForm();
    openTemplate();
    fireEvent.click(eventToggle('New device'));

    expect(chips().filter((c) => c === '{{udid}}')).toHaveLength(1);
  });

  it('puts a chip in the template where it is clicked', async () => {
    await openForm();
    openTemplate();

    fireEvent.click(screen.getByRole('button', { name: '{{failureReason}}' }));

    expect(textarea().value).toContain('{{failureReason}}');
  });
});

describe('webhook settings: the format', () => {
  it('saves a Slack message by default', async () => {
    await openForm();

    fireEvent.click(screen.getByRole('button', { name: /save webhook/i }));

    await waitFor(() => expect(api.addWebhookConfig).toHaveBeenCalled());
    expect(api.addWebhookConfig).toHaveBeenCalledWith(
      URL,
      ['device_offline', 'session_failed'],
      'slack',
      undefined,
    );
  });

  it('can be set to plain JSON, which is what a generic receiver needs', async () => {
    await openForm();

    fireEvent.change(screen.getByLabelText('Message format'), { target: { value: 'webhook' } });
    fireEvent.click(screen.getByRole('button', { name: /save webhook/i }));

    await waitFor(() => expect(api.addWebhookConfig).toHaveBeenCalled());
    expect(api.addWebhookConfig.mock.calls[0][2]).toBe('webhook');
  });

  it('says that a custom payload is sent as written, whatever the format', async () => {
    await openForm();
    openTemplate();
    fireEvent.change(textarea(), { target: { value: '{"text": "{{udid}}"}' } });

    expect(screen.getByText(/sent as written/i)).toBeInTheDocument();
  });

  it('labels each saved webhook by what it sends', async () => {
    api.getWebhookConfigs.mockResolvedValue([
      { id: '1', url: 'https://a.example', type: 'slack', events: '["device_new"]', active: true },
      {
        id: '2',
        url: 'https://b.example',
        type: 'webhook',
        events: '["device_new"]',
        active: true,
      },
      {
        id: '3',
        url: 'https://c.example',
        type: 'slack',
        events: '["device_new"]',
        active: true,
        payloadTemplate: '{"text":"x"}',
      },
    ]);
    render(<WebhookSettings />);

    const row = async (url: string) =>
      (await screen.findByText(url)).closest('.webhook-row-card') as HTMLElement;
    expect(within(await row('https://a.example')).getByText('SLACK')).toBeInTheDocument();
    expect(within(await row('https://b.example')).getByText('JSON')).toBeInTheDocument();
    expect(within(await row('https://c.example')).getByText('CUSTOM')).toBeInTheDocument();
  });
});

describe('webhook settings: Send test', () => {
  it('sends the template, the format and the event, so what arrives is what a real event sends', async () => {
    await openForm();
    fireEvent.click(eventToggle('Device offline')); // leave Session failed alone
    openTemplate();
    fireEvent.change(textarea(), { target: { value: '{"text": "{{failureReason}}"}' } });
    fireEvent.change(screen.getByLabelText('Message format'), { target: { value: 'webhook' } });

    fireEvent.click(screen.getByRole('button', { name: /send test/i }));

    await waitFor(() => expect(api.testWebhook).toHaveBeenCalledTimes(1));
    expect(api.testWebhook).toHaveBeenCalledWith(
      URL,
      'webhook',
      '{"text": "{{failureReason}}"}',
      'session_failed',
    );
  });

  it('sends a sample of each selected event, since each fills the template its own way', async () => {
    await openForm();

    fireEvent.click(screen.getByRole('button', { name: /send test/i }));

    await waitFor(() => expect(api.testWebhook).toHaveBeenCalledTimes(2));
    expect(api.testWebhook.mock.calls.map((c) => c[3])).toEqual([
      'device_offline',
      'session_failed',
    ]);
    expect(api.testWebhook.mock.calls[0][2]).toBeUndefined(); // no template
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        'Test messages delivered: Device offline, Session failed.',
        'success',
      ),
    );
  });

  it('says which event failed and why, and stops there', async () => {
    api.testWebhook.mockRejectedValueOnce(new Error('Request failed with status code 404'));
    await openForm();

    fireEvent.click(screen.getByRole('button', { name: /send test/i }));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        'Test failed for Device offline: Request failed with status code 404',
        'error',
      ),
    );
    expect(api.testWebhook).toHaveBeenCalledTimes(1);
  });

  it('needs an event to send a sample of', async () => {
    await openForm();
    fireEvent.click(eventToggle('Device offline'));
    fireEvent.click(eventToggle('Session failed'));

    expect(screen.getByRole('button', { name: /send test/i })).toBeDisabled();
  });
});
