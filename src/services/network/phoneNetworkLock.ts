import AsyncLock from 'async-lock';

const lock = new AsyncLock({ maxPending: 10_000 });

/**
 * One change at a time to a phone's network settings (Wi-Fi, mobile data, the
 * global proxy): a session's start reading and changing them, its end putting
 * them back, and a clean-up of what an earlier run left. Without it, a
 * clean-up that read a dead proxy could clear the one a new session had just
 * set, or a session could read another's half-undone state as the phone's own.
 *
 * Not reentrant: never call it from inside itself for the same phone.
 */
export function withPhoneNetworkLock<T>(udid: string, fn: () => Promise<T>): Promise<T> {
  return lock.acquire(`phone-network:${udid}`, fn);
}
