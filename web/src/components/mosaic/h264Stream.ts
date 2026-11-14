import { controlUrl, type PhoneRef } from '../../lib/phone';

/**
 * The WebSocket URL for a device's H.264 preview: `h264Path` (from
 * stream/start or stream/status) with a single-use ticket, which a WebSocket
 * needs because it can carry neither headers nor the cookie. Null when no
 * ticket could be minted, so the caller keeps MJPEG.
 */
export async function h264SocketUrl(
  phone: PhoneRef,
  h264Path: string,
  signal?: AbortSignal,
): Promise<string | null> {
  // The ticket names the phone's server, so the socket needs no host of its own.
  const tr = await fetch(controlUrl(phone, 'stream/ticket'), {
    method: 'POST',
    ...(signal ? { signal } : {}),
  });
  if (!tr.ok) return null;
  const { ticket } = await tr.json();
  if (!ticket) return null;
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}${h264Path}?ticket=${encodeURIComponent(ticket)}`;
}
