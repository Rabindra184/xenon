import * as React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WsH264Player from './WsH264Player';

/**
 * What the H.264 player tells its page when its stream stops.
 *
 * The server closes a viewer's socket with 1012 when the capture stops under
 * it (a recording starting on the phone, a stream/stop). Nothing is left to
 * end on the server then, so the page shows MJPEG without asking for it:
 * asking (`stream/start`) would take back a hold a stop had just released.
 * Any other failure leaves an H.264 capture the page must ask to end.
 */

class FakeSocket {
  static last: FakeSocket | null = null;
  binaryType = '';
  onerror: (() => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onmessage: ((ev: { data: ArrayBuffer }) => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeSocket.last = this;
  }
  close() {
    this.closed = true;
  }
}

const win = window as unknown as { VideoDecoder?: unknown };
const socket = () => FakeSocket.last as FakeSocket;

describe('WsH264Player: why its stream stopped', () => {
  beforeEach(() => {
    FakeSocket.last = null;
    vi.stubGlobal('WebSocket', FakeSocket);
    win.VideoDecoder = class {
      state = 'unconfigured';
      configure() {}
      decode() {}
      close() {}
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete win.VideoDecoder;
  });

  it('says the stream ended when the server closes the socket with 1012', () => {
    const onFatal = vi.fn();
    render(<WsH264Player wsUrl="ws://hub/stream/h264?ticket=t" onFatal={onFatal} />);

    act(() => socket().onclose?.({ code: 1012, reason: 'stream ended' }));

    expect(onFatal).toHaveBeenCalledTimes(1);
    expect(onFatal).toHaveBeenCalledWith({ streamEnded: true });
  });

  it('says it failed for any other close', () => {
    const onFatal = vi.fn();
    render(<WsH264Player wsUrl="ws://hub/stream/h264?ticket=t" onFatal={onFatal} />);

    act(() => socket().onclose?.({ code: 1011, reason: 'stream failed' }));

    expect(onFatal).toHaveBeenCalledWith({ streamEnded: false });
  });

  it('says it failed on a socket error', () => {
    const onFatal = vi.fn();
    render(<WsH264Player wsUrl="ws://hub/stream/h264?ticket=t" onFatal={onFatal} />);

    act(() => socket().onerror?.());

    expect(onFatal).toHaveBeenCalledWith({ streamEnded: false });
  });

  it('reports nothing when its page closes it', () => {
    const onFatal = vi.fn();
    const view = render(<WsH264Player wsUrl="ws://hub/stream/h264?ticket=t" onFatal={onFatal} />);
    const ws = socket();

    view.unmount();
    act(() => ws.onclose?.({ code: 1005, reason: '' }));

    expect(ws.closed).toBe(true);
    expect(onFatal).not.toHaveBeenCalled();
  });
});
