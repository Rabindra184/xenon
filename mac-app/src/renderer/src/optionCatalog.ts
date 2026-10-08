// The catalog of every Xenon option in plain words: a short label, one line of
// help and the group testers find it in. All settings lists the options from it
// (allSettings.ts); Essentials has its own, smaller catalog (essentials.ts), and
// an option in both has the same label in each. Pure, so the rules are unit-tested.
//
// The words live in copy/options.ts. This file says which group each option is in
// and what to say about one the catalog hasn't heard of.

import { humanize } from '@shared/humanize';
import { OPTIONS } from './copy/options';

const G = OPTIONS.groups;

export type CatalogGroup = (typeof G)[keyof typeof G];

export interface CatalogEntry {
  /** A short noun phrase in sentence case. */
  label: string;
  /** One plain sentence that tells a tester what changes. */
  help: string;
  group: CatalogGroup;
}

type OptionKey = keyof typeof OPTIONS.entries;

/** The groups in the order All settings lists them; More comes last. */
export const CATALOG_GROUPS: readonly CatalogGroup[] = [
  G.phones,
  G.tests,
  G.history,
  G.sharing,
  G.ai,
  G.health,
  G.network,
  G.storage,
  G.more
];

/** Names options the catalog has words for, so a misspelt one, or one with no words, fails the typecheck. */
const options = (...keys: OptionKey[]): readonly OptionKey[] => keys;

/** Which options each group holds, in the order it lists them. */
const GROUP_OPTIONS: ReadonlyArray<readonly [CatalogGroup, readonly OptionKey[]]> = [
  [
    G.phones,
    options(
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
    )
  ],
  [
    G.tests,
    options(
      'maxSessions',
      'deviceAvailabilityTimeoutMs',
      'deviceAvailabilityQueryIntervalMs',
      'newCommandTimeoutSec',
      'autowait',
      'sessionHeartbeatIntervalMs'
    )
  ],
  [
    G.history,
    options(
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
    )
  ],
  [
    G.sharing,
    options(
      'authDisabled',
      'hub',
      'remoteMachineProxyIP',
      'bindHostOrIp',
      'sendNodeDevicesToHubIntervalMs',
      'checkStaleDevicesIntervalMs'
    )
  ],
  [
    G.ai,
    options(
      'enableSelfHealing',
      'aiProvider',
      'aiModel',
      'aiBaseUrl',
      'geminiApiKey',
      'openaiApiKey',
      'anthropicApiKey'
    )
  ],
  [
    G.health,
    options(
      'healthCheckIntervalMs',
      'healthCheckSchedule',
      'checkBlockedDevicesIntervalMs',
      'removeDevicesFromDatabaseBeforeRunningThePlugin'
    )
  ],
  [G.network, options('proxy', 'tlsRejectUnauthorized', 'interceptor', 'cloud')],
  [G.storage, options('databaseProvider', 'databaseUrl', 'enableJsonLogging')]
];

/**
 * One entry for each of the 52 options in resources/schema.json. The keys are in
 * the order each group lists its options, group after group.
 */
export const OPTION_CATALOG: Readonly<Record<string, CatalogEntry>> = Object.fromEntries(
  GROUP_OPTIONS.flatMap(([group, keys]) =>
    keys.map((key): [string, CatalogEntry] => [key, { ...OPTIONS.entries[key], group }])
  )
);

/**
 * What to say about an option the catalog has no words for (a newer Xenon's): its
 * name as a sentence-case label, the first sentence of Xenon's own description, and
 * the More group.
 */
export function fallbackEntry(key: string, description: string | undefined): CatalogEntry {
  return { label: sentenceCase(humanize(key)), help: firstSentence(description), group: G.more };
}

/**
 * "Foo Bar (ms)" as "Foo bar ms": the first word as it is, each later one in lower
 * case unless it is a proper noun or an initialism (iOS, IP, URL), and a unit
 * without its brackets.
 */
function sentenceCase(label: string): string {
  return label
    .split(' ')
    .map((word, i) => {
      if (word === '(ms)') return 'ms';
      // A capital after the first letter ("iOS", "IP", "URL") marks a name to leave alone.
      return i === 0 || /[A-Z]/.test(word.slice(1)) ? word : word.toLowerCase();
    })
    .join(' ');
}

/** A sentence's full stop, "!" or "?" must be followed by a space or the end, so "e.g.", "i.e." and addresses stay whole. */
function firstSentence(description: string | undefined): string {
  const text = (description ?? '').replace(/\s+/g, ' ').trim();
  // Hide the full stops of "e.g." and "i.e." while looking for the end.
  const shielded = text.replace(/\b(?:e\.g|i\.e)\./gi, (m) => m.replaceAll('.', '\u0000'));
  const end = shielded.search(/[.!?](?=\s|$)/);
  const sentence = end === -1 ? shielded : shielded.slice(0, end + 1);
  return sentence.replaceAll('\u0000', '.');
}
