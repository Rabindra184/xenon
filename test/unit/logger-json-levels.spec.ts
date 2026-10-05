import { expect } from 'chai';
import sinon from 'sinon';
import { XenonLogger } from '../../src/logger';

/**
 * In JSON log mode every line was written through Appium's `info`, whatever
 * its level: a debug line printed at `--log-level info`, and an error went to
 * stdout, since Appium's console sends only its `error` level to stderr. Each
 * line now goes out at its own level, as in text mode.
 */
describe('XenonLogger in JSON mode writes each line at its own level', () => {
  let wasJson: boolean;
  let base: Record<'debug' | 'info' | 'warn' | 'error', sinon.SinonStub>;
  let logger: XenonLogger;

  beforeEach(() => {
    wasJson = XenonLogger.isJsonLogging;
    XenonLogger.configure({ enableJsonLogging: true });
    base = {
      debug: sinon.stub(),
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
    };
    logger = new XenonLogger('probe');
    (logger as any).baseLogger = base;
  });

  afterEach(() => {
    XenonLogger.configure({ enableJsonLogging: wasJson });
  });

  for (const level of ['debug', 'info', 'warn', 'error'] as const) {
    it(level, () => {
      logger[level](`a ${level} line`);

      const written = (Object.keys(base) as Array<keyof typeof base>).filter((l) => base[l].called);
      expect(written).to.deep.equal([level]);
      const entry = JSON.parse(base[level].firstCall.args[0]);
      expect(entry.level).to.equal(level);
      expect(entry.message).to.equal(`a ${level} line`);
    });
  }
});
