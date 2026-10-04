/**
 * Xenon's execute scripts: `driver.execute('xenon: <name>', ...)`, or `xe:`.
 *
 * Who answers them:
 * - The five session-details commands (SESSION_DETAILS_COMMANDS in
 *   dashboard/commands.ts) are answered by the server that keeps the
 *   session's record: a hub, for a session on a node's phone, when its
 *   dashboard is on (its gateway's before-hook), otherwise the server that
 *   drives the phone.
 * - Every other one is answered by the server that drives the phone
 *   (CommandInterceptor), because that is where the session's autowait
 *   settings, Omni-Vision and network capture live. A hub forwards them.
 * - A name Xenon doesn't have fails with `unknown command`.
 */

/** The names CommandInterceptor and the session-details commands answer. Keep in step with both. */
export const XENON_SCRIPT_NAMES = [
  'setAutowaitProperties',
  'getAutowaitProperties',
  'smartTap',
  'omniClick',
  'visualTap',
  'uiInventory',
  'uiScanExport',
  'analyzeScreen',
  'omniScan',
  'assertVisualState',
  'addMock',
  'removeMock',
  'clearMocks',
  'getMocks',
  'getRequests',
  'exportHar',
  'setSessionName',
  'setSessionStatus',
  'debug',
  'addTag',
  'captureEvidence',
] as const;

/** The name in a `xenon: <name>` or `xe: <name>` script, or null for any other script. */
export function xenonScriptName(script: unknown): string | null {
  if (typeof script !== 'string') return null;
  const match = /^\s*(?:xenon|xe)\s*:\s*(\S+)\s*$/.exec(script);
  return match ? match[1] : null;
}

/** The message for a `xenon:` / `xe:` script Xenon doesn't have. */
export function unknownXenonScriptMessage(script: string): string {
  return (
    `Unknown Xenon command "${script.trim()}". ` +
    `Xenon's execute commands are: ${XENON_SCRIPT_NAMES.join(', ')}.`
  );
}
