import { Container } from 'typedi';
import { PluginContext } from '../PluginContext';
import { normalizeBasePath } from '../app/appiumBasePath';
import type { McpCaller } from './mcpCredential';
import { ApiAnswer, dispatchInProcess } from './invokeApi';

/**
 * How long a WebDriver command a tool runs may take. A find that heals
 * through the AI tiers can take two AI call limits (AI_CALL_TIMEOUT_MS each,
 * failure analysis's longer), and a driver command can be slow by itself.
 */
export const WEBDRIVER_CALL_TIMEOUT_MS = 5 * 60_000;

export interface WebDriverCall {
  method: 'POST';
  /** Under `<basePath>/session/<id>/`, such as `execute/sync`. */
  path: string;
  body: unknown;
}

/**
 * Runs one WebDriver command on a session, in process, through Appium's own
 * Express app (the one ServerManager.registerRoutes was handed, kept in
 * PluginContext) at `<basePath>/session/<id>/<path>`, as `caller`.
 *
 * The request is the session's own command, as a client's is: it goes
 * through the session gateway, where per-command auth takes the preset
 * caller (PRESET_CALLER, on the request object) as the verified caller and
 * still requires them to own the session (or be an override admin); a hub
 * forwards a node's session to its node; and the plugin's interceptor runs it
 * (autowait, healing, the command log, the idle clock). It is never a
 * `/wd-internal` call, which would skip all of that.
 *
 * Resolves with the WebDriver answer's status and body, errors included. A
 * command that hasn't answered in WEBDRIVER_CALL_TIMEOUT_MS is a ToolRefusal
 * `timeout`, and its request is ended as a client that leaves ends one.
 */
export function invokeWebDriver(
  caller: McpCaller,
  sessionId: string,
  call: WebDriverCall,
  opts: { timeoutMs?: number } = {},
): Promise<ApiAnswer> {
  const context = Container.get(PluginContext);
  const app = context.expressApp;
  if (!app) return Promise.reject(new Error("Appium's server is not set up."));
  const command = call.path.replace(/^\/+/, '');
  const url = `${normalizeBasePath(context.nodeBasePath)}/session/${encodeURIComponent(sessionId)}/${command}`;
  return dispatchInProcess(
    app,
    caller,
    { method: call.method, url, body: call.body },
    {
      timeoutMs: opts.timeoutMs ?? WEBDRIVER_CALL_TIMEOUT_MS,
      what: `The session's ${command} command`,
    },
  );
}
