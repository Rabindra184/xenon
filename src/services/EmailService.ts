import { Service } from 'typedi';
import nodemailer from 'nodemailer';
import { config } from '../config';
import log from '../logger';
import { resetLinkBase } from './passwordResetLink';

interface Mail {
  to: string;
  subject: string;
  text: string;
}

@Service()
export class EmailService {
  private log = log.scope('Email');

  // Test seam — sinon spies on this in the log-fallback test.
  protected warnLog(line: string) {
    this.log.warn(line);
  }

  /** SMTP is configured, so mail really reaches the recipient. */
  hasSmtp(): boolean {
    const smtpUrl = (config as any).smtpUrl as string | undefined;
    return !!(smtpUrl && smtpUrl.trim());
  }

  /**
   * Whether send() will do anything other than throw: SMTP, or the opt-in log
   * fallback. Callers use it to avoid minting a credential nobody receives.
   */
  canDeliver(): boolean {
    return this.hasSmtp() || !!(config as any).passwordResetLogFallback;
  }

  /**
   * Startup notice when the log fallback is on. It writes reset links — which
   * are credentials for the account — to the server log in plaintext.
   */
  warnIfLogFallbackEnabled(): void {
    if (this.hasSmtp() || !(config as any).passwordResetLogFallback) return;
    this.warnLog(
      'XENON_PASSWORD_RESET_LOG_FALLBACK=true: password-reset links will be written to this ' +
        'log in plaintext. Anyone who can read the log (or a system it is shipped to) can take ' +
        'over the account for the link lifetime. Configure XENON_SMTP_URL, or unset this and ' +
        'issue links from the dashboard Users page.',
    );
  }

  /**
   * Startup notice about XENON_PUBLIC_URL, the address links Xenon hands out
   * are built from (never the request's Host, which the asker chooses):
   *
   * - set but refused (not an http(s) server address): whatever the mail
   *   setup, since it also decides each device's dashboard_link. The value is
   *   not logged: a user name and password in it is one reason to refuse it.
   * - unset while Xenon could send reset links: the sign-in page's "forgot
   *   password" then sends people to an administrator, and an administrator's
   *   reset link is handed back to them rather than emailed.
   */
  warnAboutPublicUrl(): void {
    if (config.publicUrl?.trim() && resetLinkBase() === null) {
      this.warnLog(
        'XENON_PUBLIC_URL is set but is not an http(s) server address such as ' +
          'https://xenon.example.com or http://lab-mac:4723 (a trailing /xenon is fine; any ' +
          'other path, a query, a fragment or a user name is not), so Xenon ignores it: it ' +
          'emails no password-reset links, and device dashboard links are paths on this server.',
      );
      return;
    }
    if (!this.canDeliver() || resetLinkBase() !== null) return;
    this.warnLog(
      "XENON_PUBLIC_URL is not set to this server's address, so Xenon sends no password-reset " +
        'links: "Forgot password" asks people to contact an administrator, and the Users ' +
        'page hands an administrator the link instead of emailing it. Set XENON_PUBLIC_URL to ' +
        'the http(s) address people reach this server at, such as https://xenon.example.com ' +
        'or http://lab-mac:4723 (a trailing /xenon is fine; any other path is not).',
    );
  }

  async send(mail: Mail): Promise<void> {
    const smtpUrl = (config as any).smtpUrl as string | undefined;
    const fallback = (config as any).passwordResetLogFallback as boolean | undefined;
    const fromAddr = (config as any).smtpFrom as string | undefined;

    if (smtpUrl) {
      const transport = nodemailer.createTransport(smtpUrl);
      await transport.sendMail({
        from: fromAddr ?? 'noreply@xenon.local',
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
      });
      return;
    }

    if (fallback) {
      this.warnLog(
        `[EMAIL FALLBACK] to=${mail.to} subject=${JSON.stringify(mail.subject)} body=${mail.text}`,
      );
      return;
    }

    throw new Error('SMTP not configured (XENON_SMTP_URL unset and fallback disabled)');
  }
}
