/**
 * How a user who has forgotten their password can get back in.
 *
 * - 'email': SMTP is configured, so the self-service form really emails a link.
 * - 'admin': it is not. The forgot-password route would still answer 204 and
 *   the page would promise an email, but EmailService either throws (and the
 *   route swallows it) or, with the default log fallback, writes the link to
 *   the server log where the user cannot see it. Either way nothing reaches
 *   the user, so the sign-in page must send them to an administrator, who can
 *   issue a link from the Users page.
 *
 * The log fallback deliberately does not count as self-service.
 */
export type PasswordResetMode = 'email' | 'admin';

export function passwordResetMode(cfg: { smtpUrl?: string }): PasswordResetMode {
  return cfg.smtpUrl && cfg.smtpUrl.trim() ? 'email' : 'admin';
}
