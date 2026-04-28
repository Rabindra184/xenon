import { expect } from 'chai';
import sinon from 'sinon';
import { UserService } from '../../src/services/UserService';

describe('UserService', () => {
  afterEach(() => sinon.restore());

  describe('hashPassword / verifyPassword', () => {
    it('hashes a password with bcrypt and verifies it', async () => {
      const svc = new UserService();
      const hash = await svc.hashPassword('correct-horse-staple');
      expect(hash).to.match(/^\$2[ayb]\$/);
      expect(await svc.verifyPassword('correct-horse-staple', hash)).to.be.true;
      expect(await svc.verifyPassword('wrong', hash)).to.be.false;
    });

    it('rejects passwords shorter than 8 characters', async () => {
      const svc = new UserService();
      let err: Error | undefined;
      try {
        await svc.hashPassword('short');
      } catch (e) {
        err = e as Error;
      }
      expect(err?.message).to.match(/at least 8/);
    });
  });

  describe('generateAccessKey', () => {
    it('returns a string with the xen_ prefix and 12 url-safe chars', () => {
      const svc = new UserService();
      const key = svc.generateAccessKey();
      expect(key).to.match(/^xen_[A-Za-z0-9]{12}$/);
    });

    it('returns different values on every call', () => {
      const svc = new UserService();
      const a = svc.generateAccessKey();
      const b = svc.generateAccessKey();
      expect(a).to.not.equal(b);
    });
  });
});
