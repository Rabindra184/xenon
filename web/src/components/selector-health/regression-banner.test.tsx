import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({
  handlers: new Map<string, (data: unknown) => void>(),
  navigate: vi.fn(),
}));
vi.mock('../../hooks/useSocket', () => ({
  useSocket: () => ({
    on: (event: string, fn: (data: unknown) => void) => {
      h.handlers.set(event, fn);
      return () => h.handlers.delete(event);
    },
  }),
}));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => h.navigate,
}));

import { RegressionBanner } from './regression-banner';

describe('RegressionBanner', () => {
  it('says a fixed selector broke again, and leads to the selectors to fix', () => {
    render(<RegressionBanner />);
    act(() =>
      h.handlers.get('selector_regressed')?.({
        original_strategy: 'xpath',
        original_selector: '//a',
      }),
    );
    expect(screen.getByRole('alert').textContent).toContain('A selector you fixed broke again');
    expect(screen.getByRole('alert').textContent).toContain('//a');
    fireEvent.click(screen.getByRole('button', { name: 'Show selectors to fix' }));
    expect(h.navigate).toHaveBeenCalledWith('/selector-health');
  });

  it('counts several at once', () => {
    render(<RegressionBanner />);
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
