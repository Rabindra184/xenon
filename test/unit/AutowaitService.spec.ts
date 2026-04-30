import 'reflect-metadata';
import { expect } from 'chai';
import { AutowaitService, AUTOWAIT_DEFAULTS } from '../../src/services/autowait/AutowaitService';
import { waitFor } from '../../src/services/autowait/waitFor';
import { DefaultPluginArgs, IPluginArgs } from '../../src/interfaces/IPluginArgs';

describe('AutowaitService', () => {
  let service: AutowaitService;
  let pluginArgs: IPluginArgs;

  beforeEach(() => {
    service = new AutowaitService();
    pluginArgs = {
      ...DefaultPluginArgs,
      autowait: { enabled: false, timeoutMs: 10000, intervalBetweenAttemptsMs: 500 },
    };
  });

  describe('getProps', () => {
    it('returns hard-coded defaults when no plugin args set', () => {
      const props = service.getProps('s1', { ...DefaultPluginArgs, autowait: undefined });
      expect(props).to.deep.equal(AUTOWAIT_DEFAULTS);
    });

    it('merges plugin-arg config over defaults', () => {
      pluginArgs.autowait = { enabled: true, timeoutMs: 20000 };
      const props = service.getProps('s1', pluginArgs);
      expect(props.enabled).to.equal(true);
      expect(props.timeoutMs).to.equal(20000);
      expect(props.intervalBetweenAttemptsMs).to.equal(AUTOWAIT_DEFAULTS.intervalBetweenAttemptsMs);
    });

    it('per-session override beats plugin args', () => {
      pluginArgs.autowait = { enabled: true, timeoutMs: 20000 };
      service.setProps('s1', { timeoutMs: 1500 });
      const props = service.getProps('s1', pluginArgs);
      expect(props.enabled).to.equal(true); // from plugin args
      expect(props.timeoutMs).to.equal(1500); // from override
    });
  });

  describe('setProps validation', () => {
    it('rejects non-boolean enabled', () => {
      expect(() => service.setProps('s1', { enabled: 'yes' as any })).to.throw(/boolean/);
    });

    it('rejects negative timeout', () => {
      expect(() => service.setProps('s1', { timeoutMs: -1 })).to.throw(/non-negative/);
    });

    it('rejects non-array excludeEnabledCheck', () => {
      expect(() => service.setProps('s1', { excludeEnabledCheck: 'click' as any })).to.throw(
        /array of strings/,
      );
    });

    it('rejects array with non-string members', () => {
      expect(() => service.setProps('s1', { excludeEnabledCheck: ['click', 5 as any] })).to.throw(
        /array of strings/,
      );
    });

    it('accepts valid values', () => {
      const result = service.setProps('s1', {
        enabled: true,
        timeoutMs: 5000,
        intervalBetweenAttemptsMs: 100,
        excludeEnabledCheck: ['click'],
      });
      expect(result.enabled).to.equal(true);
      expect(result.timeoutMs).to.equal(5000);
      expect(result.excludeEnabledCheck).to.deep.equal(['click']);
    });
  });

  describe('clearSession', () => {
    it('drops the per-session override', () => {
      service.setProps('s1', { timeoutMs: 1234 });
      expect(service.getProps('s1', pluginArgs).timeoutMs).to.equal(1234);
      service.clearSession('s1');
      expect(service.getProps('s1', pluginArgs).timeoutMs).to.equal(AUTOWAIT_DEFAULTS.timeoutMs);
    });
  });

  describe('fromLegacyShape', () => {
    it('maps appium-wait-plugin payload to modern shape', () => {
      const out = AutowaitService.fromLegacyShape({
        timeout: 1111,
        intervalBetweenAttempts: 22,
        excludeEnabledCheck: ['click', 'setValue'],
      });
      expect(out.timeoutMs).to.equal(1111);
      expect(out.intervalBetweenAttemptsMs).to.equal(22);
      expect(out.excludeEnabledCheck).to.deep.equal(['click', 'setValue']);
    });

    it('drops unknown / mistyped fields silently', () => {
      const out = AutowaitService.fromLegacyShape({
        timeout: 'fast',
        excludeEnabledCheck: ['click', 5, null],
        bogus: true,
      });
      expect(out.timeoutMs).to.equal(undefined);
      expect(out.excludeEnabledCheck).to.deep.equal(['click']);
      expect(out).to.not.have.property('bogus');
    });
  });
});

describe('waitFor', () => {
  it('returns immediately on first success', async () => {
    let calls = 0;
    const result = await waitFor(
      async () => {
        calls += 1;
        return 'ok';
      },
      { timeoutMs: 1000, intervalMs: 50 },
    );
    expect(result).to.deep.equal({ value: 'ok' });
    expect(calls).to.equal(1);
  });

  it('retries until success', async () => {
    let calls = 0;
    const result = await waitFor(
      async () => {
        calls += 1;
        return calls >= 3 ? 'ok' : null;
      },
      { timeoutMs: 1000, intervalMs: 10 },
    );
    expect(result).to.deep.equal({ value: 'ok' });
    expect(calls).to.equal(3);
  });

  it('reports timeout when condition never met', async () => {
    const result = await waitFor(async () => null, { timeoutMs: 50, intervalMs: 10 });
    expect(result).to.have.property('timedOut', true);
  });

  it('treats transient errors as not-yet', async () => {
    let calls = 0;
    const result = await waitFor(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error('NoSuchElement');
        return 'found';
      },
      {
        timeoutMs: 500,
        intervalMs: 10,
        isTransientError: (e) => /NoSuchElement/.test(e.message),
      },
    );
    expect(result).to.deep.equal({ value: 'found' });
  });

  it('rethrows non-transient errors', async () => {
    let threw = false;
    try {
      await waitFor(
        async () => {
          throw new Error('boom');
        },
        {
          timeoutMs: 500,
          intervalMs: 10,
          isTransientError: () => false,
        },
      );
    } catch (e: any) {
      threw = true;
      expect(e.message).to.equal('boom');
    }
    expect(threw).to.equal(true);
  });

  it('runs at least once even with timeoutMs=0', async () => {
    let calls = 0;
    const result = await waitFor(
      async () => {
        calls += 1;
        return 'ok';
      },
      { timeoutMs: 0, intervalMs: 10 },
    );
    expect(calls).to.equal(1);
    expect(result).to.deep.equal({ value: 'ok' });
  });
});
