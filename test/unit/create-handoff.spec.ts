import { expect } from 'chai';
import sinon from 'sinon';
import {
  CreateHandoff,
  currentCreateHandoff,
  runWithCreateHandoff,
} from '../../src/gateway/createHandoff';

/**
 * The allocation the session gateway made for one `POST /session`, on its way
 * through Appium's route to the plugin's createSession. Taken once by the
 * plugin, or given back once if the plugin never takes it.
 */
describe('CreateHandoff', () => {
  afterEach(() => sinon.restore());

  it('hands its allocation over exactly once', () => {
    const release = sinon.spy();
    const handoff = new CreateHandoff({ udid: 'u1' }, release);
    expect(handoff.take()).to.deep.equal({ udid: 'u1' });
    expect(() => handoff.take()).to.throw(/already/);
    handoff.abandon();
    expect(release.called, 'a taken allocation is the taker’s to release').to.equal(false);
  });

  it('gives an allocation nobody took back once, and cannot be taken after', () => {
    const release = sinon.spy();
    const handoff = new CreateHandoff({ udid: 'u1' }, release);
    handoff.abandon();
    handoff.abandon();
    expect(release.callCount).to.equal(1);
    expect(release.firstCall.args[0]).to.deep.equal({ udid: 'u1' });
    expect(() => handoff.take()).to.throw(/closed/);
  });

  it('keeps no reference to the allocation once it is taken or released', () => {
    const taken = new CreateHandoff({ udid: 'u1' }, () => undefined);
    taken.take();
    expect((taken as any).allocation).to.equal(undefined);
    const released = new CreateHandoff({ udid: 'u2' }, () => undefined);
    released.abandon();
    expect((released as any).allocation).to.equal(undefined);
  });

  it('a release that throws is contained', () => {
    const handoff = new CreateHandoff({ udid: 'u1' }, () => {
      throw new Error('store down');
    });
    expect(() => handoff.abandon()).to.not.throw();
  });

  describe('the request context', () => {
    it('is none outside a request', () => {
      expect(currentCreateHandoff()).to.equal(undefined);
    });

    it('follows the request through awaits, timers and callbacks', async () => {
      const handoff = new CreateHandoff({ udid: 'u1' }, () => undefined);
      const seen = await runWithCreateHandoff(handoff, async () => {
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 5));
        return new Promise((resolve) => setImmediate(() => resolve(currentCreateHandoff())));
      });
      expect(seen).to.equal(handoff);
    });

    it('keeps two requests apart', async () => {
      const a = new CreateHandoff({ udid: 'a' }, () => undefined);
      const b = new CreateHandoff({ udid: 'b' }, () => undefined);
      const [seenA, seenB] = await Promise.all([
        runWithCreateHandoff(a, async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return currentCreateHandoff();
        }),
        runWithCreateHandoff(b, async () => {
          await new Promise((resolve) => setTimeout(resolve, 1));
          return currentCreateHandoff();
        }),
      ]);
      expect(seenA).to.equal(a);
      expect(seenB).to.equal(b);
    });
  });
});
