import * as React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api-service', () => ({
  default: {
    startStream: vi.fn().mockResolvedValue({}),
    tap: vi.fn().mockResolvedValue({}),
    swipe: vi.fn().mockResolvedValue({}),
    typeText: vi.fn().mockResolvedValue({}),
  },
}));

import { DeviceTile } from './DeviceTile';

// Measured live on 2026-09-26: when the server restarted, or stopped the
// stream, the tile's MJPEG <img> fired neither `load` nor `error`. It went
// blank (restart) or froze on the last frame (stop), and the tile stayed
// "live" with no retry. Only the server can say that the stream has ended.

type StatusAnswer = { httpStatus: number; body?: unknown } | 'unreachable';

let statusAnswer: StatusAnswer;
let statusCalls = 0;

const fetchMock = vi.fn(async (input: RequestInfo) => {
  const url = String(input);
  if (url.endsWith('/stream/status')) {
    statusCalls += 1;
    if (statusAnswer === 'unreachable') throw new TypeError('Failed to fetch');
    const { httpStatus, body } = statusAnswer;
    return new Response(JSON.stringify(body ?? {}), { status: httpStatus });
  }
  return new Response('{}', { status: 200 });
});

const mjpeg = (body: Record<string, unknown>) => ({
  httpStatus: 200,
  body: { type: 'mjpeg', ...body },
});

function renderLiveTile() {
  const view = render(
    <DeviceTile
      udid="U1"
      name="iPhone"
      mjpegPort={0}
      annotateMode={false}
      shape="RECT"
      color="#ff0000"
      platform="ios"
      screenWidth={440}
      screenHeight={956}
      onAnnotation={() => undefined}
    />,
  );
  const img = view.container.querySelector('img') as HTMLImageElement;
  // The first frame arrived: the tile is live.
  fireEvent.load(img);
  return view;
}

const streamSrc = (view: ReturnType<typeof render>) =>
  (view.container.querySelector('img') as HTMLImageElement).getAttribute('src');

const wait = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

describe('DeviceTile reconnects an MJPEG stream that ended', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    statusCalls = 0;
    statusAnswer = mjpeg({ status: 'running', startedAt: 'A' });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('reconnects when the server says the stream stopped', async () => {
    const view = renderLiveTile();
    await wait(5000);
    const before = streamSrc(view);

    statusAnswer = mjpeg({ status: 'stopped' });
    await wait(5000);

    expect(streamSrc(view)).not.toBe(before);
    expect(view.getByText('Starting stream…')).toBeInTheDocument();
  });

  it('reconnects when the stream was restarted underneath it', async () => {
    const view = renderLiveTile();
    await wait(5000);
    const before = streamSrc(view);

    statusAnswer = mjpeg({ status: 'running', startedAt: 'B' });
    await wait(5000);

    expect(streamSrc(view)).not.toBe(before);
  });

  it('waits out a server that is down, then reconnects once it answers', async () => {
    const view = renderLiveTile();
    await wait(5000);
    const before = streamSrc(view);

    statusAnswer = 'unreachable';
    await wait(30000);
    expect(streamSrc(view)).toBe(before);
    expect(view.queryByText('Connection failed')).toBeNull();

    // Back after a restart: the stream is gone.
    statusAnswer = mjpeg({ status: 'stopped' });
    await wait(5000);
    expect(streamSrc(view)).not.toBe(before);
  });

  it('leaves a healthy stream alone', async () => {
    const view = renderLiveTile();
    const before = streamSrc(view);

    await wait(60000);

    expect(statusCalls).toBeGreaterThan(5);
    expect(streamSrc(view)).toBe(before);
    expect(view.queryByText('Starting stream…')).toBeNull();
  });
});
