import { describe, it, expect, vi, afterEach } from 'vitest';
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

describe('FleetStatus keys', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists two phones of one udid without a key clash', () => {
    const error = vi.spyOn(console, 'error');
    const phone = (host: string, name: string) =>
      ({
        udid: 'emulator-5554',
        host,
        name,
        platform: 'android',
        offline: false,
        busy: false,
      }) as unknown as IDevice;
    render(
      <MemoryRouter>
        <FleetStatus
          devices={[
            phone('http://10.0.0.1:4723', 'Hub phone'),
            phone('http://10.0.0.2:4723', 'Node phone'),
          ]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: /Hub phone/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Node phone/ })).toBeInTheDocument();
    expect(error.mock.calls.flat().join(' ')).not.toMatch(/same key/);
  });
});
