import { config } from '../config';

/**
 * XENON_PUBLIC_URL: the address people reach this Xenon server at, such as
 * https://xenon.example.com or http://lab-mac:4723. Links Xenon hands out
 * (password reset links, a device's dashboard_link) are built from it, never
 * from the request's Host header, which whoever sends the request chooses.
 *
 * The dashboard's own address is taken too: a trailing `/xenon` or `/xenon/`
 * is dropped, so `http://localhost:4723/xenon/` gives `http://localhost:4723`.
 * Kept as given it built `/xenon/xenon/reset-password`, which the dashboard
 * sends to its sign-in page, losing the token.
 *
 * Any other path is refused: the dashboard loads its pages, scripts and API
 * from `/xenon` on the server's root (its base path is fixed at build time),
 * so it can't be served under a reverse-proxy prefix, and a link under one
 * wouldn't open. So are an address that isn't http(s), and one with a query,
 * fragment or user name (a fragment would swallow a reset token).
 *
 * Returns the origin (scheme, host and port, no trailing slash), or null when
 * the variable is unset or not such an address.
 */
export function publicServerBase(cfg: { publicUrl?: string } = config): string | null {
  const raw = cfg.publicUrl?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.search || url.hash || url.username || url.password) return null;
  const path = url.pathname.replace(/\/+$/, '');
  if (path !== '' && path !== '/xenon') return null;
  return url.origin;
}
