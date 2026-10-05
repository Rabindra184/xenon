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

/**
 * A Live devices tile for an iOS simulator. A simulator shows its running
 * test's picture, so with no test the server refuses the stream, and
 * /stream/status says why (`reason: simulator_needs_test`). The phone can't
 * be added to the grid while a test runs on it, so the tile is always there
 * before the test: once the test starts, it tries again by itself.
 */

const REASON = "A simulator's screen shows here only while a test runs on it.";

const REFUSED = {
  status: 'stopped',
  type: 'mjpeg',
  lastError: REASON,
  reason: 'simulator_needs_test',
};
let statusBody: Record<string, unknown> = REFUSED;

const fetchMock = vi.fn(async (input: RequestInfo) => {
  if (String(input).endsWith('/stream/status')) {
    return new Response(JSON.stringify(statusBody), { status: 200 });
  }
  return new Response('{}', { status: 200 });
});

const wait = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

function tile(testRunning: boolean) {
  return (
    <DeviceTile
      udid="SIM-1"
      name="iPhone 16 Pro"
      mjpegPort={0}
      annotateMode={false}
      shape="RECT"
      color="#ff0000"
      platform="ios"
      screenWidth={402}
      screenHeight={874}
      testRunning={testRunning}
      onAnnotation={() => undefined}
    />
  );
}

/** Each attempt's <img> fails at once, as GET /stream answers 503, until the tile gives up. */
async function untilGivenUp(view: ReturnType<typeof render>) {
  for (let i = 0; i < 6 && !view.queryByRole('alert'); i++) {
    const img = view.container.querySelector('img');
    if (img) fireEvent.error(img);
    await wait(11_000);
  }
}

describe('DeviceTile on a simulator no test runs on', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    statusBody = REFUSED;
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('says at once there is no live preview, and why, with no stream left open', async () => {
    const view = render(tile(false));
    await wait(0);

    expect(view.getByText('No live preview')).toBeInTheDocument();
    expect(view.getByText(REASON)).toBeInTheDocument();
    expect(view.queryByText('Connection failed')).toBeNull();
    expect(view.container.querySelector('img'), 'stream left open').toBeNull();
  });

  it('says why as soon as the test ends, without retrying first', async () => {
    statusBody = { status: 'running', type: 'mjpeg', startedAt: 'A' };
    const view = render(tile(true));
    await wait(0);
    fireEvent.load(view.container.querySelector('img') as HTMLImageElement);

    statusBody = REFUSED;
    await wait(5_000);

    expect(view.getByText('No live preview')).toBeInTheDocument();
    expect(view.container.querySelector('img'), 'stream left open').toBeNull();
  });

  it('tries again by itself once a test starts on the simulator', async () => {
    const view = render(tile(false));
    await untilGivenUp(view);
    expect(view.getByRole('alert')).toBeInTheDocument();

    view.rerender(tile(true));
    await wait(0);

    expect(view.queryByRole('alert')).toBeNull();
    expect(view.getByText('Starting stream…')).toBeInTheDocument();
  });
});
