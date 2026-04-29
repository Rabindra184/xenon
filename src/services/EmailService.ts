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
