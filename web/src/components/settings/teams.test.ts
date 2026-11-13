import { afterEach, describe, expect, it, vi } from 'vitest';
import { teamsRequest } from './teams';

/**
 * The Teams page's requests, among them moving a phone to a team. A refusal
 * whose `error` is a code carries its sentence in `message`: a udid two
 * servers have answers `ambiguous_phone`, and the page used to show the code.
 */
describe('teamsRequest', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const answer = (status: number, body: unknown) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(body), { status })),
    );

  it("rejects with the server's message, and the status", async () => {
    const message =
      'Two servers have a phone named emulator-5554. Name the one you mean with its host.';
    answer(409, { error: 'ambiguous_phone', message, hosts: ['a', 'b'] });
    const err = await teamsRequest('/xenon/api/device/emulator-5554/team', {
      method: 'PUT',
      body: JSON.stringify({ teamId: 't1' }),
    }).catch((e) => e);
    expect(err.message).toBe(message);
    expect(err.status).toBe(409);
  });

  it('falls back to the error, then the status', async () => {
    answer(400, { error: 'name is required' });
    await expect(teamsRequest('/xenon/api/teams', { method: 'POST' })).rejects.toThrow(
      'name is required',
    );
    answer(500, {});
    await expect(teamsRequest('/xenon/api/teams')).rejects.toThrow('HTTP 500');
  });

  it('answers the body on success', async () => {
    answer(200, [{ id: 't1', name: 'Payments' }]);
    await expect(teamsRequest('/xenon/api/teams')).resolves.toEqual([
      { id: 't1', name: 'Payments' },
    ]);
  });
});
