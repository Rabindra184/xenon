import { AsyncLocalStorage } from 'async_hooks';
import type { IncomingHttpHeaders } from 'http';
import { isSensitiveHeaderValue } from '../dashboard/commandPrivacy';

/**
 * Whether the command being run was sent with `X-Appium-Is-Sensitive: true`
 * (commandPrivacy.ts). The session gateway sees every request under
 * `<basePath>/session/:sessionId` and runs the rest of a marked one inside
 * this context, as internalCall.ts does for Xenon's own calls: the plugin's
 * `handle`, deep inside Appium's route, is never given the request.
 *
 * Read it where a command enters the plugin (CommandInterceptor.handle) or
 * where its record is written. Like any AsyncLocalStorage it also holds in
 * what the command starts and runs later.
 */
const sensitiveCommands = new AsyncLocalStorage<true>();

export const SENSITIVE_HEADER = 'x-appium-is-sensitive';

/** Whether a request's headers mark it sensitive, as Appium reads them. */
export function hasSensitiveMark(headers: IncomingHttpHeaders | undefined): boolean {
  return isSensitiveHeaderValue(headers?.[SENSITIVE_HEADER]);
}

/** Runs `next` inside the context when the request is marked, else as it is. */
export function runMarkingSensitive(
  headers: IncomingHttpHeaders | undefined,
  next: () => void,
): void {
  if (hasSensitiveMark(headers)) sensitiveCommands.run(true, next);
  else next();
}

export function isInsideSensitiveCommand(): boolean {
  return sensitiveCommands.getStore() === true;
}
