import { expect } from 'chai';
import { LoginRateLimiter } from '../../src/middleware/loginRateLimiter';

describe('LoginRateLimiter', () => {
  it('allows up to N attempts then 429s', () => {
    const r = new LoginRateLimiter({ attempts: 3, windowMs: 60_000 });
    expect(r.consume('1.2.3.4')).to.equal('ok');
    expect(r.consume('1.2.3.4')).to.equal('ok');
    expect(r.consume('1.2.3.4')).to.equal('ok');
    expect(r.consume('1.2.3.4')).to.equal('blocked');
  });

  it('separate IPs do not interfere', () => {
    const r = new LoginRateLimiter({ attempts: 2, windowMs: 60_000 });
    r.consume('1.1.1.1'); r.consume('1.1.1.1');
    expect(r.consume('2.2.2.2')).to.equal('ok');
    expect(r.consume('1.1.1.1')).to.equal('blocked');
  });

  it('clearOnSuccess() resets the bucket for a successful login', () => {
    const r = new LoginRateLimiter({ attempts: 3, windowMs: 60_000 });
    r.consume('1.1.1.1'); r.consume('1.1.1.1'); r.consume('1.1.1.1');
    r.clearOnSuccess('1.1.1.1');
    expect(r.consume('1.1.1.1')).to.equal('ok');
  });

  it('window rolls over after windowMs', () => {
    const r = new LoginRateLimiter({ attempts: 1, windowMs: 10 });
    r.consume('1.1.1.1');
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(r.consume('1.1.1.1')).to.equal('ok');
        resolve();
      }, 30);
    });
  });
});
