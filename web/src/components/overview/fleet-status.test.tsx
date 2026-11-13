import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { IDevice } from '../../interfaces/IDevice';
import { FleetStatus } from './fleet-status';

describe('FleetStatus filter', () => {
  it('exposes which filter is on, not just by colour', () => {
    render(
      <MemoryRouter>
        <FleetStatus devices={[]} />
      </MemoryRouter>,
    );
    const group = screen.getByRole('group', { name: 'Filter devices' });
    const all = screen.getByRole('button', { name: 'All' });
    const nonReady = screen.getByRole('button', { name: /Non-ready/ });
    expect(group).toContainElement(all);
    expect(all).toHaveAttribute('aria-pressed', 'true');
    expect(nonReady).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(nonReady);
    expect(all).toHaveAttribute('aria-pressed', 'false');
    expect(nonReady).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('FleetStatus rows', () => {
  function Where() {
    const l = useLocation();
    return <output data-testid="where">{l.pathname + l.search}</output>;
  }
  it('opens the phone of the row, by udid and host', () => {
    const phone = {
      udid: 'emulator-5554',
      host: 'http://10.0.0.2:4724',
      name: 'Pixel 8',
      platform: 'android',
      offline: false,
      busy: false,
    } as unknown as IDevice;
    render(
      <MemoryRouter initialEntries={['/overview']}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <FleetStatus devices={[phone]} />
                <Where />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Pixel 8/ }));
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/devices/emulator-5554/control/screen?host=http%3A%2F%2F10.0.0.2%3A4724',
    );
  });
});
