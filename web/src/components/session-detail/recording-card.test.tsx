import React from 'react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render as rtlRender, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ISession } from '../../interfaces/ISession';
import type { LibraryResponse, RecordingSummary } from '../../api-service/recordings';

const api = vi.hoisted(() => ({ listRecordings: vi.fn() }));
vi.mock('../../api-service/recordings', async () => ({
  ...(await vi.importActual<typeof import('../../api-service/recordings')>(
    '../../api-service/recordings',
  )),
  listRecordings: api.listRecordings,
}));

import { RecordingCard, noVideoReason } from './recording-card';

const render = (ui: React.ReactElement) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>);

function library(groupIds: string[]): LibraryResponse {
  return {
    recordings: groupIds.map((groupId) => ({ groupId }) as RecordingSummary),
    nextCursor: null,
    total: groupIds.length,
    facets: {
      phones: [],
      people: [],
      unknownCount: 0,
      when: { any: 0, '24h': 0, '7d': 0, '30d': 0 },
    },
    retention: { days: 30, maxCount: 100 },
  };
}

beforeEach(() => {
  api.listRecordings.mockReset();
  api.listRecordings.mockResolvedValue(library([]));
});

const session = (over: Partial<ISession> = {}): ISession =>
  ({
    id: '088cce7e-aaaa-bbbb-cccc-000000000001',
    status: 'failed',
    desired_capabilities: '{}',
    session_capabilities: '{}',
    node_id: 'n-1',
    has_live_video: false,
    video_recording_enabled: true,
    video_recording: null,
    startTime: '2026-09-30T20:41:00.000Z',
    device_udid: 'R58M1234',
    device_platform: 'android',
    device_version: '10',
    createdAt: '2026-09-30T20:41:00.000Z',
    updatedAt: '2026-09-30T20:41:00.000Z',
    ...over,
  }) as ISession;

/**
 * The card used to say "Session failed before recording started." for every
 * failed session without a video, including the ones that never asked for a
 * recording, and ones that failed long after it started. It now says only
 * what the session's record shows.
 */
describe('RecordingCard without a video', () => {
  it.each([
    [
      'failed, recording off',
      { status: 'failed', video_recording_enabled: false },
      'Recording was off for this session.',
    ],
    [
      'passed, recording off',
      { status: 'passed', video_recording_enabled: false },
      'Recording was off for this session.',
    ],
    [
      'failed, recording asked for',
      { status: 'failed', video_recording_enabled: true },
      'No video was saved for this session.',
    ],
    [
      'passed, recording asked for',
      { status: 'passed', video_recording_enabled: true },
      'No video was saved for this session.',
    ],
    [
      'running, recording off',
      { status: 'running', video_recording_enabled: false },
      'Recording is off for this session.',
    ],
    [
      'running, recording asked for',
      { status: 'running', video_recording_enabled: true },
      'Any video appears here after the session ends.',
    ],
  ] as const)('%s', (_name, over, expected) => {
    render(<RecordingCard session={session(over as Partial<ISession>)} />);
    expect(screen.getByText('No video available')).toBeInTheDocument();
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it('never says when a failure happened, since the record does not say', () => {
    for (const status of ['failed', 'passed', 'error', 'timeout', 'running']) {
      for (const video_recording_enabled of [true, false, undefined]) {
        const text = noVideoReason({ status, video_recording_enabled });
        expect(text).not.toMatch(/before|failed|started|disabled/i);
      }
    }
  });
});

describe('RecordingCard with a video', () => {
  it('plays the saved video of an ended session', () => {
    const { container } = render(
      <RecordingCard session={session({ status: 'failed', video_recording: 'abc/video.mp4' })} />,
    );
    expect(container.querySelector('video')).not.toBeNull();
    expect(screen.queryByText('No video available')).toBeNull();
  });

  it('shows the live view of a running session that has one', () => {
    render(<RecordingCard session={session({ status: 'running', has_live_video: true })} />);
    expect(screen.getByAltText(/Live view of session/)).toBeInTheDocument();
  });
});

describe('RecordingCard and the recording that observed the session', () => {
  it('links to the group that recorded the session', async () => {
    api.listRecordings.mockResolvedValue(library(['g 1']));
    render(<RecordingCard session={session({ status: 'passed' })} />);
    const link = await screen.findByRole('link', { name: 'Recorded with other phones' });
    expect(link).toHaveAttribute('href', '/recordings/g%201');
    expect(api.listRecordings).toHaveBeenCalledWith({
      sessionId: '088cce7e-aaaa-bbbb-cccc-000000000001',
      limit: 1,
    });
  });

  it('shows no link when no recording observed it', async () => {
    render(<RecordingCard session={session({ status: 'passed' })} />);
    await waitFor(() => expect(api.listRecordings).toHaveBeenCalled());
    await Promise.resolve();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('No video available')).toBeInTheDocument();
  });

  it('keeps the card as it was when the request fails', async () => {
    api.listRecordings.mockRejectedValue(new Error('HTTP 500'));
    render(<RecordingCard session={session({ status: 'passed' })} />);
    await waitFor(() => expect(api.listRecordings).toHaveBeenCalled());
    await Promise.resolve();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('No video available')).toBeInTheDocument();
  });
});
