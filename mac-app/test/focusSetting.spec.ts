import { afterEach, describe, expect, it, vi } from 'vitest';
import { focusSetting, settingSelector } from '../src/renderer/src/focusSetting';

describe('settingSelector', () => {
  it('finds the wrapper by its setting key', () => {
    expect(settingSelector('server.port')).toBe('[data-setting-key="server.port"]');
    expect(settingSelector('hub')).toBe('[data-setting-key="hub"]');
  });

  it('cannot be broken out of by a quote or backslash in the key', () => {
    expect(settingSelector('a"]b')).toBe('[data-setting-key="a\\"]b"]');
    expect(settingSelector('a\\b')).toBe('[data-setting-key="a\\\\b"]');
  });
});

/** Just enough of an element for focusSetting: what it matches, what it holds, what was done to it. */
function fakeEl(opts: { focusable?: boolean; inner?: ReturnType<typeof fakeEl> | null } = {}) {
  const calls: string[] = [];
  return {
    calls,
    matches: (sel: string) => (opts.focusable ?? false) && sel === 'input, textarea, select, button',
    querySelector: (sel: string) => (sel === 'input, textarea, select, button' ? (opts.inner ?? null) : null),
    scrollIntoView: (o: unknown) => calls.push(`scroll ${JSON.stringify(o)}`),
    focus: () => calls.push('focus')
  };
}

describe('focusSetting', () => {
  afterEach(() => vi.unstubAllGlobals());

  function page(found: Record<string, ReturnType<typeof fakeEl>>) {
    const asked: string[] = [];
    vi.stubGlobal('document', {
      querySelector: (sel: string) => {
        asked.push(sel);
        return found[sel] ?? null;
      }
    });
    return asked;
  }

  it("scrolls the setting into view and focuses the first control inside its wrapper", () => {
    const control = fakeEl({ focusable: true });
    const wrapper = fakeEl({ inner: control });
    const asked = page({ '[data-setting-key="hub"]': wrapper });
    focusSetting('hub');
    expect(asked).toEqual(['[data-setting-key="hub"]']);
    expect(wrapper.calls).toEqual(['scroll {"block":"center"}']);
    expect(control.calls).toEqual(['focus']);
  });

  it('focuses the element itself when it is the control', () => {
    const input = fakeEl({ focusable: true });
    page({ '[data-setting-key="server.port"]': input });
    focusSetting('server.port');
    expect(input.calls).toEqual(['scroll {"block":"center"}', 'focus']);
  });

  it('does nothing, and does not throw, when the setting is not on screen', () => {
    page({});
    expect(() => focusSetting('nowhere')).not.toThrow();
  });

  // A place's panel can mount a frame after the commit that chose it, so the caller looks again until it is there.
  it('says whether the setting was on screen', () => {
    page({ '[data-setting-key="hub"]': fakeEl({ inner: fakeEl({ focusable: true }) }) });
    expect(focusSetting('hub')).toBe(true);
    page({});
    expect(focusSetting('nowhere')).toBe(false);
  });

  it('scrolls to a wrapper that holds no control, without focusing anything', () => {
    const wrapper = fakeEl({ inner: null });
    page({ '[data-setting-key="note"]': wrapper });
    focusSetting('note');
    expect(wrapper.calls).toEqual(['scroll {"block":"center"}']);
  });
});
