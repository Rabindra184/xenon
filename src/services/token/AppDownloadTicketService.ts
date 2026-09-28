import { Service, Container } from 'typedi';
import { randomUUID } from 'crypto';
import { JwtKeyService } from './JwtKeyService';
import { SingleUseLedger } from './singleUseLedger';

/**
 * Ten minutes: long enough for a session to wait for a phone and for the
 * driver to start its download, short enough that a URL left in a log is
 * worthless soon after.
 */
export const APP_TICKET_TTL_SEC = 600;

/**
 * Its own audience, so the verifier refuses a stream ticket here and an app
 * ticket on the stream route: neither can stand in for the other.
 */
export const APP_TICKET_AUDIENCE = 'xenon-app-download';

/**
 * Single-use, app-bound tickets for `GET /apps/:id/download?ticket=`.
 *
 * When a session names an uploaded app by id, SessionLifecycleService rewrites
 * the capability to that URL, and the Appium driver downloads it itself with
 * no credentials. The ticket is minted only after the session's creator was
 * found to be allowed to see the app, so it carries no identity: its whole
 * authority is "this app, once, until it expires".
 *
 * Modelled on StreamTicketService: RS256 via JwtKeyService, a `jti`, and the
 * same SingleUseLedger for replay.
 */
@Service()
export class AppDownloadTicketService {
  private ledger = new SingleUseLedger(APP_TICKET_TTL_SEC);

  async mint(appId: string): Promise<string> {
    return Container.get(JwtKeyService).sign(
      { appId },
      { audience: APP_TICKET_AUDIENCE, ttlSeconds: APP_TICKET_TTL_SEC, jti: randomUUID() },
    );
  }

  /**
   * Throws unless the ticket is genuine, unexpired, unused and for `appId`.
   * A ticket presented for the wrong app is not spent.
   */
  async redeem(ticket: string, appId: string): Promise<void> {
    const payload = await Container.get(JwtKeyService).verify(ticket, {
      audience: APP_TICKET_AUDIENCE,
    });
    if (payload.appId !== appId) throw new Error('ticket app mismatch');
    this.ledger.consume(payload);
  }
}
