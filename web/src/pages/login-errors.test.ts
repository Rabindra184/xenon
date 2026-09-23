import { describe, it, expect } from 'vitest';
import { LoginError } from '../api-service/auth';
import { describeLoginError, formatWait } from './login-errors';

describe('describeLoginError', () => {
  it('replaces the raw server string for a wrong password', () => {
    expect(describeLoginError(new LoginError('invalid credentials', 401))).toEqual({
      message: 'Incorrect email or password.',
    });
  });

  it("keeps the server's Retry-After for a rate-limited attempt", () => {
    expect(describeLoginError(new LoginError('too many login attempts', 429, 42))).toEqual({
      message: 'Too many sign-in attempts.',
      retryAfterSec: 42,
    });
  });

  it("falls back to the limiter's 5-minute window without Retry-After", () => {
    expect(describeLoginError(new LoginError('x', 429)).retryAfterSec).toBe(300);
  });

  it('tells an unreachable server apart from a rejected sign-in', () => {
    expect(describeLoginError(new LoginError('Failed to fetch', 0)).message).toMatch(
      /Can't reach the Xenon server/,
    );
    expect(describeLoginError(new LoginError('boom', 503)).message).toMatch(/unavailable/);
  });

  it('never surfaces an unknown error verbatim', () => {
    expect(describeLoginError(new Error('TypeError: x is undefined')).message).toBe(
      'Sign-in failed. Try again.',
    );
  });
});

describe('formatWait', () => {
  it.each([
    [0.2, '1s'],
    [42, '42s'],
    [59.4, '1:00'],
    [60, '1:00'],
    [245, '4:05'],
    [-3, '0s'],
  ])('%s → %s', (sec, out) => expect(formatWait(sec)).toBe(out));
});
