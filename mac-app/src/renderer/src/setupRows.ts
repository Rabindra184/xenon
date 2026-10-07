import type { CheckCode, PreflightResult, Profile, ToolCheck } from '@shared/types';
import { NOT_INSTALLED_MESSAGE, portOfInUseMessage } from '@shared/preflightMessages';
import { SETUP } from './copy/setup';
import { driverState, phonesOf, type Driver, type Phones } from './homeState';

// The Setup screen's checklists: This Mac, Xenon and Phones, one plain sentence
// per row. The sentence is decided here from a check's `code`, never from its
// raw words; those (and the command that fixes it) go in `technical`, which the
// screen shows only with technical details on. Pure, with no React in it.

export interface SetupRow {
  /** Stable, one per row: also what the screen's test ids are made from. */
  id: string;
  group: 'mac' | 'xenon' | 'phones';
  label: string;
  tone: 'ok' | 'attention' | 'info';
  sentence: string;
  action?: { kind: 'setup' } | { kind: 'recheck' } | { kind: 'link'; link: 'install' };
  technical: { detail: string; command?: string; remediation?: string };
}

type Action = NonNullable<SetupRow['action']>;

/** What a check's outcome says and offers. */
interface Outcome {
  tone: SetupRow['tone'];
  sentence: string;
  action?: Action;
  /** What to type, for the technical details. */
  command?: string;
}

const INSTALL: Action = { kind: 'link', link: 'install' };
const SET_UP: Action = { kind: 'setup' };
const RECHECK: Action = { kind: 'recheck' };

const ok = (sentence: string): Outcome => ({ tone: 'ok', sentence });
const attention = (sentence: string, action: Action, command?: string): Outcome => ({
  tone: 'attention',
  sentence,
  action,
  ...(command === undefined ? {} : { command })
});

/**
 * The toolchain checks that are a row of their own, in the order of the screen.
 * An outcome that is not listed has no sentence to say, and gives no row: that
 * is how an iPhone check that is "not needed" (an answer from before the
 * profile changed to use iPhones) stays out, rather than claiming "ready".
 */
interface CheckRow {
  id: string;
  check: string;
  group: SetupRow['group'];
  label: string;
  /** Whether the profile's phones use this row. */
  uses(phones: Phones, profile: Profile): boolean;
  outcomes: Partial<Record<CheckCode, Outcome>>;
}

const always = (): boolean => true;
const forAndroid = (phones: Phones): boolean => phones !== 'ios';
const forIos = (phones: Phones): boolean => phones !== 'android';

const CHECK_ROWS: CheckRow[] = [
  {
    id: 'node',
    check: 'node',
    group: 'mac',
    label: SETUP.labels.node,
    uses: always,
    outcomes: {
      ok: ok(SETUP.ready.node),
      missing: attention(SETUP.node.missing, INSTALL, SETUP.commands.installNode),
      unsupported: attention(SETUP.node.wrongVersion, INSTALL, SETUP.commands.installNode)
    }
  },
  {
    id: 'appium',
    check: 'appium',
    group: 'mac',
    label: SETUP.labels.appium,
    uses: always,
    outcomes: {
      ok: ok(SETUP.ready.appium),
      missing: attention(SETUP.appium.missing, INSTALL, SETUP.commands.installAppium),
      unsupported: attention(SETUP.appium.tooOld, INSTALL, SETUP.commands.updateAppium)
    }
  },
  {
    id: 'android-tools',
    check: 'adb',
    group: 'mac',
    label: SETUP.labels.androidTools,
    uses: forAndroid,
    outcomes: {
      ok: ok(SETUP.ready.androidTools),
      missing: attention(SETUP.androidTools.missing, INSTALL),
      'no-sdk-root': attention(SETUP.androidTools.noSdkRoot, INSTALL)
    }
  },
  {
    id: 'xcode',
    check: 'xcode',
    group: 'mac',
    label: SETUP.labels.xcode,
    uses: forIos,
    outcomes: {
      ok: ok(SETUP.ready.xcode),
      missing: attention(SETUP.xcode.missing, INSTALL, SETUP.commands.installXcode)
    }
  }
];

/** iPhone support is go-ios, needed only for real iPhones: a profile for simulators alone has no row. */
const IPHONE_ROW: CheckRow = {
  id: 'iphone-support',
  check: 'go-ios',
  group: 'phones',
  label: SETUP.labels.iphoneSupport,
  uses: (phones, profile) => forIos(phones) && profile.settings.iosDeviceType !== 'simulated',
  outcomes: {
    ok: ok(SETUP.ready.iphoneSupport),
    missing: attention(SETUP.iphoneSupport.missing, SET_UP),
    stale: attention(SETUP.iphoneSupport.stale, SET_UP)
  }
};

/** The check's code. An answer without one (older, or made by hand) is read from its status. */
function codeOf(c: ToolCheck): CheckCode {
  if (c.code !== undefined) return c.code;
  if (c.status === 'ok') return 'ok';
  if (c.status === 'missing') return 'missing';
  // A warning: Node.js and Appium are there but no good, anything else is not there.
  return c.id === 'node' || c.id === 'appium' ? 'unsupported' : 'missing';
}

/** The row's raw words: the check's own, and the command when the outcome has one. */
function technicalOf(check: ToolCheck | undefined, command?: string): SetupRow['technical'] {
  return {
    detail: check?.detail ?? '',
    ...(command === undefined ? {} : { command }),
    ...(check?.remediation === undefined ? {} : { remediation: check.remediation })
  };
}

/**
 * A row. One with nothing to do shows no fix: the drivers check has one fix for
 * both support rows, and "Android support is installed." must not go on to say
 * how to install it.
 */
function build(
  head: Pick<SetupRow, 'id' | 'group' | 'label'>,
  outcome: Outcome,
  technical: SetupRow['technical']
): SetupRow {
  const { remediation, ...rest } = technical;
  return {
    id: head.id,
    group: head.group,
    label: head.label,
    tone: outcome.tone,
    sentence: outcome.sentence,
    ...(outcome.action === undefined ? {} : { action: outcome.action }),
    technical: outcome.tone === 'ok' || remediation === undefined ? rest : { ...rest, remediation }
  };
}

function checkRow(spec: CheckRow, r: PreflightResult): SetupRow | null {
  const check = r.checks.find((c) => c.id === spec.check);
  if (check === undefined) return null;
  const outcome = spec.outcomes[codeOf(check)];
  if (outcome === undefined) return null;
  return build(spec, outcome, technicalOf(check, outcome.command));
}

/** The Xenon row: the plugin has no check of its own, so it follows the version read from disk. */
function xenonRow(installedVersion: string | null | undefined): SetupRow {
  const head = { id: 'xenon', group: 'xenon', label: SETUP.labels.xenon } as const;
  if (installedVersion === undefined) {
    return build(head, { tone: 'info', sentence: SETUP.xenon.checking }, { detail: SETUP.xenonTechnical.checking });
  }
  if (installedVersion === null) {
    return build(head, attention(SETUP.xenon.notInstalled, SET_UP), { detail: SETUP.xenonTechnical.notInstalled });
  }
  return build(
    head,
    ok(SETUP.xenon.installed(installedVersion)),
    { detail: SETUP.xenonTechnical.installed(installedVersion) }
  );
}

interface SupportRow {
  id: string;
  label: string;
  driver: Driver;
  installed: string;
  missing: string;
  command: string;
}

const ANDROID_SUPPORT: SupportRow = {
  id: 'android-support',
  label: SETUP.labels.androidSupport,
  driver: 'uiautomator2',
  installed: SETUP.androidSupport.installed,
  missing: SETUP.androidSupport.missing,
  command: SETUP.commands.installAndroidDriver
};

const IOS_SUPPORT: SupportRow = {
  id: 'ios-support',
  label: SETUP.labels.iosSupport,
  driver: 'xcuitest',
  installed: SETUP.iosSupport.installed,
  missing: SETUP.iosSupport.missing,
  command: SETUP.commands.installIosDriver
};

/**
 * Android support and iOS support: one drivers check, two rows. Only a driver
 * list that was read can say a driver is missing (the same reading Home uses);
 * a list that could not be read, or no drivers check at all, is not knowing,
 * and with no Appium to ask there is nothing to say yet.
 */
function supportRow(spec: SupportRow, r: PreflightResult): SetupRow {
  const check = r.checks.find((c) => c.id === 'drivers');
  const head = { id: spec.id, group: 'phones', label: spec.label } as const;
  const technical = technicalOf(check);

  if (check !== undefined && (check.code === 'missing' || (check.code === undefined && check.status === 'missing'))) {
    return build(head, { tone: 'info', sentence: SETUP.support.needsAppium }, technical);
  }
  const state = check?.code === 'list-failed' ? 'unknown' : driverState(r, spec.driver);
  if (state === 'unknown') {
    return build(head, attention(SETUP.support.couldntCheck, RECHECK), technical);
  }
  if (state === 'installed') {
    return build(head, ok(spec.installed), technical);
  }
  return build(head, attention(spec.missing, SET_UP, spec.command), technicalOf(check, spec.command));
}

/**
 * The rows of Setup for the phones this profile uses, in the order the screen
 * lists them: This Mac, then Xenon, then Phones. `installedVersion` is the
 * plugin version read from disk: `undefined` while it is still being read,
 * `null` when Xenon is not installed. A check missing from the answer gives no
 * row, since there is nothing true to say about it.
 */
export function setupRows(r: PreflightResult, profile: Profile, installedVersion: string | null | undefined): SetupRow[] {
  const phones = phonesOf(profile);
  const rows: SetupRow[] = [];
  const add = (row: SetupRow | null): void => {
    if (row !== null) rows.push(row);
  };
  const addCheckRow = (spec: CheckRow): void => {
    if (spec.uses(phones, profile)) add(checkRow(spec, r));
  };

  CHECK_ROWS.forEach(addCheckRow); // This Mac: Node.js, Appium, Android tools, Xcode
  rows.push(xenonRow(installedVersion));
  if (forAndroid(phones)) rows.push(supportRow(ANDROID_SUPPORT, r));
  if (forIos(phones)) rows.push(supportRow(IOS_SUPPORT, r));
  addCheckRow(IPHONE_ROW);
  return rows;
}

/**
 * What a row says on screen: its sentence, led by its name when the sentence
 * does not say what it is about. Both support rows can say "Couldn’t check
 * which phone support is installed." or "Needs Appium first.", and two rows
 * saying the same words must be told apart.
 */
export function shownSentence(row: SetupRow): string {
  return row.sentence.includes(row.label) ? row.sentence : SETUP.screen.named(row.label, row.sentence);
}

/**
 * The plain sentence for a Node.js or Appium check that is in the way (R24),
 * the one its Setup row says, or null for any other check and for one that is
 * fine. Read from the check's code, or from its status when it has none.
 */
export function runtimeSentence(check: ToolCheck): string | null {
  if (check.id !== 'node' && check.id !== 'appium') return null;
  const spec = CHECK_ROWS.find((s) => s.check === check.id);
  const outcome = spec?.outcomes[codeOf(check)];
  return outcome !== undefined && outcome.tone === 'attention' ? outcome.sentence : null;
}

/**
 * Why Start is off, as Setup lists it above the rows: the blockers main gives,
 * which are its own plain sentences (the port, Xenon not installed, a check that
 * could not run). A check's own fix is never one: it names commands, and that
 * check's row says it in plain words. A port in use that is not the profile's
 * port is left out: that answer is from before the port changed, and the check
 * of the new one is on its way.
 */
export function setupBlockers(r: PreflightResult | null, port: number): string[] {
  if (r === null) return [];
  return r.blockers.filter((b) => {
    const named = portOfInUseMessage(b);
    return named === null || named === port;
  });
}

/**
 * The short summary Setup announces when a check completes: every row that
 * needs attention, and each blocker Setup lists that no row says. Xenon not
 * installed is one thing, though its row and a blocker can both say it.
 */
export function checksSummary(rows: SetupRow[], blockers: string[]): string {
  const xenonRowSaysIt = rows.some((row) => row.id === 'xenon' && row.tone === 'attention');
  const count =
    rows.filter((row) => row.tone === 'attention').length +
    blockers.filter((b) => !(xenonRowSaysIt && b === NOT_INSTALLED_MESSAGE)).length;
  return count === 0 ? SETUP.summary.allPassed : SETUP.summary.attention(count);
}

/**
 * What Setup's live region says when a check completes, or null to say
 * nothing: the summary when the person asked for the check (Check again), so
 * they hear it was done, or when it changed. A check nobody asked for that
 * changed nothing (the window coming back into focus) is not news.
 */
export function announceCheck(previous: string | null, next: string, asked: boolean): string | null {
  return asked || previous !== next ? next : null;
}

/**
 * Whether the checks must look again because the open profile's phones
 * changed: what the iPhone check says depends on them (it is not needed for
 * Android alone), and the readiness check's own triggers don't include them.
 * Another profile being opened is checked anyway. Whether the iPhone row
 * applies at all (only simulators, or real iPhones) is read from the profile
 * as it is drawn, so that needs no new look.
 */
export function phonesChanged(
  prev: { id: string; platform: unknown } | null,
  next: { id: string; platform: unknown }
): boolean {
  return prev !== null && prev.id === next.id && prev.platform !== next.platform;
}

/** What Setup's live region remembers between renders. */
export interface AnnouncerState {
  /** The profile whose answers it is following. */
  profileId: string | null;
  /**
   * The highest answer id it has taken in (useReadiness' answerId), or -1. Ids only grow, so an id
   * no higher than this is an answer from before (a profile's last answer, shown again while its
   * own check runs), never a check that just completed.
   */
  seen: number;
  /** The summary it last took in for this profile, for whether a new one is news. */
  last: string | null;
  /** Check again was pressed since: the next answer is said even if it changed nothing. */
  asked: boolean;
}

/** The region as Setup opens: what is on screen then is taken in, not said. */
export function announcerStart(profileId: string | null, answerId: number | null, summary: string | null): AnnouncerState {
  return { profileId, seen: answerId ?? -1, last: summary, asked: false };
}

/**
 * What Setup's live region does with what is on screen now. It speaks only
 * when a check's answer is applied (an answer id higher than any it has seen)
 * for the profile it follows, and then only as announceCheck says. A profile
 * switch is not an answer: the switched-to profile's last answer shows while
 * its own check runs, so the region empties (`clear`), forgets what it said
 * for the other profile and any Check again pressed there, and waits for that
 * check.
 */
export function announcerStep(
  state: AnnouncerState,
  now: { profileId: string; answerId: number | null; summary: string | null }
): { state: AnnouncerState; say: string | null; clear: boolean } {
  const seen = Math.max(state.seen, now.answerId ?? -1);
  if (now.profileId !== state.profileId) {
    return { state: { profileId: now.profileId, seen, last: null, asked: false }, say: null, clear: true };
  }
  if (now.answerId === null || now.answerId <= state.seen || now.summary === null) {
    return { state: { ...state, seen }, say: null, clear: false };
  }
  const say = announceCheck(state.last, now.summary, state.asked);
  return { state: { ...state, seen, last: now.summary, asked: false }, say, clear: false };
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/** How long ago the checks ran, to follow them: "Checked just now.", "Checked 5 minutes ago.", "Checked 2 hours ago." */
export function checkedAgo(at: number, now: number): string {
  const elapsed = Number.isFinite(at) && Number.isFinite(now) ? now - at : 0;
  if (elapsed < MINUTE) return SETUP.checked.justNow;
  if (elapsed < HOUR) return SETUP.checked.minutes(Math.floor(elapsed / MINUTE));
  return SETUP.checked.hours(Math.floor(elapsed / HOUR));
}
