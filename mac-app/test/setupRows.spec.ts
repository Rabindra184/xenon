import { describe, expect, it } from 'vitest';
import {
  announceCheck,
  announcerStart,
  announcerStep,
  checkedAgo,
  checksSummary,
  setupBlockers,
  setupRows,
  shownSentence,
  type SetupRow
} from '../src/renderer/src/setupRows';
import { SETUP } from '../src/renderer/src/copy/setup';
import { findJargon } from './e2e/jargon';
import { makeDefaultProfile } from '../src/shared/profileDefaults';
import type { CheckCode, PreflightResult, Profile, ToolCheck } from '../src/shared/types';

// Setup's rows: one plain sentence for every check. The table below is the
// spec's, word for word (typographic apostrophes and the em dash included), so
// the sentences are written out here rather than read from the copy file.

const profile = (platform: unknown = 'both', iosDeviceType?: unknown): Profile => {
  const p = makeDefaultProfile({ id: 'p1', now: 0, name: 'Local server' });
  const settings = { ...p.settings };
  if (platform === undefined) delete settings.platform;
  else settings.platform = platform;
  if (iosDeviceType !== undefined) settings.iosDeviceType = iosDeviceType;
  return { ...p, settings };
};

const tool = (id: string, label: string, code: CheckCode | undefined, over: Partial<ToolCheck> = {}): ToolCheck => ({
  id,
  label,
  status: 'ok',
  detail: `${id} detail`,
  blocking: false,
  ...(code === undefined ? {} : { code }),
  ...over
});

const NODE_OK = tool('node', 'Node.js', 'ok', { detail: 'v22.12.0' });
const NODE_MISSING = tool('node', 'Node.js', 'missing', {
  status: 'missing',
  detail: 'node not found on PATH',
  blocking: true,
  remediation: 'Install Node.js — Appium 3.x needs ^20.19 || ^22.12 || >=24 (e.g. via Homebrew: brew install node@22).'
});
const NODE_WRONG = tool('node', 'Node.js', 'unsupported', {
  status: 'warn',
  detail: 'v23.1.0',
  blocking: true,
  remediation: 'Appium 3.x requires Node ^20.19 || ^22.12 || >=24 (even-numbered LTS lines).'
});

const APPIUM_OK = tool('appium', 'Appium', 'ok', { detail: '3.1.1' });
const APPIUM_MISSING = tool('appium', 'Appium', 'missing', {
  status: 'missing',
  detail: 'appium not found on PATH',
  blocking: true,
  remediation: 'Install Appium 3: npm i -g appium'
});
const APPIUM_OLD = tool('appium', 'Appium', 'unsupported', {
  status: 'warn',
  detail: '3.0.9',
  blocking: true,
  remediation: 'Xenon needs Appium 3.1.1 or newer.'
});

const drivers = (found: string, code: CheckCode = 'ok'): ToolCheck =>
  tool('drivers', 'Appium drivers', code, {
    detail: `installed: ${found}`,
    remediation: 'Install the platform drivers you need: appium driver install uiautomator2 (Android) / xcuitest (iOS).'
  });
const DRIVERS_BOTH = drivers('uiautomator2, xcuitest');
const DRIVERS_LIST_FAILED = tool('drivers', 'Appium drivers', 'list-failed', {
  status: 'warn',
  detail: 'could not list drivers',
  remediation: 'Install drivers: appium driver install uiautomator2 && appium driver install xcuitest'
});
const DRIVERS_NO_APPIUM = tool('drivers', 'Appium drivers', 'missing', {
  status: 'missing',
  detail: 'appium not available'
});

const ADB_OK = tool('adb', 'Android SDK (adb)', 'ok', { detail: 'Android Debug Bridge version 1.0.41 — ANDROID_HOME=/sdk' });
const ADB_MISSING = tool('adb', 'Android SDK (adb)', 'missing', {
  status: 'warn',
  detail: 'adb not found and no Android SDK detected',
  remediation: 'Only needed for local Android devices. Install the Android SDK (Android Studio).'
});
const ADB_NO_ROOT = tool('adb', 'Android SDK (adb)', 'no-sdk-root', {
  status: 'warn',
  detail: 'Android Debug Bridge version 1.0.41 — but no SDK root could be resolved',
  remediation: 'adb is on PATH but its SDK root is unknown. Set ANDROID_HOME in this profile’s environment variables.'
});

const XCODE_OK = tool('xcode', 'Xcode', 'ok', { detail: 'Xcode 16.0' });
const XCODE_MISSING = tool('xcode', 'Xcode', 'missing', {
  status: 'warn',
  detail: 'xcodebuild not found',
  remediation: 'Only needed for iOS. Install Xcode and run xcode-select --install.'
});

const GO_OK = tool('go-ios', 'iPhone support', 'ok', { detail: 'Ready for iPhones (go-ios v1.2.1)' });
const GO_MISSING = tool('go-ios', 'iPhone support', 'missing', {
  status: 'warn',
  detail: 'Not installed yet',
  remediation: "iPhones won't work until setup finishes. Run Set up again."
});
const GO_STALE = tool('go-ios', 'iPhone support', 'stale', {
  status: 'warn',
  detail: 'go-ios v1.0.134, Xenon expects v1.2.1',
  remediation: 'Xenon was updated. Run Set up again to update iPhone support.'
});
const GO_NOT_NEEDED = tool('go-ios', 'iPhone support', 'not-needed', {
  detail: 'Not needed for Android-only profiles.'
});

/** Everything fine, with `over` replacing the check of the same id (or adding it). */
const result = (...over: ToolCheck[]): PreflightResult => {
  const base = [NODE_OK, APPIUM_OK, DRIVERS_BOTH, ADB_OK, XCODE_OK, GO_OK];
  const checks = base.map((c) => over.find((o) => o.id === c.id) ?? c);
  return { ok: true, checks, blockers: [] };
};

const row = (rows: SetupRow[], id: string): SetupRow => {
  const found = rows.find((r) => r.id === id);
  if (found === undefined) throw new Error(`no row "${id}" in ${rows.map((r) => r.id).join(', ')}`);
  return found;
};

type Action = SetupRow['action'];
const SETUP_ACTION: Action = { kind: 'setup' };
const RECHECK: Action = { kind: 'recheck' };
const INSTALL: Action = { kind: 'link', link: 'install' };

interface Case {
  name: string;
  r: PreflightResult;
  id: string;
  group: SetupRow['group'];
  label: string;
  tone: SetupRow['tone'];
  sentence: string;
  action?: Action;
  command?: string;
  /** The check whose detail and remediation the row carries in its technical details. */
  from: ToolCheck;
}

const TABLE: Case[] = [
  {
    name: 'Node.js ok',
    r: result(NODE_OK),
    id: 'node',
    group: 'mac',
    label: 'Node.js',
    tone: 'ok',
    sentence: 'Node.js is ready.',
    from: NODE_OK
  },
  {
    name: 'Node.js missing',
    r: result(NODE_MISSING),
    id: 'node',
    group: 'mac',
    label: 'Node.js',
    tone: 'attention',
    sentence: 'Node.js isn’t installed on this Mac. Appium needs it.',
    action: INSTALL,
    command: 'brew install node@22',
    from: NODE_MISSING
  },
  {
    name: 'Node.js unsupported',
    r: result(NODE_WRONG),
    id: 'node',
    group: 'mac',
    label: 'Node.js',
    tone: 'attention',
    sentence: 'This Mac’s Node.js version doesn’t work with Appium 3.',
    action: INSTALL,
    command: 'brew install node@22',
    from: NODE_WRONG
  },
  {
    name: 'Appium ok',
    r: result(APPIUM_OK),
    id: 'appium',
    group: 'mac',
    label: 'Appium',
    tone: 'ok',
    sentence: 'Appium is ready.',
    from: APPIUM_OK
  },
  {
    name: 'Appium missing',
    r: result(APPIUM_MISSING),
    id: 'appium',
    group: 'mac',
    label: 'Appium',
    tone: 'attention',
    sentence: 'Appium isn’t installed on this Mac. Xenon needs Appium 3.1.1 or newer.',
    action: INSTALL,
    command: 'npm i -g appium',
    from: APPIUM_MISSING
  },
  {
    name: 'Appium unsupported',
    r: result(APPIUM_OLD),
    id: 'appium',
    group: 'mac',
    label: 'Appium',
    tone: 'attention',
    sentence: 'This Mac’s Appium is too old. Xenon needs Appium 3.1.1 or newer.',
    action: INSTALL,
    command: 'npm i -g appium@latest',
    from: APPIUM_OLD
  },
  {
    name: 'Android tools ok',
    r: result(ADB_OK),
    id: 'android-tools',
    group: 'mac',
    label: 'Android tools',
    tone: 'ok',
    sentence: 'Android tools are ready.',
    from: ADB_OK
  },
  {
    name: 'Android tools missing',
    r: result(ADB_MISSING),
    id: 'android-tools',
    group: 'mac',
    label: 'Android tools',
    tone: 'attention',
    sentence: 'Android tools aren’t installed. You need them only for Android phones on this Mac.',
    action: INSTALL,
    from: ADB_MISSING
  },
  {
    name: 'Android tools no-sdk-root',
    r: result(ADB_NO_ROOT),
    id: 'android-tools',
    group: 'mac',
    label: 'Android tools',
    tone: 'attention',
    sentence: 'Android tools were found, but not where Xenon looks for them.',
    action: INSTALL,
    from: ADB_NO_ROOT
  },
  {
    name: 'Xcode ok',
    r: result(XCODE_OK),
    id: 'xcode',
    group: 'mac',
    label: 'Xcode',
    tone: 'ok',
    sentence: 'Xcode is ready.',
    from: XCODE_OK
  },
  {
    name: 'Xcode missing',
    r: result(XCODE_MISSING),
    id: 'xcode',
    group: 'mac',
    label: 'Xcode',
    tone: 'attention',
    sentence: 'Xcode isn’t installed. You need it only for iPhones and simulators.',
    action: INSTALL,
    command: 'xcode-select --install',
    from: XCODE_MISSING
  },
  {
    name: 'Android support installed',
    r: result(drivers('uiautomator2')),
    id: 'android-support',
    group: 'phones',
    label: 'Android support',
    tone: 'ok',
    sentence: 'Android support is installed.',
    from: drivers('uiautomator2')
  },
  {
    name: 'Android support missing',
    r: result(drivers('xcuitest')),
    id: 'android-support',
    group: 'phones',
    label: 'Android support',
    tone: 'attention',
    sentence: 'Android support isn’t installed yet.',
    action: SETUP_ACTION,
    command: 'appium driver install uiautomator2',
    from: drivers('xcuitest')
  },
  {
    name: 'iOS support installed',
    r: result(drivers('xcuitest')),
    id: 'ios-support',
    group: 'phones',
    label: 'iOS support',
    tone: 'ok',
    sentence: 'iOS support is installed.',
    from: drivers('xcuitest')
  },
  {
    name: 'iOS support missing',
    r: result(drivers('uiautomator2')),
    id: 'ios-support',
    group: 'phones',
    label: 'iOS support',
    tone: 'attention',
    sentence: 'iOS support isn’t installed yet.',
    action: SETUP_ACTION,
    command: 'appium driver install xcuitest',
    from: drivers('uiautomator2')
  },
  {
    name: 'Android support, nothing installed',
    r: result(drivers('none')),
    id: 'android-support',
    group: 'phones',
    label: 'Android support',
    tone: 'attention',
    sentence: 'Android support isn’t installed yet.',
    action: SETUP_ACTION,
    command: 'appium driver install uiautomator2',
    from: drivers('none')
  },
  {
    name: 'iOS support, nothing installed',
    r: result(drivers('none')),
    id: 'ios-support',
    group: 'phones',
    label: 'iOS support',
    tone: 'attention',
    sentence: 'iOS support isn’t installed yet.',
    action: SETUP_ACTION,
    command: 'appium driver install xcuitest',
    from: drivers('none')
  },
  {
    name: 'Android support, list failed',
    r: result(DRIVERS_LIST_FAILED),
    id: 'android-support',
    group: 'phones',
    label: 'Android support',
    tone: 'attention',
    sentence: 'Couldn’t check which phone support is installed.',
    action: RECHECK,
    from: DRIVERS_LIST_FAILED
  },
  {
    name: 'iOS support, list failed',
    r: result(DRIVERS_LIST_FAILED),
    id: 'ios-support',
    group: 'phones',
    label: 'iOS support',
    tone: 'attention',
    sentence: 'Couldn’t check which phone support is installed.',
    action: RECHECK,
    from: DRIVERS_LIST_FAILED
  },
  {
    name: 'Android support, Appium missing',
    r: result(DRIVERS_NO_APPIUM),
    id: 'android-support',
    group: 'phones',
    label: 'Android support',
    tone: 'info',
    sentence: 'Needs Appium first.',
    from: DRIVERS_NO_APPIUM
  },
  {
    name: 'iOS support, Appium missing',
    r: result(DRIVERS_NO_APPIUM),
    id: 'ios-support',
    group: 'phones',
    label: 'iOS support',
    tone: 'info',
    sentence: 'Needs Appium first.',
    from: DRIVERS_NO_APPIUM
  },
  {
    name: 'iPhone support ok',
    r: result(GO_OK),
    id: 'iphone-support',
    group: 'phones',
    label: 'iPhone support',
    tone: 'ok',
    sentence: 'iPhone support is ready.',
    from: GO_OK
  },
  {
    name: 'iPhone support missing',
    r: result(GO_MISSING),
    id: 'iphone-support',
    group: 'phones',
    label: 'iPhone support',
    tone: 'attention',
    sentence: 'iPhone support isn’t installed yet.',
    action: SETUP_ACTION,
    from: GO_MISSING
  },
  {
    name: 'iPhone support stale',
    r: result(GO_STALE),
    id: 'iphone-support',
    group: 'phones',
    label: 'iPhone support',
    tone: 'attention',
    sentence: 'iPhone support needs updating — Xenon was updated.',
    action: SETUP_ACTION,
    from: GO_STALE
  }
];

describe('setupRows: the table, one row per outcome', () => {
  it.each(TABLE)('$name', (c) => {
    const found = row(setupRows(c.r, profile('both'), '1.11.2'), c.id);
    expect(found.group).toBe(c.group);
    expect(found.label).toBe(c.label);
    expect(found.tone).toBe(c.tone);
    expect(found.sentence).toBe(c.sentence);
    expect(found.action).toEqual(c.action);
    expect(found.technical.command).toBe(c.command);
    expect(found.technical.detail).toBe(c.from.detail);
    // A row with nothing to do has no fix to show, even when its check carries one (the drivers check).
    expect(found.technical.remediation).toBe(c.tone === 'ok' ? undefined : c.from.remediation);
  });

  it('is exactly the row of the interface and nothing more, whatever the outcome', () => {
    for (const c of TABLE) {
      const found = row(setupRows(c.r, profile('both'), '1.11.2'), c.id);
      expect(Object.keys(found).sort()).toEqual(
        ['group', 'id', 'label', 'sentence', 'technical', 'tone', ...(c.action === undefined ? [] : ['action'])].sort()
      );
      expect(Object.keys(found.technical).every((k) => ['detail', 'command', 'remediation'].includes(k))).toBe(true);
    }
    for (const v of ['1.11.2', null, undefined] as const) {
      const found = row(setupRows(result(), profile('both'), v), 'xenon');
      expect(Object.keys(found).every((k) => ['id', 'group', 'label', 'tone', 'sentence', 'action', 'technical'].includes(k))).toBe(true);
    }
  });

  it('gives an action only to the rows that have one, and a command only where the table has one', () => {
    for (const c of TABLE) {
      const found = row(setupRows(c.r, profile('both'), '1.11.2'), c.id);
      expect('action' in found).toBe(c.action !== undefined);
      expect('command' in found.technical).toBe(c.command !== undefined);
    }
  });

  it('says the Node.js and Appium sentences Home says (R24)', () => {
    const rows = setupRows(result(NODE_MISSING), profile(), '1.0.0');
    expect(row(rows, 'node').sentence).toBe(SETUP.node.missing);
    expect(row(setupRows(result(NODE_WRONG), profile(), '1.0.0'), 'node').sentence).toBe(SETUP.node.wrongVersion);
    expect(row(setupRows(result(APPIUM_MISSING), profile(), '1.0.0'), 'appium').sentence).toBe(SETUP.appium.missing);
    expect(row(setupRows(result(APPIUM_OLD), profile(), '1.0.0'), 'appium').sentence).toBe(SETUP.appium.tooOld);
  });
});

describe('setupRows: the Xenon row', () => {
  const xenon = (v: string | null | undefined) => row(setupRows(result(), profile(), v), 'xenon');

  it('says the version when it is installed', () => {
    const r = xenon('1.11.2');
    expect(r).toMatchObject({
      group: 'xenon',
      label: 'Xenon',
      tone: 'ok',
      sentence: 'Xenon 1.11.2 is installed'
    });
    expect(r.action).toBeUndefined();
  });

  it('asks for Set up when it is not installed', () => {
    const r = xenon(null);
    expect(r).toMatchObject({ tone: 'attention', sentence: 'Xenon isn’t installed yet', action: { kind: 'setup' } });
  });

  it('says it is checking while the version is still being read, and claims neither', () => {
    const r = xenon(undefined);
    expect(r).toMatchObject({ tone: 'info', sentence: 'Checking Xenon…' });
    expect(r.action).toBeUndefined();
  });

  // The bug the old footer had: `installed ?? meta.pluginVersion` named the version baked into the
  // app bundle whenever the live read was empty, so a Mac with no plugin read `plugin 1.11.2`.
  it('never names a version it does not have', () => {
    expect(xenon(null).sentence).not.toMatch(/\d+\.\d+\.\d+/);
    expect(xenon(undefined).sentence).not.toMatch(/\d+\.\d+\.\d+/);
  });

  it('has technical details in each of the three states', () => {
    for (const v of ['1.11.2', null, undefined] as const) {
      expect(xenon(v).technical.detail).not.toBe('');
    }
    expect(xenon('1.11.2').technical.detail).toContain('1.11.2');
  });
});

describe('setupRows: the phone support rows follow the drivers check (R25)', () => {
  const both = (checks: ToolCheck[]) => {
    const rows = setupRows(
      { ok: true, checks: [NODE_OK, APPIUM_OK, ...checks], blockers: [] },
      profile('both'),
      '1.0.0'
    );
    return { android: row(rows, 'android-support'), ios: row(rows, 'ios-support') };
  };

  it('reads which drivers are installed from the detail', () => {
    const r = both([drivers('uiautomator2, xcuitest')]);
    expect([r.android.tone, r.ios.tone]).toEqual(['ok', 'ok']);
  });

  it('reads the list without caring about case', () => {
    const r = both([{ ...DRIVERS_BOTH, detail: 'Installed: UIAutomator2, XCUITest' }]);
    expect([r.android.tone, r.ios.tone]).toEqual(['ok', 'ok']);
  });

  it('never says "isn’t installed yet" for a list that failed or an Appium that is missing', () => {
    for (const d of [DRIVERS_LIST_FAILED, DRIVERS_NO_APPIUM]) {
      const r = both([d]);
      for (const x of [r.android, r.ios]) expect(x.sentence).not.toContain('installed yet');
    }
  });

  it('treats a detail that is not an "installed: …" list as unknown, whatever the code says', () => {
    const r = both([{ ...DRIVERS_BOTH, detail: 'could not list drivers' }]);
    for (const x of [r.android, r.ios]) {
      expect(x.sentence).toBe('Couldn’t check which phone support is installed.');
      expect(x.action).toEqual({ kind: 'recheck' });
    }
  });

  it('treats a drivers check with no code the same way, from its detail', () => {
    const noCode: ToolCheck = { ...DRIVERS_LIST_FAILED };
    delete noCode.code;
    expect(both([noCode]).android.sentence).toBe('Couldn’t check which phone support is installed.');
    const noCodeOk: ToolCheck = { ...DRIVERS_BOTH };
    delete noCodeOk.code;
    expect(both([noCodeOk]).android.tone).toBe('ok');
  });

  it('does not know which phone support is installed when there is no drivers check at all', () => {
    const r = both([]);
    for (const x of [r.android, r.ios]) {
      expect(x.sentence).toBe('Couldn’t check which phone support is installed.');
      expect(x.tone).toBe('attention');
      expect(x.technical.detail).toBe('');
    }
  });

  it('carries the drivers check’s own words in both rows’ technical details', () => {
    const r = both([DRIVERS_LIST_FAILED]);
    for (const x of [r.android, r.ios]) {
      expect(x.technical.detail).toBe('could not list drivers');
      expect(x.technical.remediation).toBe(DRIVERS_LIST_FAILED.remediation);
    }
  });
});

describe('setupRows: only the phones the profile uses', () => {
  const ids = (p: Profile) => setupRows(result(), p, '1.0.0').map((r) => r.id);

  it('lists everything, in the order of the screen, for both kinds of phone', () => {
    expect(ids(profile('both'))).toEqual([
      'node',
      'appium',
      'android-tools',
      'xcode',
      'xenon',
      'android-support',
      'ios-support',
      'iphone-support'
    ]);
  });

  it('gives an Android profile no Xcode, iOS or iPhone row', () => {
    expect(ids(profile('android'))).toEqual(['node', 'appium', 'android-tools', 'xenon', 'android-support']);
  });

  it('gives an iOS profile no Android row', () => {
    expect(ids(profile('ios'))).toEqual(['node', 'appium', 'xcode', 'xenon', 'ios-support', 'iphone-support']);
  });

  it('reads an unset or unknown platform as both, as Xenon does', () => {
    expect(ids(profile(undefined))).toEqual(ids(profile('both')));
    expect(ids(profile('windows'))).toEqual(ids(profile('both')));
  });

  it('gives no iPhone row when only simulators are used', () => {
    expect(ids(profile('ios', 'simulated'))).toEqual(['node', 'appium', 'xcode', 'xenon', 'ios-support']);
    expect(ids(profile('both', 'simulated'))).not.toContain('iphone-support');
    expect(ids(profile('both', 'simulated'))).toContain('ios-support');
  });

  it('keeps the iPhone row for real phones, for both kinds, and when the kind is unset', () => {
    expect(ids(profile('ios', 'real'))).toContain('iphone-support');
    expect(ids(profile('ios', 'both'))).toContain('iphone-support');
    expect(ids(profile('ios'))).toContain('iphone-support');
  });

  it('ignores the iOS device kind on an Android profile', () => {
    expect(ids(profile('android', 'real'))).toEqual(ids(profile('android')));
  });

  it('groups the rows: This Mac, Xenon, Phones', () => {
    const groups = setupRows(result(), profile('both'), '1.0.0').map((r) => [r.id, r.group]);
    expect(groups).toEqual([
      ['node', 'mac'],
      ['appium', 'mac'],
      ['android-tools', 'mac'],
      ['xcode', 'mac'],
      ['xenon', 'xenon'],
      ['android-support', 'phones'],
      ['ios-support', 'phones'],
      ['iphone-support', 'phones']
    ]);
  });

  it('has no iPhone row when the check says it is not needed, since it would have nothing true to say', () => {
    // The check ran for an Android-only profile; the profile has since changed and a new check is on its way.
    expect(setupRows(result(GO_NOT_NEEDED), profile('both'), '1.0.0').map((r) => r.id)).not.toContain(
      'iphone-support'
    );
  });

  it('skips a row whose check is not in the answer', () => {
    const r: PreflightResult = { ok: true, checks: [NODE_OK], blockers: [] };
    expect(setupRows(r, profile('both'), '1.0.0').map((x) => x.id)).toEqual([
      'node',
      'xenon',
      'android-support',
      'ios-support'
    ]);
  });

  it('gives every row an id of its own', () => {
    const all = ids(profile('both'));
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('setupRows: a check without a code', () => {
  const noCode = (c: ToolCheck): ToolCheck => {
    const copy = { ...c };
    delete copy.code;
    return copy;
  };

  it('is read from its status, so an older answer still gets a sentence', () => {
    const rows = (c: ToolCheck) => setupRows(result(noCode(c)), profile('both'), '1.0.0');
    expect(row(rows(NODE_OK), 'node').tone).toBe('ok');
    expect(row(rows(NODE_MISSING), 'node').sentence).toBe('Node.js isn’t installed on this Mac. Appium needs it.');
    expect(row(rows(NODE_WRONG), 'node').sentence).toBe('This Mac’s Node.js version doesn’t work with Appium 3.');
    expect(row(rows(APPIUM_OLD), 'appium').sentence).toBe(
      'This Mac’s Appium is too old. Xenon needs Appium 3.1.1 or newer.'
    );
    expect(row(rows(ADB_MISSING), 'android-tools').sentence).toBe(
      'Android tools aren’t installed. You need them only for Android phones on this Mac.'
    );
    expect(row(rows(GO_MISSING), 'iphone-support').sentence).toBe('iPhone support isn’t installed yet.');
  });
});

describe('setupRows: technical details', () => {
  it('leaves remediation out when the check has none', () => {
    const found = row(setupRows(result(), profile(), '1.0.0'), 'node');
    expect('remediation' in found.technical).toBe(false);
  });

  it('gives a row that is ok no remediation, though its check has one', () => {
    // One drivers check with one fix behind two rows: the installed one must not say how to install.
    expect(DRIVERS_BOTH.remediation).toBeDefined();
    const rows = setupRows(result(drivers('uiautomator2')), profile('both'), '1.0.0');
    const android = row(rows, 'android-support');
    const ios = row(rows, 'ios-support');
    expect(android.tone).toBe('ok');
    expect('remediation' in android.technical).toBe(false);
    expect(android.technical.detail).toBe('installed: uiautomator2');
    expect(ios.tone).toBe('attention');
    expect(ios.technical.remediation).toBe(DRIVERS_BOTH.remediation);
  });

  it('gives no ok row any remediation, whatever the answer', () => {
    for (const c of TABLE) {
      for (const p of [profile('both'), profile('android'), profile('ios')]) {
        for (const r of setupRows(c.r, p, '1.11.2')) {
          if (r.tone === 'ok') expect('remediation' in r.technical, `${c.name}: ${r.id}`).toBe(false);
        }
      }
    }
  });

  it('keeps the command and the check’s raw words out of every sentence and label', () => {
    // Every outcome in the table, plus a version, at each profile shape.
    const words: string[] = [];
    for (const c of TABLE) {
      for (const p of [profile('both'), profile('android'), profile('ios')]) {
        for (const r of setupRows(c.r, p, '1.11.2')) words.push(r.label, r.sentence);
      }
    }
    for (const v of ['1.11.2', null, undefined] as const) {
      for (const r of setupRows(result(), profile(), v)) words.push(r.label, r.sentence);
    }
    expect(words.length).toBeGreaterThan(100);
    // The camel-case option keys that could leak into a sentence.
    const keys = ['iosDeviceType', 'androidDeviceType', 'bootedSimulators', 'bootedEmulators', 'maxSessions'];
    expect(findJargon(words.join('\n'), keys)).toEqual([]);
  });

  it('would catch a command or a path in a sentence (the check itself works)', () => {
    expect(findJargon('Run brew install node@22', [])).not.toEqual([]);
    expect(findJargon('Set ANDROID_HOME', [])).not.toEqual([]);
  });
});

describe('checkedAgo', () => {
  const NOW = 1_700_000_000_000;
  const SECOND = 1000;
  const MINUTE = 60 * SECOND;
  const HOUR = 60 * MINUTE;

  it.each([
    ['0 s', 0, 'Checked just now.'],
    ['59 s', 59 * SECOND, 'Checked just now.'],
    ['60 s', 60 * SECOND, 'Checked 1 minute ago.'],
    ['119 s', 119 * SECOND, 'Checked 1 minute ago.'],
    ['2 min', 2 * MINUTE, 'Checked 2 minutes ago.'],
    ['5 min', 5 * MINUTE, 'Checked 5 minutes ago.'],
    ['59 min', 59 * MINUTE + 59 * SECOND, 'Checked 59 minutes ago.'],
    ['1 h', HOUR, 'Checked 1 hour ago.'],
    ['1 h 59 min', HOUR + 59 * MINUTE, 'Checked 1 hour ago.'],
    ['2 h', 2 * HOUR, 'Checked 2 hours ago.'],
    ['30 h', 30 * HOUR, 'Checked 30 hours ago.']
  ])('%s ago -> %s', (_name, ago, expected) => {
    expect(checkedAgo(NOW - ago, NOW)).toBe(expected);
  });

  it('says just now for a clock that went backwards or a time that is not a number', () => {
    expect(checkedAgo(NOW + 5 * MINUTE, NOW)).toBe('Checked just now.');
    expect(checkedAgo(Number.NaN, NOW)).toBe('Checked just now.');
    expect(checkedAgo(NOW, Number.NaN)).toBe('Checked just now.');
  });
});

const PORT_TAKEN = 'Port 4723 is already in use by another app. Choose another port or close that app.';
const NOT_INSTALLED = "Run Set up first. Xenon isn't installed in the Appium folder this profile uses.";
const CHECK_FAILED = "Couldn't check whether this Mac is ready. Press Check again on Setup.";

describe('setupBlockers: why Start is off, as Setup lists it', () => {
  const answer = (blockers: string[]): PreflightResult => ({ ...result(), ok: blockers.length === 0, blockers });

  it('lists the blockers main gives, in its own plain words', () => {
    expect(setupBlockers(answer([PORT_TAKEN, NOT_INSTALLED]), 4723)).toEqual([PORT_TAKEN, NOT_INSTALLED]);
    expect(setupBlockers(answer([CHECK_FAILED]), 4723)).toEqual([CHECK_FAILED]);
  });

  it('leaves out a port in use that is not the profile’s port: that answer is from before the port changed', () => {
    expect(setupBlockers(answer([PORT_TAKEN, NOT_INSTALLED]), 4800)).toEqual([NOT_INSTALLED]);
  });

  it('never lists a check’s own fix, which names commands: the rows say those in plain words', () => {
    const r: PreflightResult = { ok: false, checks: [NODE_OK, APPIUM_MISSING], blockers: [] };
    expect(setupBlockers(r, 4723)).toEqual([]);
  });

  it('lists nothing before anything has been checked, or for a check that passed', () => {
    expect(setupBlockers(null, 4723)).toEqual([]);
    expect(setupBlockers(answer([]), 4723)).toEqual([]);
  });

  it('is in plain words', () => {
    expect(findJargon([PORT_TAKEN, NOT_INSTALLED, CHECK_FAILED].join('\n'), [])).toEqual([]);
  });
});

describe('checksSummary: what Setup announces when a check completes', () => {
  it('says every check passed when no row needs attention and nothing blocks', () => {
    expect(checksSummary(setupRows(result(), profile(), '1.0.0'), [])).toBe('All checks passed.');
  });

  it('counts the rows that need attention, one or more', () => {
    expect(checksSummary(setupRows(result(ADB_MISSING), profile(), '1.0.0'), [])).toBe('1 thing needs attention.');
    expect(checksSummary(setupRows(result(ADB_MISSING, XCODE_MISSING), profile(), '1.0.0'), [])).toBe(
      '2 things need attention.'
    );
  });

  it('does not count a row that is only a note (Xenon still being read, support that needs Appium first)', () => {
    expect(checksSummary(setupRows(result(), profile(), undefined), [])).toBe('All checks passed.');
    const rows = setupRows(result(APPIUM_MISSING, DRIVERS_NO_APPIUM), profile('android'), '1.0.0');
    expect(row(rows, 'android-support').tone).toBe('info');
    expect(checksSummary(rows, [])).toBe('1 thing needs attention.');
  });

  it('counts a blocker with no row of its own, such as the port', () => {
    expect(checksSummary(setupRows(result(), profile(), '1.0.0'), [PORT_TAKEN])).toBe('1 thing needs attention.');
    expect(checksSummary(setupRows(result(ADB_MISSING), profile(), '1.0.0'), [PORT_TAKEN])).toBe(
      '2 things need attention.'
    );
  });

  it('counts Xenon not installed once, though its row and a blocker both say so', () => {
    const rows = setupRows(result(), profile(), null);
    expect(checksSummary(rows, [NOT_INSTALLED])).toBe('1 thing needs attention.');
    // With the version read as installed, the blocker is the only one to say it, so it counts.
    expect(checksSummary(setupRows(result(), profile(), '1.0.0'), [NOT_INSTALLED])).toBe('1 thing needs attention.');
  });
});

describe('announceCheck: whether Setup says the summary', () => {
  it('says it when the person asked for the check, even when it is the same as before', () => {
    expect(announceCheck('All checks passed.', 'All checks passed.', true)).toBe('All checks passed.');
  });

  it('says it when it changed, asked or not', () => {
    expect(announceCheck('All checks passed.', '1 thing needs attention.', false)).toBe('1 thing needs attention.');
    expect(announceCheck(null, 'All checks passed.', false)).toBe('All checks passed.');
  });

  it('says nothing for a check nobody asked for that changed nothing (coming back to the window)', () => {
    expect(announceCheck('All checks passed.', 'All checks passed.', false)).toBeNull();
  });
});

describe('announcerStep: Setup speaks when a check’s answer is applied, and only then', () => {
  const ALL = 'All checks passed.';
  const TWO = '2 things need attention.';
  const ONE = '1 thing needs attention.';

  it('says nothing when Setup opens: what is on screen is not news', () => {
    const start = announcerStart('a', 3, ALL);
    expect(announcerStep(start, { profileId: 'a', answerId: 3, summary: ALL }).say).toBeNull();
  });

  it('says the summary when a new answer for the same profile is applied and it changed', () => {
    const start = announcerStart('a', 3, ALL);
    const step = announcerStep(start, { profileId: 'a', answerId: 4, summary: TWO });
    expect(step.say).toBe(TWO);
    expect(step.clear).toBe(false);
    // The same answer seen again (a render with nothing new) says nothing more.
    expect(announcerStep(step.state, { profileId: 'a', answerId: 4, summary: TWO }).say).toBeNull();
  });

  it('says nothing for a new answer that changed nothing nobody asked for, and says it when asked', () => {
    const start = announcerStart('a', 3, ALL);
    expect(announcerStep(start, { profileId: 'a', answerId: 4, summary: ALL }).say).toBeNull();
    expect(announcerStep({ ...start, asked: true }, { profileId: 'a', answerId: 4, summary: ALL }).say).toBe(ALL);
  });

  it('does not take a summary that changed with no new answer as one (the Xenon version read again)', () => {
    const start = announcerStart('a', 3, ALL);
    expect(announcerStep(start, { profileId: 'a', answerId: 3, summary: ONE }).say).toBeNull();
  });

  it('says nothing on a profile switch, which shows that profile’s last answer before its check is back, and empties', () => {
    const onB = announcerStep(announcerStart('b', 5, TWO), { profileId: 'b', answerId: 6, summary: ONE }).state;
    // Back to A: its cached answer (applied earlier, id 2) is on screen while its own check is held.
    const switched = announcerStep(onB, { profileId: 'a', answerId: 2, summary: TWO });
    expect(switched.say).toBeNull();
    expect(switched.clear).toBe(true);
    // No answer at all yet for a profile never checked: the same.
    expect(announcerStep(onB, { profileId: 'c', answerId: null, summary: null })).toMatchObject({ say: null, clear: true });
  });

  it('says nothing when the switched-to profile’s last answer shows up a moment after the switch', () => {
    // The order the window draws it in: the switch first (nothing known about A yet), then A's check
    // begins and A's last answer, applied before B's, shows while it runs.
    const onB = announcerStep(announcerStart('a', 2, TWO), { profileId: 'b', answerId: 6, summary: ONE }).state;
    const switched = announcerStep(onB, { profileId: 'a', answerId: null, summary: null });
    expect(switched.say).toBeNull();
    const cached = announcerStep(switched.state, { profileId: 'a', answerId: 2, summary: TWO });
    expect(cached.say).toBeNull();
    // A's own check comes back: said once.
    const answered = announcerStep(cached.state, { profileId: 'a', answerId: 7, summary: TWO });
    expect(answered.say).toBe(TWO);
    expect(announcerStep(answered.state, { profileId: 'a', answerId: 7, summary: TWO }).say).toBeNull();
  });

  it('says the switched-to profile’s first answer once, even when it matches the cached one', () => {
    const onB = announcerStart('b', 5, ONE);
    const switched = announcerStep(onB, { profileId: 'a', answerId: 2, summary: TWO }).state;
    const answered = announcerStep(switched, { profileId: 'a', answerId: 7, summary: TWO });
    expect(answered.say).toBe(TWO);
    expect(announcerStep(answered.state, { profileId: 'a', answerId: 7, summary: TWO }).say).toBeNull();
  });

  it('forgets a Check again asked on another profile', () => {
    const asked = { ...announcerStart('b', 5, ONE), asked: true };
    const switched = announcerStep(asked, { profileId: 'a', answerId: 2, summary: ALL }).state;
    expect(switched.asked).toBe(false);
  });

  it('says nothing while there is no answer to sum up', () => {
    const start = announcerStart('a', null, null);
    expect(announcerStep(start, { profileId: 'a', answerId: null, summary: null }).say).toBeNull();
    expect(announcerStep(start, { profileId: 'a', answerId: 1, summary: ALL }).say).toBe(ALL);
  });
});

describe('shownSentence: what a row says on screen', () => {
  it('is the sentence when it names what the row is about', () => {
    const rows = setupRows(result(ADB_MISSING), profile(), '2.17.0');
    expect(shownSentence(row(rows, 'node'))).toBe('Node.js is ready.');
    expect(shownSentence(row(rows, 'android-tools'))).toBe(
      'Android tools aren’t installed. You need them only for Android phones on this Mac.'
    );
    expect(shownSentence(row(rows, 'xenon'))).toBe('Xenon 2.17.0 is installed');
  });

  it('leads with the row’s name when the sentence does not say it, so two such rows can be told apart', () => {
    const failed = setupRows(result(DRIVERS_LIST_FAILED), profile('both'), '1.0.0');
    expect(shownSentence(row(failed, 'android-support'))).toBe(
      'Android support: Couldn’t check which phone support is installed.'
    );
    expect(shownSentence(row(failed, 'ios-support'))).toBe('iOS support: Couldn’t check which phone support is installed.');
    const noAppium = setupRows(result(APPIUM_MISSING, DRIVERS_NO_APPIUM), profile('both'), '1.0.0');
    expect(shownSentence(row(noAppium, 'android-support'))).toBe('Android support: Needs Appium first.');
  });

  it('is in plain words for every outcome', () => {
    const words = TABLE.flatMap((c) => setupRows(c.r, profile('both'), '1.11.2').map(shownSentence));
    expect(findJargon(words.join('\n'), [])).toEqual([]);
  });
});
