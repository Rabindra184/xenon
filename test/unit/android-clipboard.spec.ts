import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import AndroidDeviceManager from '../../src/device-managers/AndroidDeviceManager';
import { parseClipboardBroadcast } from '../../src/device-managers/android/clipboardBroadcast';
import { ClipboardUnsupportedError } from '../../src/device-managers/clipboardErrors';
import type { IDeviceManager } from '../../src/interfaces/IDeviceManager';

/**
 * Device control's clipboard on Android, measured 2026-09-26 on a Galaxy S9+
 * (Android 10, Appium Settings 8.0.5):
 *
 * - Appium Settings can only *read* the clipboard. Its code holds one
 *   clipboard action, io.appium.settings.clipboard.get. Our "set" broadcast
 *   reached that same receiver, which read the clipboard, answered result=-1,
 *   and the server reported success while nothing changed.
 * - The read works, but only while Appium Settings is the default input
 *   method (Android 10+ restricts clipboard reads to the IME). After an
 *   on-device Copy of "xenonread" it returned data="eGVub25yZWFk".
 * - Both methods swallowed every error, so the route always answered 200.
 */

const UDID = '381103b720057ece';
const ORIGINAL_IME = 'com.samsung.android.honeyboard/.service.HoneyBoardService';
const APPIUM_IME = 'io.appium.settings/.AppiumIME';

function fakeAdb(broadcast: string | Error) {
  const calls: string[][] = [];
  const adbExec = sinon.stub().callsFake(async (args: string[]) => {
    calls.push(args);
    const cmd = args.slice(2).join(' ');
    if (cmd === 'shell settings get secure default_input_method') return `${ORIGINAL_IME}\n`;
    if (cmd.startsWith('shell am broadcast')) {
      if (broadcast instanceof Error) throw broadcast;
      return broadcast;
    }
    return '';
  });
  return { adbInstance: { adbExec }, calls };
}

function managerWith(adb: { adbInstance: unknown } | { adbInstance: null }) {
  // The constructor starts device tracking; these tests need only the methods.
  const manager = Object.create(AndroidDeviceManager.prototype) as AndroidDeviceManager;
  (manager as any).getAdb = async () => adb;
  return manager;
}

const imeSets = (calls: string[][]) =>
  calls.filter((c) => c.slice(2, 5).join(' ') === 'shell ime set').map((c) => c[5]);

describe('Android clipboard', () => {
  afterEach(() => sinon.restore());

  describe('parseClipboardBroadcast', () => {
    it('decodes the base64 text Appium Settings returns', () => {
      expect(
        parseClipboardBroadcast(
          'Broadcasting: Intent { … }\nBroadcast completed: result=-1, data="eGVub25yZWFk"',
        ),
      ).to.equal('xenonread');
    });

    it('keeps non-ASCII text', () => {
      const data = Buffer.from('héllo · 世界').toString('base64');
      expect(parseClipboardBroadcast(`Broadcast completed: result=-1, data="${data}"`)).to.equal(
        'héllo · 世界',
      );
    });

    it('treats an empty answer as an empty clipboard', () => {
      expect(parseClipboardBroadcast('Broadcast completed: result=-1, data=""')).to.equal('');
    });

    // A missing receiver answers result=0 with no data; that used to read as
    // an empty clipboard.
    it('refuses an answer that is not a clipboard', () => {
      expect(() => parseClipboardBroadcast('Broadcast completed: result=0')).to.throw(
        /Appium Settings didn’t return the clipboard/,
      );
      expect(() => parseClipboardBroadcast('Broadcast completed: result=0, data="eA=="')).to.throw(
        /Appium Settings/,
      );
    });
  });

  describe('getClipboard', () => {
    it('reads it with the documented broadcast, as the Appium IME', async () => {
      const adb = fakeAdb('Broadcast completed: result=-1, data="eGVub25yZWFk"');
      expect(await managerWith(adb).getClipboard(UDID)).to.equal('xenonread');
      const broadcast = adb.calls.find((c) => c.includes('broadcast')) ?? [];
      expect(broadcast).to.include.members([
        '-n',
        'io.appium.settings/.receivers.ClipboardReceiver',
        '-a',
        'io.appium.settings.clipboard.get',
      ]);
      expect(imeSets(adb.calls)).to.deep.equal([APPIUM_IME, ORIGINAL_IME]);
    });

    it('says why when Appium Settings does not answer, and restores the keyboard', async () => {
      const adb = fakeAdb('Broadcast completed: result=0');
      let error: Error | undefined;
      try {
        await managerWith(adb).getClipboard(UDID);
      } catch (e) {
        error = e as Error;
      }
      expect(error?.message).to.match(/Appium Settings didn’t return the clipboard/);
      expect(imeSets(adb.calls)).to.deep.equal([APPIUM_IME, ORIGINAL_IME]);
    });

    it('does not swallow an adb failure', async () => {
      const adb = fakeAdb(new Error('device offline'));
      let error: Error | undefined;
      try {
        await managerWith(adb).getClipboard(UDID);
      } catch (e) {
        error = e as Error;
      }
      expect(error?.message).to.equal('device offline');
      expect(imeSets(adb.calls)).to.deep.equal([APPIUM_IME, ORIGINAL_IME]);
    });

    it('fails when adb is unavailable, instead of returning nothing', async () => {
      let error: Error | undefined;
      try {
        await managerWith({ adbInstance: null }).getClipboard(UDID);
      } catch (e) {
        error = e as Error;
      }
      expect(error?.message).to.equal('ADB is not available');
    });
  });

  describe('setClipboard', () => {
    it('refuses, since Appium Settings can only read the clipboard, and touches nothing', async () => {
      const adb = fakeAdb('Broadcast completed: result=-1, data=""');
      let error: Error | undefined;
      try {
        // Through the interface, as the control route calls it.
        const manager: IDeviceManager = managerWith(adb);
        await manager.setClipboard?.(UDID, 'xenon-clip-test');
      } catch (e) {
        error = e as Error;
      }
      expect(error).to.be.instanceOf(ClipboardUnsupportedError);
      expect(error?.message).to.match(/can only read/);
      expect(adb.calls).to.deep.equal([]);
    });
  });
});
