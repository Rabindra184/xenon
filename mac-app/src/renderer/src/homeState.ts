import type { LastRun, PreflightResult, Profile, ServerState, ValidationIssue } from '@shared/types';
import { NOT_INSTALLED_MESSAGE } from '@shared/preflightMessages';
import { HOME } from './copy/home';
import { blockerOf, quickFix, type Blocker } from './quickFix';
import { blockedReason, decideStart, firstBlocker } from './readiness';
import { isServerActive } from './serverStatus';

// What Home says and offers. Home always answers "can I test now?" and offers
// the one next step; this decides both from what the window knows, in one
// place, with no React in it. The first state that fits wins, in the order the
// rows are checked in homeState().

export type HomeKind =
  | 'checking'
  | 'first-run'
  | 'setting-up'
  | 'cant-start'
  | 'ready'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'crashed'
  | 'other-running';

export interface HomeAction {
  id: 'setup' | 'start' | 'stop' | 'open-dashboard' | 'try-again' | 'see-logs' | 'switch-profile' | 'quick-fix';
  label: string;
}

export interface HomeView {
  kind: HomeKind;
  title: string;
  sentence?: string;
  detail?: string;
  primary?: HomeAction;
  secondary?: HomeAction;
  footer?: string;
  checklist?: { label: string; done: boolean }[];
  /** For "Can't start yet": what is in the way, so the screen can carry out its quick fix. */
  blocker?: Blocker;
}

export interface HomeInput {
  server: ServerState;
  profile: Profile;
  /** The name of a saved profile, or null when there is no such profile any more. */
  profileName(id: string): string | null;
  readiness: PreflightResult | null;
  checking: boolean;
  installing: boolean;
  issues: ValidationIssue[];
  lastRun: LastRun | null;
  /** The last problem line the server printed, for a crash. */
  lastProblem: string | null;
  /** The next free port, when the port is in use and one was found; null or missing when not. */
  freePort?: number | null;
  now: number;
}

/** The longest "Last message" Home quotes, the ellipsis included. */
const LAST_MESSAGE_MAX = 120;

type Phones = 'android' | 'ios' | 'both';

/** Which phones a profile is for. Unset, or anything else, is both, as Xenon reads it. */
function phonesOf(p: Profile): Phones {
  const platform = p.settings.platform;
  return platform === 'android' || platform === 'ios' ? platform : 'both';
}

/** The text, trimmed, or null when there is none worth showing. */
function present(text: string | null | undefined): string | null {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  return trimmed === '' ? null : trimmed;
}

/** Whether the drivers check lists a driver as installed ("installed: uiautomator2, xcuitest"). */
function hasDriver(readiness: PreflightResult, driver: 'uiautomator2' | 'xcuitest'): boolean {
  const drivers = readiness.checks.find((c) => c.id === 'drivers');
  return drivers !== undefined && drivers.detail.toLowerCase().includes(driver);
}

const isOk = (readiness: PreflightResult, id: string): boolean =>
  readiness.checks.some((c) => c.id === id && c.status === 'ok');

/**
 * Whether this Mac needs Set up before anything else is worth saying: Xenon is
 * not in the profile's Appium folder, or Node.js and Appium are fine but a
 * driver the profile's phones need is missing. While Node.js or Appium is not
 * ok it is false: there is nothing to install into yet, and that check already
 * says what to do.
 */
export function needsSetup(readiness: PreflightResult | null, profile: Profile): boolean {
  if (readiness === null) return false;
  if (readiness.blockers.includes(NOT_INSTALLED_MESSAGE)) return true;
  if (!isOk(readiness, 'node') || !isOk(readiness, 'appium')) return false;
  // Without a drivers check there is nothing to say a driver is missing.
  if (!readiness.checks.some((c) => c.id === 'drivers')) return false;
  const phones = phonesOf(profile);
  const missingAndroid = phones !== 'ios' && !hasDriver(readiness, 'uiautomator2');
  const missingIphone = phones !== 'android' && !hasDriver(readiness, 'xcuitest');
  return missingAndroid || missingIphone;
}

/** First run's list: what Set up puts on this Mac, for the phones the profile uses, each done or not. */
function firstRunChecklist(readiness: PreflightResult | null, profile: Profile): { label: string; done: boolean }[] {
  const words = HOME.firstRun.checklist;
  const phones = phonesOf(profile);
  const known = readiness !== null;
  const items: { label: string; done: boolean }[] = [
    { label: words.node, done: known && isOk(readiness, 'node') },
    { label: words.appium, done: known && isOk(readiness, 'appium') },
    { label: words.xenon, done: known && !readiness.blockers.includes(NOT_INSTALLED_MESSAGE) }
  ];
  if (phones !== 'ios') items.push({ label: words.android, done: known && hasDriver(readiness, 'uiautomator2') });
  if (phones !== 'android') items.push({ label: words.iphone, done: known && hasDriver(readiness, 'xcuitest') });
  return items;
}

/** How long the server has been up, to follow "Running": "for 5 min", "for 1 h 12 min". */
export function runningFor(ms: number): string {
  const minutes = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 60_000) : 0;
  if (minutes < 1) return HOME.running.forUnderMinute;
  if (minutes < 60) return HOME.running.forMinutes(minutes);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? HOME.running.forHours(hours) : HOME.running.forHoursMinutes(hours, rest);
}

/** The hub's name for "shared with …": its host, from the address as typed (with or without http://). Null for no hub. */
function hubHostname(hub: unknown): string | null {
  const typed = typeof hub === 'string' ? hub.trim() : '';
  if (typed === '') return null;
  for (const candidate of [typed, `http://${typed}`]) {
    try {
      const host = new URL(candidate).hostname;
      if (host !== '') return host;
    } catch {
      // not an address in this form; try the next
    }
  }
  return typed;
}

/** One line on what a start will do: which phones, and whether this Mac is shared with a hub. */
export function readySummary(p: Profile): string {
  const hub = hubHostname(p.settings.hub);
  const where = hub === null ? HOME.ready.thisMacOnly : HOME.ready.sharedWith(hub);
  return `${HOME.ready.phones[phonesOf(p)]}${where}`;
}

const twoDigits = (n: number): string => String(n).padStart(2, '0');

const sameCalendarDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** How the server's last run ended, as a footer: "Last run: today 09:42 · stopped normally". Null when there was none. */
export function lastRunLine(run: LastRun | null, now: number): string | null {
  if (run === null || !Number.isFinite(run.endedAt)) return null;
  const ended = new Date(run.endedAt);
  const today = new Date(now);
  // Days are the calendar's, in local time: a run ten minutes before midnight is "yesterday" at five past.
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const words = HOME.lastRun;
  const day = sameCalendarDay(ended, today)
    ? words.today
    : sameCalendarDay(ended, yesterday)
      ? words.yesterday
      : `${ended.getDate()} ${words.months[ended.getMonth()]}`;
  const time = `${twoDigits(ended.getHours())}:${twoDigits(ended.getMinutes())}`;
  return words.line(day, time, run.how === 'crashed' ? words.crashed : words.stopped);
}

/**
 * Why the server stopped unexpectedly, in a sentence. It reads the last
 * problem line, else what the server reported, and names the few causes people
 * can act on; anything else is "closed on its own" (with technical details on,
 * Home shows the raw message beside it).
 */
export function crashReason(server: ServerState, lastProblem: string | null, port: number): string {
  const text = present(lastProblem) ?? present(server.lastError) ?? '';
  if (/EADDRINUSE|address already in use/i.test(text)) return HOME.crashed.portTaken(port);
  if (/unknown option|not a valid|invalid (plugin )?(arg|option|config)/i.test(text)) {
    return HOME.crashed.refusedSettings;
  }
  return HOME.crashed.closedOnItsOwn;
}

/** The last message as one line of at most LAST_MESSAGE_MAX characters, or null when there is none. */
function lastMessage(lastProblem: string | null): string | null {
  const text = present(lastProblem)?.replace(/\s+/g, ' ') ?? null;
  if (text === null) return null;
  const chars = Array.from(text);
  return chars.length > LAST_MESSAGE_MAX ? `${chars.slice(0, LAST_MESSAGE_MAX - 1).join('')}…` : text;
}

export function homeState(i: HomeInput): HomeView {
  const { server, profile } = i;
  const stop: HomeAction = { id: 'stop', label: HOME.stop };

  // 1. The server is active for another profile: say which, and offer to go to it.
  if (isServerActive(server.status) && server.profileId !== profile.id) {
    const name = server.profileId === null ? null : i.profileName(server.profileId);
    if (name === null) {
      return { kind: 'other-running', title: HOME.otherRunning.removedTitle, sentence: HOME.otherRunning.removedSentence };
    }
    return {
      kind: 'other-running',
      title: HOME.otherRunning.title(name),
      sentence: HOME.otherRunning.sentence,
      primary: { id: 'switch-profile', label: HOME.otherRunning.switchTo }
    };
  }

  // 2-4. This profile's own server.
  if (server.status === 'starting') {
    return { kind: 'starting', title: HOME.starting.title, sentence: HOME.starting.sentence, primary: stop };
  }
  if (server.status === 'running') {
    return {
      kind: 'running',
      title: HOME.running.title,
      sentence: runningFor(server.startedAt === null ? 0 : i.now - server.startedAt),
      primary: { id: 'open-dashboard', label: HOME.running.openDashboard },
      secondary: stop
    };
  }
  if (server.status === 'stopping') {
    return { kind: 'stopping', title: HOME.stopping.title };
  }

  // 5. Set up is running; it is changing what everything below reads.
  if (i.installing) {
    return { kind: 'setting-up', title: HOME.settingUp.title };
  }

  // 6. This profile's server stopped unexpectedly (or no profile is named for it).
  if (server.status === 'crashed' && (server.profileId === null || server.profileId === profile.id)) {
    const message = lastMessage(i.lastProblem);
    return {
      kind: 'crashed',
      title: HOME.crashed.title,
      sentence: crashReason(server, i.lastProblem, profile.server.port),
      ...(message === null ? {} : { detail: HOME.crashed.lastMessage(message) }),
      primary: { id: 'start', label: HOME.crashed.startAgain },
      secondary: { id: 'see-logs', label: HOME.crashed.seeWhatHappened }
    };
  }

  // 7. Xenon, or a driver the profile's phones need, is not installed.
  if (needsSetup(i.readiness, profile)) {
    return {
      kind: 'first-run',
      title: HOME.firstRun.title,
      sentence: HOME.firstRun.sentence,
      primary: { id: 'setup', label: HOME.firstRun.setUp },
      checklist: firstRunChecklist(i.readiness, profile)
    };
  }

  // 8. Something else is in the way of a start.
  const blocker = blockerOf(i.readiness, i.issues, profile.server.port);
  if (blocker !== null) {
    const decision = decideStart({
      status: server.status,
      issues: i.issues,
      readiness: i.readiness,
      checking: i.checking,
      installing: i.installing
    });
    const sentence = blockedReason(decision) ?? (i.readiness === null ? null : firstBlocker(i.readiness));
    return {
      kind: 'cant-start',
      title: HOME.cantStart.title,
      ...(sentence === null ? {} : { sentence }),
      primary: { id: 'quick-fix', label: quickFix(blocker, { freePort: i.freePort ?? null }).label },
      secondary: { id: 'try-again', label: HOME.cantStart.tryAgain },
      footer: HOME.cantStart.footer,
      blocker
    };
  }

  // 9. Nothing is known about this Mac yet.
  if (i.readiness === null) {
    return { kind: 'checking', title: HOME.checking.title };
  }

  // 10. Good to go.
  const footer = lastRunLine(i.lastRun, i.now);
  return {
    kind: 'ready',
    title: HOME.ready.title,
    sentence: readySummary(profile),
    primary: { id: 'start', label: HOME.ready.start },
    ...(footer === null ? {} : { footer })
  };
}
