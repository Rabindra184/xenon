import { Service } from 'typedi';

/** Far more live sessions than one server runs; bounds a leak if an end is missed. */
const MAX_LIVE_SESSIONS = 1_000;

/**
 * The owners of the sessions this server runs, while they run.
 *
 * SessionOwnerResolver reads a session's owner from its Session row. A node
 * writes none for a session the hub created (the hub keeps that record, in
 * its own database), so the node's own ownership checks (the /control guard,
 * the logcat WebSocket, the session listing) found no owner and, failing
 * closed, refused the phone to everyone but admins, its owner included. The
 * same held for any server with the dashboard off.
 *
 * finalizeSession records the owner of each session this server drives (on a
 * node, the one the hub's create token named), and the session's end forgets
 * it: deleteSession, an unexpected shutdown, or the server's own shutdown.
 * SessionOwnerResolver asks here before the database.
 */
@Service()
export class LiveSessionOwners {
  private readonly owners = new Map<string, string>();

  record(sessionId: string, userId: string | null | undefined): void {
    if (!sessionId || !userId) return;
    this.owners.delete(sessionId);
    if (this.owners.size >= MAX_LIVE_SESSIONS) {
      const oldest = this.owners.keys().next().value as string;
      this.owners.delete(oldest);
    }
    this.owners.set(sessionId, userId);
  }

  forget(sessionId: string | null | undefined): void {
    if (sessionId) this.owners.delete(sessionId);
  }

  ownerOf(sessionId: string): string | undefined {
    return sessionId ? this.owners.get(sessionId) : undefined;
  }
}
