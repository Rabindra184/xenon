import { Service } from 'typedi';
import nodemailer from 'nodemailer';
import { config } from '../config';
import log from '../logger';

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
