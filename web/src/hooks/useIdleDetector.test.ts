import * as React from 'react';
import { render, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useIdleDetector } from './useIdleDetector';

interface ProbeProps {
  idleAfterMs: number;
  warningSec: number;
  enabled: boolean;
  onWarning: (n: number) => void;
  onTimeout: () => void;
  // Captures the hook's reset() so tests can call it.
  exposeReset: (reset: () => void) => void;
}

function Probe(props: ProbeProps) {
  const { reset } = useIdleDetector({
    idleAfterMs: props.idleAfterMs,
    warningSec: props.warningSec,
    enabled: props.enabled,
    onWarning: props.onWarning,
    onTimeout: props.onTimeout,
  });
  React.useEffect(() => {
    props.exposeReset(reset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reset]);
  return null;
}

describe('useIdleDetector', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does nothing when disabled', () => {
    const onWarning = vi.fn();
    const onTimeout = vi.fn();
    render(
      React.createElement(Probe, {
        idleAfterMs: 5000,
        warningSec: 1,
        enabled: false,
        onWarning,
        onTimeout,
        exposeReset: () => {},
      }),
    );
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(onWarning).not.toHaveBeenCalled();
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('fires onWarning at idleAfterMs - warningSec*1000 and onTimeout at idleAfterMs', () => {
    const onWarning = vi.fn();
    const onTimeout = vi.fn();
    render(
      React.createElement(Probe, {
        idleAfterMs: 5000,
        warningSec: 2,
        enabled: true,
        onWarning,
        onTimeout,
        exposeReset: () => {},
      }),
    );
    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(onWarning).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onWarning).toHaveBeenCalledTimes(1);
    expect(onWarning).toHaveBeenCalledWith(2);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('reset() during the warning window cancels the pending timeout', () => {
    const onWarning = vi.fn();
    const onTimeout = vi.fn();
    let resetFn: () => void = () => {};
    render(
      React.createElement(Probe, {
        idleAfterMs: 5000,
        warningSec: 2,
        enabled: true,
        onWarning,
        onTimeout,
        exposeReset: (r) => {
          resetFn = r;
        },
      }),
    );
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(onWarning).toHaveBeenCalledTimes(1);
    act(() => {
      resetFn();
    });
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(onTimeout).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('user activity before the warning window resets the idle clock', () => {
    const onWarning = vi.fn();
    const onTimeout = vi.fn();
    render(
      React.createElement(Probe, {
        idleAfterMs: 5000,
        warningSec: 1,
        enabled: true,
        onWarning,
        onTimeout,
        exposeReset: () => {},
      }),
    );
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(onWarning).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(onWarning).toHaveBeenCalledTimes(1);
  });

  it('activity DURING the warning window does not silently dismiss it', () => {
    const onWarning = vi.fn();
    const onTimeout = vi.fn();
    render(
      React.createElement(Probe, {
        idleAfterMs: 5000,
        warningSec: 2,
        enabled: true,
        onWarning,
        onTimeout,
        exposeReset: () => {},
      }),
    );
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(onWarning).toHaveBeenCalledTimes(1);
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove'));
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });
});
