/**
 * The WebSocket URL for a device's H.264 preview: `h264Path` (from
 * stream/start or stream/status) with a single-use ticket, which a WebSocket
 * needs because it can carry neither headers nor the cookie. Null when no
 * ticket could be minted, so the caller keeps MJPEG.
 */
export async function h264SocketUrl(udid: string, h264Path: string): Promise<string | null> {
  const tr = await fetch(`/xenon/api/control/${encodeURIComponent(udid)}/stream/ticket`, {
    method: 'POST',
  });
  if (!tr.ok) return null;
  const { ticket } = await tr.json();
  if (!ticket) return null;
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}${h264Path}?ticket=${encodeURIComponent(ticket)}`;
}
