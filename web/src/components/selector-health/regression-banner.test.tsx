import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({
  handlers: new Map<string, (data: unknown) => void>(),
}));
vi.mock('../../hooks/useSocket', () => ({
  useSocket: () => ({
    on: (event: string, fn: (data: unknown) => void) => {
      h.handlers.set(event, fn);
      return () => h.handlers.delete(event);
    },
  }),
}));

import { RegressionBanner } from './regression-banner';

describe('RegressionBanner', () => {
  it('says a fixed selector broke again, and leads to it among the selectors to fix', () => {
    const onShow = vi.fn();
    render(<RegressionBanner onShow={onShow} />);
    act(() =>
      h.handlers.get('selector_regressed')?.({
        original_strategy: 'xpath',
        original_selector: '//a',
      }),
    );
    expect(screen.getByRole('alert').textContent).toContain('A selector you fixed broke again');
    expect(screen.getByRole('alert').textContent).toContain('//a');
    fireEvent.click(screen.getByRole('button', { name: 'Show selectors to fix' }));
    expect(onShow).toHaveBeenCalledWith([{ strategy: 'xpath', selector: '//a' }]);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('counts several at once', () => {
    render(<RegressionBanner onShow={() => undefined} />);
    act(() => {
      h.handlers.get('selector_regressed')?.({
        original_strategy: 'xpath',
        original_selector: '//a',
      });
      h.handlers.get('selector_regressed')?.({
        original_strategy: 'xpath',
        original_selector: '//b',
      });
    });
    expect(screen.getByRole('alert').textContent).toContain('2 selectors you fixed broke again');
  });
});
