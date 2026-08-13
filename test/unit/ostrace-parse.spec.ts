import { expect } from 'chai';
import { parseOstraceLine } from '../../src/services/logcat/ostraceParse';
import { resolveLogSource } from '../../src/services/logcat/logSource';

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
