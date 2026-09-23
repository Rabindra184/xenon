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

  describe('log fallback is opt-in (1.20.7)', () => {
    it('defaults off when XENON_PASSWORD_RESET_LOG_FALLBACK is unset', function () {
      if (process.env.XENON_PASSWORD_RESET_LOG_FALLBACK !== undefined) this.skip();
      expect((config as any).passwordResetLogFallback).to.equal(false);
    });

    it('canDeliver: SMTP or explicit fallback, nothing else', () => {
      const orig = { url: (config as any).smtpUrl, fb: (config as any).passwordResetLogFallback };
      const svc = new EmailService();
      try {
        (config as any).smtpUrl = undefined;
        (config as any).passwordResetLogFallback = false;
        expect(svc.canDeliver()).to.equal(false);
        (config as any).passwordResetLogFallback = true;
        expect(svc.canDeliver()).to.equal(true);
        (config as any).passwordResetLogFallback = false;
        (config as any).smtpUrl = 'smtp://mail.example.com:587';
        expect(svc.canDeliver()).to.equal(true);
      } finally {
        (config as any).smtpUrl = orig.url;
        (config as any).passwordResetLogFallback = orig.fb;
      }
    });

    it('warns at startup only when the fallback would actually log links', () => {
      const orig = { url: (config as any).smtpUrl, fb: (config as any).passwordResetLogFallback };
      const svc = new EmailService();
      const warn = sinon.stub(svc as any, 'warnLog');
      try {
        (config as any).smtpUrl = undefined;
        (config as any).passwordResetLogFallback = false;
        svc.warnIfLogFallbackEnabled();
        expect(warn.called).to.equal(false);

        (config as any).smtpUrl = 'smtp://mail.example.com:587';
        (config as any).passwordResetLogFallback = true;
        svc.warnIfLogFallbackEnabled();
        expect(warn.called, 'SMTP wins, so nothing is logged').to.equal(false);

        (config as any).smtpUrl = undefined;
        svc.warnIfLogFallbackEnabled();
        expect(warn.calledOnce).to.equal(true);
        expect(warn.firstCall.args[0]).to.match(/plaintext/);
      } finally {
        (config as any).smtpUrl = orig.url;
        (config as any).passwordResetLogFallback = orig.fb;
      }
    });
  });
});
