import { z } from 'zod';
import { decodeJwt } from 'jose';
import { Container } from 'typedi';
import { AUTH_TOKEN_PARAM, defineTool } from '../tool';
import { invokeApi } from '../invokeApi';
import { answerOf, ToolRefusal } from '../toolCall';
import { callerOrigin } from '../publicOrigin';
import type { McpCaller } from '../mcpCredential';
import { config } from '../../config';
import { mintSessionToken } from '../../app/routers/auth';
import { normalizeBasePath } from '../../app/appiumBasePath';
import { commandAuthEnabled } from '../../middleware/commandAuth';
import { SESSION_TOKEN_BASIC_USER } from '../../middleware/basicCredential';
import {
  OPTION_NAMESPACES,
  XE_OPTIONS,
  isOptionsObject,
  xenonOptionsIn,
} from '../../services/session/xenonOptions';
import { SECRET_OPTION_FIELDS } from '../../services/session/sessionCredentials';
import { PluginContext } from '../../PluginContext';

/**
 * `xenon_session_capabilities`: what appium-mcp's create-session call needs
 * to run on this lab as the signed-in user. appium-mcp drives; Xenon gives
 * the lab: the agent passes `remoteServerUrl` and `capabilities` through.
 *
 * Answers `{ remoteServerUrl, capabilities, expiresAt }`.
 *
 * - `remoteServerUrl` is this server's WebDriver URL: the origin the agent
 *   reached `/xenon/mcp` at, plus Appium's base path.
 * - `capabilities` carry a fresh `xe:options.sessionToken` (audience
 *   `xenon-session`), so the session is the caller's; with a lease, the
 *   lease's own capabilities and `leaseId`, `leaseToken` and `leaseMember`.
 * - The caller's own capabilities (the `capabilities` argument: the app, its
 *   activity, Xenon's options) go into `alwaysMatch` under those, so the
 *   answer goes to the create-session tool as it is. What the lease or this
 *   tool sets always wins (appAndLabCapabilities), and `ignored` names what
 *   lost.
 * - With per-command auth on, appium-mcp sends no credential after the
 *   create except the URL's user info, so the same token goes there as the
 *   Basic password, the user `xenon-session` (basicCredential.ts). It adds no
 *   secret the capabilities don't already hold.
 *
 * The token lasts as long as a `xenon-mcp` token (XENON_MCP_TOKEN_TTL_SEC),
 * answered as `expiresAt`: with per-command auth on, a session that outlives
 * it is refused after that.
 * - Under an agent's browser sign-in (the caller has a `grantId`) it lasts
 *   all of that, not the access token's remaining hour: it carries the
 *   grant's `gid`, so revoking the sign-in refuses it at once, and an agent
 *   whose session outlived its hour would otherwise lose it mid-test.
 * - For any other caller it never outlives the credential that asked for it
 *   (mintedLifetimeSec), as POST /auth/token's tokens don't.
 */

const sessionCapabilitiesParams = z.object({
  authToken: AUTH_TOKEN_PARAM,
  lockId: z
    .string()
    .min(1)
    .optional()
    .describe(
      'The lockId xenon_acquire_device answered, to start the session on that leased phone. Pass it with leaseToken, or neither.',
    ),
  leaseToken: z
    .string()
    .min(1)
    .optional()
    .describe('The leaseToken xenon_acquire_device answered. Pass it with lockId, or neither.'),
  capabilities: z
    .union([z.record(z.string(), z.unknown()), z.string()])
    .optional()
    .describe(
      "Your app's own capabilities, as one flat object of W3C names, for example " +
        '{"platformName":"Android","appium:automationName":"UiAutomator2",' +
        '"appium:appPackage":"com.android.settings","appium:appActivity":".Settings"}. ' +
        "They are put into the answer's capabilities.alwaysMatch, so the answer needs no editing. " +
        "A capability the lease sets (the phone, its ports) keeps the lease's value. " +
        'Not {alwaysMatch, firstMatch}: only what goes inside alwaysMatch. The same object as a JSON string is taken too.',
    ),
});

/**
 * The fields of `xe:options` this tool decides: the caller's identity and the
 * lease. A caller's own value for one is dropped, in either namespace, so a
 * key pair or another lease passed in `capabilities` can't decide whose
 * session it is or which phone it gets.
 */
const LAB_OPTION_FIELDS: readonly string[] = [...SECRET_OPTION_FIELDS, 'leaseId', 'leaseMember'];

/**
 * The caller's capabilities under the lease's: the caller's first, then the
 * lease's over them, with `xe:options` merged field by field the same way.
 * Returns the merged map, the names of the caller's capabilities the lease's
 * replaced, and the option fields taken out (`dropped`), for the caller to
 * compare with what the tool sets in their place.
 */
function appAndLabCapabilities(
  app: Record<string, unknown>,
  lease: Record<string, any>,
): { alwaysMatch: Record<string, any>; ignored: string[]; dropped: DroppedOption[] } {
  const ignored: string[] = [];
  const dropped: DroppedOption[] = [];
  const alwaysMatch: Record<string, any> = {};

  for (const [name, value] of Object.entries(app)) {
    if (value === undefined) continue;
    if (!(OPTION_NAMESPACES as readonly string[]).includes(name)) {
      alwaysMatch[name] = value;
      continue;
    }
    // Xenon's options: kept, minus the fields this tool decides.
    if (!isOptionsObject(value)) {
      ignored.push(name);
      continue;
    }
    const options: Record<string, any> = {};
    for (const [field, fieldValue] of Object.entries(value)) {
      if (LAB_OPTION_FIELDS.includes(field)) dropped.push({ name, field, value: fieldValue });
      else options[field] = fieldValue;
    }
    if (Object.keys(options).length > 0) alwaysMatch[name] = options;
  }

  for (const [name, value] of Object.entries(lease)) {
    if (name === XE_OPTIONS && isOptionsObject(value)) {
      const mine = isOptionsObject(alwaysMatch[name]) ? alwaysMatch[name] : {};
      for (const field of Object.keys(value)) {
        if (field in mine && !sameValue(mine[field], value[field])) {
          ignored.push(`${name}.${field}`);
        }
      }
      alwaysMatch[name] = { ...mine, ...value };
      continue;
    }
    if (name in alwaysMatch && !sameValue(alwaysMatch[name], value)) ignored.push(name);
    alwaysMatch[name] = value;
  }
  return { alwaysMatch, ignored, dropped };
}

/** An option field of the caller's that this tool decides, taken out of their capabilities. */
interface DroppedOption {
  name: string;
  field: string;
  value: unknown;
}

/**
 * The lease the session is for: the `lockId` and `leaseToken` arguments, else
 * the ones in the caller's own capabilities. xenon_acquire_device answers
 * `appiumCapabilities` that carry both, and an agent may pass those as
 * `capabilities` and nothing else; without this the answer would pin the
 * leased phone with no lease, and the create would wait for a phone it can't
 * have. A lease id without its token can't be used: refused, saying what to
 * pass.
 */
function leaseOf(
  args: { lockId?: string; leaseToken?: string },
  app: Record<string, unknown>,
): { lockId: string; leaseToken: string } | undefined {
  if (args.lockId && args.leaseToken) return { lockId: args.lockId, leaseToken: args.leaseToken };
  const mine = xenonOptionsIn(app);
  const lockId = typeof mine.leaseId === 'string' && mine.leaseId ? mine.leaseId : undefined;
  const leaseToken =
    typeof mine.leaseToken === 'string' && mine.leaseToken ? mine.leaseToken : undefined;
  if (lockId && leaseToken) return { lockId, leaseToken };
  if (lockId || leaseToken) {
    throw new ToolRefusal(
      'bad_request',
      "capabilities name a lease without both its id and its token. Pass the lease's lockId " +
        'and leaseToken from xenon_acquire_device as arguments.',
      400,
    );
  }
  return undefined;
}

/** Whether a caller's capability says what the lease's does (platformName's letter case aside). */
function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The `capabilities` argument as an object. appium-mcp's own create-session
 * tool takes its capabilities as a JSON string, so an agent passes one here
 * by habit, and a client holding an older list of this tool's arguments
 * sends the object as text: both are read as the object they spell.
 */
function flatCapabilities(
  given: Record<string, unknown> | string | undefined,
): Record<string, unknown> {
  if (given === undefined) return {};
  if (typeof given !== 'string') return given;
  let parsed: unknown;
  try {
    parsed = JSON.parse(given);
  } catch {
    parsed = undefined;
  }
  if (isOptionsObject(parsed)) return parsed;
  throw new ToolRefusal(
    'bad_request',
    'capabilities must be one flat object of capabilities, or that object as a JSON string.',
    400,
  );
}

/** `capabilities` given as a whole W3C request, which would nest inside alwaysMatch. */
function looksLikeW3cRequest(app: Record<string, unknown>): boolean {
  return 'alwaysMatch' in app || 'firstMatch' in app;
}

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
    'as you. Returns {remoteServerUrl, capabilities, expiresAt}: pass remoteServerUrl and ' +
    'capabilities to the create-session tool unchanged, adding the capabilities your app ' +
    'needs (platformName, app, ...). Or pass those here as capabilities (one flat object): ' +
    "they are put into the answer's alwaysMatch, and the answer then goes to the " +
    'create-session tool with nothing to add. What the lease sets keeps its value; ignored ' +
    'lists the names of capabilities of yours that were left out for that reason. ' +
    'capabilities carry xe:options.sessionToken, which makes ' +
    'the session yours. With a device from xenon_acquire_device, pass its lockId and ' +
    'leaseToken: the capabilities then name that device and its lease. expiresAt (epoch ms) ' +
    'is when the token ends: a day by default. Connected with an API key or token, it ends ' +
    'when that does, if sooner; signed in through the browser, it stops working as soon as ' +
    'that sign-in ends or is signed out. Ask again for each new session.',
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
    const app = flatCapabilities(args.capabilities);
    if (looksLikeW3cRequest(app)) {
      throw new ToolRefusal(
        'bad_request',
        'capabilities takes one flat object of capabilities (what goes inside alwaysMatch), ' +
          'not { alwaysMatch, firstMatch }.',
        400,
      );
    }
    const lease = leaseOf(args, app);
    const { alwaysMatch, ignored, dropped } = appAndLabCapabilities(
      app,
      lease ? await leaseCapabilities(caller, lease.lockId, lease.leaseToken) : {},
    );

    // Under the caller's sign-in grant, so revoking it stops the session's
    // commands too; for that reason it isn't cut to the access token's hour.
    const { sessionToken } = await mintSessionToken(
      caller.grantId ? { ...caller.auth, credentialExpiresAt: undefined } : caller.auth,
      caller.grantId ? { grantId: caller.grantId } : {},
    );
    const exp = decodeJwt(sessionToken).exp;
    const options: Record<string, any> = { ...(alwaysMatch[XE_OPTIONS] ?? {}), sessionToken };
    if (lease) {
      options.leaseId = lease.lockId;
      options.leaseToken = lease.leaseToken;
      options.leaseMember = options.leaseMember ?? 0;
    }
    alwaysMatch[XE_OPTIONS] = options;
    // A field of the caller's that says what the tool set anyway isn't worth
    // a mention. Names only: a dropped field may be a secret.
    for (const { name, field, value } of dropped) {
      if (!sameValue(value, options[field])) ignored.push(`${name}.${field}`);
    }
    const left = [...new Set(ignored)].sort();

    const commandAuth = commandAuthEnabled() && config.authDisabled !== true;
    return {
      remoteServerUrl: webDriverUrl(callerOrigin(caller), commandAuth ? sessionToken : undefined),
      capabilities: { alwaysMatch, firstMatch: [{}] },
      expiresAt: typeof exp === 'number' ? exp * 1000 : null,
      ...(left.length > 0 ? { ignored: left } : {}),
    };
  },
});
