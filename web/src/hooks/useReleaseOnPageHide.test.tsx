import * as React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useReleaseOnPageHide } from './useReleaseOnPageHide';

function Probe({ release, onRestore }: { release: () => void; onRestore?: () => void }) {
  useReleaseOnPageHide(release, onRestore);
  return null;
}

const hide = () => window.dispatchEvent(new Event('pagehide'));
const show = (persisted: boolean) =>
  window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted }));

describe('useReleaseOnPageHide', () => {
  // Closing the tab, reloading or leaving the site tears the page down without
  // unmounting anything, so an effect's cleanup never runs. pagehide does.
  it('releases when the page is hidden', () => {
    const release = vi.fn();
    render(<Probe release={release} />);
    hide();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('uses the latest release it was given', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Probe release={first} />);
    rerender(<Probe release={second} />);
    hide();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('stops listening once unmounted', () => {
    const release = vi.fn();
    const { unmount } = render(<Probe release={release} />);
    unmount();
    hide();
    expect(release).not.toHaveBeenCalled();
  });

  it('asks to take back what it released when the page is restored from the cache', () => {
    const onRestore = vi.fn();
    render(<Probe release={vi.fn()} onRestore={onRestore} />);
    show(false);
    expect(onRestore).not.toHaveBeenCalled();
    show(true);
    expect(onRestore).toHaveBeenCalledTimes(1);
  });
});
