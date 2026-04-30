import 'reflect-metadata';
import { expect } from 'chai';
import { CommandInterceptor } from '../../src/interceptors/CommandInterceptor';

/**
 * These tests exercise the autowait helpers on CommandInterceptor without
 * spinning up the full handle() pipeline. handle() pulls in TracingService,
 * the dashboard event manager, and the session manager — all of which have
 * their own setup costs. The autowait logic is self-contained, so we cast
 * to access the helpers directly.
 */
describe('CommandInterceptor autowait helpers', () => {
  const interceptor = new CommandInterceptor() as any;

  describe('runFindWithAutowait', () => {
    it('returns the first non-null result', async () => {
      let calls = 0;
      const next = async () => {
        calls += 1;
        return { ELEMENT: 'abc' };
      };
      const result = await interceptor.runFindWithAutowait(next, 'findElement', {
        timeoutMs: 500,
        intervalBetweenAttemptsMs: 10,
      });
      expect(result).to.deep.equal({ ELEMENT: 'abc' });
      expect(calls).to.equal(1);
    });

    it('retries on NoSuchElement until element appears', async () => {
      let calls = 0;
      const next = async () => {
        calls += 1;
        if (calls < 3) {
          const err: any = new Error('NoSuchElement: not yet');
          err.name = 'NoSuchElementError';
          throw err;
        }
        return { ELEMENT: 'late' };
      };
      const result = await interceptor.runFindWithAutowait(next, 'findElement', {
        timeoutMs: 500,
        intervalBetweenAttemptsMs: 10,
      });
      expect(result).to.deep.equal({ ELEMENT: 'late' });
      expect(calls).to.be.greaterThanOrEqual(3);
    });

    it('throws NoSuchElement after timeout when never found', async () => {
      const next = async () => {
        const err: any = new Error('NoSuchElement');
        err.name = 'NoSuchElementError';
        throw err;
      };
      let caught: any;
      try {
        await interceptor.runFindWithAutowait(next, 'findElement', {
          timeoutMs: 30,
          intervalBetweenAttemptsMs: 5,
        });
      } catch (e) {
        caught = e;
      }
      expect(caught).to.exist;
      // message should include the original NoSuchElement marker so the
      // outer catch in handle() still routes to healing.
      expect(caught.message).to.match(/NoSuchElement/);
    });

    it('returns [] for findElements after timeout (no throw)', async () => {
      const next = async () => [];
      const result = await interceptor.runFindWithAutowait(next, 'findElements', {
        timeoutMs: 30,
        intervalBetweenAttemptsMs: 5,
      });
      expect(result).to.deep.equal([]);
    });

    it('returns the array immediately when findElements has hits', async () => {
      const next = async () => [{ ELEMENT: 'a' }, { ELEMENT: 'b' }];
      const result = await interceptor.runFindWithAutowait(next, 'findElements', {
        timeoutMs: 500,
        intervalBetweenAttemptsMs: 10,
      });
      expect(result).to.have.length(2);
    });

    it('does not swallow non-NoSuchElement errors', async () => {
      const next = async () => {
        throw new Error('boom — driver crashed');
      };
      let caught: any;
      try {
        await interceptor.runFindWithAutowait(next, 'findElement', {
          timeoutMs: 500,
          intervalBetweenAttemptsMs: 5,
        });
      } catch (e) {
        caught = e;
      }
      expect(caught).to.exist;
      expect(caught.message).to.equal('boom — driver crashed');
    });
  });

  describe('waitForElementEnabled', () => {
    it('returns once element becomes enabled', async () => {
      let calls = 0;
      const driver = {
        elementEnabled: async () => {
          calls += 1;
          return calls >= 2;
        },
      };
      await interceptor.waitForElementEnabled(driver, 'el-1', {
        timeoutMs: 500,
        intervalBetweenAttemptsMs: 5,
      });
      expect(calls).to.be.greaterThanOrEqual(2);
    });

    it('throws after timeout if never enabled', async () => {
      const driver = { elementEnabled: async () => false };
      let caught: any;
      try {
        await interceptor.waitForElementEnabled(driver, 'el-1', {
          timeoutMs: 30,
          intervalBetweenAttemptsMs: 5,
        });
      } catch (e) {
        caught = e;
      }
      expect(caught).to.exist;
      expect(caught.message).to.match(/enabled/);
    });

    it('no-ops when driver has no elementEnabled method', async () => {
      const driver = {} as any;
      await interceptor.waitForElementEnabled(driver, 'el-1', {
        timeoutMs: 1000,
        intervalBetweenAttemptsMs: 5,
      });
      // Should resolve without throwing — proxy/hub drivers have no
      // elementEnabled, and we don't want autowait to break those flows.
    });

    it('treats elementEnabled errors as not-yet and retries', async () => {
      let calls = 0;
      const driver = {
        elementEnabled: async () => {
          calls += 1;
          if (calls < 3) throw new Error('stale ref');
          return true;
        },
      };
      await interceptor.waitForElementEnabled(driver, 'el-1', {
        timeoutMs: 500,
        intervalBetweenAttemptsMs: 5,
      });
      expect(calls).to.be.greaterThanOrEqual(3);
    });
  });
});
