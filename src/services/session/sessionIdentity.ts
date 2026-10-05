/**
 * Who owns an Appium session.
 *
 * Two id spaces, kept apart on purpose. `apiKeyId` is an `ApiKey` row id;
 * `userId` is a `User` id. Writing one into the other is the conflation that
 * caused #216 — `stream/start` wrote a userId while `stream/stop` read an
 * ApiKey id, and users were locked out of their own devices.
 *
 * Pure: no Prisma, no Container, no I/O of its own. The caller supplies an
 * already-verified key row and a `verify` function for the token.
 */
export interface SessionIdentity {
  /** ApiKey row id, when the caller presented an xe:options key pair. */
  apiKeyId: string | null;
  /** User id — the human. Populated from either credential path. */
  userId: string | null;
}

export interface SessionIdentityInput {
  /** An xe:options.{accessKey,token} pair already verified by ApiKeyService. */
  row: { id: string; userId: string } | null;
  /** The raw xe:options.sessionToken capability, if the caller sent one. */
  sessionToken: string | null;
  /**
   * verifySessionTokenCredential's payload: a live `xenon-session` signature
   * and an ACTIVE subject. Throws for a token that doesn't check out.
   */
  verify: (token: string) => Promise<{ sub?: unknown }>;
}

const NONE: SessionIdentity = { apiKeyId: null, userId: null };

export async function resolveSessionIdentity(
  input: SessionIdentityInput,
): Promise<SessionIdentity> {
  // A verified key pair is the strongest credential and carries both ids, so
  // rows written this way need no ApiKey hop when the owner is read back.
  if (input.row) {
    return { apiKeyId: input.row.id, userId: input.row.userId };
  }

  if (!input.sessionToken) return NONE;

  // Attribution is decoupled from enforcement: a token that does not verify is
  // IGNORED here, never rejected. Whether the session is admitted is decided
  // by the caller: assertSessionTokenGate for a session with no valid
  // credentials, and authorizeSessionRequest's `sessions` scope check for a
  // token that verifies. That separation is what lets a valid token identify
  // its caller even when the gate is switched off.
  try {
    const payload = await input.verify(input.sessionToken);
    const sub = payload?.sub;
    if (typeof sub === 'string' && sub.length > 0) {
      return { apiKeyId: null, userId: sub };
    }
  } catch {
    /* unverifiable token — unattributed, not rejected */
  }
  return NONE;
}
