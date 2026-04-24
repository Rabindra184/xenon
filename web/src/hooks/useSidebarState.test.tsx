import * as React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useSidebarState } from './useSidebarState';

// RTL v11 has no renderHook — wrap in a probe component that exposes the
// hook's return value via a ref.
interface Probe {
  current: ReturnType<typeof useSidebarState> | null;
}

function HookProbe({ probe }: { probe: Probe }) {
  probe.current = useSidebarState();
  return null;
}

function mount() {
  const probe: Probe = { current: null };
  const utils = render(<HookProbe probe={probe} />);
  return { probe, ...utils };
}

describe('useSidebarState', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('defaults to collapsed', () => {
    const { probe } = mount();
    expect(probe.current?.state).toBe('collapsed');
    expect(probe.current?.isPinned).toBe(false);
  });

  it('togglePin makes state pinned-open and persists', () => {
    const { probe, rerender } = mount();
    act(() => probe.current?.togglePin());
    rerender(<HookProbe probe={probe} />);
    expect(probe.current?.state).toBe('pinned-open');
    expect(probe.current?.isPinned).toBe(true);
    expect(window.localStorage.getItem('xenon.sidebar')).toBe('pinned-open');
  });

  it('hover sets expanded when not pinned', () => {
    const { probe, rerender } = mount();
    act(() => probe.current?.setHover(true));
    rerender(<HookProbe probe={probe} />);
    expect(probe.current?.state).toBe('expanded');
  });

  it('hover does not override pinned-open', () => {
    const { probe, rerender } = mount();
    act(() => probe.current?.togglePin());
    rerender(<HookProbe probe={probe} />);
    act(() => probe.current?.setHover(true));
    rerender(<HookProbe probe={probe} />);
    expect(probe.current?.state).toBe('pinned-open');
  });

  it('hydrates from pre-existing localStorage pinned-open', () => {
    window.localStorage.setItem('xenon.sidebar', 'pinned-open');
    const { probe } = mount();
    expect(probe.current?.state).toBe('pinned-open');
    expect(probe.current?.isPinned).toBe(true);
  });

  it('second togglePin unpins back to collapsed', () => {
    const { probe, rerender } = mount();
    act(() => probe.current?.togglePin());
    rerender(<HookProbe probe={probe} />);
    act(() => probe.current?.togglePin());
    rerender(<HookProbe probe={probe} />);
    expect(probe.current?.state).toBe('collapsed');
    expect(probe.current?.isPinned).toBe(false);
  });
});
