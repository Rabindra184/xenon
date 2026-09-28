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
