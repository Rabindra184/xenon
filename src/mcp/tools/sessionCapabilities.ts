import { z } from 'zod';
import { Container } from 'typedi';
import { defineTool } from '../tool';
import { invokeApi } from '../invokeApi';
import { answerOf, ToolRefusal } from '../toolCall';
import { callerOrigin } from '../publicOrigin';
import type { McpCaller } from '../mcpCredential';
import { config } from '../../config';
import { mintSessionToken } from '../../app/routers/auth';
import { normalizeBasePath } from '../../app/appiumBasePath';
import { commandAuthEnabled } from '../../middleware/commandAuth';
import { SESSION_TOKEN_BASIC_USER } from '../../middleware/basicCredential';
import { XE_OPTIONS } from '../../services/session/xenonOptions';
import { PluginContext } from '../../PluginContext';

/**
 * `xenon_session_capabilities`: what appium-mcp's create-session call needs
 * to run on this lab as the signed-in user. appium-mcp drives; Xenon gives
 * the lab: the agent passes `remoteServerUrl` and `capabilities` through.
 *
 * - `remoteServerUrl` is this server's WebDriver URL: the origin the agent
 *   reached `/xenon/mcp` at, plus Appium's base path.
 * - `capabilities` carry a fresh `xe:options.sessionToken` (audience
 *   `xenon-session`), so the session is the caller's; with a lease, the
 *   lease's own capabilities and `leaseId`, `leaseToken` and `leaseMember`.
 * - With per-command auth on, appium-mcp sends no credential after the
 *   create except the URL's user info, so the same token goes there as the
 *   Basic password, the user `xenon-session` (basicCredential.ts). It adds no
 *   secret the capabilities don't already hold.
 *
 * The token lasts as long as a `xenon-mcp` token (XENON_MCP_TOKEN_TTL_SEC):
 * with per-command auth on, a session that outlives it is refused after that.
 */

const sessionCapabilitiesParams = z.object({
  authToken: z.string().optional(),
  lockId: z.string().min(1).optional(),
  leaseToken: z.string().min(1).optional(),
});

/** A lease as `GET /sdk/leases/:id` answers it, as far as the tool reads it. */
interface LeaseAnswer {
  status?: string;
  appiumCapabilities?: Record<string, any>;
  members?: Array<{ index: number; appiumCapabilities?: Record<string, any> }>;
}

/** The lease's member 0's capabilities, as its holder reads them (its token checked by REST). */
async function leaseCapabilities(
  caller: McpCaller,
  lockId: string,
  leaseToken: string,
): Promise<Record<string, any>> {
  const lease: LeaseAnswer = answerOf(
    await invokeApi(caller, {
      method: 'GET',
      path: `/sdk/leases/${encodeURIComponent(lockId)}`,
      headers: { 'x-xenon-lease-token': leaseToken },
    }),
  );
  if (lease.status === 'waiting') {
    throw new ToolRefusal(
      'lease_waiting',
      'The lease is still waiting for its device. Try again once it has one.',
      409,
    );
  }
  const member = lease.members?.find((m) => m.index === 0);
  return { ...(member?.appiumCapabilities ?? lease.appiumCapabilities ?? {}) };
}

/** This server's WebDriver URL, with the session token as its Basic password when asked. */
function webDriverUrl(origin: string, sessionToken: string | undefined): string {
  const url = new URL(origin);
  if (sessionToken) {
    url.username = SESSION_TOKEN_BASIC_USER;
    url.password = sessionToken;
  }
  const base = normalizeBasePath(Container.get(PluginContext).nodeBasePath);
  return url.href.replace(/\/+$/, '') + base;
}

export const sessionCapabilitiesTool = defineTool({
  name: 'xenon_session_capabilities',
  scope: 'appium:use',
  description:
    "What appium-mcp's create-session call needs to run an Appium session on this Xenon lab " +
    'as you. Returns {remoteServerUrl, capabilities}: pass both to the create-session tool ' +
    'unchanged, adding the capabilities your app needs (platformName, app, ...). ' +
    'capabilities carry xe:options.sessionToken, which makes the session yours. With a device ' +
    'from xenon_acquire_device, pass its lockId and leaseToken: the capabilities then name that ' +
    'device and its lease. The token lasts about an hour; ask again for a new session after that.',
  params: sessionCapabilitiesParams,
  annotations: { readOnlyHint: true, destructiveHint: false },
  async run(args, caller) {
    if ((args.lockId === undefined) !== (args.leaseToken === undefined)) {
      throw new ToolRefusal(
        'bad_request',
        'Pass both lockId and leaseToken from xenon_acquire_device, or neither.',
        400,
      );
    }
    const alwaysMatch =
      args.lockId && args.leaseToken
        ? await leaseCapabilities(caller, args.lockId, args.leaseToken)
        : {};

    const { sessionToken } = await mintSessionToken(caller.auth);
    const options: Record<string, any> = { ...(alwaysMatch[XE_OPTIONS] ?? {}), sessionToken };
    if (args.lockId && args.leaseToken) {
      options.leaseId = args.lockId;
      options.leaseToken = args.leaseToken;
      options.leaseMember = options.leaseMember ?? 0;
    }
    alwaysMatch[XE_OPTIONS] = options;

    const commandAuth = commandAuthEnabled() && config.authDisabled !== true;
    return {
      remoteServerUrl: webDriverUrl(callerOrigin(caller), commandAuth ? sessionToken : undefined),
      capabilities: { alwaysMatch, firstMatch: [{}] },
    };
  },
});
