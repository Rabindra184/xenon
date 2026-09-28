/**
 * Appium's base-path rule (base-driver `normalizeBasePath`): drop one trailing
 * '/', and add a leading '/' unless the path is empty. `cliArgs.basePath`
 * reaches a plugin as the operator wrote it, while Appium normalises its own
 * copy before building routes and WebSocket paths, so anything placed in front
 * of those must normalise the same way or it would miss what it guards.
 */
export function normalizeBasePath(basePath: unknown): string {
  let normalized = typeof basePath === 'string' ? basePath : '';
  normalized = normalized.replace(/\/$/, '');
  if (normalized !== '' && !normalized.startsWith('/')) normalized = `/${normalized}`;
  return normalized;
}

/**
 * The pathname Appium matches an upgrade against, computed as
 * base-driver's tryHandleWebSocketUpgrade does: WHATWG URL parsing, which
 * resolves dot segments (also `%2e%2e`) and drops the query and an absolute
 * form's host.
 */
export function appiumPathname(url: string): string {
  try {
    return new URL(url, 'http://localhost').pathname;
  } catch {
    return url;
  }
}
