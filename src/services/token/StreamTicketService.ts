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
    this.used.set(jti, now + TICKET_TTL_SEC * 1000);
    return { actorId: String(payload.actorId) };
  }
}
