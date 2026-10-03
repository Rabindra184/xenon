import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { LogDetails, type LogDetailsProps } from './LogDetails';

const record = {
  seq: 1,
  ts: Date.UTC(2026, 7, 9, 16, 11, 0) + 123,
  pid: 1408,
  tid: 1409,
  level: 'E',
  tag: 'ActivityManager',
  pkg: 'com.android.systemui',
  message: 'ANR in com.android.systemui\nReason: input dispatching timed out',
};
const handlers = () => ({
  onCopyLine: vi.fn(),
  onCopyMessage: vi.fn(),
  onShowOnlyTag: vi.fn(),
  onHideTag: vi.fn(),
  onShowOnlyApp: vi.fn(),
  onClose: vi.fn(),
});
const panel = (over: Partial<LogDetailsProps> = {}) => {
  const h = handlers();
  render(<LogDetails record={record} platform="android" inBuffer {...h} {...over} />);
  return { h, section: screen.getByRole('region', { name: 'Line details' }) };
};

describe('LogDetails', () => {
  it('shows the whole line', () => {
    const { section } = panel();
    expect(within(section).getByRole('heading')).toHaveTextContent('Error · ActivityManager');
    expect(section).toHaveTextContent(/\d\d:\d\d:00\.123/);
    expect(section).toHaveTextContent('com.android.systemui');
    expect(section).toHaveTextContent('1408');
    expect(section).toHaveTextContent('1409');
    expect(section).toHaveTextContent('Reason: input dispatching timed out');
    expect(screen.queryByText('This line has left the buffer')).toBeNull();
  });

  it('runs each action', () => {
    const { h } = panel();
    const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
    click('Copy line');
    click('Copy message');
    click('Show only this tag');
    click('Hide this tag');
    click('Show only this app');
    click('Close details');
    Object.values(h).forEach((fn) => expect(fn).toHaveBeenCalledTimes(1));
  });

  it('offers Show only this app only when the line has an app', () => {
    panel({ record: { ...record, pkg: undefined } });
    expect(screen.queryByRole('button', { name: 'Show only this app' })).toBeNull();
  });

  it('says when the line has left the buffer', () => {
    panel({ inBuffer: false });
    expect(screen.getByText('This line has left the buffer')).toBeInTheDocument();
  });

  it('says Xenon added its own line, and offers Copy line only', () => {
    panel({
      record: {
        ...record,
        synthetic: true,
        level: 'W',
        tag: 'xenon',
        message: '3 lines dropped (slow client)',
      },
    });
    expect(screen.getByRole('heading')).toHaveTextContent('Added by Xenon');
    expect(
      screen.getByText('Xenon added this line. It didn’t come from the phone.'),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole('button').map((b) => b.textContent || b.getAttribute('aria-label')),
    ).toEqual(['Close details', 'Copy line']);
  });

  it('names Fault by its iOS name', () => {
    panel({ platform: 'ios', record: { ...record, level: 'F' } });
    expect(screen.getByRole('heading')).toHaveTextContent('Fault · ActivityManager');
  });
});
