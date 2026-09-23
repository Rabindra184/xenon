import type { Request } from 'express';

/**
 * The URL a reset token is redeemed at. Built from the request so it matches
 * the host the caller reached the server on (honouring a TLS-terminating
 * proxy's x-forwarded-proto). The raw token is a credential for the account
 * until it expires or is used: never log the result.
 *
 * The token goes in the fragment (#), not the path. Browsers never send the
 * fragment to the server, so opening the link can't put the token in any
 * server-side log. As a path segment it was logged on every open: Appium's
 * [HTTP] request line and Xenon's UI-fallback line both record the URL.
 */
export function buildResetLink(req: Request, rawToken: string): string {
  const proto =
    req.secure || (req.headers['x-forwarded-proto'] as string) === 'https' ? 'https' : 'http';
  const host = req.headers.host || 'localhost';
  return `${proto}://${host}/xenon/reset-password#${rawToken}`;
}

/** The reset email, shared by self-service and admin-issued resets. */
export function resetEmail(user: { email: string; name: string }, link: string) {
  return {
    to: user.email,
    subject: 'Reset your Xenon password',
    text:
      `Hi ${user.name},\n\n` +
      `Someone requested a password reset for your Xenon account. ` +
      `If that was you, click the link below to choose a new password:\n\n` +
      `${link}\n\n` +
      `This link expires in 1 hour. If you did not request this, ignore this email — no action is needed.\n`,
  };
}
