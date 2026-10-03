import * as React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { LogRow, type LogRowProps } from './LogRow';
import { tagColor } from './tagColor';

/** jsdom reports style.color as rgb(); the palette is hex. */
const toRgb = (hex: string) => {
  const m = /^#(..)(..)(..)$/.exec(hex);
  return m ? `rgb(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)})` : hex;
};

const record = {
  seq: 5,
  ts: Date.UTC(2026, 7, 9, 16, 11, 0),
  pid: 1408,
  tid: 1409,
  level: 'E',
  tag: 'ActivityManager',
  pkg: 'com.android.systemui',
  message: 'ANR in com.android.systemui',
};

const row = (over: Partial<LogRowProps> = {}) => {
  const props: LogRowProps = {
    record,
    index: 4,
    setSize: 10,
    start: 80,
    id: 'log-opt-5',
    selected: false,
    active: false,
    hit: false,
    activeHit: false,
    find: '',
    caseSensitive: false,
    measureRef: () => {},
    ...over,
  };
  const { container } = render(<LogRow {...props} />);
  return container.querySelector('[role="option"]') as HTMLElement;
};

describe('LogRow', () => {
  it('shows the time, the level, the tag, the package and the message, not the PID and TID', () => {
    const el = row();
    expect(el.querySelector('.log-time')?.textContent).toMatch(/^\d\d:\d\d:00$/);
    expect(el.querySelector('.log-badge')?.textContent).toBe('E');
    expect(el.querySelector('.log-tag')?.textContent).toBe('ActivityManager');
    expect(el.querySelector('.log-pkg')?.textContent).toBe('com.android.systemui');
    expect(el.querySelector('.log-msg')?.textContent).toBe('ANR in com.android.systemui');
    expect(el.textContent).not.toContain('1408');
  });

  it('puts the full tag and package in their titles, and colours the tag from the tag', () => {
    const el = row();
    const tag = el.querySelector('.log-tag') as HTMLElement;
    expect(tag.title).toBe('ActivityManager');
    expect(el.querySelector('.log-pkg')?.getAttribute('title')).toBe('com.android.systemui');
    expect(tag.style.color).toBe(toRgb(tagColor('ActivityManager')));
  });

  it('marks its level, and says where it is among the shown lines', () => {
    const el = row();
    expect(el).toHaveClass('log-row', 'lvl-E');
    expect(el).toHaveAttribute('aria-posinset', '5');
    expect(el).toHaveAttribute('aria-setsize', '10');
    expect(el).toHaveAttribute('data-index', '4');
    expect(el).toHaveAttribute('aria-selected', 'false');
    expect(el.style.transform).toBe('translateY(80px)');
  });

  it('highlights each Find match in the tag and the message, and marks the hit', () => {
    const el = row({ find: 'activity', hit: true, activeHit: true });
    expect(Array.from(el.querySelectorAll('mark.log-mark')).map((m) => m.textContent)).toEqual([
      'Activity',
    ]);
    expect(el).toHaveClass('is-hit', 'is-active-hit');
  });

  it("shows Xenon's own record without tag and package", () => {
    const el = row({
      record: {
        ...record,
        synthetic: true,
        level: 'W',
        tag: 'xenon',
        message: '3 lines dropped (slow client)',
      },
    });
    expect(el).toHaveClass('is-synthetic');
    expect(el.querySelector('.log-tag')).toBeNull();
    expect(el.querySelector('.log-msg')?.textContent).toBe('3 lines dropped (slow client)');
  });

  it('is selected through aria-selected, and active through a class', () => {
    expect(row({ selected: true, active: true })).toHaveAttribute('aria-selected', 'true');
    expect(row({ active: true })).toHaveClass('is-active');
  });
});
