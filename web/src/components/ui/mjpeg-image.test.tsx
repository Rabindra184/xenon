import * as React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MjpegImage } from './mjpeg-image';

// A browser keeps loading a multipart MJPEG <img> after the element leaves
// the page, until it is garbage collected, and the server counts every open
// connection as a viewer. Measured on the lab (2026-10-02): an <img> removed
// from the page kept its stream open; removing its src attribute first closed
// the stream at once, with no error event (setting src to '' fires one).

describe('MjpegImage', () => {
  afterEach(cleanup);

  it('drops its src when it leaves the page, so the browser closes the stream', () => {
    const view = render(<MjpegImage src="/xenon/api/control/U1/stream?t=0" alt="U1" />);
    const img = view.container.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/xenon/api/control/U1/stream?t=0');

    view.unmount();

    expect(img.hasAttribute('src')).toBe(false);
  });

  it('drops the old src when a new key replaces the element (a reconnect)', () => {
    const view = render(<MjpegImage key={0} src="/stream?t=0" alt="" />);
    const first = view.container.querySelector('img') as HTMLImageElement;

    view.rerender(<MjpegImage key={1} src="/stream?t=1" alt="" />);

    const second = view.container.querySelector('img') as HTMLImageElement;
    expect(second).not.toBe(first);
    expect(first.hasAttribute('src')).toBe(false);
    expect(second.getAttribute('src')).toBe('/stream?t=1');
  });

  it('keeps its src while it stays on the page', () => {
    const view = render(<MjpegImage src="/stream?t=0" alt="" />);
    const img = view.container.querySelector('img') as HTMLImageElement;

    view.rerender(<MjpegImage src="/stream?t=0" alt="" className="live" />);

    expect(view.container.querySelector('img')).toBe(img);
    expect(img.getAttribute('src')).toBe('/stream?t=0');
  });

  it('passes its ref and props to the <img>', () => {
    const ref = React.createRef<HTMLImageElement>();
    const onLoad = vi.fn();
    const view = render(
      <MjpegImage ref={ref} src="/stream" alt="live" className="x" onLoad={onLoad} />,
    );
    const img = view.container.querySelector('img') as HTMLImageElement;

    fireEvent.load(img);

    expect(ref.current).toBe(img);
    expect(img.className).toBe('x');
    expect(img.alt).toBe('live');
    expect(onLoad).toHaveBeenCalledTimes(1);
  });
});
