import { useEffect, useState } from 'react';
import { useSocket, useSocketPhase } from './useSocket';

export type ConnectionTone = 'live' | 'reconnecting' | 'down';

export interface ConnectionStatus {
  tone: ConnectionTone;
  label: string;
  title: string;
  /** Something the person can do about it: `reload` the page. */
  action?: 'reload';
}

/** How long a drop is shown as "Reconnecting…" before it counts as down. */
export const RECONNECT_GRACE_MS = 60_000;

/**
 * What the header's status pill says, derived only from the real socket
 * connection. It replaced a pill that was hardcoded "Online" beside an
 * "Updated Xm ago" timer counting from when the header mounted, which turned
 * red after 10 minutes on any open tab whether or not data was flowing.
 *
 * While connected, pushed data is live by definition, so there is no timer:
 * a quiet lab is not a stale one.
 *
 * A refused socket (the server refused its handshake, and the sign-in is
 * still good) is never tried again, so it says so and offers a reload.
 * Through 2.36 it read "Retrying automatically" for a minute, then
 * "Disconnected", while nothing retried.
 */
export function describeConnection(
  isConnected: boolean,
  disconnectedAt: number | null,
  now: number,
  everConnected = true,
  refused = false,
): ConnectionStatus {
  if (isConnected) {
    return {
      tone: 'live',
      label: 'Live',
      title: 'Connected to the Xenon server. Updates stream in as they happen.',
    };
  }
  if (refused) {
    return {
      tone: 'down',
      label: 'Live updates stopped',
      title:
        'This page stopped getting live updates from the Xenon server. Reload the page to reconnect.',
      action: 'reload',
    };
  }
  const since = disconnectedAt ?? now;
  if (now - since < RECONNECT_GRACE_MS) {
    if (!everConnected) {
      return {
        tone: 'reconnecting',
        label: 'Connecting…',
        title: 'Connecting to the Xenon server.',
      };
    }
    return {
      tone: 'reconnecting',
      label: 'Reconnecting…',
      title: 'Lost the connection to the Xenon server. Retrying automatically.',
    };
  }
  const at = new Date(since).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return {
    tone: 'down',
    label: `Disconnected · since ${at}`,
    title: `No connection to the Xenon server since ${at}. What's on screen may be out of date.`,
  };
}

export function useConnectionStatus(): ConnectionStatus {
  const { isConnected } = useSocket();
  const refused = useSocketPhase() === 'refused';
  const [disconnectedAt, setDisconnectedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [everConnected, setEverConnected] = useState(isConnected);

  // A revived socket (no longer refused) gets the grace period afresh.
  useEffect(() => {
    setDisconnectedAt(isConnected ? null : Date.now());
    if (isConnected) setEverConnected(true);
  }, [isConnected, refused]);

  // Tick only while disconnected and trying again, so "Reconnecting…" can
  // become "Disconnected". A refused socket says the same however long.
  useEffect(() => {
    if (isConnected || refused) return;
    const id = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(id);
  }, [isConnected, refused]);

  return describeConnection(isConnected, disconnectedAt, now, everConnected, refused);
}
