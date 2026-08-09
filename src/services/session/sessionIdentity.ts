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
  /** ApiKey row id, when the caller presented a df:options pair. */
  apiKeyId: string | null;
  /** User id — the human. Populated from either credential path. */
  userId: string | null;
}

export interface SessionIdentityInput {
  /** A df:options.{accessKey,token} pair already verified by ApiKeyService. */
  row: { id: string; userId: string } | null;
  /** The raw xenon:options.sessionToken capability, if the caller sent one. */
  sessionToken: string | null;
  /** JwtKeyService.verify bound to audience 'xenon-session'. */
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
  // IGNORED here, never rejected. assertSessionTokenGate remains the only
  // decider of whether the session is admitted. That separation is what lets a
  // valid token identify its caller even when the gate is switched off.
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
