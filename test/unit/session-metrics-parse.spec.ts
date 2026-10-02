import { expect } from 'chai';
import {
  AndroidReading,
  androidSample,
  androidSampleCommand,
  appPackageOf,
  isSafePackage,
  parseAndroidReading,
  parseForegroundPackage,
} from '../../src/services/metrics/androidMetrics';
import { parseSysmontapCpu } from '../../src/services/metrics/iosMetrics';

/**
 * Recorded on the S9+ (Android 10) with the command androidSampleCommand
 * builds; the second reading is the first plus 1000 jiffies, 800 of them
 * idle, and 50 for the app.
 */
const FIRST = [
  'cpu  4842746 1486246 9435122 410569805 191176 0 106298 0 0 0',
  'MemTotal:        5755748 kB',
  'MemAvailable:    2839168 kB',
  'pid=1404',
  'stat=211391 93546',
  'VmRSS:\t  334480 kB',
].join('\n');
const SECOND = [
  'cpu  4842846 1486246 9435222 410570595 191186 0 106298 0 0 0',
  'MemTotal:        5755748 kB',
  'MemAvailable:    2838144 kB',
  'pid=1404',
  'stat=211421 93566',
  'VmRSS:\t  335504 kB',
].join('\n');

/** A reading the test knows is readable. */
function read(out: string): AndroidReading {
  const r = parseAndroidReading(out);
  if (!r) throw new Error('unreadable sample');
  return r;
}

describe('session metrics: Android readings', () => {
  it('reads device CPU jiffies, memory, and the app process', () => {
    expect(parseAndroidReading(FIRST)).to.deep.equal({
      cpuTotal: 4842746 + 1486246 + 9435122 + 410569805 + 191176 + 0 + 106298 + 0,
      cpuIdle: 410569805 + 191176,
      memTotalKb: 5755748,
      memAvailableKb: 2839168,
      pid: 1404,
      appJiffies: 211391 + 93546,
      appRssKb: 334480,
    });
  });

  it('reads a device with no app process as device figures only', () => {
    const out = [FIRST.split('\n')[0], FIRST.split('\n')[1], FIRST.split('\n')[2], 'pid='].join(
      '\n',
    );
    expect(parseAndroidReading(out)).to.include({ pid: null, appJiffies: null, appRssKb: null });
  });

  it('reads output with CRLF line ends', () => {
    expect(parseAndroidReading(FIRST.replace(/\n/g, '\r\n'))).to.include({
      pid: 1404,
      appRssKb: 334480,
    });
  });

  it('gives up on output without the cpu line', () => {
    expect(parseAndroidReading('MemTotal: 5755748 kB')).to.equal(null);
  });

  it('records no CPU on the first sample, only memory', () => {
    const s = androidSample(null, read(FIRST), 'com.android.systemui', 1000);
    expect(s).to.deep.equal({
      at: 1000,
      deviceCpuPct: null,
      deviceMemMb: 2848.2,
      deviceMemTotalMb: 5620.8,
      appCpuPct: null,
      appMemMb: 326.6,
      appId: 'com.android.systemui',
    });
  });

  it('turns two readings into device and app CPU as shares of the whole device', () => {
    const s = androidSample(parseAndroidReading(FIRST), read(SECOND), 'com.android.systemui', 3000);
    expect(s.deviceCpuPct).to.equal(20);
    expect(s.appCpuPct).to.equal(5);
    expect(s.appMemMb).to.equal(327.6);
  });

  it('records no app CPU, not a spike, when the app restarted between samples', () => {
    const restarted = SECOND.replace('pid=1404', 'pid=2210').replace(
      'stat=211421 93566',
      'stat=12 8',
    );
    const s = androidSample(
      parseAndroidReading(FIRST),
      read(restarted),
      'com.android.systemui',
      3000,
    );
    expect(s.appCpuPct).to.equal(null);
    expect(s.deviceCpuPct).to.equal(20);
    expect(s.appMemMb).to.equal(327.6);
  });

  it('names no app when the app has no process', () => {
    const none = [SECOND.split('\n')[0], SECOND.split('\n')[1], SECOND.split('\n')[2], 'pid='].join(
      '\n',
    );
    const s = androidSample(parseAndroidReading(FIRST), read(none), 'com.acme.shop', 3000);
    expect(s).to.include({ appId: null, appCpuPct: null, appMemMb: null, deviceCpuPct: 20 });
  });
});

describe('session metrics: Android package names', () => {
  it('accepts package names and nothing else', () => {
    for (const ok of ['com.acme.shop', 'com.sec.android.app.launcher', 'io.x_y.App2']) {
      expect(isSafePackage(ok), ok).to.equal(true);
    }
    for (const bad of [
      '',
      'shop',
      'com.acme;reboot',
      '$(id).x',
      'com.acme shop',
      'com..x',
      '1com.x',
      undefined,
      42,
    ]) {
      expect(isSafePackage(bad), String(bad)).to.equal(false);
    }
  });

  it("reads a session's appPackage from either capability spelling", () => {
    expect(appPackageOf({ 'appium:appPackage': 'com.a.b' })).to.equal('com.a.b');
    expect(appPackageOf({ appPackage: 'com.c.d' })).to.equal('com.c.d');
    expect(appPackageOf({})).to.equal(undefined);
    expect(appPackageOf(undefined)).to.equal(undefined);
  });

  it('builds a device-only command with no package, and refuses anything but a package', () => {
    expect(androidSampleCommand(null)).to.not.include('pidof');
    expect(androidSampleCommand('com.acme.shop')).to.include('pidof com.acme.shop');
    expect(() => androidSampleCommand('com.acme;reboot')).to.throw(/not a package name/);
  });

  it('reads the foreground app from dumpsys, before and after Android 10', () => {
    expect(
      parseForegroundPackage(
        '    mResumedActivity: ActivityRecord{c51fd83 u0 com.sec.android.app.launcher/.activities.LauncherActivity t2}',
      ),
    ).to.equal('com.sec.android.app.launcher');
    expect(
      parseForegroundPackage(
        '  topResumedActivity=ActivityRecord{a1b2c3 u0 com.acme.shop/.MainActivity t12}',
      ),
    ).to.equal('com.acme.shop');
    expect(parseForegroundPackage('nothing resumed')).to.equal(null);
  });
});

describe('session metrics: iPhone sysmontap lines', () => {
  it('reads device CPU, the load divided over the cores', () => {
    const line =
      '{"time":"2026-10-02T11:56:46.322036+05:30","level":"INFO","msg":"received CPU usage data","cpu_count":6,"enabled_cpus":6,"end_time":1301586447413,"cpu_total_load":77.48226950354608}';
    expect(parseSysmontapCpu(line)).to.equal(12.9);
  });

  it('reads nothing from other lines', () => {
    expect(parseSysmontapCpu('{"level":"WARN","msg":"go-ios agent is not running."}')).to.equal(
      null,
    );
    expect(parseSysmontapCpu('not json')).to.equal(null);
  });

  it('never reports more than 100%', () => {
    expect(parseSysmontapCpu('{"enabled_cpus":2,"cpu_total_load":450}')).to.equal(100);
  });
});
