import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ESSENTIALS,
  dashboardCanOverride,
  essentialsShows,
  hubOpenAfter,
  hubOpenFor,
  numberRowNote,
  rowSettingKey,
  schemaDefaults as defaultsOfSchema,
  visibleRows,
  type EssentialCtx,
  type EssentialRow
} from '../src/renderer/src/essentials';
import { SETTINGS } from '../src/renderer/src/copy/settings';
import { fromInput, toDisplay } from '../src/renderer/src/numberField';
import { validate } from '../src/renderer/src/validation';
import { makeDefaultProfile } from '../src/shared/profileDefaults';
import type { Profile, SecretKey, XenonSchema } from '../src/shared/types';
import { findJargon } from './e2e/jargon';

// The bundled schema: the descriptions dashboardCanOverride reads, and the
// property defaults the screen hands the catalog as `ctx.defaults`.
const schema = JSON.parse(
  readFileSync(resolve(__dirname, '..', 'resources', 'schema.json'), 'utf8')
) as XenonSchema;

const schemaDefaults: Record<string, unknown> = Object.fromEntries(
  Object.entries(schema.properties)
    .filter(([, property]) => property.default !== undefined)
    .map(([key, property]) => [key, property.default])
);

const ctx = (over: Partial<EssentialCtx> = {}): EssentialCtx => ({
  defaults: schemaDefaults,
  hubOpen: false,
  secretsSaved: {},
  ...over
});

/** A new profile with the given settings added (a value of undefined removes the setting). */
const profileWith = (settings: Record<string, unknown> = {}, over: Partial<Profile> = {}): Profile => {
  const base = makeDefaultProfile({ id: 'p', now: 0 });
  const merged: Record<string, unknown> = { ...base.settings, ...settings };
  for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];
  return { ...base, settings: merged, ...over };
};

/** A profile with none of the settings the catalog reads, so every row is unset. */
const bare = (settings: Record<string, unknown> = {}, over: Partial<Profile> = {}): Profile =>
  ({ ...profileWith({}, over), settings });

const row = (id: string): EssentialRow => {
  const found = ESSENTIALS.find((r) => r.id === id);
  if (!found) throw new Error(`no row ${id}`);
  return found;
};

const ids = (rows: readonly EssentialRow[]): string[] => rows.map((r) => r.id);

const IDS = [
  'platform',
  'androidDeviceType',
  'bootedEmulators',
  'iosDeviceType',
  'bootedSimulators',
  'maxSessions',
  'port',
  'deviceAvailabilityTimeoutMs',
  'enableDashboard',
  'buildCleanupDays',
  'signIn',
  'hub',
  'hubAddress',
  'hubAccessKey',
  'hubToken',
  'enableSelfHealing',
  'aiProvider',
  'geminiKey',
  'openaiKey',
  'anthropicKey',
  'aiBaseUrl'
];

/** Source text without its comments, for the checks that look for strings in a file. */
const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

describe('the catalog', () => {
  it('has the spec’s rows, in its order, once each', () => {
    expect(ids(ESSENTIALS)).toEqual(IDS);
  });

  it('puts the rows in the spec’s groups, in order', () => {
    const groups: string[] = [];
    for (const r of ESSENTIALS) if (groups[groups.length - 1] !== r.group) groups.push(r.group);
    expect(groups).toEqual(['Phones', 'Tests', 'Recording & history', 'Sharing & sign-in', 'AI help']);

    const groupOf = Object.fromEntries(ESSENTIALS.map((r) => [r.id, r.group]));
    expect(groupOf).toMatchObject({
      platform: 'Phones',
      bootedSimulators: 'Phones',
      maxSessions: 'Tests',
      deviceAvailabilityTimeoutMs: 'Tests',
      enableDashboard: 'Recording & history',
      buildCleanupDays: 'Recording & history',
      signIn: 'Sharing & sign-in',
      hubToken: 'Sharing & sign-in',
      enableSelfHealing: 'AI help',
      aiBaseUrl: 'AI help'
    });
  });

  it('says every row in the spec’s words', () => {
    expect(Object.fromEntries(ESSENTIALS.map((r) => [r.id, r.label]))).toEqual({
      platform: 'Which phones',
      androidDeviceType: 'Android',
      bootedEmulators: 'Only emulators that are already running',
      iosDeviceType: 'iPhone',
      bootedSimulators: 'Only simulators that are already running',
      maxSessions: 'Tests at the same time',
      port: 'Port tests connect to',
      deviceAvailabilityTimeoutMs: 'Wait for a free phone up to',
      enableDashboard: 'Keep a full record of each test',
      buildCleanupDays: 'Keep history for',
      signIn: 'Ask people to sign in',
      hub: 'Share this Mac’s phones with a lab hub',
      hubAddress: 'Hub address',
      hubAccessKey: 'Access key',
      hubToken: 'Token',
      enableSelfHealing: 'Repair broken element lookups automatically',
      aiProvider: 'AI service',
      geminiKey: 'Gemini key',
      openaiKey: 'OpenAI key',
      anthropicKey: 'Claude key',
      aiBaseUrl: 'Ollama address'
    });
  });

  it('gives only the record-of-each-test row a line of help', () => {
    // R49: Xenon records video either way, so the help names what the full record adds.
    expect(row('enableDashboard').help).toBe('steps, screenshots and logs, in the dashboard');
    expect(ESSENTIALS.filter((r) => r.help !== undefined).map((r) => r.id)).toEqual(['enableDashboard']);
  });

  it('names the option each row is about', () => {
    expect(Object.fromEntries(ESSENTIALS.map((r) => [r.id, r.optionKey]))).toEqual({
      platform: 'platform',
      androidDeviceType: 'androidDeviceType',
      bootedEmulators: 'bootedEmulators',
      iosDeviceType: 'iosDeviceType',
      bootedSimulators: 'bootedSimulators',
      maxSessions: 'maxSessions',
      port: 'server.port',
      deviceAvailabilityTimeoutMs: 'deviceAvailabilityTimeoutMs',
      enableDashboard: 'enableDashboard',
      buildCleanupDays: 'buildCleanupDays',
      signIn: 'authDisabled',
      hub: 'hub',
      hubAddress: 'hub',
      hubAccessKey: 'XENON_HUB_ACCESS_KEY',
      hubToken: 'XENON_HUB_TOKEN',
      enableSelfHealing: 'enableSelfHealing',
      aiProvider: 'aiProvider',
      geminiKey: 'XENON_GEMINI_API_KEY',
      openaiKey: 'XENON_OPENAI_API_KEY',
      anthropicKey: 'XENON_ANTHROPIC_API_KEY',
      aiBaseUrl: 'aiBaseUrl'
    });
  });

  it('uses the right control for each row', () => {
    const kinds = Object.fromEntries(ESSENTIALS.map((r) => [r.id, r.control.kind]));
    expect(kinds).toEqual({
      platform: 'segmented',
      androidDeviceType: 'segmented',
      bootedEmulators: 'switch',
      iosDeviceType: 'segmented',
      bootedSimulators: 'switch',
      maxSessions: 'number',
      port: 'number',
      deviceAvailabilityTimeoutMs: 'number',
      enableDashboard: 'switch',
      buildCleanupDays: 'number',
      signIn: 'switch',
      hub: 'switch',
      hubAddress: 'text',
      hubAccessKey: 'secret',
      hubToken: 'secret',
      enableSelfHealing: 'switch',
      aiProvider: 'segmented',
      geminiKey: 'secret',
      openaiKey: 'secret',
      anthropicKey: 'secret',
      aiBaseUrl: 'text'
    });
  });

  it('offers the segmented choices in the spec’s words', () => {
    expect(row('platform').control).toEqual({
      kind: 'segmented',
      options: [
        { value: 'android', label: 'Android' },
        { value: 'ios', label: 'iPhone' },
        { value: 'both', label: 'Both' }
      ]
    });
    expect(row('androidDeviceType').control).toEqual({
      kind: 'segmented',
      options: [
        { value: 'real', label: 'Real phones' },
        { value: 'simulated', label: 'Emulators' },
        { value: 'both', label: 'Both' }
      ]
    });
    expect(row('iosDeviceType').control).toEqual({
      kind: 'segmented',
      options: [
        { value: 'real', label: 'Real iPhones' },
        { value: 'simulated', label: 'Simulators' },
        { value: 'both', label: 'Both' }
      ]
    });
    expect(row('aiProvider').control).toEqual({
      kind: 'segmented',
      options: [
        { value: 'gemini', label: 'Gemini' },
        { value: 'openai', label: 'OpenAI' },
        { value: 'anthropic', label: 'Claude' },
        { value: 'ollama', label: 'Ollama' }
      ]
    });
  });

  it('bounds each number in the unit shown', () => {
    expect(row('maxSessions').control).toMatchObject({ kind: 'number', unit: 'plain', integer: true, min: 1, max: 99 });
    expect(row('port').control).toMatchObject({ kind: 'number', unit: 'plain', integer: true, min: 1, max: 65535 });
    expect(row('deviceAvailabilityTimeoutMs').control).toMatchObject({
      kind: 'number',
      unit: 'minutes-from-ms',
      min: 0.5,
      step: 0.5,
      suffix: 'min'
    });
    expect(row('buildCleanupDays').control).toMatchObject({
      kind: 'number',
      unit: 'days',
      integer: true,
      min: 1,
      suffix: 'days'
    });
  });

  it('points each secret row at its own Keychain secret', () => {
    const secrets = ESSENTIALS.flatMap((r) => (r.control.kind === 'secret' ? [[r.id, r.control.secret]] : []));
    expect(Object.fromEntries(secrets)).toEqual({
      hubAccessKey: 'XENON_HUB_ACCESS_KEY',
      hubToken: 'XENON_HUB_TOKEN',
      geminiKey: 'XENON_GEMINI_API_KEY',
      openaiKey: 'XENON_OPENAI_API_KEY',
      anthropicKey: 'XENON_ANTHROPIC_API_KEY'
    });
  });
});

describe('read and write', () => {
  /** Values to write into each row, then read back. Every row is listed, so a new row must be added here. */
  const SAMPLES: Record<string, unknown[]> = {
    platform: ['android', 'ios', 'both'],
    androidDeviceType: ['real', 'simulated', 'both'],
    bootedEmulators: [true, false],
    iosDeviceType: ['real', 'simulated', 'both'],
    bootedSimulators: [true, false],
    maxSessions: [1, 8, 99],
    port: [1, 4799, 65535],
    deviceAvailabilityTimeoutMs: [30000, 90000, 3600000],
    enableDashboard: [true, false],
    buildCleanupDays: [1, 30, 365],
    signIn: [true, false],
    enableSelfHealing: [true, false],
    aiProvider: ['gemini', 'openai', 'anthropic', 'ollama'],
    aiBaseUrl: ['http://localhost:11434', 'http://gateway.example:8080/v1']
  };

  it('writes a value that reads back the same, for every row with a plain value', () => {
    for (const r of ESSENTIALS) {
      const samples = SAMPLES[r.id];
      if (!samples) continue;
      for (const value of samples) {
        const written = r.write(profileWith(), value);
        expect(r.read(written, ctx()), `${r.id} = ${String(value)}`).toBe(value);
      }
    }
  });

  it('covers every row: plain ones above, the hub and secret rows below', () => {
    const special = new Set(['hub', 'hubAddress', 'hubAccessKey', 'hubToken', 'geminiKey', 'openaiKey', 'anthropicKey']);
    expect(ESSENTIALS.map((r) => r.id).filter((id) => !(id in SAMPLES) && !special.has(id))).toEqual([]);
  });

  it('writes one option and leaves every other part of the profile alone', () => {
    const before = profileWith({ maxSessions: 3, streaming: { androidH264: true } }, { secretRefs: ['XENON_HUB_TOKEN'], env: { A: 'b' } });
    for (const r of ESSENTIALS) {
      for (const value of SAMPLES[r.id] ?? [true]) {
        const frozen = deepFreeze(structuredClone(before));
        const after = r.write(frozen, value); // a frozen input throws if write mutates it
        expect(after.id).toBe(before.id);
        expect(after.name).toBe(before.name);
        expect(after.env).toEqual(before.env);
        expect(after.createdAt).toBe(before.createdAt);
        expect(after.updatedAt).toBe(before.updatedAt);
        expect(after.server.basePath).toBe(before.server.basePath);
        expect(after.settings.streaming).toEqual({ androidH264: true });
      }
    }
  });

  it('never writes when it reads', () => {
    const c = ctx({ secretsSaved: { XENON_GEMINI_API_KEY: true } });
    for (const p of [profileWith(), bare()]) {
      const frozen = deepFreeze(structuredClone(p));
      for (const r of ESSENTIALS) {
        r.read(frozen, c);
        r.when?.(frozen, c);
      }
      expect(frozen).toEqual(p);
    }
    visibleRows(deepFreeze(structuredClone(bare())), deepFreeze(structuredClone(ctx())));
  });

  describe('an unset option', () => {
    it('reads the default the context carries', () => {
      const p = bare();
      expect(row('maxSessions').read(p, ctx())).toBe(8);
      expect(row('deviceAvailabilityTimeoutMs').read(p, ctx())).toBe(300000);
      expect(row('buildCleanupDays').read(p, ctx())).toBe(30);
      expect(row('enableSelfHealing').read(p, ctx())).toBe(true);
      expect(row('enableDashboard').read(p, ctx())).toBe(false);
      expect(row('bootedEmulators').read(p, ctx())).toBe(false);
      expect(row('androidDeviceType').read(p, ctx())).toBe('both');
      expect(row('iosDeviceType').read(p, ctx())).toBe('both');
      expect(row('maxSessions').read(p, ctx({ defaults: { maxSessions: 4 } }))).toBe(4);
    });

    it('prefers the profile’s own value to the default', () => {
      expect(row('maxSessions').read(bare({ maxSessions: 2 }), ctx())).toBe(2);
      expect(row('enableSelfHealing').read(bare({ enableSelfHealing: false }), ctx())).toBe(false);
    });

    it('reads the default for a null, as a file may hold', () => {
      expect(row('maxSessions').read(bare({ maxSessions: null }), ctx())).toBe(8);
    });

    it('lets the platform fall back to both', () => {
      expect(row('platform').read(bare(), ctx({ defaults: {} }))).toBe('both');
      expect(row('platform').read(bare(), ctx())).toBe('both');
      expect(row('platform').read(bare({ platform: 'ios' }), ctx({ defaults: {} }))).toBe('ios');
    });

    it('reads the AI service as Gemini, Xenon’s own choice', () => {
      expect(row('aiProvider').read(bare(), ctx())).toBe('gemini');
      expect(row('aiProvider').read(bare({ aiProvider: 'ollama' }), ctx())).toBe('ollama');
    });

    it('reads an unset address as empty text', () => {
      expect(row('hubAddress').read(bare(), ctx())).toBe('');
      expect(row('aiBaseUrl').read(bare(), ctx())).toBe('');
    });
  });

  describe('a number', () => {
    it('deletes its key when written undefined, so the option goes back to its default', () => {
      for (const id of ['maxSessions', 'deviceAvailabilityTimeoutMs', 'buildCleanupDays']) {
        const set = row(id).write(bare(), 5);
        expect(Object.keys(set.settings), id).toEqual([row(id).optionKey]);
        const cleared = row(id).write(set, undefined);
        expect(Object.keys(cleared.settings), id).toEqual([]);
        expect(row(id).read(cleared, ctx()), id).toBe(schemaDefaults[id]);
      }
    });

    it('keeps the other settings when it deletes its key', () => {
      const cleared = row('maxSessions').write(bare({ maxSessions: 3, platform: 'ios' }), undefined);
      expect(cleared.settings).toEqual({ platform: 'ios' });
    });

    it('leaves the profile alone for anything that is not a number', () => {
      const p = bare({ maxSessions: 3 });
      for (const value of [Number.NaN, Number.POSITIVE_INFINITY, '5', {}, true]) {
        expect(row('maxSessions').write(p, value), String(value)).toEqual(p);
      }
    });

    it('keeps the port in the server section, not the settings', () => {
      const p = profileWith();
      const after = row('port').write(p, 4799);
      expect(after.server.port).toBe(4799);
      expect(after.settings).toEqual(p.settings);
      expect(row('port').read(after, ctx())).toBe(4799);
      expect(row('port').read(p, ctx())).toBe(4723);
    });

    it('leaves the stored port alone when emptied, as Part A does: the screen says "Port is required." and blocks Start', () => {
      const p = profileWith({}, { server: { ...profileWith().server, port: 4799 } });
      for (const emptied of [undefined, null]) {
        const after = row('port').write(p, emptied);
        expect(after, String(emptied)).toBe(p);
        expect(after.server.port).toBe(4799);
      }
    });

    it('leaves it alone for anything that is not a number', () => {
      const p = profileWith();
      for (const value of [Number.NaN, Number.POSITIVE_INFINITY, '4799', {}, true]) {
        expect(row('port').write(p, value), String(value)).toBe(p);
      }
    });
  });

  describe('Wait for a free phone up to', () => {
    const r = () => row('deviceAvailabilityTimeoutMs');
    const unit = () => {
      const c = r().control;
      if (c.kind !== 'number') throw new Error('not a number');
      return c;
    };

    it('reads the default, 300000, as 300000, and shows it as 5 minutes', () => {
      const value = r().read(bare(), ctx());
      expect(value).toBe(300000);
      expect(toDisplay(value as number, unit().unit)).toBe('5');
    });

    it('shows 100000 as 1.7 and leaves the stored value alone', () => {
      const p = bare({ deviceAvailabilityTimeoutMs: 100000 });
      const value = r().read(p, ctx());
      expect(value).toBe(100000);
      expect(toDisplay(value as number, unit().unit)).toBe('1.7');
      r().read(p, ctx());
      expect(p.settings.deviceAvailabilityTimeoutMs).toBe(100000);
    });

    it('stores typed minutes as milliseconds', () => {
      const parsed = fromInput('2.5', unit().unit, unit());
      expect(parsed).toEqual({ ok: true, value: 150000 });
      if (parsed.ok) expect(r().write(bare(), parsed.value).settings.deviceAvailabilityTimeoutMs).toBe(150000);
    });

    it('takes no less than half a minute: 0 would mean no wait, and a negative would purge every waiting request', () => {
      for (const text of ['0', '-1', '0.4']) {
        const parsed = fromInput(text, unit().unit, unit());
        expect(parsed, text).toEqual({ ok: false, error: 'Enter 0.5 or more.' });
        // The screen writes only a value that parsed, so the profile stays as it was.
        const p = bare();
        const after = parsed.ok ? r().write(p, parsed.value) : p;
        expect(after, text).toBe(p);
        expect('deviceAvailabilityTimeoutMs' in after.settings, text).toBe(false);
      }
      expect(fromInput('0.5', unit().unit, unit())).toEqual({ ok: true, value: 30000 });
    });

    it('goes back to the default when the box is emptied, not to 0', () => {
      const parsed = fromInput('', unit().unit, unit());
      expect(parsed).toEqual({ ok: true, value: undefined });
      if (!parsed.ok) throw new Error('unreachable');
      const p = r().write(bare({ deviceAvailabilityTimeoutMs: 100000 }), parsed.value);
      expect('deviceAvailabilityTimeoutMs' in p.settings).toBe(false);
      expect(r().read(p, ctx())).toBe(300000);
    });
  });

  describe('Ask people to sign in', () => {
    const r = () => row('signIn');

    it('reads on when sign-in is not disabled, and when the option is unset', () => {
      expect(r().read(bare(), ctx())).toBe(true);
      expect(r().read(bare({ authDisabled: false }), ctx())).toBe(true);
    });

    it('reads off when sign-in is disabled', () => {
      expect(r().read(bare({ authDisabled: true }), ctx())).toBe(false);
    });

    it('turns on by deleting authDisabled, and off by setting it', () => {
      const off = r().write(bare(), false);
      expect(off.settings.authDisabled).toBe(true);
      expect(r().read(off, ctx())).toBe(false);

      const on = r().write(off, true);
      expect('authDisabled' in on.settings).toBe(false);
      expect(r().read(on, ctx())).toBe(true);
    });

    it('does not read the schema default, which would be the other way round', () => {
      expect(r().read(bare(), ctx({ defaults: { authDisabled: true } }))).toBe(true);
    });
  });

  describe('Share this Mac’s phones with a lab hub', () => {
    const r = () => row('hub');
    const hubKeys: SecretKey[] = ['XENON_HUB_ACCESS_KEY', 'XENON_HUB_TOKEN'];

    it('reads off with no hub address and the switch not opened', () => {
      expect(r().read(bare(), ctx({ hubOpen: false }))).toBe(false);
    });

    it('reads on once the switch is opened, before an address is typed', () => {
      expect(r().read(bare(), ctx({ hubOpen: true }))).toBe(true);
    });

    it('reads on when a hub address is saved, whether or not the switch was opened', () => {
      expect(r().read(bare({ hub: 'http://hub-mac:4723' }), ctx({ hubOpen: false }))).toBe(true);
    });

    it('reads a saved empty address as off', () => {
      expect(r().read(bare({ hub: '' }), ctx({ hubOpen: false }))).toBe(false);
    });

    it('turning it on writes nothing: the profile comes back deep-equal', () => {
      const p = profileWith({}, { secretRefs: [...hubKeys] });
      const after = r().write(p, true);
      expect(after).toEqual(p);
      expect('hub' in after.settings).toBe(false);
    });

    it('never saves an empty hub address when turned on, off and on again', () => {
      const p = profileWith();
      const on1 = r().write(p, true);
      const off = r().write(on1, false);
      const on2 = r().write(off, true);
      for (const step of [on1, off, on2]) expect('hub' in step.settings).toBe(false);
      expect(JSON.stringify([on1, off, on2])).not.toContain('"hub"');
    });

    it('turning it off clears the address and keeps the keys the profile uses', () => {
      const p = profileWith({ hub: 'http://hub-mac:4723' }, { secretRefs: [...hubKeys, 'XENON_GEMINI_API_KEY'] });
      const after = r().write(p, false);
      expect('hub' in after.settings).toBe(false);
      expect(after.secretRefs).toEqual([...hubKeys, 'XENON_GEMINI_API_KEY']);
    });

    it('keeps its rows through an address edit only while the screen holds hubOpen, since emptying a saved address deletes it', () => {
      const saved = profileWith({ hub: 'http://hub-mac:4723' }, { secretRefs: [...hubKeys] });
      const emptied = row('hubAddress').write(saved, '');
      expect('hub' in emptied.settings).toBe(false);

      // hubOpen false (the screen forgot to set it): the switch reads off and the rows vanish mid-edit.
      expect(r().read(emptied, ctx({ hubOpen: false }))).toBe(false);
      const closed = ids(visibleRows(emptied, ctx({ hubOpen: false })));
      for (const id of ['hubAddress', 'hubAccessKey', 'hubToken']) expect(closed).not.toContain(id);

      // hubOpen true (set on load with a saved address, and on any address edit): the rows stay for the next address.
      expect(r().read(emptied, ctx({ hubOpen: true }))).toBe(true);
      const open = ids(visibleRows(emptied, ctx({ hubOpen: true })));
      for (const id of ['hubAddress', 'hubAccessKey', 'hubToken']) expect(open).toContain(id);

      // Emptying the address never touches the keys the profile uses.
      expect(emptied.secretRefs).toEqual([...hubKeys]);
    });

    it('reads off after being turned off, once the screen closes its switch', () => {
      const off = r().write(profileWith({ hub: 'http://hub-mac:4723' }), false);
      expect(r().read(off, ctx({ hubOpen: false }))).toBe(false);
    });
  });

  describe('Hub address', () => {
    const r = () => row('hubAddress');

    it('saves the address trimmed', () => {
      expect(r().write(bare(), '  http://hub-mac:4723  ').settings.hub).toBe('http://hub-mac:4723');
    });

    it('deletes the hub, never storing an empty string, when the box is emptied', () => {
      for (const empty of ['', '   ', '\t\n']) {
        const after = r().write(bare({ hub: 'http://hub-mac:4723' }), empty);
        expect('hub' in after.settings, JSON.stringify(empty)).toBe(false);
        expect(JSON.stringify(after)).not.toContain('"hub"');
      }
    });

    it('leaves the profile alone for anything that is not text', () => {
      const p = bare({ hub: 'http://hub-mac:4723' });
      for (const value of [undefined, null, 5, true]) expect(r().write(p, value)).toEqual(p);
    });

    it('is checked by Part A’s rule: the hub’s own address, with no path', () => {
      const issuesFor = (address: string) =>
        validate(schema, r().write(profileWith(), address)).filter((i) => i.path === 'hub');
      expect(issuesFor('http://hub-mac:4723')).toEqual([]);
      expect(issuesFor('')).toEqual([]);
      expect(issuesFor('http://hub-mac:4723/wd/hub')).toHaveLength(1);
      expect(issuesFor('hub-mac')).toHaveLength(1);
    });

    it('does not revalidate in the catalog: it saves what it is given', () => {
      expect(r().write(bare(), 'hub-mac').settings.hub).toBe('hub-mac');
    });
  });

  describe('Ollama address', () => {
    it('saves the address trimmed, and deletes the option when emptied', () => {
      const set = row('aiBaseUrl').write(bare(), ' http://localhost:11434 ');
      expect(set.settings.aiBaseUrl).toBe('http://localhost:11434');
      expect('aiBaseUrl' in row('aiBaseUrl').write(set, '  ').settings).toBe(false);
    });
  });

  describe('a key', () => {
    const KEY_ROWS: [string, SecretKey][] = [
      ['hubAccessKey', 'XENON_HUB_ACCESS_KEY'],
      ['hubToken', 'XENON_HUB_TOKEN'],
      ['geminiKey', 'XENON_GEMINI_API_KEY'],
      ['openaiKey', 'XENON_OPENAI_API_KEY'],
      ['anthropicKey', 'XENON_ANTHROPIC_API_KEY']
    ];

    it('reads whether it is saved and whether this profile uses it', () => {
      for (const [id, key] of KEY_ROWS) {
        expect(row(id).read(profileWith(), ctx()), id).toEqual({ saved: false, used: false });
        expect(row(id).read(profileWith(), ctx({ secretsSaved: { [key]: true } })), id).toEqual({ saved: true, used: false });
        expect(row(id).read(profileWith({}, { secretRefs: [key] }), ctx()), id).toEqual({ saved: false, used: true });
        expect(row(id).read(profileWith({}, { secretRefs: [key] }), ctx({ secretsSaved: { [key]: true } })), id).toEqual({
          saved: true,
          used: true
        });
      }
    });

    it('reads saved and used from separate places: another key does not count', () => {
      const p = profileWith({}, { secretRefs: ['XENON_OPENAI_API_KEY'] });
      const c = ctx({ secretsSaved: { XENON_OPENAI_API_KEY: true } });
      expect(row('geminiKey').read(p, c)).toEqual({ saved: false, used: false });
      expect(row('openaiKey').read(p, c)).toEqual({ saved: true, used: true });
    });

    it('treats a missing status as not saved', () => {
      expect(row('geminiKey').read(profileWith(), ctx({ secretsSaved: { XENON_GEMINI_API_KEY: false } }))).toEqual({
        saved: false,
        used: false
      });
    });

    it('is used by the profile once written true, with the key added once', () => {
      for (const [id, key] of KEY_ROWS) {
        const once = row(id).write(profileWith({}, { secretRefs: ['XENON_SMTP_URL'] }), true);
        expect(once.secretRefs, id).toEqual(['XENON_SMTP_URL', key]);
        expect(row(id).write(once, true).secretRefs, id).toEqual(['XENON_SMTP_URL', key]);
        expect(row(id).read(once, ctx()), id).toEqual({ saved: false, used: true });
      }
    });

    it('can be left out of the profile again, leaving the other keys', () => {
      const p = profileWith({}, { secretRefs: ['XENON_GEMINI_API_KEY', 'XENON_HUB_TOKEN'] });
      expect(row('geminiKey').write(p, false).secretRefs).toEqual(['XENON_HUB_TOKEN']);
    });

    it('never carries a value in the profile', () => {
      for (const [id, key] of KEY_ROWS) {
        const p = profileWith();
        const after = row(id).write(p, true);
        expect(after.settings).toEqual(p.settings);
        expect(after.env).toEqual(p.env);
        expect(after.secretRefs).toEqual([key]);
      }
    });

    it('leaves the profile alone for any other value', () => {
      const p = profileWith({}, { secretRefs: ['XENON_GEMINI_API_KEY'] });
      for (const value of ['sk-secret', undefined, null, { saved: true, used: true }]) {
        expect(row('openaiKey').write(p, value)).toEqual(p);
      }
    });
  });
});

describe('visibleRows', () => {
  const shown = (p: Profile, c: EssentialCtx = ctx()) => ids(visibleRows(p, c));
  const IOS = ['iosDeviceType', 'bootedSimulators'];
  const ANDROID = ['androidDeviceType', 'bootedEmulators'];
  const ALWAYS = [
    'platform',
    'maxSessions',
    'port',
    'deviceAvailabilityTimeoutMs',
    'enableDashboard',
    'buildCleanupDays',
    'signIn',
    'hub',
    'enableSelfHealing'
  ];

  it('keeps the catalog’s order', () => {
    const everything = shown(profileWith({ platform: 'both', enableSelfHealing: true, aiProvider: 'ollama' }), ctx({ hubOpen: true }));
    const order = (list: string[]) => list.map((id) => IDS.indexOf(id));
    expect(order(everything)).toEqual([...order(everything)].sort((a, b) => a - b));
  });

  it('shows the always-there rows whatever the profile says', () => {
    for (const platform of ['android', 'ios', 'both']) {
      expect(shown(profileWith({ platform }))).toEqual(expect.arrayContaining(ALWAYS));
    }
  });

  describe('Phones', () => {
    it('shows no iPhone rows for an Android profile', () => {
      const rows = shown(profileWith({ platform: 'android' }));
      for (const id of IOS) expect(rows).not.toContain(id);
      for (const id of ANDROID) expect(rows).toContain(id);
    });

    it('shows no Android rows for an iPhone profile', () => {
      const rows = shown(profileWith({ platform: 'ios' }));
      for (const id of ANDROID) expect(rows).not.toContain(id);
      for (const id of IOS) expect(rows).toContain(id);
    });

    it('shows both sets for Both, and for an unset platform', () => {
      for (const p of [profileWith({ platform: 'both' }), profileWith({ platform: undefined })]) {
        const rows = shown(p, ctx({ defaults: {} }));
        for (const id of [...ANDROID, ...IOS]) expect(rows).toContain(id);
      }
    });

    it('hides the booted-emulators switch when only real phones are used', () => {
      const rows = shown(profileWith({ platform: 'android', androidDeviceType: 'real' }));
      expect(rows).toContain('androidDeviceType');
      expect(rows).not.toContain('bootedEmulators');
    });

    it('shows the booted-emulators switch for emulators and for both', () => {
      for (const androidDeviceType of ['simulated', 'both']) {
        expect(shown(profileWith({ platform: 'android', androidDeviceType }))).toContain('bootedEmulators');
      }
    });

    it('treats an unset Android type as the default, both', () => {
      expect(shown(profileWith({ platform: 'android', androidDeviceType: undefined }))).toContain('bootedEmulators');
    });

    it('hides the booted-simulators switch when only real iPhones are used', () => {
      const rows = shown(profileWith({ platform: 'ios', iosDeviceType: 'real' }));
      expect(rows).toContain('iosDeviceType');
      expect(rows).not.toContain('bootedSimulators');
    });

    it('shows the booted-simulators switch for simulators and for both', () => {
      for (const iosDeviceType of ['simulated', 'both']) {
        expect(shown(profileWith({ platform: 'ios', iosDeviceType }))).toContain('bootedSimulators');
      }
    });

    it('lets each platform’s type decide only its own switch', () => {
      const rows = shown(profileWith({ platform: 'both', androidDeviceType: 'real', iosDeviceType: 'simulated' }));
      expect(rows).not.toContain('bootedEmulators');
      expect(rows).toContain('bootedSimulators');
    });
  });

  describe('Sharing', () => {
    const HUB_ROWS = ['hubAddress', 'hubAccessKey', 'hubToken'];

    it('hides the hub’s address and keys until the hub is on', () => {
      const rows = shown(profileWith({ hub: undefined }), ctx({ hubOpen: false }));
      for (const id of HUB_ROWS) expect(rows).not.toContain(id);
      expect(rows).toContain('hub');
    });

    it('shows them once the switch is opened, before an address is typed', () => {
      const rows = shown(profileWith({ hub: undefined }), ctx({ hubOpen: true }));
      for (const id of HUB_ROWS) expect(rows).toContain(id);
    });

    it('shows them when the profile already has a hub address', () => {
      const rows = shown(profileWith({ hub: 'http://hub-mac:4723' }), ctx({ hubOpen: false }));
      for (const id of HUB_ROWS) expect(rows).toContain(id);
    });

    it('puts the three just after the hub switch', () => {
      const rows = shown(profileWith({ hub: 'http://hub-mac:4723' }));
      expect(rows.slice(rows.indexOf('hub'), rows.indexOf('hub') + 4)).toEqual(['hub', ...HUB_ROWS]);
    });
  });

  describe('AI help', () => {
    const KEYS = ['geminiKey', 'openaiKey', 'anthropicKey'];
    const AI = ['aiProvider', ...KEYS, 'aiBaseUrl'];

    it('hides the service, the keys and the Ollama address when repair is off', () => {
      for (const aiProvider of [undefined, 'gemini', 'ollama']) {
        const rows = shown(profileWith({ enableSelfHealing: false, aiProvider }));
        for (const id of AI) expect(rows, `${String(aiProvider)} ${id}`).not.toContain(id);
        expect(rows).toContain('enableSelfHealing');
      }
    });

    it('treats an unset repair switch as the default, on', () => {
      expect(shown(profileWith({ enableSelfHealing: undefined }))).toContain('aiProvider');
    });

    it('shows the Gemini key for an unset provider, since Gemini is Xenon’s default', () => {
      const rows = shown(profileWith({ enableSelfHealing: true, aiProvider: undefined }));
      expect(rows).toContain('aiProvider');
      expect(rows).toContain('geminiKey');
      expect(rows).not.toContain('openaiKey');
      expect(rows).not.toContain('anthropicKey');
      expect(rows).not.toContain('aiBaseUrl');
    });

    it('shows only the key for the chosen provider', () => {
      const keyFor = { gemini: 'geminiKey', openai: 'openaiKey', anthropic: 'anthropicKey' };
      for (const [aiProvider, key] of Object.entries(keyFor)) {
        const rows = shown(profileWith({ enableSelfHealing: true, aiProvider }));
        expect(rows.filter((id) => KEYS.includes(id)), aiProvider).toEqual([key]);
        expect(rows).not.toContain('aiBaseUrl');
      }
    });

    it('shows the Ollama address and no key for Ollama', () => {
      const rows = shown(profileWith({ enableSelfHealing: true, aiProvider: 'ollama' }));
      expect(rows).toContain('aiBaseUrl');
      for (const id of KEYS) expect(rows).not.toContain(id);
    });

    it('follows a default provider the context carries', () => {
      const rows = shown(profileWith({ aiProvider: undefined }), ctx({ defaults: { ...schemaDefaults, aiProvider: 'openai' } }));
      expect(rows).toContain('openaiKey');
      expect(rows).not.toContain('geminiKey');
    });
  });

  it('returns the catalog’s own row objects', () => {
    for (const r of visibleRows(profileWith(), ctx())) expect(ESSENTIALS).toContain(r);
  });
});

describe('schemaDefaults', () => {
  it('is every property default of the option list, by option name', () => {
    expect(defaultsOfSchema(schema)).toEqual(schemaDefaults);
    expect(defaultsOfSchema(schema).maxSessions).toBe(8);
    expect('hub' in defaultsOfSchema(schema)).toBe(false);
  });

  it('is empty before the option list has been read', () => {
    expect(defaultsOfSchema(null)).toEqual({});
  });
});

describe('rowSettingKey', () => {
  it('is the option of every row but the hub switch, so focusSetting lands in the address box', () => {
    const keys = ESSENTIALS.map((r) => [r.id, rowSettingKey(r)]);
    expect(Object.fromEntries(keys)).toMatchObject({
      platform: 'platform',
      port: 'server.port',
      signIn: 'authDisabled',
      hub: undefined,
      hubAddress: 'hub',
      geminiKey: 'XENON_GEMINI_API_KEY'
    });
    expect(ESSENTIALS.filter((r) => rowSettingKey(r) === 'hub').map((r) => r.id)).toEqual(['hubAddress']);
  });
});

describe('hubOpen', () => {
  it('starts open for a profile with a saved address, and closed for one without', () => {
    expect(hubOpenFor(profileWith({ hub: 'http://hub-mac:4723' }))).toBe(true);
    expect(hubOpenFor(profileWith())).toBe(false);
    expect(hubOpenFor(profileWith({ hub: '' }))).toBe(false);
    expect(hubOpenFor(profileWith({ hub: 42 }))).toBe(false);
  });

  it('opens when the switch is turned on and closes when it is turned off', () => {
    expect(hubOpenAfter(false, { type: 'switch', on: true })).toBe(true);
    expect(hubOpenAfter(true, { type: 'switch', on: false })).toBe(false);
  });

  it('stays open on any edit of the address, emptying it included', () => {
    expect(hubOpenAfter(true, { type: 'address' })).toBe(true);
    expect(hubOpenAfter(false, { type: 'address' })).toBe(true);
  });

  it('keeps the address, access key and token rows while the address is emptied', () => {
    // Typed, then emptied: the edit deletes `hub`, and the rows stay because the screen holds it open.
    let open = hubOpenAfter(false, { type: 'switch', on: true });
    let p = row('hubAddress').write(profileWith(), 'http://hub-mac:4723');
    open = hubOpenAfter(open, { type: 'address' });
    p = row('hubAddress').write(p, '');
    open = hubOpenAfter(open, { type: 'address' });
    expect('hub' in p.settings).toBe(false);
    expect(ids(visibleRows(p, ctx({ hubOpen: open })))).toEqual(
      expect.arrayContaining(['hubAddress', 'hubAccessKey', 'hubToken'])
    );
  });
});

describe('essentialsShows', () => {
  it('is true for a setting Essentials shows a box or switch for, now', () => {
    expect(essentialsShows('server.port', profileWith(), ctx())).toBe(true);
    expect(essentialsShows('maxSessions', profileWith(), ctx())).toBe(true);
    expect(essentialsShows('authDisabled', profileWith(), ctx())).toBe(true);
  });

  it('is false for a setting only All settings has', () => {
    expect(essentialsShows('server.basePath', profileWith(), ctx())).toBe(false);
    expect(essentialsShows('newCommandTimeoutSec', profileWith(), ctx())).toBe(false);
  });

  it('follows the rows on screen: the hub address only while it is saved, the Ollama address only for Ollama', () => {
    expect(essentialsShows('hub', profileWith(), ctx())).toBe(false);
    expect(essentialsShows('hub', profileWith({ hub: 'http://hub-mac/x' }), ctx())).toBe(true);
    expect(essentialsShows('aiBaseUrl', profileWith({ aiProvider: 'gemini' }), ctx())).toBe(false);
    expect(essentialsShows('aiBaseUrl', profileWith({ enableSelfHealing: true, aiProvider: 'ollama' }), ctx())).toBe(true);
  });

  it('is false for a Keychain secret, which is no setting', () => {
    expect(essentialsShows('XENON_GEMINI_API_KEY', profileWith({ enableSelfHealing: true }), ctx())).toBe(false);
  });
});

describe('dashboardCanOverride', () => {
  const descriptionOf = (key: string) => schema.properties[key]?.description;

  it('is true when the description says a dashboard value replaces this one', () => {
    expect(dashboardCanOverride(descriptionOf('buildCleanupDays'))).toBe(true);
    expect(dashboardCanOverride(descriptionOf('aiProvider'))).toBe(true);
    expect(dashboardCanOverride(descriptionOf('enableSelfHealing'))).toBe(true);
  });

  it('is false for an option the dashboard has no say in', () => {
    expect(dashboardCanOverride(descriptionOf('maxSessions'))).toBe(false);
    expect(dashboardCanOverride(descriptionOf('platform'))).toBe(false);
  });

  it('needs both halves of the sentence', () => {
    expect(dashboardCanOverride('Opens the dashboard.')).toBe(false);
    expect(dashboardCanOverride('A value saved elsewhere replaces this one.')).toBe(false);
    expect(dashboardCanOverride('A value saved in the Dashboard REPLACES THIS ONE.')).toBe(true);
  });

  it('is false for a missing description', () => {
    expect(dashboardCanOverride(undefined)).toBe(false);
    expect(dashboardCanOverride('')).toBe(false);
  });

  it('is true for the Essentials options the spec says the dashboard can override', () => {
    const overridable = ESSENTIALS.filter((r) => dashboardCanOverride(schema.properties[r.optionKey]?.description)).map((r) => r.id);
    expect(overridable).toEqual(expect.arrayContaining(['buildCleanupDays', 'enableSelfHealing', 'aiProvider']));
    expect(overridable).not.toContain('maxSessions');
  });
});

describe('plain words', () => {
  const optionKeys = [...new Set([...Object.keys(schema.properties), ...ESSENTIALS.map((r) => r.optionKey), ...IDS])];

  /** Every word a row says. A unit's suffix ('days') is also a value the code uses, so the source check leaves it out. */
  const wordsOf = (r: EssentialRow, withSuffix = true): string[] => {
    const c = r.control;
    return [
      r.group,
      r.label,
      ...(r.help ? [r.help] : []),
      ...(c.kind === 'segmented' ? c.options.map((o) => o.label) : []),
      ...(withSuffix && c.kind === 'number' && c.suffix ? [c.suffix] : []),
      ...(c.kind === 'text' && c.placeholder ? [c.placeholder] : [])
    ];
  };

  it('has no option key, environment name, command or path in any label', () => {
    for (const r of ESSENTIALS) expect(findJargon(r.label, optionKeys), r.id).toEqual([]);
  });

  it('has none in a line of help, a choice, a unit or a group name either', () => {
    expect(findJargon(ESSENTIALS.flatMap((r) => wordsOf(r)).join('\n'), optionKeys)).toEqual([]);
  });

  it('would notice jargon if there were any', () => {
    expect(findJargon('Set maxSessions', optionKeys)).toEqual(['maxSessions']);
    expect(findJargon('Needs XENON_GEMINI_API_KEY', optionKeys)).toContain('XENON_GEMINI_API_KEY');
  });

  it('uses typographic apostrophes, never a straight one', () => {
    expect(row('hub').label).toContain('Mac’s');
    for (const text of ESSENTIALS.flatMap((r) => wordsOf(r))) expect(text).not.toContain("'");
  });

  it('is sentence case: no label starts in lower case (but iPhone) or ends in a full stop', () => {
    for (const r of ESSENTIALS) {
      if (r.label !== 'iPhone') expect(r.label[0], r.id).toBe(r.label[0].toUpperCase());
      expect(r.label.endsWith('.'), r.id).toBe(false);
    }
  });

  it('keeps every word in copy/settings: essentials.ts holds none of them as a string', () => {
    const source = stripComments(readFileSync(resolve(__dirname, '..', 'src/renderer/src/essentials.ts'), 'utf8'));
    for (const text of ESSENTIALS.flatMap((r) => wordsOf(r, false))) {
      for (const quote of ["'", '"', '`']) expect(source, text).not.toContain(`${quote}${text}${quote}`);
    }
  });
});

describe('number field copy', () => {
  it('leaves no sentence inline in numberField.ts', () => {
    const source = stripComments(readFileSync(resolve(__dirname, '..', 'src/renderer/src/numberField.ts'), 'utf8'));
    expect(source).not.toMatch(/Enter /);
  });

  it('keeps the four sentences fromInput can return in copy/settings, word for word', () => {
    expect(SETTINGS.numberField.notANumber).toBe('Enter a number.');
    expect(SETTINGS.numberField.wholeNumber).toBe('Enter a whole number.');
    expect(SETTINGS.numberField.atLeast(1)).toBe('Enter 1 or more.');
    expect(SETTINGS.numberField.atMost(100)).toBe('Enter 100 or less.');
  });

  it('is what fromInput says', () => {
    expect(fromInput('x', 'plain', {})).toEqual({ ok: false, error: SETTINGS.numberField.notANumber });
    expect(fromInput('1.5', 'plain', { integer: true })).toEqual({ ok: false, error: SETTINGS.numberField.wholeNumber });
    expect(fromInput('0', 'plain', { min: 1 })).toEqual({ ok: false, error: SETTINGS.numberField.atLeast(1) });
    expect(fromInput('9', 'plain', { max: 5 })).toEqual({ ok: false, error: SETTINGS.numberField.atMost(5) });
  });
});

describe('numberRowNote (I2)', () => {
  const rowOf = (id: string) => ESSENTIALS.find((r) => r.id === id)!;

  it('says 0 means no limit under the tests at the same time, when the stored number is below 1', () => {
    expect(numberRowNote(rowOf('maxSessions'), 0)).toBe('0 means no limit');
    expect(numberRowNote(rowOf('maxSessions'), -1)).toBe('0 means no limit');
  });

  it('says nothing for a number of 1 or more, an unset one, or another row', () => {
    expect(numberRowNote(rowOf('maxSessions'), 1)).toBeUndefined();
    expect(numberRowNote(rowOf('maxSessions'), undefined)).toBeUndefined();
    expect(numberRowNote(rowOf('buildCleanupDays'), 0)).toBeUndefined();
  });
});
