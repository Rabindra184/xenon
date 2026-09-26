import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DevicePicker, type PickerDevice } from './DevicePicker';

const devices: PickerDevice[] = [
  { udid: 'I1', name: 'iPhone', platform: 'ios' },
  { udid: 'A1', name: 'star2ltexx', platform: 'android' },
];

const mount = (props: Partial<React.ComponentProps<typeof DevicePicker>> = {}) =>
  render(
    <DevicePicker devices={devices} inMosaic={new Set(['I1'])} onToggle={vi.fn()} {...props} />,
  );

describe('DevicePicker', () => {
  // The first render said "No devices online." while the list was still loading.
  it('says it is loading until the first list arrives', () => {
    mount({ devices: [], status: 'loading' });
    expect(screen.getByText('Loading devices…')).toBeInTheDocument();
    expect(screen.queryByText('No devices online.')).toBeNull();
  });

  it('says when the list could not be loaded', () => {
    mount({ devices: [], status: 'error' });
    expect(screen.getByText('Couldn’t load devices. Retrying…')).toBeInTheDocument();
  });

  it('says no devices are online once the list is loaded and empty', () => {
    mount({ devices: [], status: 'ready' });
    expect(screen.getByText('No devices online.')).toBeInTheDocument();
  });

  // Without an explicit label, the row's accessible name came from its tooltip
  // ("Click to add to mosaic…"), the same for every device.
  it('names each device and says whether it is on the grid', () => {
    mount();
    expect(screen.getByRole('button', { name: 'iPhone, iOS', pressed: true })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'star2ltexx, Android', pressed: false }),
    ).toBeInTheDocument();
  });

  it('says whether a platform group is expanded', () => {
    mount();
    const group = screen.getByRole('button', { name: /^Android/, expanded: true });
    fireEvent.click(group);
    expect(screen.getByRole('button', { name: /^Android/, expanded: false })).toBeInTheDocument();
  });

  it('does not call the grid a mosaic', () => {
    const { container } = mount();
    const titles = Array.from(container.querySelectorAll('[title]')).map((e) =>
      e.getAttribute('title'),
    );
    expect(titles.filter((t) => /mosaic/i.test(t ?? ''))).toEqual([]);
  });
});
