import { expect } from 'chai';
import {
  IosAppLines,
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

  // Lines as an iPhone 14 Plus (iOS 26.5) printed them during a session on
  // Settings (com.apple.Preferences), pid 8429.
  describe('IosAppLines', () => {
    const at = (proc: string, text: string, level = 'Notice') =>
      `Oct  5 23:48:33 Rabindras-iPhone ${proc} <${level}>: ${text}`;
    const ANNOUNCE = at(
      'runningboardd(RunningBoard)[34]',
      'Acquiring assertion targeting [app<com.apple.Preferences(FEEDEEEE-DDDD)>:8429] from originator [osservice<com.apple.SpringBoard>:36947]',
    );
    // Written by the app's own code: no library, or the app's own binary.
    const APP = at('Preferences[8429]', 'loading content for context');
    const DAEMON = at('duetexpertd(DuetExpertCenter)[412]', 'Updating predictions');
    const keeps = (f: IosAppLines, m: string) => f.keeps(m, iosLineLevel(m));

    it("keeps the app's own lines, the app manager's lines about it and faults, and leaves the rest", () => {
      const f = new IosAppLines('com.apple.Preferences');

      expect(keeps(f, ANNOUNCE), 'the app manager names the app').to.equal(true);
      expect(keeps(f, APP), "the app's own code").to.equal(true);
      expect(
        keeps(f, at('Preferences(Preferences)[8429]', 'opened a pane')),
        'its own binary',
      ).to.equal(true);
      expect(keeps(f, DAEMON), 'daemon chatter').to.equal(false);
      expect(
        keeps(f, at('wifid(WiFiPolicy)[61]', 'link quality dropped', 'Fault')),
        'a fault',
      ).to.equal(true);
      expect(
        keeps(f, at('trustd(Security)[127]', 'SecKeyVerifySignature failed', 'Error')),
      ).to.equal(false);
    });

    // Measured on Edge: 8,839 lines from its process, 5 of them its own code.
    it("leaves out the frameworks' ordinary lines inside the app, and keeps their errors", () => {
      const f = new IosAppLines('com.apple.Preferences');
      f.learn(ANNOUNCE);

      expect(
        keeps(f, at('Preferences(UIKitCore)[8429]', 'Ending task with identifier 43')),
      ).to.equal(false);
      expect(keeps(f, at('Preferences(CFNetwork)[8429]', 'Task finished', 'Error'))).to.equal(true);
      expect(keeps(f, at('Preferences(WebKit)[8429]', 'WebContent crashed', 'Fault'))).to.equal(
        true,
      );
    });

    it('keeps a crash report or a memory kill that names the app by its executable', () => {
      const f = new IosAppLines('com.apple.Preferences');
      f.learn(ANNOUNCE);
      f.learn(APP);

      expect(
        keeps(
          f,
          at('ReportCrash[9001]', 'Formulating fatal 309 report for corpse[8429] Preferences'),
        ),
      ).to.equal(true);
      expect(
        keeps(f, at('ReportCrash[9001]', 'Saved crash report for Preferences[8429]')),
      ).to.equal(true);
      expect(
        keeps(
          f,
          'Oct  5 23:48:40 Rabindras-iPhone kernel[0] <Notice>: memorystatus: killing pid 8429 [Preferences]',
        ),
      ).to.equal(true);
      // A relaunch: a new pid, the same executable.
      expect(keeps(f, at('Preferences[8447]', 'scene connected'))).to.equal(true);
    });

    it("leaves out the daemons that only repeat the app's state", () => {
      const f = new IosAppLines('com.apple.Preferences');
      f.learn(ANNOUNCE);

      for (const line of [
        at(
          'CommCenter(RunningBoardServices)[100]',
          'Received state update for 8429 (app<com.apple.Preferences(FEEDEEEE)>, running-active-NotVisible',
        ),
        at('mobileassetd(MobileAssetDaemon)[120]', 'com.apple.Preferences issued query command'),
      ]) {
        expect(keeps(f, line), line).to.equal(false);
      }
      expect(
        keeps(f, at('SpringBoard(FrontBoard)[36947]', 'Application com.apple.Preferences exited')),
      ).to.equal(true);
    });

    it('lets a line with no header follow the line before it', () => {
      const f = new IosAppLines('com.apple.Preferences');
      expect(keeps(f, ANNOUNCE)).to.equal(true);
      expect(keeps(f, '    AssetLocale = "en_IN";')).to.equal(true);
      expect(keeps(f, DAEMON)).to.equal(false);
      expect(keeps(f, '    AssetLocale = "en_IN";')).to.equal(false);
    });

    it("reads a simulator's compact lines the same way", () => {
      const f = new IosAppLines('com.example.shop');
      const sim = (proc: string, text: string, type = 'Df') =>
        `2026-10-05 20:31:40.123 ${type} ${proc} ${text}`;

      expect(
        keeps(
          f,
          sim('runningboardd[90:1200]', 'Acquiring assertion [app<com.example.shop(UUID)>:4127]'),
        ),
      ).to.equal(true);
      expect(keeps(f, sim('Shop[4127:8812]', '(Shop) launched'))).to.equal(true);
      expect(keeps(f, sim('Shop[4127:8812]', '(UIKitCore) scene active'))).to.equal(false);
      expect(keeps(f, sim('Shop[4127:8812]', '(CFNetwork) task failed', 'E'))).to.equal(true);
      expect(keeps(f, sim('locationd[77:300]', 'region update'))).to.equal(false);
      expect(keeps(f, sim('Shop[4127:8812]', 'Terminating app', 'F'))).to.equal(true);
    });

    it("doesn't take a bundle id's dots as any character", () => {
      const f = new IosAppLines('com.example.shop');
      f.learn(
        'Oct  5 23:48:33 iPhone runningboardd[34] <Notice>: [app<comXexampleXshop(UUID)>:5555]',
      );
      expect(keeps(f, 'Oct  5 23:48:33 iPhone Other[5555] <Notice>: hello')).to.equal(false);
    });
  });
});
