import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from './copyText';

const setClipboard = (value: unknown) =>
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });

describe('copyText', () => {
  afterEach(() => {
    setClipboard(undefined);
  });

  it('is true when the browser wrote it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    expect(await copyText('com.foo')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('com.foo');
  });

  // Plain http on a LAN address has no clipboard API.
  it('is false when copying is blocked or unavailable', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('NotAllowedError')) });
    expect(await copyText('x')).toBe(false);
    setClipboard(undefined);
    expect(await copyText('x')).toBe(false);
  });
});
