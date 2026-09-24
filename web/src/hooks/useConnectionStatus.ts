import { useEffect, useState } from 'react';
import { useSocket } from './useSocket';

export type ConnectionTone = 'live' | 'reconnecting' | 'down';

export interface ConnectionStatus {
  tone: ConnectionTone;
  label: string;
  title: string;
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
 */
export function describeConnection(
  isConnected: boolean,
  disconnectedAt: number | null,
  now: number,
  everConnected = true,
): ConnectionStatus {
  if (isConnected) {
    return {
      tone: 'live',
      label: 'Live',
      title: 'Connected to the Xenon server. Updates stream in as they happen.',
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
  const [disconnectedAt, setDisconnectedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [everConnected, setEverConnected] = useState(isConnected);

  useEffect(() => {
    setDisconnectedAt(isConnected ? null : Date.now());
    if (isConnected) setEverConnected(true);
  }, [isConnected]);

  // Tick only while disconnected, so "Reconnecting…" can become "Disconnected".
  useEffect(() => {
    if (isConnected) return;
    const id = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(id);
  }, [isConnected]);

  return describeConnection(isConnected, disconnectedAt, now, everConnected);
}
