import { afterEach, describe, expect, it, vi } from 'vitest';
import XenonApiService from './index';

describe('Selector Health calls', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks for one selector by strategy and value, and keeps the answer status', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 404,
      ok: false,
      json: async () => ({ error: 'not_found', message: 'Selector not found' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const r = await XenonApiService.getSelectorPanel('xpath', "//a[@t='50% & #']", 7, 330);

    expect(r).toEqual({ status: 404, body: { error: 'not_found', message: 'Selector not found' } });
    const url = new URL(fetchMock.mock.calls[0][0] as string, 'http://x');
    expect(url.pathname).toBe('/xenon/api/healing/selectors/detail');
    expect(url.searchParams.get('strategy')).toBe('xpath');
    expect(url.searchParams.get('selector')).toBe("//a[@t='50% & #']");
    expect(url.searchParams.get('days')).toBe('7');
    expect(url.searchParams.get('tz')).toBe('330');
  });

  it('sends a mute reason with the action', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ status: 200, ok: true, json: async () => ({ state: null }) });
    vi.stubGlobal('fetch', fetchMock);

    await XenonApiService.postSelectorStateAction({
      original_strategy: 'xpath',
      original_selector: '//a',
      action: 'mute',
      reason: 'Redesign',
    });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      original_strategy: 'xpath',
      original_selector: '//a',
      action: 'mute',
      reason: 'Redesign',
    });
  });
});
