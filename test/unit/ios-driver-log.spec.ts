import { expect } from 'chai';
import {
  bufferedDriverLog,
  iosLineLevel,
  iosLineText,
  isDriverLog,
  recordFromDriverLog,
} from '../../src/services/logcat/iosDriverLog';
import type { LogcatRecord } from '../../src/services/logcat/logcatParse';

// The driver's own log class (test/helpers/driver-log.ts): an iPhone's and a
// simulator's `logs.syslog` extend it, so what Xenon reads is what the driver keeps.
import { TestDriverLog } from '../helpers/driver-log';

const IPHONE_ERROR =
  'Oct  5 20:31:40 iPhone SpringBoard(FrontBoard)[57] <Error>: Failed to launch com.example.shop';
const IPHONE_NOTICE = 'Oct  5 20:31:41 iPhone backboardd[61] <Notice>: touch began';
const SIM_FAULT =
  '2026-10-05 20:31:40.123 F  Shop[4127:8812] (UIKitCore) [com.apple.UIKit:Crash] Terminating app';
const SIM_DEFAULT = '2026-10-05 20:31:40.200 Df SpringBoard[1234:5678] (FrontBoard) launched';

describe('iosDriverLog', () => {
  describe('iosLineLevel', () => {
    it("reads an iPhone's syslog level", () => {
      expect(iosLineLevel(IPHONE_ERROR)).to.equal('E');
      expect(iosLineLevel(IPHONE_NOTICE)).to.equal('I');
      expect(iosLineLevel(IPHONE_ERROR.replace('<Error>', '<Fault>'))).to.equal('F');
      expect(iosLineLevel(IPHONE_ERROR.replace('<Error>', '<Warning>'))).to.equal('W');
    });

    it("reads a simulator's compact type", () => {
      expect(iosLineLevel(SIM_FAULT)).to.equal('F');
      expect(iosLineLevel(SIM_DEFAULT)).to.equal('I');
      expect(iosLineLevel(SIM_DEFAULT.replace(' Df ', ' E  '))).to.equal('E');
      expect(iosLineLevel(SIM_DEFAULT.replace(' Df ', ' Db '))).to.equal('D');
    });

    it('takes a line with no level of its own as I', () => {
      expect(iosLineLevel('\t0   Shop   0x0000000100abc123 main + 42')).to.equal('I');
    });
  });

  describe('recordFromDriverLog', () => {
    it('keeps the line as printed, at the time it reached the server', () => {
      const rec = recordFromDriverLog({
        timestamp: 1_791_000_000_123,
        level: 'ALL',
        message: IPHONE_ERROR,
      });

      expect(rec).to.include({ ts: 1_791_000_000_123, level: 'E', message: IPHONE_ERROR });
      expect(iosLineText(rec as LogcatRecord)).to.equal(IPHONE_ERROR);
    });

    it("drops what `log stream` prints before the simulator's first line", () => {
      for (const banner of [
        'Filtering the log data using "subsystem != \\"com.apple.CoreTelephony\\""',
        'Timestamp               Ty Process[PID:TID]',
      ]) {
        expect(recordFromDriverLog({ timestamp: 1, message: banner }), banner).to.equal(null);
      }
    });

    it("keeps a crash report's continuation lines, and drops empty ones", () => {
      expect(recordFromDriverLog({ timestamp: 1, message: '\tThread 0 Crashed:' })).to.not.equal(
        null,
      );
      expect(recordFromDriverLog({ timestamp: 1, message: '   ' })).to.equal(null);
      expect(recordFromDriverLog(undefined)).to.equal(null);
    });
  });

  describe("the driver's own log", () => {
    it('is something Xenon can listen to', () => {
      expect(isDriverLog(new TestDriverLog())).to.equal(true);
      expect(isDriverLog(undefined)).to.equal(false);
      expect(isDriverLog({ on() {} })).to.equal(false);
    });

    it('gives the lines it holds, oldest first, without taking them from the test', async () => {
      const driverLog = new TestDriverLog();
      driverLog.line('first');
      driverLog.line('second');
      driverLog.line('third');

      expect(bufferedDriverLog(driverLog).map((e) => e.message)).to.deep.equal([
        'first',
        'second',
        'third',
      ]);
      // A test's own `getLog('syslog')` still gets every line.
      const forTheTest = await driverLog.getLogs();
      expect(forTheTest.map((e: { message: string }) => e.message)).to.deep.equal([
        'first',
        'second',
        'third',
      ]);
    });

    it('gives nothing for a log of another shape', () => {
      expect(bufferedDriverLog({})).to.deep.equal([]);
      expect(bufferedDriverLog({ logs: { rvalues: () => [1] } })).to.deep.equal([]);
      expect(
        bufferedDriverLog({
          logs: { rvalues: () => [1] },
          _deserializeEntry: () => {
            throw new Error('changed');
          },
        }),
      ).to.deep.equal([]);
    });
  });
});
