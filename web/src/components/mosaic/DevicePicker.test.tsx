import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DevicePicker, type PickerDevice } from './DevicePicker';

const devices: PickerDevice[] = [
  { udid: 'I1', host: 'http://127.0.0.1:4723', name: 'iPhone', platform: 'ios' },
  { udid: 'A1', host: 'http://127.0.0.1:4723', name: 'star2ltexx', platform: 'android' },
];

const mount = (props: Partial<React.ComponentProps<typeof DevicePicker>> = {}) =>
  render(
    <DevicePicker
      devices={devices}
      inMosaic={new Set(['I1@http://127.0.0.1:4723'])}
      onToggle={vi.fn()}
      {...props}
    />,
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

  // Rows now show the friendly name; the codename people may still type has
  // to keep finding the device.
  it('finds a device by its codename as well as its name', () => {
    mount({
      devices: [
        {
          udid: 'A1',
          host: 'http://127.0.0.1:4723',
          name: 'Galaxy S9+',
          altName: 'star2ltexx',
          platform: 'android',
        },
        { udid: 'I1', host: 'http://127.0.0.1:4723', name: 'iPhone', platform: 'ios' },
      ],
    });
    fireEvent.change(screen.getByPlaceholderText('Filter devices...'), {
      target: { value: 'star2' },
    });
    expect(screen.getByRole('button', { name: 'Galaxy S9+, Android' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /iPhone/ })).toBeNull();
  });

  // A hub's emulator-5554 and a node's are two rows, each its own phone.
  describe('two phones of one udid', () => {
    const H1 = 'http://10.0.0.1:4723';
    const H2 = 'http://10.0.0.2:4723';
    const twins: PickerDevice[] = [
      { udid: 'emulator-5554', host: H1, name: 'Pixel 8 (hub)', platform: 'android' },
      { udid: 'emulator-5554', host: H2, name: 'Pixel 8 (node)', platform: 'android' },
    ];

    it('says which of them is on the grid, and toggles the one clicked', () => {
      const onToggle = vi.fn();
      mount({ devices: twins, inMosaic: new Set([`emulator-5554@${H2}`]), onToggle });
      expect(screen.getByRole('button', { name: /hub/, pressed: false })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /node/, pressed: true }));
      expect(onToggle).toHaveBeenCalledWith(`emulator-5554@${H2}`);
    });

    it('drags the phone’s key', () => {
      mount({ devices: twins, inMosaic: new Set() });
      const data: Record<string, string> = {};
      fireEvent.dragStart(screen.getByRole('button', { name: /node/ }), {
        dataTransfer: { setData: (k: string, v: string) => (data[k] = v), effectAllowed: '' },
      });
      expect(data['application/x-xenon-phone']).toBe(`emulator-5554@${H2}`);
    });
  });
});
