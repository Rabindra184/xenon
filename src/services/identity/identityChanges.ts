import log from '../../logger';

/**
 * Something a live connection holds about a user changed: their role or
 * status, a sign-in (UserSession), an API key or access key, or their teams.
 * REST looks the caller up on every request, so it needs no notice. A
 * dashboard socket keeps who it is from its handshake, so the socket server
 * listens here and checks that user's sockets again (SocketServer.recheckUser).
 *
 * The writers call it once their write is done, through the services that
 * make the change (UserService, UserSessionService, ApiKeyService,
 * TeamService), and wait for it: once a REST call that made the change has
 * answered, the user's sockets have their new identity or are gone. A write
 * made anywhere else (another server sharing the database, a direct edit)
 * reaches the sockets at the socket server's next sweep.
 *
 * A module of its own so those services don't import the socket server,
 * which imports them.
 */
type Listener = (userId: string) => Promise<void>;

const listeners = new Set<Listener>();

/** Returns the function that stops listening. */
export function onIdentityChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Never rejects: a listener's failure is logged and the write it follows stands. */
export async function identityChanged(userId: string | null | undefined): Promise<void> {
  if (!userId) return;
  await Promise.all(
    Array.from(listeners, async (listener) => {
      try {
        await listener(userId);
      } catch (err: any) {
        log.warn(
          `[Identity] A change to user ${userId} was not applied to a live connection: ${err?.message ?? err}`,
        );
      }
    }),
  );
}
