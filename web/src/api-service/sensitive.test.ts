import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { login, changePassword, checkResetToken, resetPassword } from './auth';
import { createUser } from './users';

// Appium logs request bodies in full unless this header is set, so every
// call whose body carries a secret must send it.
describe('requests carrying secrets are marked sensitive', () => {
  const sent: Array<{ url: string; headers: Record<string, string> }> = [];
  beforeEach(() => {
    sent.length = 0;
    vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
      sent.push({ url, headers: (init.headers ?? {}) as Record<string, string> });
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ['login (password)', () => login('a@b.co', 'pw')],
    ['changePassword (old + new)', () => changePassword('old', 'new')],
    ['checkResetToken (token)', () => checkResetToken('tok')],
    ['resetPassword (token + new password)', () => resetPassword('tok', 'newpw')],
    [
      'createUser (optional password)',
      () => createUser({ email: 'a@b.co', name: 'A', role: 'MEMBER', password: 'pw123456' }),
    ],
  ])('%s', async (_name, call) => {
    await call().catch(() => {});
    expect(sent).toHaveLength(1);
    expect(sent[0].headers['X-Appium-Is-Sensitive']).toBe('true');
  });
});
