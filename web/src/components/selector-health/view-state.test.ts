import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VIEW,
  SelectorHealthView,
  legacyDetailTarget,
  readView,
  writeView,
} from './view-state';

const read = (qs: string) => readView(new URLSearchParams(qs));

describe('the address holds the view', () => {
  it('reads defaults from an empty address, and writes nothing for them', () => {
    expect(read('')).toEqual(DEFAULT_VIEW);
    expect(writeView(DEFAULT_VIEW).toString()).toBe('');
  });

  it('round-trips every field, a selector full of punctuation included', () => {
    const view: SelectorHealthView = {
      tab: 'muted',
      days: 7,
      q: 'a b&c',
      platform: 'ios',
      method: 'Visual AI',
      sort: 'time',
      page: 3,
      open: { strategy: 'xpath', selector: '//*[@text=\'50% off & "free" #1? [x]\'] / a+b' },
    };
    expect(read(writeView(view).toString())).toEqual(view);
  });

  it('keeps a selector recorded with no strategy open', () => {
    const view: SelectorHealthView = {
      ...DEFAULT_VIEW,
      open: { strategy: '', selector: '//legacy' },
    };
    expect(read(writeView(view).toString()).open).toEqual({ strategy: '', selector: '//legacy' });
  });

  it('reads the old tab names, and ignores values it does not know', () => {
    expect(read('tab=active').tab).toBe('fix');
    expect(read('tab=pending').tab).toBe('verifying');
    expect(read('tab=resolved').tab).toBe('fixed');
    expect(read('tab=bogus&days=12&sort=x&page=0')).toEqual(DEFAULT_VIEW);
  });

  it('sends an old detail link to the panel, or to a search when it named no strategy', () => {
    expect(
      legacyDetailTarget(new URLSearchParams('value=%2F%2Fa&strategy=xpath&windowDays=7')),
    ).toBe('/selector-health?days=7&strategy=xpath&selector=%2F%2Fa');
    expect(legacyDetailTarget(new URLSearchParams('value=%2F%2Fa'))).toBe(
      '/selector-health?q=%2F%2Fa',
    );
    expect(legacyDetailTarget(new URLSearchParams(''))).toBe('/selector-health');
  });
});
