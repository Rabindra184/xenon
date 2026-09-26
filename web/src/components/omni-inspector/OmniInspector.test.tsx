import * as React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InspectorNode, InspectorSnapshot } from './OmniInspector';

const api = vi.hoisted(() => ({
  getInspectorSnapshot: vi.fn(),
  getAppiumSession: vi.fn(),
}));
vi.mock('../../api-service', () => ({ default: api }));

import OmniInspector from './OmniInspector';

function button(id: string): InspectorNode {
  return {
    name: '',
    type: 'android.widget.Button',
    text: 'Log in',
    rect: { x: 10, y: 10, width: 200, height: 60 },
    xpath: `/hierarchy/${id}`,
    suggestedLocators: [{ strategy: 'id', value: id, unique: true, score: 0 }],
    suggestedActions: [],
    children: [],
    attributes: { clickable: 'true', enabled: 'true', 'resource-id': id },
  };
}

function snapshot(id = 'com.app:id/login'): InspectorSnapshot {
  return {
    udid: 'U1',
    platform: 'android',
    timestamp: new Date().toISOString(),
    screenshot: '',
    hierarchySource: 'device',
    metadata: { screenWidth: 1080, screenHeight: 2220 },
    hierarchy: {
      name: '',
      type: 'hierarchy',
      rect: { x: 0, y: 0, width: 1080, height: 2220 },
      xpath: '/',
      suggestedLocators: [],
      suggestedActions: [],
      attributes: {},
      children: [button(id)],
    },
  };
}

const STALE = 'The screen may have changed since this capture.';

beforeEach(() => {
  vi.clearAllMocks();
  api.getInspectorSnapshot.mockResolvedValue(snapshot());
  api.getAppiumSession.mockResolvedValue({});
});

describe('OmniInspector — Checks', () => {
  // "AI Insight" ran rules in the browser; nothing in it was AI.
  it('shows Checks, not AI Insight, with a summary and one row per check', async () => {
    render(<OmniInspector udid="U1" embedded />);
    fireEvent.click(await screen.findByText('com.app:id/login'));
    expect(screen.queryByRole('tab', { name: /AI Insight/i })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Checks' }));
    expect(screen.getByText(/\d+ passed/)).toBeInTheDocument();
    expect(screen.getByText('Unique locator')).toBeInTheDocument();
    expect(screen.getByText('id com.app:id/login matches only this element')).toBeInTheDocument();
    expect(screen.queryByText('Quick Facts')).toBeNull();
  });
});

describe('OmniInspector — stale capture', () => {
  it('says when an input may have changed the screen, and Refresh captures again', async () => {
    const { rerender } = render(<OmniInspector udid="U1" embedded deviceActionAt={0} />);
    await screen.findByText('com.app:id/login');
    expect(screen.getByText(/^Captured /)).toBeInTheDocument();
    expect(screen.queryByText(STALE)).toBeNull();

    await new Promise((r) => setTimeout(r, 5));
    rerender(<OmniInspector udid="U1" embedded deviceActionAt={Date.now()} />);
    const banner = screen.getByText(STALE).closest('[role="status"]') as HTMLElement;
    expect(banner).not.toBeNull();

    await new Promise((r) => setTimeout(r, 5));
    fireEvent.click(within(banner).getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(api.getInspectorSnapshot).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText(STALE)).toBeNull());
  });
});

describe('OmniInspector — refresh race', () => {
  // A slow capture of the previous device must not replace the current one.
  it('keeps the newest capture when an older request answers late', async () => {
    let answerFirst: (v: InspectorSnapshot) => void = () => {};
    api.getInspectorSnapshot
      .mockImplementationOnce(() => new Promise((r) => (answerFirst = r)))
      .mockResolvedValueOnce(snapshot('com.app:id/second'));
    const { rerender } = render(<OmniInspector udid="U1" embedded />);
    rerender(<OmniInspector udid="U2" embedded />);
    await screen.findByText('com.app:id/second');
    answerFirst(snapshot('com.app:id/first'));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('com.app:id/first')).toBeNull();
    expect(screen.getByText('com.app:id/second')).toBeInTheDocument();
  });
});

describe('OmniInspector — names', () => {
  it('names the tree header’s icon buttons', async () => {
    render(<OmniInspector udid="U1" embedded />);
    await screen.findByText('com.app:id/login');
    for (const name of ['Expand all', 'Collapse all', 'Refresh snapshot']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: /^(Inspect|Interact) mode/ })).toBeInTheDocument();
  });

  it('names each locator’s icon buttons', async () => {
    render(<OmniInspector udid="U1" embedded />);
    fireEvent.click(await screen.findByText('com.app:id/login'));
    for (const name of [
      'Test locator',
      'Verify with Appium',
      'Find and tap with Appium',
      'Copy locator',
    ]) {
      expect(screen.getAllByRole('button', { name }).length).toBeGreaterThan(0);
    }
  });
});
