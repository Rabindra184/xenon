import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { PreflightResult, Profile, SetupProgress } from '@shared/types';
import { CheckCircle2, Copy, ExternalLink, Loader2, RefreshCw, Wrench, XCircle } from 'lucide-react';
import { cn } from '../cn';
import { SETUP } from '../copy/setup';
import { showsBlockerList } from '../readiness';
import {
  announcerStart,
  announcerStep,
  checkedAgo,
  checksSummary,
  setupBlockers,
  setupRows,
  shownSentence,
  type AnnouncerState,
  type SetupRow
} from '../setupRows';
import type { PluginVersion } from '../pluginVersion';
import type { SetupSummary } from '../hooks/useSetupRun';
import { Banner } from '../components/ui/Banner';
import { Button } from '../components/ui/Button';
import { Group } from '../components/ui/Group';
import { StatusRow, type StatusTone } from '../components/ui/StatusRow';
import { toast } from '../components/ui/toastStore';
import { SetupSteps } from '../components/SetupSteps';
import { SetupHubRow } from '../components/slots/SetupHubRow';
import { SetupUpdateRow } from '../components/slots/SetupUpdateRow';

const S = SETUP.screen;

export interface SetupProps {
  /** The open profile, as edited on screen: which phones it uses, and its port. */
  profile: Profile;
  /** The last answer of the readiness check, or null before the first one is back. */
  readiness: PreflightResult | null;
  /** A check is running. */
  checking: boolean;
  /** When the answer shown came back. */
  checkedAt: number | null;
  /** A new number each time a check's answer is applied (a check that just completed); null while one runs. */
  answerId: number | null;
  /** The Xenon in the profile's Appium folder: undefined while it is read, null when there is none. */
  installedVersion: PluginVersion;
  /** The Appium folder the profile uses and how it was found, for the technical details. */
  appiumFolder: { display: string; source: string } | null;
  technicalDetails: boolean;
  /** Set up is running. */
  installing: boolean;
  /** The server is starting, running or stopping: Set up would replace files it uses. */
  serverActive: boolean;
  /** The steps of the current or last Set up run. */
  progress: SetupProgress[];
  /** How the last run ended, or null. */
  setupSummary: SetupSummary | null;
  onSetUp(): void;
  /** Check again: looks at this Mac again, the rows and whether Start is allowed. */
  onCheckAgain(): void;
}

/** An answer with nothing in it, for the Xenon row before the first check is back (it needs none). */
const NO_ANSWER: PreflightResult = { ok: false, checks: [], blockers: [] };

const GROUPS: Array<{ group: SetupRow['group']; title: string }> = [
  { group: 'mac', title: S.groups.mac },
  { group: 'xenon', title: S.groups.xenon },
  { group: 'phones', title: S.groups.phones }
];

/** "Now", for how long ago the checks ran: read again every 30 s while Setup is open. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * Setup's one live region. When a check's answer is applied for the open
 * profile (a new `answerId`) it says the summary ("All checks passed.",
 * "2 things need attention.") if the person asked for the check or the summary
 * changed (announcerStep). A profile switch is not an answer: the region
 * empties, and the switched-to profile's own check is said when it is back.
 * The region is emptied first and filled a frame later, so the same words
 * said again are announced again.
 */
function useCheckAnnouncement(
  profileId: string,
  answerId: number | null,
  summary: string | null
): { text: string; asked(): void } {
  const [text, setText] = useState('');
  // What was on screen when Setup opened is taken in, not said.
  const state = useRef<AnnouncerState>(announcerStart(profileId, answerId, summary));
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const step = announcerStep(state.current, { profileId, answerId, summary });
    state.current = step.state;
    if (!step.clear && step.say === null) return;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    setText('');
    const say = step.say;
    if (say === null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      setText(say);
    });
  }, [profileId, answerId, summary]);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    []
  );

  return {
    text,
    asked: () => {
      state.current = { ...state.current, asked: true };
    }
  };
}

async function copyCommand(command: string): Promise<void> {
  try {
    await window.xenon.share.copy(command);
    toast(S.copied);
  } catch {
    toast(S.copyFailed, 'error');
  }
}

/**
 * Setup: everything this Mac needs to run tests, as three checklists (This
 * Mac, Xenon, Phones), each row one plain sentence (setupRows) with the action
 * that fixes it, then the one Set up button with its steps inline. With
 * technical details on, each row also shows what the check found, its own fix,
 * the command (with Copy) and, on the Xenon row, the Appium folder.
 *
 * Buttons that can't be pressed now (Set up while the server runs or Set up
 * runs, Check again while it looks) say so with aria-disabled and keep focus,
 * as Start does; they are never natively disabled.
 */
export function Setup(p: SetupProps) {
  const now = useNow();
  const rows =
    p.readiness === null
      ? setupRows(NO_ANSWER, p.profile, p.installedVersion).filter((row) => row.group === 'xenon')
      : setupRows(p.readiness, p.profile, p.installedVersion);
  const blockers =
    p.readiness !== null &&
    showsBlockerList({ readiness: p.readiness, serverActive: p.serverActive, installing: p.installing })
      ? setupBlockers(p.readiness, p.profile.server.port)
      : [];
  const announcement = useCheckAnnouncement(
    p.profile.id,
    p.answerId,
    p.readiness === null ? null : checksSummary(rows, blockers)
  );

  const setUpHintId = useId();
  const serverActiveId = useId();
  const setUpUnavailable = p.installing || p.serverActive;
  const checkBusy = p.checking && !p.installing;
  const checkUnavailable = checkBusy || p.installing;

  const setUp = () => {
    if (!setUpUnavailable) p.onSetUp();
  };
  const checkAgain = () => {
    if (checkUnavailable) return;
    announcement.asked();
    p.onCheckAgain();
  };

  const checkAgainButton = (testId?: string, describedBy?: string) => (
    <Button
      size="sm"
      data-testid={testId}
      aria-disabled={checkUnavailable || undefined}
      aria-describedby={describedBy}
      title={p.installing ? S.waitForSetUp : undefined}
      onClick={checkAgain}
      icon={<RefreshCw size={14} aria-hidden="true" className={checkBusy ? 'animate-spin' : undefined} />}
    >
      {S.checkAgain}
    </Button>
  );

  const action = (row: SetupRow, sentenceId: string): ReactNode => {
    switch (row.action?.kind) {
      case 'setup':
        return (
          <Button
            size="sm"
            aria-disabled={setUpUnavailable || undefined}
            aria-describedby={p.serverActive ? `${sentenceId} ${serverActiveId}` : sentenceId}
            title={p.serverActive ? S.serverActive : undefined}
            onClick={setUp}
            icon={<Wrench size={14} aria-hidden="true" />}
          >
            {S.setUp}
          </Button>
        );
      case 'recheck':
        return checkAgainButton(undefined, sentenceId);
      case 'link':
        return (
          <Button
            size="sm"
            aria-describedby={sentenceId}
            onClick={() => void window.xenon.app.openLink('install')}
            icon={<ExternalLink size={14} aria-hidden="true" />}
          >
            {S.howToInstall}
          </Button>
        );
      default:
        return undefined;
    }
  };

  return (
    <div data-testid="setup" className="mx-auto flex max-w-2xl flex-col gap-5 pt-6">
      <header>
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-ink">{S.title}</h1>
          {checkAgainButton('setup-check-again')}
        </div>
        <p className="mt-1 text-sm text-muted">
          {p.checkedAt === null ? S.intro : `${S.intro} ${checkedAgo(p.checkedAt, now)}`}
        </p>
      </header>

      {/* The screen's one live region, on the page from the first frame: a check's summary. */}
      <div role="status" aria-live="polite" className="sr-only">
        {announcement.text}
      </div>

      {blockers.length > 0 && (
        <div data-testid="readiness-blockers">
          <Banner tone="attention" title={S.whyStartIsOff} announce={false}>
            {blockers.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </Banner>
        </div>
      )}

      {GROUPS.map(({ group, title }) => {
        const inGroup = rows.filter((row) => row.group === group);
        if (p.readiness !== null && inGroup.length === 0) return null;
        return (
          <Group key={group} title={title}>
            {p.readiness === null && group !== 'xenon' ? (
              <StatusRow tone="checking" sentence={S.checking} showTechnical={false} />
            ) : (
              inGroup.map((row) => (
                <SetupRowView
                  key={row.id}
                  row={row}
                  // The version is still being read: that is checking, not a note.
                  tone={row.id === 'xenon' && p.installedVersion === undefined ? 'checking' : row.tone}
                  technicalDetails={p.technicalDetails}
                  appiumFolder={row.id === 'xenon' ? p.appiumFolder : null}
                  action={action}
                />
              ))
            )}
            {group === 'xenon' && (
              <>
                <SetupUpdateRow />
                <SetupHubRow />
              </>
            )}
          </Group>
        );
      })}

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            data-testid="setup-run"
            aria-disabled={setUpUnavailable || undefined}
            aria-describedby={p.serverActive ? `${setUpHintId} ${serverActiveId}` : setUpHintId}
            title={p.serverActive ? S.serverActive : undefined}
            onClick={setUp}
            icon={
              p.installing ? (
                <Loader2 size={14} aria-hidden="true" className="animate-spin" />
              ) : (
                <Wrench size={14} aria-hidden="true" />
              )
            }
          >
            {p.installing ? S.settingUp : S.setUp}
          </Button>
          <p id={setUpHintId} className="text-sm text-muted">
            {S.setUpHint}
          </p>
        </div>
        {p.serverActive && (
          <p id={serverActiveId} className="text-xs text-muted">
            {S.serverActive}
          </p>
        )}
        {p.progress.length > 0 && <SetupSteps rows={p.progress} />}
        {p.setupSummary !== null && !p.installing && <RunSummary summary={p.setupSummary} />}
      </div>
    </div>
  );
}

/** One row: its sentence, the action that fixes it, and its technical details. */
function SetupRowView({
  row,
  tone,
  technicalDetails,
  appiumFolder,
  action
}: {
  row: SetupRow;
  tone: StatusTone;
  technicalDetails: boolean;
  appiumFolder: { display: string; source: string } | null;
  action: (row: SetupRow, sentenceId: string) => ReactNode;
}) {
  const sentenceId = useId();
  const { detail, remediation, command } = row.technical;
  return (
    <StatusRow
      tone={tone}
      sentence={shownSentence(row)}
      testId={`setup-row-${row.id}`}
      sentenceId={sentenceId}
      // The Xenon row's sentence is where the installed version shows (Part A's footer line).
      sentenceTestId={row.id === 'xenon' ? 'plugin-version' : undefined}
      action={action(row, sentenceId)}
      showTechnical={technicalDetails}
      technical={
        <>
          {detail !== '' && <p>{detail}</p>}
          {remediation !== undefined && <p>{remediation}</p>}
          {command !== undefined && (
            <div className="mt-1 flex items-center gap-2">
              <code className="min-w-0 break-all text-ink">{command}</code>
              <Button
                size="sm"
                // The details are in the mono face; a button keeps the app's own.
                className="font-sans"
                aria-label={S.copyCommand(row.label)}
                onClick={() => void copyCommand(command)}
                icon={<Copy size={14} aria-hidden="true" />}
              >
                {S.copy}
              </Button>
            </div>
          )}
          {appiumFolder !== null && <p>{S.appiumFolder(appiumFolder.display, appiumFolder.source)}</p>}
        </>
      }
    />
  );
}

/** How the last Set up ended, in A3's words, under its steps. Its toast already announced it. */
function RunSummary({ summary }: { summary: SetupSummary }) {
  const ok = summary.kind === 'success';
  const Icon = ok ? CheckCircle2 : XCircle;
  return (
    <p data-testid="setup-summary" className="flex items-start gap-2 text-sm text-ink">
      <Icon size={16} aria-hidden="true" className={cn('mt-0.5 shrink-0', ok ? 'text-ok' : 'text-danger')} />
      <span>{summary.message}</span>
    </p>
  );
}
