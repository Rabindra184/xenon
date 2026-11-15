import { z } from 'zod';
import { Container } from 'typedi';
import { defineTool } from '../tool';
import { ToolRefusal } from '../toolCall';
import { invokeWebDriver } from '../invokeWebDriver';
import type { McpCaller } from '../mcpCredential';
import { config } from '../../config';
import { decideCallerAccess } from '../../middleware/commandAuth';
import { commandCallerOf } from '../../middleware/commandCaller';
import { SessionOwnerResolver } from '../../services/device-access/SessionOwnerResolver';

/**
 * `xenon_execute_script`, ported from Xenon Studio's `appium-mcp-plugin`
 * (`src/tools/execute.ts`) with its name, arguments and answer. Studio ran
 * the script on appium-mcp's current session; the hub has no current
 * session, so `sessionId` is required.
 *
 * The script runs as the session's own `executeScript` command, in process
 * (invokeWebDriver), on a session the caller owns: through the session
 * gateway (a node's session is forwarded to its node) and the plugin's
 * interceptor, which answers Xenon's scripts.
 */

/** Only xe:/xenon:-prefixed scripts are run (Studio's rule). */
const XE_PREFIX = /^(xe|xenon)\s*:/;

const executeScriptParams = z.object({
  authToken: z.string().optional(),
  script: z.string(),
  args: z.unknown().optional(),
  sessionId: z.string().min(1),
});

const DESCRIPTION =
  'Run a Xenon hub command (xe:/xenon: prefix) as executeScript on an Appium session you own. ' +
  'sessionId is required: the id of a session running on this Xenon server (for example the ' +
  "one appium-mcp created with xenon_session_capabilities' URL and capabilities). " +
  "Returns {script, value} where value is the command's result. Available commands " +
  '(xe: and xenon: are interchangeable):\n' +
  '  Vision/interaction: xe:smartTap {text?,icon?,description?,index?,takeANewScreenShot?}; ' +
  'xe:omniClick {text,index?,takeANewScreenShot?}; xe:visualTap {icon?,description?,takeANewScreenShot?}; ' +
  'xe:uiInventory {takeANewScreenShot?,maxItems?}; xe:analyzeScreen (no args); ' +
  'xe:assertVisualState "<instruction>" | {instruction}.\n' +
  '  Autowait: xe:setAutowaitProperties {enabled?,timeoutMs?,intervalBetweenAttemptsMs?,excludeEnabledCheck?}; ' +
  'xe:getAutowaitProperties (no args).\n' +
  '  Network (session must opt into interceptor capability): xe:addMock {match:{url,method?},respondWith?...}; ' +
  'xe:removeMock {id}; xe:clearMocks; xe:getMocks; xe:getRequests; xe:exportHar.\n' +
  '  Session metadata: xe:setSessionName "<name>"|{name}; xe:setSessionStatus {status:"success"|"failed",reason?}; ' +
  'xe:debug "<msg>"|{message}; xe:captureEvidence "<reason>"|{reason?,label?}; xe:addTag "<tag>"|{tag}.';

/** What REST answers for a session the caller may not see, or that doesn't exist. */
function unknownSession(sessionId: string): ToolRefusal {
  return new ToolRefusal('not_found', `Session with id ${sessionId} not found`, 404);
}

/**
 * Whether the caller may run commands on the session: per-command auth's
 * own decision (decideCallerAccess), applied whatever its setting, so a
 * session the caller doesn't own reads as one that doesn't exist.
 */
async function assertMayDrive(caller: McpCaller, sessionId: string): Promise<void> {
  if (config.authDisabled === true) return;
  const decision = await decideCallerAccess(commandCallerOf(caller), [sessionId], {
    ownerOf: (id) => Container.get(SessionOwnerResolver).ownerOf(id),
  });
  if ('unavailable' in decision) {
    throw new ToolRefusal(
      'unavailable',
      'Xenon could not verify access to this session. Try again.',
      503,
    );
  }
  if (!decision.allow) throw unknownSession(sessionId);
}

export const executeScriptTool = defineTool({
  name: 'xenon_execute_script',
  scope: 'xenon:execute',
  description: DESCRIPTION,
  params: executeScriptParams,
  annotations: { readOnlyHint: false, destructiveHint: false },
  async run(args, caller) {
    if (!XE_PREFIX.test(args.script)) {
      throw new ToolRefusal(
        'bad_request',
        `script must start with "xe:" or "xenon:" (got: ${JSON.stringify(args.script).slice(0, 200)})`,
        400,
      );
    }
    await assertMayDrive(caller, args.sessionId);

    const answer = await invokeWebDriver(caller, args.sessionId, {
      method: 'POST',
      path: 'execute/sync',
      body: { script: args.script, args: args.args === undefined ? [] : [args.args] },
    });
    const value = answer.body && typeof answer.body === 'object' ? answer.body.value : undefined;
    if (answer.status < 400) return { script: args.script, value: value ?? null };

    // A WebDriver error: `{ value: { error, message } }`.
    const error = value && typeof value === 'object' ? value.error : undefined;
    if (error === 'invalid session id') throw unknownSession(args.sessionId);
    const message =
      value && typeof value === 'object' && typeof value.message === 'string'
        ? value.message
        : `The command failed with status ${answer.status}.`;
    throw new ToolRefusal(error ?? `http_${answer.status}`, message, answer.status);
  },
});
