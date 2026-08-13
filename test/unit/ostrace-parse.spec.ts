import { expect } from 'chai';
import { parseOstraceLine } from '../../src/services/logcat/ostraceParse';
import { resolveLogSource } from '../../src/services/logcat/logSource';
import { appIdForProcess, parseInstalledApps } from '../../src/device-managers/ios/iosAppIds';
import { iosLevelsToLetters } from '../../src/services/logcat/ostraceParse';
import {
  DEFAULT_LEVELS,
  levelsCovered,
  widenLevels,
} from '../../src/device-managers/ios/IOSLogStreamService';

/**
 * Verbatim from `go-ios ostrace` against an iPhone 14 on iOS 26.5.2.
 *
 * os_trace_relay is the transport Xcode's console reads and the only one
 * carrying Debug — the older `syslog` emits Notice and Error only, which is
 * why it is not the source here.
 */
const DEBUG_LINE = JSON.stringify({
  pid: 396,
  timestamp: '2026-08-13T07:39:31.406821+05:30',
  level: 2,
  levelName: 'Debug',
  threadId: 654586,
  imageName:
    '/System/Library/PrivateFrameworks/DVTInstrumentsFoundation.framework/DVTInstrumentsFoundation',
  imageOffset: 189168,
  filename: '/System/Developer/usr/libexec/testmanagerd',
  message: 'Data Size: 0, Rows Sent: 0, Stack depth: 60',
  label: { subsystem: 'com.apple.dt.xctest', category: 'Default' },
});

describe('parseOstraceLine', () => {
  it('reads a real Debug record', () => {
    const r = parseOstraceLine(DEBUG_LINE)!;
    expect(r.pid).to.equal(396);
    expect(r.tid).to.equal(654586);
    expect(r.level).to.equal('D');
    expect(r.message).to.equal('Data Size: 0, Rows Sent: 0, Stack depth: 60');
  });

  it('takes the timestamp at its stated offset, with no year to infer', () => {
    // The Android parser has to guess a year from `MM-DD` and gets the host
    // timezone involved; os_trace carries a full ISO 8601 instant, so this is
    // exact wherever the server runs.
    const r = parseOstraceLine(DEBUG_LINE)!;
    expect(r.ts).to.equal(Date.parse('2026-08-13T07:39:31.406821+05:30'));
  });

  it('tags on the subsystem, which is what Xcode groups by', () => {
    expect(parseOstraceLine(DEBUG_LINE)!.tag).to.equal('com.apple.dt.xctest');
  });

  it('falls back to the logging image when a record carries no subsystem', () => {
    const noLabel = JSON.parse(DEBUG_LINE);
    delete noLabel.label;
    expect(parseOstraceLine(JSON.stringify(noLabel))!.tag).to.equal('DVTInstrumentsFoundation');
  });

  it('reports the process so `package:` selects one app', () => {
    // This is what "app-specific logs" means here: the existing filter term
    // matches on it, and ostrace can narrow to it at the source.
    expect(parseOstraceLine(DEBUG_LINE)!.pkg).to.equal('testmanagerd');
  });

  it('maps os_log levels onto the set the UI already speaks', () => {
    const at = (levelName: string) =>
      parseOstraceLine(JSON.stringify({ ...JSON.parse(DEBUG_LINE), levelName }))!.level;
    expect(at('Debug')).to.equal('D');
    expect(at('Info')).to.equal('I');
    // No Android peer for os_log's normal priority. Folded into I rather than
    // promoted to W, because rendering an ordinary message as a warning is a
    // lie the colour scheme would then repeat.
    expect(at('Default')).to.equal('I');
    expect(at('Error')).to.equal('E');
    expect(at('Fault')).to.equal('F');
    expect(at('SomethingNew')).to.equal('I');
  });

  it('returns null for anything that is not a record', () => {
    // go-ios writes progress and warnings to the same stream, and a malformed
    // line must not take the session down.
    ['', '   ', 'connecting to device…', '{not json', '{}'].forEach((l) =>
      expect(parseOstraceLine(l), l).to.equal(null),
    );
  });

  it('survives a record with fields missing', () => {
    const r = parseOstraceLine(
      JSON.stringify({ timestamp: '2026-08-13T07:39:31Z', levelName: 'Error' }),
    )!;
    expect(r.pid).to.equal(0);
    expect(r.level).to.equal('E');
    expect(r.message).to.equal('');
    expect(r.pkg).to.equal(undefined);
  });
});

describe('resolveLogSource', () => {
  it('sends Android to logcat and iOS to ostrace', () => {
    expect(resolveLogSource('android')).to.equal('logcat');
    expect(resolveLogSource('ios')).to.equal('ostrace');
    expect(resolveLogSource('iOS')).to.equal('ostrace');
  });

  it('refuses a platform with no transport instead of guessing', () => {
    // An empty pane reads as a broken feature; "unsupported" reads as a
    // missing one, which is the truth.
    expect(resolveLogSource('tvos')).to.equal('unsupported');
    expect(resolveLogSource(undefined)).to.equal('unsupported');
  });
});

/**
 * An os_trace record names the binary that logged, never the app it belongs
 * to. Android has no such gap — a process name there IS the package name, so
 * `package:com.google.android.gms` already filters by app id (verified on a
 * Galaxy S9). Translating the executable back to its bundle id is what makes
 * one filter grammar mean the same thing on both platforms.
 */
describe('iOS app id attribution', () => {
  // Verbatim shape from `ios apps` against an iPhone 14.
  const APPS = JSON.stringify([
    {
      CFBundleExecutable: 'Food Truck',
      CFBundleIdentifier: 'com.example.apple-samplecode.Food-TruckJM7967FMBS',
    },
    {
      CFBundleExecutable: 'WebDriverAgentRunner-Runner',
      CFBundleIdentifier: 'com.qasecret.WebDriverAgentRunner.xctrunner',
    },
  ]);

  it('maps an executable to its bundle id', () => {
    const m = parseInstalledApps(APPS);
    expect(m.get('Food Truck')).to.equal('com.example.apple-samplecode.Food-TruckJM7967FMBS');
    expect(m.size).to.equal(2);
  });

  it('reports an app by its app id', () => {
    const m = parseInstalledApps(APPS);
    expect(appIdForProcess('Food Truck', m)).to.equal(
      'com.example.apple-samplecode.Food-TruckJM7967FMBS',
    );
  });

  it('leaves a daemon as itself, exactly as Android leaves surfaceflinger', () => {
    const m = parseInstalledApps(APPS);
    expect(appIdForProcess('backboardd', m)).to.equal('backboardd');
    expect(appIdForProcess(undefined, m)).to.equal(undefined);
  });

  it('degrades to executable names when the device cannot list apps', () => {
    // This runs at stream start; a listing failure must not take the log
    // stream down, it must only cost the translation.
    ['', 'not json', '{}', '[]', 'null'].forEach((bad) => {
      const m = parseInstalledApps(bad);
      expect(m.size, bad).to.equal(0);
      expect(appIdForProcess('Food Truck', m), bad).to.equal('Food Truck');
    });
  });

  it('ignores a half-populated entry rather than mapping to undefined', () => {
    const m = parseInstalledApps(
      JSON.stringify([{ CFBundleExecutable: 'Ghost' }, { CFBundleIdentifier: 'com.no.exe' }]),
    );
    expect(m.size).to.equal(0);
    expect(appIdForProcess('Ghost', m)).to.equal('Ghost');
  });

  it('keeps the first mapping when two apps share an executable name', () => {
    // Nothing here can tell them apart from a name, and silently switching
    // which one a filter means is worse than picking one and staying put.
    const m = parseInstalledApps(
      JSON.stringify([
        { CFBundleExecutable: 'Dup', CFBundleIdentifier: 'com.first' },
        { CFBundleExecutable: 'Dup', CFBundleIdentifier: 'com.second' },
      ]),
    );
    expect(m.get('Dup')).to.equal('com.first');
  });
});

/**
 * os_trace_relay serves ONE consumer. Measured against an iPhone 14: three
 * concurrent `ostrace` processes left every one of them silent — including a
 * capture started fresh from a shell — and killing them restored 2,223 lines
 * in 10s immediately. A second child is not a second view of the logs, it is
 * the end of the first.
 *
 * So one child per device, emitting a superset, and each socket narrows what
 * it is sent. These are the two halves of that: what the child must emit, and
 * what a socket may keep.
 */
describe('sharing one os_trace child between viewers', () => {
  it('keeps the running child when it already covers the request', () => {
    expect(levelsCovered(['Info', 'Default', 'Error', 'Fault'], ['Info', 'Error'])).to.equal(true);
  });

  it('does not consider Debug covered by the default set', () => {
    // The case that must respawn: Debug is exactly what the default omits.
    expect(levelsCovered(DEFAULT_LEVELS, ['Debug'])).to.equal(false);
  });

  it('widens to the union, never the intersection', () => {
    // A viewer wanting less is served by filtering downstream; a viewer
    // wanting more cannot be served by a child never told to emit it.
    const widened = widenLevels(DEFAULT_LEVELS, ['Debug']);
    expect(widened).to.include('Debug');
    DEFAULT_LEVELS.forEach((l) => expect(widened).to.include(l));
  });

  it('does not duplicate levels when widening twice', () => {
    const once = widenLevels(DEFAULT_LEVELS, ['Debug']);
    expect(widenLevels(once, ['Debug'])).to.deep.equal(once);
  });

  it('translates a viewer request back to the letters records carry', () => {
    const letters = iosLevelsToLetters(['Debug', 'Error']);
    expect([...letters].sort()).to.deep.equal(['D', 'E']);
  });

  it('admits both Info and Default for either, since both map to I', () => {
    // The honest consequence of refusing to render an ordinary message as a
    // warning: the two are indistinguishable once mapped.
    expect([...iosLevelsToLetters(['Info'])]).to.deep.equal(['I']);
    expect([...iosLevelsToLetters(['Default'])]).to.deep.equal(['I']);
  });

  it('ignores a level name it does not know rather than admitting everything', () => {
    expect(iosLevelsToLetters(['Nonsense']).size).to.equal(0);
  });
});
