import { resetLinkBase } from './passwordResetLink';

/**
 * How a user who has forgotten their password can get back in.
 *
 * - 'email': SMTP is configured and so is XENON_PUBLIC_URL, the address the
 *   emailed link points at, so the self-service form really emails a link.
 * - 'admin': one of them is not. Self-service can't reach the user: the
 *   forgot-password route mints no token when nothing can deliver it or no
 *   address is set to point it at, and even the opt-in log fallback
 *   (XENON_PASSWORD_RESET_LOG_FALLBACK=true) only writes the link to the
 *   server log, which the user can't read. So the sign-in page sends them to
 *   an administrator, who issues a link from the Users page
 *   (POST /users/:id/reset-link).
 *
 * The log fallback deliberately does not count as self-service. Same test as
 * EmailService.hasSmtp(), kept pure here so it needs no DI container.
 */
export type PasswordResetMode = 'email' | 'admin';

export function passwordResetMode(cfg: {
  smtpUrl?: string;
  publicUrl?: string;
}): PasswordResetMode {
  const smtp = !!(cfg.smtpUrl && cfg.smtpUrl.trim());
  return smtp && resetLinkBase(cfg) !== null ? 'email' : 'admin';
}
