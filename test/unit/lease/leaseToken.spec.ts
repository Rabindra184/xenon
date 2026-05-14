import 'reflect-metadata';
import { expect } from 'chai';
import { generateToken, hashToken, verifyToken } from '../../../src/services/lease/leaseToken';

describe('leaseToken', () => {
  it('generates a 64-char hex token', () => {
    const t = generateToken();
    expect(t).to.match(/^[0-9a-f]{64}$/);
  });

  it('hashToken returns a 64-char hex SHA-256', () => {
    const h = hashToken('whatever');
    expect(h).to.match(/^[0-9a-f]{64}$/);
  });

  it('verifyToken returns true for matching cleartext', () => {
    const t = generateToken();
    expect(verifyToken(t, hashToken(t))).to.equal(true);
  });

  it('verifyToken returns false for mismatch', () => {
    const t = generateToken();
    expect(verifyToken(t + 'x', hashToken(t))).to.equal(false);
  });

  it('two generated tokens differ', () => {
    expect(generateToken()).to.not.equal(generateToken());
  });
});
