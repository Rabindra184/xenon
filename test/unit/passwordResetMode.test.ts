import { expect } from 'chai';
import { passwordResetMode } from '../../src/services/passwordResetMode';

describe('passwordResetMode', () => {
  it('is email when an SMTP URL is configured', () => {
    expect(passwordResetMode({ smtpUrl: 'smtp://mail.example.com:587' })).to.equal('email');
  });

  it('is admin without SMTP, even though the log fallback defaults on', () => {
    // The fallback writes the link to the server log, which the person who
    // forgot their password cannot read — so it is not self-service.
    expect(passwordResetMode({})).to.equal('admin');
    expect(passwordResetMode({ smtpUrl: '' })).to.equal('admin');
    expect(passwordResetMode({ smtpUrl: '   ' })).to.equal('admin');
  });
});
