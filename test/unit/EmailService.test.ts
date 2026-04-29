import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import nodemailer from 'nodemailer';
import { EmailService } from '../../src/services/EmailService';
import { config } from '../../src/config';

describe('EmailService', () => {
  afterEach(() => sinon.restore());

  it('uses nodemailer when XENON_SMTP_URL is set', async () => {
    const sendMail = sinon.stub().resolves({ messageId: 'm1' });
    const createTransport = sinon.stub(nodemailer, 'createTransport').returns({ sendMail } as any);
    const orig = (config as any).smtpUrl;
    (config as any).smtpUrl = 'smtps://user:pass@smtp.example.com:465';
    try {
      const svc = new EmailService();
      await svc.send({ to: 'a@b.com', subject: 'Reset', text: 'click here' });
      expect(createTransport.calledOnce).to.be.true;
      expect(sendMail.firstCall.args[0]).to.include({ to: 'a@b.com', subject: 'Reset' });
    } finally {
      (config as any).smtpUrl = orig;
    }
  });

  it('falls back to log when SMTP_URL is unset and fallback enabled', async () => {
    const orig = { url: (config as any).smtpUrl, fb: (config as any).passwordResetLogFallback };
    (config as any).smtpUrl = undefined;
    (config as any).passwordResetLogFallback = true;
    try {
      const svc = new EmailService();
      const warn = sinon.spy(svc as any, 'warnLog');
      await svc.send({ to: 'a@b.com', subject: 'Reset', text: 'click https://x/reset/abc' });
      expect(warn.calledOnce).to.be.true;
      const logged = warn.firstCall.args[0] as string;
      expect(logged).to.include('a@b.com');
      expect(logged).to.include('https://x/reset/abc');
    } finally {
      (config as any).smtpUrl = orig.url;
      (config as any).passwordResetLogFallback = orig.fb;
    }
  });

  it('throws when SMTP unset and fallback disabled', async () => {
    const orig = { url: (config as any).smtpUrl, fb: (config as any).passwordResetLogFallback };
    (config as any).smtpUrl = undefined;
    (config as any).passwordResetLogFallback = false;
    try {
      const svc = new EmailService();
      let err: Error | undefined;
      try {
        await svc.send({ to: 'a@b.com', subject: 'x', text: 'y' });
      } catch (e) {
        err = e as Error;
      }
      expect(err?.message).to.match(/SMTP not configured/);
    } finally {
      (config as any).smtpUrl = orig.url;
      (config as any).passwordResetLogFallback = orig.fb;
    }
  });
});
