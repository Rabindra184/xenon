import type { Request } from 'express';
import { config } from '../config';
import log from '../logger';
import {
  AuthContext,
  authDisabledAuth,
  bearerAuth,
  keyPairAuth,
} from '../middleware/authMiddleware';
import { verifyBearerCredential, verifyKeyPairCredential } from '../middleware/verifyCredential';
import { readBasicCredential } from '../middleware/basicCredential';

/** Where a credential check that could not run is logged. */
export const mcpCredentialLog = log.scope('McpCredential');

/** Who an MCP call is. */
export interface McpCaller {
  /** As `req.auth` would be for the same credential on REST. */
  auth: AuthContext;
  /** The sign-in grant a bearer token was issued under (its `gid` claim). */
  grantId?: string;
  /**
   * The granular MCP scopes a bearer token was minted with (its `scope`
   * claim, space-separated). Absent for a credential without one, whose flat
   * scopes say what it may do (mcpScopesAllowedBy).
   */
  mcpScopes?: string[];
  /**
   * The origin the agent reached this server at (publicOrigin of its
   * `/xenon/mcp` request): where the URLs a tool hands out point, such as
   * `xenon_session_capabilities`' WebDriver URL. Set by the endpoint.
   */
  origin?: string;
}

/**
 * The caller of a `/xenon/mcp` request, from the credentials REST takes in
 * headers: the key pair (`x-xenon-access-key` + `x-xenon-token`), a bearer
 * token (audience `xenon-mcp` or `xenon-rest`), or the key pair as Basic auth,
 * each checked by REST's own verifier. Never the dashboard cookie: a browser
 * sends it with any page's request, so any page could drive the tools as the
 * signed-in user.
 *
 * `unauthenticated` for no credential or a wrong one; `unavailable` when one
 * could not be checked (the database or the signing key unavailable).
 */
export async function resolveMcpCaller(
  req: Request,
): Promise<McpCaller | 'unauthenticated' | 'unavailable'> {
  if (config.authDisabled === true) return { auth: authDisabledAuth() };
  try {
    const accessKey = req.headers['x-xenon-access-key'];
    const token = req.headers['x-xenon-token'];
    if (typeof accessKey === 'string' && accessKey && typeof token === 'string' && token) {
      const verified = await verifyKeyPairCredential(accessKey, token);
      return verified ? { auth: await keyPairAuth(verified) } : 'unauthenticated';
    }

    const authorization = req.headers['authorization'];
    if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
      const verified = await verifyBearerCredential(authorization.slice(7));
      if (!verified) return 'unauthenticated';
      const { gid, scope } = verified.payload;
      return {
        auth: await bearerAuth(verified),
        ...(typeof gid === 'string' && gid ? { grantId: gid } : {}),
        ...(typeof scope === 'string' ? { mcpScopes: scope.split(' ').filter(Boolean) } : {}),
      };
    }

    const basic = readBasicCredential(authorization);
    if (basic.kind === 'pair') {
      const verified = await verifyKeyPairCredential(basic.accessKey, basic.token);
      return verified ? { auth: await keyPairAuth(verified) } : 'unauthenticated';
    }
    return 'unauthenticated';
  } catch (err: any) {
    mcpCredentialLog.warn(`An MCP credential could not be checked: ${err?.message ?? err}`);
    return 'unavailable';
  }
}
