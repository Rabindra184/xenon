import * as React from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { IDevice } from '../../interfaces/IDevice';
import { PhoneChooser } from './PhoneChooser';

const H1 = 'http://10.0.0.1:4723';
const H2 = 'http://10.0.0.2:4724';
const base = {
  sdk: '14',
  offline: false,
  userBlocked: false,
  session_id: null,
  platform: 'android',
};
const DEVICES = [
  { ...base, udid: 'emulator-5554', host: H1, name: 'Pixel 7 API 34', busy: false },
  { ...base, udid: 'emulator-5554', host: H2, name: 'Pixel 8 API 35', busy: true },
] as unknown as IDevice[];

describe('PhoneChooser', () => {
  it('says why it asks, and links to each phone by its server', () => {
    render(
      <MemoryRouter>
        <PhoneChooser devices={DEVICES} tab="logs" />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole('heading', {
        name: 'Two servers have a phone named emulator-5554. Choose one.',
      }),
    ).toBeInTheDocument();
    const links = screen.getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      `/devices/emulator-5554/control/logs?host=${encodeURIComponent(H1)}`,
      `/devices/emulator-5554/control/logs?host=${encodeURIComponent(H2)}`,
    ]);
    expect(within(links[0]).getByText('Pixel 7 API 34')).toBeInTheDocument();
    expect(within(links[0]).getByText(H1)).toBeInTheDocument();
    expect(within(links[0]).getByText('Ready')).toBeInTheDocument();
    expect(within(links[1]).getByText(H2)).toBeInTheDocument();
    expect(within(links[1]).getByText('Busy')).toBeInTheDocument();
  });
});
