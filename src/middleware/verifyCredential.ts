import * as jose from 'jose';
import { Container } from 'typedi';
import { ApiKeyService, ApiKeyRow } from '../services/ApiKeyService';
import { UserService } from '../services/UserService';
import { JwtKeyService } from '../services/token/JwtKeyService';

/**
 * The credential checks behind authMiddleware's header-pair and Bearer paths.
 *
 * Shared so every surface that accepts "the credentials REST accepts" verifies
 * them the same way: authMiddleware for /xenon/api, and the WebDriver
 * per-command check (commandAuth.ts). Each check returns null when the
 * credential is wrong and throws only when it could not be checked at all
 * (database or signing key unavailable), so a caller can tell the two apart.
 * authMiddleware answers 401 either way; per-command auth answers 503 for a
 * check that could not run.
 *
 * Services are read from the Container at call time, not import time, so the
 * specs that Container.set() stubs keep working.
 */

/**
 * xenon-mcp tokens are the gateway-injected `authToken` the MCP plugin's tools
 * present when calling the REST surface, so both audiences verify.
 * A xenon-session token (the `xe:options.sessionToken` capability) is not
 * among them: it proves who created a session, and REST does not accept it.
 */
export const ACCEPTED_BEARER_AUDIENCES = ['xenon-rest', 'xenon-mcp'] as const;

export interface VerifiedUser {
  id: string;
  role: string;
  status: string;
}

/**
 * The (x-xenon-access-key, x-xenon-token) pair: a live, unexpired, unrevoked
 * key belonging to the user with that access key, whose owner is ACTIVE.
 */
export async function verifyKeyPairCredential(
  accessKey: string,
  token: string,
): Promise<{ row: ApiKeyRow; user: VerifiedUser } | null> {
  const row = await Container.get(ApiKeyService).verifyPair(accessKey, token);
  if (!row || !row.userId) return null;
  const user = await Container.get(UserService).findById(row.userId);
  if (!user || user.status !== 'ACTIVE') return null;
  return { row, user: user as VerifiedUser };
}

/**
 * A hub-issued RS256 JWT with one of ACCEPTED_BEARER_AUDIENCES, whose subject
 * is an ACTIVE user. The user is looked up live on every call, so disabling an
 * account revokes its tokens even though the tokens themselves are stateless.
 *
 * JwtKeyService.verify() takes a single audience, so each accepted audience is
 * tried in turn. A JOSE error (bad signature, wrong audience, expired, not a
 * JWT) means the token is wrong. Any other error (typically "JWT key service
 * not initialized") means it could not be checked, and is rethrown once no
 * audience has verified.
 */
export async function verifyBearerCredential(
  token: string,
): Promise<{ payload: jose.JWTPayload; user: VerifiedUser } | null> {
  let payload: jose.JWTPayload | undefined;
  let checkFailure: unknown;
  for (const audience of ACCEPTED_BEARER_AUDIENCES) {
    try {
      payload = await Container.get(JwtKeyService).verify(token, { audience });
      break;
    } catch (err) {
      if (!(err instanceof jose.errors.JOSEError)) checkFailure = checkFailure ?? err;
    }
  }
  if (!payload) {
    if (checkFailure) throw checkFailure;
    return null;
  }
  const user = await Container.get(UserService).findById(String(payload.sub));
  if (!user || user.status !== 'ACTIVE') return null;
  return { payload, user: user as VerifiedUser };
}
