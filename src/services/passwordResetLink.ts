import type { Request } from 'express';
import { config } from '../config';

/**
 * Where a password reset link points, and the email that carries it. The raw
 * token in a link is a credential for the account until it expires or is
 * used: never log the result.
 *
 * The token goes in the fragment (#), not the path. Browsers never send the
 * fragment to the server, so opening the link can't put the token in any
 * server-side log. As a path segment it was logged on every open: Appium's
 * [HTTP] request line and Xenon's UI-fallback line both record the URL.
 */

/**
 * The address a link Xenon sends (by email, or to the log fallback) points
 * at: XENON_PUBLIC_URL, the address people open the dashboard at, with any
 * path prefix a proxy serves it under and no trailing slash. null when it is
 * not set, or isn't a plain http(s) address (a query or fragment would
 * swallow the token).
 *
 * Never the request's Host header. Through 2.14 the link was built from it,
 * so anyone could ask for a reset of someone else's account naming a host of
 * their own (a matching Origin passes the CSRF check), and Xenon emailed the
 * victim a genuine link to that host, which handed over the token.
 */
export function resetLinkBase(cfg: { publicUrl?: string } = config): string | null {
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
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/** The reset page for `rawToken`, under `base` (resetLinkBase, or requestBase). */
export function buildResetLink(base: string, rawToken: string): string {
  return `${base}/xenon/reset-password#${rawToken}`;
}

/**
 * The address the caller reached this server on, honouring a TLS-terminating
 * proxy's x-forwarded-proto. Only for a link handed back to the signed-in
 * administrator who asked for it (POST /users/:id/reset-link when it can't be
 * emailed): they see where it points before passing it on, and hold the token
 * anyway. Never for a link Xenon sends to someone else.
 */
export function requestBase(req: Request): string {
  const proto =
    req.secure || (req.headers['x-forwarded-proto'] as string) === 'https' ? 'https' : 'http';
  const host = req.headers.host || 'localhost';
  return `${proto}://${host}`;
}

/** "1 hour", "30 minutes", "2 hours": a reset link's lifetime, for the email. */
export function describeLifetime(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/**
 * The reset email, shared by self-service and admin-issued resets. `ttlMs` is
 * how long the link lasts (PasswordResetService.ttlMs(), from
 * XENON_RESET_TOKEN_TTL_MS): the email said "1 hour" whatever it was.
 */
export function resetEmail(user: { email: string; name: string }, link: string, ttlMs: number) {
  return {
    to: user.email,
    subject: 'Reset your Xenon password',
    text:
      `Hi ${user.name},\n\n` +
      `Someone requested a password reset for your Xenon account. ` +
      `If that was you, click the link below to choose a new password:\n\n` +
      `${link}\n\n` +
      `This link expires in ${describeLifetime(ttlMs)}. If you did not request this, ignore this email — no action is needed.\n`,
  };
}
