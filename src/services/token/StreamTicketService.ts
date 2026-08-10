import { Service, Container } from 'typedi';
import { randomUUID } from 'crypto';
import { JwtKeyService } from './JwtKeyService';

const TICKET_TTL_SEC = 60;

/**
 * The identity a redeemed ticket carries.
 *
 * `actorId` is a **User** id (see test/unit/stream-ticket-identity.spec.ts —
 * minting an ApiKey row id here poisons every ownership reader downstream).
 *
 * `isAdmin` and `apiKeyId` exist so a consumer can reach the same ownership
 * verdict `deviceAccessGuard` reaches for the same caller over REST:
 * `evaluateDeviceAccess` needs the admin flag for the admin bypass, and the
 * api-key id to recognise a pre-1.13.0 `manual_<apiKeyId>_<udid>` lock as the
 * caller's own. Both are captured at mint time from `resolveActor(req)`, which
 * has already derived them from the presented credential — that also captures
 * an admin-scoped **API key**, which a `User.role` lookup at redeem time would
 * miss. They are ordinary JWT claims inside the RS256-signed ticket, so a
 * client cannot supply or edit them: a tampered payload fails verification and
 * never reaches this shape at all.
 */
export interface StreamTicketActor {
  actorId: string;
  /** Optional so a ticket minted before this claim existed reads as non-admin. */
  isAdmin?: boolean;
  apiKeyId?: string;
}

/** Single-use, udid-bound, 60 s tokens for the webview <img> MJPEG path. */
@Service()
export class StreamTicketService {
  // jti -> expiry epoch-ms. Pruned on each redeem; bounded by 60 s TTL.
  private used = new Map<string, number>();

  async mint(
    udid: string,
    actorId: string,
    actor: { isAdmin?: boolean; apiKeyId?: string } = {},
  ): Promise<string> {
    return Container.get(JwtKeyService).sign(
      {
        udid,
        actorId,
        isAdmin: !!actor.isAdmin,
        ...(actor.apiKeyId ? { apiKeyId: actor.apiKeyId } : {}),
      },
      { audience: 'xenon-stream', ttlSeconds: TICKET_TTL_SEC, jti: randomUUID() },
    );
  }

  async redeem(ticket: string, udid: string): Promise<StreamTicketActor> {
    const payload = await Container.get(JwtKeyService).verify(ticket, { audience: 'xenon-stream' });
    if (payload.udid !== udid) throw new Error('ticket udid mismatch');
    const jti = String(payload.jti);
    const now = Date.now();
    for (const [k, exp] of this.used) if (exp < now) this.used.delete(k);
    if (this.used.has(jti)) throw new Error('ticket already used');
    // Evict the anti-replay entry only once the JWT itself is genuinely
    // unverifiable. JwtKeyService.verify() honors clockTolerance:60, so the
    // token stays acceptable until exp + 60s. Keying eviction off redeem-time
    // + TTL (mint..mint+60) would drop the jti at mint+60 while verify() still
    // accepts a replay up to mint+120 — a ~60s single-use bypass. Key off the
    // token's own exp claim plus the same tolerance so memory outlives it.
    const evictAt =
      (typeof payload.exp === 'number' ? payload.exp * 1000 : now + TICKET_TTL_SEC * 1000) + 60_000; // token exp + clockTolerance (mirrors JwtKeyService.verify)
    this.used.set(jti, evictAt);
    // Every field comes out of the *verified* payload. Read defensively anyway
    // (=== true, typeof === 'string') so a ticket minted by an older build,
    // which carries neither claim, degrades to "non-admin, no key" rather than
    // to a truthy string.
    return {
      actorId: String(payload.actorId),
      isAdmin: payload.isAdmin === true,
      ...(typeof payload.apiKeyId === 'string' ? { apiKeyId: payload.apiKeyId } : {}),
    };
  }
}
