import { expect } from 'chai';
import sinon from 'sinon';
import { runMigrations } from '../../src/scripts/run-migrations';
import { config } from '../../src/config';
import log from '../../src/logger';

describe('runMigrations', () => {
  afterEach(() => sinon.restore());

  it('skips with an info log when XENON_AUTO_MIGRATE=false (autoMigrate=false)', async () => {
    const orig = config.autoMigrate;
    config.autoMigrate = false;
    const info = sinon.spy(log, 'info');
    try {
      // Should resolve without throwing — and without invoking the prisma
      // binary at all. We assert via the log line we know is fixed copy.
      await runMigrations();
      const calls = info.getCalls().map((c) => c.args.join(' '));
      expect(calls.some((m) => /Auto-migrate disabled/i.test(m))).to.be.true;
    } finally {
      config.autoMigrate = orig;
      info.restore();
    }
  });
});
