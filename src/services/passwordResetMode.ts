/**
 * How a user who has forgotten their password can get back in.
 *
 * - 'email': SMTP is configured, so the self-service form really emails a link.
 * - 'admin': it is not. Self-service can't reach the user: the forgot-password
 *   route mints no token when nothing can deliver it, and even the opt-in log
 *   fallback (XENON_PASSWORD_RESET_LOG_FALLBACK=true) only writes the link to
 *   the server log, which the user can't read. So the sign-in page sends them
 *   to an administrator, who issues a link from the Users page
 *   (POST /users/:id/reset-link).
 *
 * The log fallback deliberately does not count as self-service. Same test as
 * EmailService.hasSmtp(), kept pure here so it needs no DI container.
 */
export type PasswordResetMode = 'email' | 'admin';

export function passwordResetMode(cfg: { smtpUrl?: string }): PasswordResetMode {
  return cfg.smtpUrl && cfg.smtpUrl.trim() ? 'email' : 'admin';
}
