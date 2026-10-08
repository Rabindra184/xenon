import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CATALOG_GROUPS,
  OPTION_CATALOG,
  choiceClearable,
  choiceLabel,
  choiceOrder,
  columnLabel,
  fallbackEntry,
  issueLabel,
  partLabel,
  rawValueText,
  type CatalogEntry,
  type CatalogGroup
} from '../src/renderer/src/optionCatalog';
import { buildForm, type FormField } from '../src/renderer/src/schemaForm';
import { ESSENTIALS } from '../src/renderer/src/essentials';
import { OPTIONS } from '../src/renderer/src/copy/options';
import { SETTINGS } from '../src/renderer/src/copy/settings';
import { SECRET_SETTINGS, SECRET_SETTING_PARTS } from '../src/shared/secrets';
import { RETIRED_SETTINGS } from '../src/shared/retiredSettings';
import { humanize } from '../src/shared/humanize';
import { findJargon } from './e2e/jargon';
import { readRepoSchema } from './repoSchema';

const schema = readRepoSchema();

const schemaKeys = Object.keys(schema.properties);

/** The brief's table: which options sit in which group, in the order each group lists them. */
const TABLE: Record<CatalogGroup, string[]> = {
  Phones: [
    'platform',
    'androidDeviceType',
    'iosDeviceType',
    'simulators',
    'emulators',
    'bootedSimulators',
    'bootedEmulators',
    'adbRemote',
    'derivedDataPath',
    'skipChromeDownload'
  ],
  Tests: [
    'maxSessions',
    'deviceAvailabilityTimeoutMs',
    'deviceAvailabilityQueryIntervalMs',
    'newCommandTimeoutSec',
    'autowait',
    'sessionHeartbeatIntervalMs'
  ],
  'Recording & history': [
    'enableDashboard',
    'buildCleanupDays',
    'buildCleanupMaxCount',
    'buildCleanupSchedule',
    'deleteBuildAssets',
    'recordingCleanupDays',
    'recordingCleanupMaxCount',
    'recordingFailedCleanupDays',
    'maxConcurrentRecordings',
    'recordingsAssetsPath',
    'sessionMetrics',
    'streaming'
  ],
  'Sharing & sign-in': [
    'authDisabled',
    'hub',
    'remoteMachineProxyIP',
    'bindHostOrIp',
    'sendNodeDevicesToHubIntervalMs',
    'checkStaleDevicesIntervalMs'
  ],
  'AI help': [
    'enableSelfHealing',
    'aiProvider',
    'aiModel',
    'aiBaseUrl',
    'geminiApiKey',
    'openaiApiKey',
    'anthropicApiKey'
  ],
  'Phone health': [
    'healthCheckIntervalMs',
    'healthCheckSchedule',
    'checkBlockedDevicesIntervalMs',
    'removeDevicesFromDatabaseBeforeRunningThePlugin'
  ],
  Network: ['proxy', 'tlsRejectUnauthorized', 'interceptor', 'cloud'],
  'Storage & logs': ['databaseProvider', 'databaseUrl', 'enableJsonLogging'],
  More: []
};

const entries = Object.entries(OPTION_CATALOG);

describe('OPTION_CATALOG completeness', () => {
  it('has an entry for each of the 52 options in schema.json, and no other', () => {
    expect(schemaKeys).toHaveLength(52);
    expect(Object.keys(OPTION_CATALOG).sort()).toEqual([...schemaKeys].sort());
  });

  it('gives every entry a non-empty label and help', () => {
    for (const key of schemaKeys) {
      const entry = OPTION_CATALOG[key];
      expect(entry, key).toBeDefined();
      expect(entry.label.trim(), `${key} label`).not.toBe('');
      expect(entry.help.trim(), `${key} help`).not.toBe('');
    }
  });

  it('puts each option in the group the brief names, listing them in the brief’s order', () => {
    const byGroup: Record<string, string[]> = {};
    for (const [key, entry] of entries) (byGroup[entry.group] ??= []).push(key);
    for (const group of Object.keys(TABLE) as CatalogGroup[]) {
      expect(byGroup[group] ?? [], group).toEqual(TABLE[group]);
    }
  });

  it('lists the groups in order, with More last, and never puts an option in More', () => {
    expect(CATALOG_GROUPS).toEqual([
      'Phones',
      'Tests',
      'Recording & history',
      'Sharing & sign-in',
      'AI help',
      'Phone health',
      'Network',
      'Storage & logs',
      'More'
    ]);
    expect(entries.filter(([, e]) => e.group === 'More')).toEqual([]);
  });

  it('writes the option’s words once: every line in copy/options.ts is a catalog entry', () => {
    expect(Object.keys(OPTIONS.entries).sort()).toEqual(Object.keys(OPTION_CATALOG).sort());
  });

  it('still has an entry for a retired option, which the model drops', () => {
    for (const key of RETIRED_SETTINGS) expect(OPTION_CATALOG[key], key).toBeDefined();
  });

  it('gives every label its own words', () => {
    const labels = entries.map(([, e]) => e.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('OPTION_CATALOG plain words', () => {
  // Every name a main sentence must not carry: the schema's options, the ones inside them, and the Essentials rows' own.
  const nested = Object.values(schema.definitions ?? {}).flatMap((d) => Object.keys(d.properties ?? {}));
  const optionKeys = [
    ...new Set([...schemaKeys, ...nested, ...ESSENTIALS.map((r) => r.optionKey), ...ESSENTIALS.map((r) => r.id)])
  ];

  it('has no option key, environment name, command or path in any label or line of help', () => {
    for (const [key, e] of entries) {
      expect(findJargon(`${e.label} ${e.help}`, optionKeys), key).toEqual([]);
    }
  });

  it('would notice jargon if there were any', () => {
    expect(findJargon('Set maxSessions', optionKeys)).toEqual(['maxSessions']);
    expect(findJargon('Needs XENON_GEMINI_API_KEY', optionKeys)).toContain('XENON_GEMINI_API_KEY');
  });

  it('writes a label as a short noun phrase in sentence case: it starts upper case (but iPhone) and ends without a full stop', () => {
    for (const [key, e] of entries) {
      if (e.label !== 'iPhone') expect(e.label[0], key).toBe(e.label[0].toUpperCase());
      expect(e.label.endsWith('.'), key).toBe(false);
      expect(e.label.length, key).toBeLessThanOrEqual(48);
    }
  });

  it('writes help as one sentence that ends in a full stop', () => {
    for (const [key, e] of entries) {
      expect(e.help.endsWith('.'), key).toBe(true);
      expect(e.help.slice(0, -1), key).not.toMatch(/[.!?](\s|$)/);
    }
  });

  it('uses typographic apostrophes, never a straight one', () => {
    for (const [key, e] of entries) {
      expect(e.label, key).not.toContain("'");
      expect(e.help, key).not.toContain("'");
    }
  });

  it('keeps every word in copy/options: optionCatalog.ts holds none of them as a string', () => {
    const source = stripComments(readFileSync(resolve(__dirname, '..', 'src/renderer/src/optionCatalog.ts'), 'utf8'));
    for (const e of entries.map(([, v]) => v)) {
      for (const text of [e.label, e.help]) {
        for (const quote of ["'", '"', '`']) expect(source, text).not.toContain(`${quote}${text}${quote}`);
      }
    }
    for (const group of CATALOG_GROUPS) {
      for (const quote of ["'", '"', '`']) expect(source, group).not.toContain(`${quote}${group}${quote}`);
    }
  });
});

describe('OPTION_CATALOG accuracy', () => {
  // Words the options' own descriptions and the Xenon source rule out (checked against schema.json and src/).
  const help = (key: string): string => OPTION_CATALOG[key].help;

  it('does not say the full record saves video: video is recorded either way', () => {
    expect(help('enableDashboard')).not.toMatch(/video/i);
    expect(help('enableDashboard')).toMatch(/steps, screenshots and logs/);
  });

  it('describes the derived data folders as ready-made builds of the helper app, one for real iPhones and one for simulators', () => {
    expect(help('derivedDataPath')).toMatch(/ready-made build of the helper app/);
    expect(help('derivedDataPath')).toMatch(/real iPhones and one for simulators/);
  });

  it('says network capture and automatic waiting are settings to turn on, not things always done', () => {
    expect(help('interceptor')).toMatch(/^Sets whether/);
    expect(help('interceptor')).toMatch(/web traffic through Xenon/);
    expect(help('autowait')).toMatch(/^Sets whether/);
    // Both are off until someone turns them on, and both say so.
    expect(help('interceptor')).toMatch(/it is off unless you turn it on/);
    expect(help('autowait')).toMatch(/it is off unless you turn it on/);
  });

  it('labels the helper app builds and the certificate check as narrowly as their help', () => {
    expect(OPTION_CATALOG.derivedDataPath.label).toBe('Ready-made iPhone helper app builds');
    expect(OPTION_CATALOG.tlsRejectUnauthorized.label).toBe('Check certificates between Xenon servers');
  });

  it('puts the public address behind a reverse proxy or a router, not a firewall', () => {
    expect(help('remoteMachineProxyIP')).toMatch(/reverse proxy/);
    expect(help('remoteMachineProxyIP')).not.toMatch(/firewall/i);
  });

  it('limits the certificate check to calls to other Xenon servers', () => {
    expect(help('tlsRejectUnauthorized')).toMatch(/other Xenon servers/);
    expect(help('tlsRejectUnauthorized')).toMatch(/AI services and other outside calls aren’t covered/);
  });

  it('names computers for the remote ADB hosts, one per entry as address:port with an example', () => {
    expect(OPTION_CATALOG.adbRemote.label).toMatch(/^Other computers/);
    expect(help('adbRemote')).toMatch(/one per entry/);
    expect(help('adbRemote')).toContain('address:port such as 192.168.1.50:5037');
  });

  it('says what skipping the Chrome driver costs: Android web and hybrid testing', () => {
    expect(help('skipChromeDownload')).toMatch(/websites and hybrid apps/);
  });

  it('gives each cron schedule an example, and says test runs rather than builds', () => {
    expect(help('buildCleanupSchedule')).toContain('such as 0 0 * * *');
    expect(help('healthCheckSchedule')).toContain('such as 0 * * * *');
    expect(OPTION_CATALOG.buildCleanupMaxCount.label).toBe('Most test runs to keep');
    // "Build" stays where it is about Xcode, not a group of tests.
    for (const [key, e] of entries.filter(([, v]) => v.group === 'Recording & history')) {
      expect(`${e.label} ${e.help}`, key).not.toMatch(/\bbuilds?\b/i);
    }
  });
});

describe('OPTION_CATALOG and Essentials', () => {
  it('gives every Essentials row the label its option has in the catalog', () => {
    // The port is in the profile's server section, not the options, and the hub switch is the whole
    // sharing switch: the catalog's `hub` is the address, as the hubAddress row.
    const rows = ESSENTIALS.filter((r) => Object.prototype.hasOwnProperty.call(schema.properties, r.optionKey) && r.id !== 'hub');
    expect(rows.map((r) => r.id)).toEqual([
      'platform',
      'androidDeviceType',
      'bootedEmulators',
      'iosDeviceType',
      'bootedSimulators',
      'maxSessions',
      'deviceAvailabilityTimeoutMs',
      'enableDashboard',
      'buildCleanupDays',
      'signIn',
      'hubAddress',
      'enableSelfHealing',
      'aiProvider',
      'aiBaseUrl'
    ]);
    for (const r of rows) expect(OPTION_CATALOG[r.optionKey].label, r.id).toBe(r.label);
  });

  it('labels the catalog’s hub the way the hubAddress row does', () => {
    expect(OPTION_CATALOG.hub.label).toBe('Hub address');
  });

  it('asks people to sign in for authDisabled, as the inverted switch does', () => {
    expect(OPTION_CATALOG.authDisabled.label).toBe('Ask people to sign in');
  });

  it('names the three AI keys as their Essentials rows do', () => {
    expect(OPTION_CATALOG.geminiApiKey.label).toBe('Gemini key');
    expect(OPTION_CATALOG.openaiApiKey.label).toBe('OpenAI key');
    expect(OPTION_CATALOG.anthropicApiKey.label).toBe('Claude key');
  });
});

describe('OPTION_CATALOG and secrets', () => {
  const pointer = SETTINGS.screen.tabs.keys;

  it('points a secret option to Keys & accounts, in its help', () => {
    for (const key of Object.keys(SECRET_SETTINGS)) {
      expect(OPTION_CATALOG[key].help, key).toContain(pointer);
    }
  });

  it('points an option with a secret part to Keys & accounts too', () => {
    const owners = Object.keys(SECRET_SETTING_PARTS).map((path) => path.split('.')[0]);
    expect(owners.sort()).toEqual(['cloud', 'proxy']);
    for (const key of owners) expect(OPTION_CATALOG[key].help, key).toContain(pointer);
  });

  it('describes no value to type for a secret option', () => {
    for (const key of Object.keys(SECRET_SETTINGS)) {
      expect(OPTION_CATALOG[key].help, key).not.toMatch(/\b(enter|type|paste)\b/i);
    }
  });
});

/** Every part of an option the form draws (a nested setting) and every table column, in the bundled schema. */
function partsOf(fields: FormField[], parent = ''): { paths: string[]; columns: string[] } {
  const paths: string[] = [];
  const columns: string[] = [];
  for (const f of fields) {
    const path = parent ? `${parent}.${f.key}` : f.key;
    if (parent) paths.push(path);
    columns.push(...(f.itemColumns ?? []));
    if (f.children) {
      const inner = partsOf(f.children, path);
      paths.push(...inner.paths);
      columns.push(...inner.columns);
    }
  }
  return { paths, columns: [...new Set(columns)] };
}

describe('the parts of an option, the columns of a table and the choices', () => {
  const { paths, columns } = partsOf(buildForm(schema).flatMap((s) => s.fields));

  it('finds parts and columns to name in the bundled schema', () => {
    expect(paths).toEqual(expect.arrayContaining(['autowait.timeoutMs', 'streaming.androidH264', 'cloud.apiKey']));
    expect(columns).toEqual(expect.arrayContaining(['name', 'sdk', 'avdName']));
  });

  it('has its own plain words for every part of an option in the bundled schema', () => {
    for (const path of paths) {
      expect(Object.prototype.hasOwnProperty.call(OPTIONS.parts, path), path).toBe(true);
      expect(findJargon(partLabel(path), schemaKeys), path).toEqual([]);
    }
  });

  it('names the cloud’s access key as Keys & accounts does', () => {
    expect(partLabel('cloud.apiKey')).toBe('Cloud access key');
  });

  it('has its own plain words for every table column in the bundled schema', () => {
    for (const column of columns) {
      expect(Object.prototype.hasOwnProperty.call(OPTIONS.columns, column), column).toBe(true);
      expect(findJargon(columnLabel(column), schemaKeys), column).toEqual([]);
    }
    expect(columnLabel('name')).toBe('Name');
    expect(columnLabel('sdk')).toBe('iOS version');
    expect(columnLabel('avdName')).toBe('Emulator name');
  });

  it('says what each part and column really is (R48)', () => {
    // A test can change these: they are defaults, and network capture is Android's only.
    expect(partLabel('autowait.enabled')).toMatch(/by default$/);
    expect(partLabel('interceptor.enabled')).toMatch(/Android/);
    expect(partLabel('interceptor.enabled')).toMatch(/by default$/);
    for (const path of ['autowait.enabled', 'interceptor.enabled']) expect(partLabel(path)).not.toMatch(/every test/);
    // It skips the check that an element is enabled, not that it is ready.
    expect(partLabel('autowait.excludeEnabledCheck')).toMatch(/enabled/);
    expect(partLabel('autowait.excludeEnabledCheck')).not.toMatch(/ready/);
    // H.264 through scrcpy is smoother and lighter than MJPEG, not sharper.
    expect(partLabel('streaming.androidH264')).not.toMatch(/sharper/i);
    expect(partLabel('streaming.androidH264')).toMatch(/smoother/i);
    // The cloud phone's OS version, under each provider's own name for it.
    for (const column of ['os_version', 'platformVersion', 'pCloudy_DeviceVersion']) {
      expect(columnLabel(column), column).toMatch(/^OS version/);
    }
    expect(new Set(['os_version', 'platformVersion', 'pCloudy_DeviceVersion'].map(columnLabel)).size).toBe(3);
    expect(columnLabel('pCloudy_DeviceVersion')).not.toMatch(/model/i);
  });

  it('says a part or a column it doesn’t know as its name in sentence case', () => {
    expect(partLabel('autowait.newThingMs')).toBe('New thing ms');
    expect(partLabel('toString')).toBe('To string');
    expect(columnLabel('deviceSerial')).toBe('Device serial');
    expect(columnLabel('constructor')).toBe('Constructor');
  });

  it('says every choice of the bundled schema in plain words, the Essentials choices in Essentials’ words', () => {
    for (const [key, property] of Object.entries(schema.properties)) {
      for (const value of property.enum ?? []) {
        expect(choiceLabel(key, value), `${key}=${value}`).not.toBe(value);
        expect(findJargon(choiceLabel(key, value), schemaKeys), `${key}=${value}`).toEqual([]);
      }
    }
    const C = SETTINGS.essentials.choices;
    expect(choiceLabel('platform', 'ios')).toBe(C.platform.ios);
    expect(choiceLabel('androidDeviceType', 'simulated')).toBe(C.androidDeviceType.simulated);
    expect(choiceLabel('iosDeviceType', 'real')).toBe(C.iosDeviceType.real);
    expect(choiceLabel('aiProvider', 'anthropic')).toBe(C.aiProvider.anthropic);
    expect(choiceLabel('databaseProvider', 'sqlite')).toBe('SQLite');
  });

  it('shows a choice it doesn’t know as it is', () => {
    expect(choiceLabel('platform', 'windows')).toBe('windows');
    expect(choiceLabel('newThing', 'on')).toBe('on');
    expect(choiceLabel('platform', 'toString')).toBe('toString');
  });
});

describe('issueLabel', () => {
  it('names a problem with an option by the option’s plain label', () => {
    expect(issueLabel({ path: 'maxSessions', label: 'Max Sessions', message: 'Must be ≥ 1.' })).toBe('Tests at the same time');
    expect(issueLabel({ path: 'hub', label: 'Hub', message: 'x' })).toBe('Hub address');
  });

  it('keeps the problem’s own label for the server’s settings and for options the catalog doesn’t know', () => {
    expect(issueLabel({ path: 'server.port', label: 'Port', message: 'Port is required.' })).toBe('Port');
    expect(issueLabel({ path: 'server.basePath', label: 'Base path', message: 'x' })).toBe('Base path');
    expect(issueLabel({ path: 'newThing', label: 'New Thing', message: 'x' })).toBe('New Thing');
    expect(issueLabel({ path: 'constructor', label: 'Constructor', message: 'x' })).toBe('Constructor');
  });
});

describe('fallbackEntry', () => {
  it('says an option the catalog doesn’t know in sentence case, with the first sentence of its description', () => {
    expect(fallbackEntry('fooBarMs', 'Does a thing. More text.')).toEqual({
      label: 'Foo bar ms',
      help: 'Does a thing.',
      group: 'More'
    });
  });

  it('says a name that is also an Object property as the name, not as what Object holds', () => {
    expect(humanize('constructor')).toBe('Constructor');
    expect(fallbackEntry('constructor', undefined).label).toBe('Constructor');
    expect(fallbackEntry('hasOwnProperty', undefined).label).toBe('Has own property');
  });

  it('starts from the humanized key and keeps its proper nouns', () => {
    expect(fallbackEntry('newThing', undefined).label).toBe('New thing');
    expect(fallbackEntry('iosBuildPath', undefined).label).toBe('iOS build path');
    expect(fallbackEntry('bindHostOrIp', undefined).label).toBe('Bind host or IP');
    expect(fallbackEntry('aiBaseUrl', undefined).label).toBe('AI base URL');
    // Same words as humanize, only cased as a sentence.
    for (const key of ['bindHostOrIp', 'aiBaseUrl', 'iosBuildPath', 'newThing']) {
      expect(fallbackEntry(key, undefined).label.toLowerCase()).toBe(humanize(key).toLowerCase());
    }
  });

  it('has no help when there is no description', () => {
    expect(fallbackEntry('newThing', undefined).help).toBe('');
    expect(fallbackEntry('newThing', '').help).toBe('');
    expect(fallbackEntry('newThing', '   ').help).toBe('');
  });

  it('keeps a description with no full stop whole', () => {
    expect(fallbackEntry('newThing', 'Does a thing').help).toBe('Does a thing');
  });

  it('does not end the sentence at e.g. or i.e.', () => {
    expect(fallbackEntry('x', 'Where to look (e.g. a folder, i.e. a path). Then more.').help).toBe(
      'Where to look (e.g. a folder, i.e. a path).'
    );
  });

  it('does not end the sentence inside an address', () => {
    expect(fallbackEntry('x', 'Reach http://hub.example:4723 for it. Then more.').help).toBe(
      'Reach http://hub.example:4723 for it.'
    );
  });

  it('ends the sentence at ! or ? as well, and reads a line break as a space', () => {
    expect(fallbackEntry('x', 'Is it on? Then more.').help).toBe('Is it on?');
    expect(fallbackEntry('x', 'Careful! Then more.').help).toBe('Careful!');
    expect(fallbackEntry('x', 'Does a\n  thing.\nThen more.').help).toBe('Does a thing.');
  });

  it('is always in More', () => {
    const e: CatalogEntry = fallbackEntry('x', 'y.');
    expect(e.group).toBe('More');
  });
});

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('choiceOrder and choiceClearable (minor: All settings agrees with Essentials)', () => {
  const field = (key: string) => buildForm(schema).flatMap((s) => s.fields).find((f) => f.key === key)!;

  it('lists an option’s choices in Essentials’ order, whatever order Xenon lists them in', () => {
    expect(field('platform').enum).toEqual(['ios', 'android', 'both']);
    expect(choiceOrder('platform', field('platform').enum!)).toEqual(['android', 'ios', 'both']);
    const essentialsPlatform = ESSENTIALS.find((r) => r.id === 'platform')!.control;
    expect(essentialsPlatform.kind === 'segmented' && essentialsPlatform.options.map((o) => o.value)).toEqual(['android', 'ios', 'both']);
    expect(choiceOrder('androidDeviceType', field('androidDeviceType').enum!)).toEqual(['real', 'simulated', 'both']);
    expect(choiceOrder('aiProvider', field('aiProvider').enum!)).toEqual(['gemini', 'openai', 'anthropic', 'ollama']);
  });

  it('keeps every choice: one the catalog has no words for comes after, in Xenon’s order', () => {
    expect(choiceOrder('platform', ['web', 'ios', 'android', 'both', 'tv'])).toEqual(['android', 'ios', 'both', 'web', 'tv']);
    expect(choiceOrder('platform', ['ios'])).toEqual(['ios']);
    expect(choiceOrder('unknownOption', ['b', 'a'])).toEqual(['b', 'a']);
  });

  it('lets a choice be cleared only for an option with no default', () => {
    expect(choiceClearable(field('platform'))).toBe(false);
    expect(choiceClearable(field('androidDeviceType'))).toBe(false);
    expect(choiceClearable(field('iosDeviceType'))).toBe(false);
    expect(choiceClearable(field('aiProvider'))).toBe(true);
    expect(choiceClearable({ default: undefined })).toBe(true);
  });
});

describe('rawValueText (minor: the inverted sign-in switch with technical details on)', () => {
  it('names the option and the value it is stored as', () => {
    expect(rawValueText('authDisabled', false)).toBe('authDisabled: false');
    expect(rawValueText('authDisabled', true)).toBe('authDisabled: true');
    expect(rawValueText('authDisabled', undefined)).toBe('authDisabled: null');
  });
});

describe('the cloud phone OS version column (minor)', () => {
  it('names every provider that reads it, HeadSpin included (src/device-managers/cloud/Devices.ts)', () => {
    expect(columnLabel('platformVersion')).toBe('OS version (Sauce Labs, LambdaTest, HeadSpin)');
  });
});

