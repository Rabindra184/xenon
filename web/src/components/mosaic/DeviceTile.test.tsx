import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

const tile = (props: Partial<React.ComponentProps<typeof DeviceTile>> = {}) =>
  render(
    <DeviceTile
      udid="00008150-000E78612168C01C"
      name="iPhone"
      mjpegPort={0}
      annotateMode={false}
      shape="RECT"
      color="#ff0000"
      platform="ios"
      screenWidth={440}
      screenHeight={956}
      onAnnotation={() => undefined}
      onRemove={() => undefined}
      {...props}
    />,
  );

const goLive = (container: HTMLElement) =>
  fireEvent.load(container.querySelector('img') as HTMLImageElement);

describe('DeviceTile', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ status: 'running', type: 'mjpeg' }))),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  // The side buttons used text symbols (⌂ ‹ ▢ ⎙), and a button's text is its
  // name, so a screen reader read out the symbol instead of the tooltip.
  it('names its side buttons for screen readers', () => {
    const { container } = tile({ udid: 'A1', name: 'star2ltexx', platform: 'android' });
    goLive(container);
    for (const name of ['Remove star2ltexx', 'Home', 'Back', 'Recent apps', 'Screenshot']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('shows the device name, not its ID, while the stream starts', () => {
    tile();
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('iPhone');
    expect(status).not.toHaveTextContent('00008150-000E78612168C01C');
  });

  // An iPhone takes 10-20 s to start (tunnel, then WebDriverAgent); without a
  // word about it the spinner looked stuck.
  it('tells the user an iPhone stream takes a while to start', () => {
    tile();
    expect(screen.getByRole('status')).toHaveTextContent(/up to 20 seconds/);
  });
});
