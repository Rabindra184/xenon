import { Service, Container } from 'typedi';
import { randomUUID } from 'crypto';
import { JwtKeyService } from './JwtKeyService';

const TICKET_TTL_SEC = 60;

/** Single-use, udid-bound, 60 s tokens for the webview <img> MJPEG path. */
@Service()
export class StreamTicketService {
  // jti -> expiry epoch-ms. Pruned on each redeem; bounded by 60 s TTL.
  private used = new Map<string, number>();

  async mint(udid: string, actorId: string): Promise<string> {
    return Container.get(JwtKeyService).sign(
      { udid, actorId },
      { audience: 'xenon-stream', ttlSeconds: TICKET_TTL_SEC, jti: randomUUID() },
    );
  }

  async redeem(ticket: string, udid: string): Promise<{ actorId: string }> {
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
    return { actorId: String(payload.actorId) };
  }
}
