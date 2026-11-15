/**
 * Schemes the consent page never sends the browser to: they run code in the
 * page, read files or aren't an app's. The server refuses them when an agent
 * registers (clientStore.ts redirectUriProblem); this is the page's own
 * check, since the address is opened as the signed-in user.
 */
const NEVER = new Set([
  'javascript:',
  'data:',
  'vbscript:',
  'file:',
  'blob:',
  'about:',
  'filesystem:',
  'view-source:',
]);

/** Whether the consent page may send the browser to `url`. */
export function canGoBackTo(url: string): boolean {
  try {
    return !NEVER.has(new URL(url).protocol.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Leave the consent page for the agent: `url` is the `redirectTo` the
 * server's answer named, never an address taken from the page's own URL.
 * False when it isn't one the page goes to.
 */
export function backToAgent(url: string): boolean {
  if (!canGoBackTo(url)) return false;
  window.location.assign(url);
  return true;
}
