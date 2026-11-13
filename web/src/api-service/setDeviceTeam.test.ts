import { afterEach, describe, expect, it, vi } from 'vitest';
import XenonApiService from './index';

/**
 * Moving a phone to a team. A refusal whose `error` is a code carries its
 * sentence in `message`: a udid two servers have answers `ambiguous_phone`,
 * and the picker used to show that code.
 */
describe('XenonApiService.setDeviceTeam', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const answer = (status: number, body: unknown) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(body), { status })),
    );

  it("rejects with the server's message, not its code", async () => {
    const message =
      'Two servers have a phone named emulator-5554. Name the one you mean with its host.';
    answer(409, { error: 'ambiguous_phone', message, hosts: ['a', 'b'] });
    await expect(
      XenonApiService.setDeviceTeam({ udid: 'emulator-5554', host: 'http://a:4723' }, 't1'),
    ).rejects.toThrow(message);
  });

  it('falls back to the error when there is no message', async () => {
    answer(400, { error: 'teamId must be a string or null' });
    await expect(
      XenonApiService.setDeviceTeam({ udid: 'U1', host: 'http://a:4723' }, 't1'),
    ).rejects.toThrow('teamId must be a string or null');
  });
});
