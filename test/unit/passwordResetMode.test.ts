import { expect } from 'chai';
import { passwordResetMode } from '../../src/services/passwordResetMode';

describe('passwordResetMode', () => {
  it('is email when an SMTP URL and XENON_PUBLIC_URL are configured', () => {
    expect(
      passwordResetMode({
        smtpUrl: 'smtp://mail.example.com:587',
        publicUrl: 'https://xenon.example.com',
      }),
    ).to.equal('email');
  });

  // The emailed link points at XENON_PUBLIC_URL, never at the request's Host:
  // without it Xenon emails no link, so the form must not promise one.
  it('is admin with SMTP but no XENON_PUBLIC_URL', () => {
    expect(passwordResetMode({ smtpUrl: 'smtp://mail.example.com:587' })).to.equal('admin');
  });

  it('is admin without SMTP, even though the log fallback defaults on', () => {
    // The fallback writes the link to the server log, which the person who
    // forgot their password cannot read — so it is not self-service.
    expect(passwordResetMode({})).to.equal('admin');
    expect(passwordResetMode({ smtpUrl: '' })).to.equal('admin');
    expect(passwordResetMode({ smtpUrl: '   ' })).to.equal('admin');
  });
});
