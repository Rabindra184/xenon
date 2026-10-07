import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { LastRun, PreflightResult, Profile, ServerState, SetupProgress, ValidationIssue } from '@shared/types';
import {
  AlertTriangle,
  ArrowLeftRight,
  ArrowRight,
  CheckCircle2,
  Circle,
  CircleDashed,
  ExternalLink,
  Info,
  Loader2,
  OctagonAlert,
  Pencil,
  Play,
  RefreshCw,
  ScrollText,
  Square,
  Wrench,
  XCircle,
  type LucideIcon
} from 'lucide-react';
import { cn } from '../cn';
import { HOME } from '../copy/home';
import { homeState, type ChecklistItem, type HomeAction, type HomeKind } from '../homeState';
import { blockerOf, quickFix, type FixAction } from '../quickFix';
import { testAddressSource } from '../addresses';
import { profileName as nameOf } from '../profileSummary';
import { rowDetail, rowState, stepLabel, type RowState } from '../setupProgress';
import { useNextFreePort } from '../hooks/useNextFreePort';
import { AddressCard } from '../components/AddressCard';
import { Button } from '../components/ui/Button';
import { FirstSignInCard } from '../components/slots/FirstSignInCard';
import { HomeLiveStrip } from '../components/slots/HomeLiveStrip';

/** What Home's buttons do, other than a quick fix, which carries its own action. */
export type HomeActionId = Exclude<HomeAction['id'], 'quick-fix'>;

export interface HomeProps {
  server: ServerState;
  /** The open profile, as edited on screen. */
  profile: Profile;
  /** Every profile, as shown: for the running profile's name and address. */
  profiles: readonly Profile[];
  readiness: PreflightResult | null;
  checking: boolean;
  /** Set up is running. */
  installing: boolean;
  /** What is wrong with the profile's settings, the port's included. */
  issues: ValidationIssue[];
  lastRun: LastRun | null;
  /** The rows of the Set up run, shown while it runs. */
  setupProgress: SetupProgress[];
  technicalDetails: boolean;
  /** A start is under way (its own check is running): Start says it can't be pressed again yet. */
  startBusy: boolean;
  /** A stop is under way. */
  stopBusy: boolean;
  onAction(id: HomeActionId): void;
  onQuickFix(action: FixAction): void;
}

/** The icon beside each state's title. The title carries the words, so the icon is decoration. */
const KIND_ICON: Record<HomeKind, { Icon: LucideIcon; className: string }> = {
  checking: { Icon: Loader2, className: 'animate-spin text-muted' },
  'first-run': { Icon: Wrench, className: 'text-info' },
  'setting-up': { Icon: Loader2, className: 'animate-spin text-muted' },
  'cant-start': { Icon: AlertTriangle, className: 'text-warn' },
  ready: { Icon: CheckCircle2, className: 'text-ok' },
  starting: { Icon: Loader2, className: 'animate-spin text-warn' },
  running: { Icon: Circle, className: 'fill-current text-ok' },
  stopping: { Icon: Loader2, className: 'animate-spin text-warn' },
  crashed: { Icon: OctagonAlert, className: 'text-danger' },
  'other-running': { Icon: Info, className: 'text-info' }
};

const ACTION_ICON: Record<HomeActionId, LucideIcon> = {
  setup: Wrench,
  start: Play,
  stop: Square,
  'open-dashboard': ExternalLink,
  'try-again': RefreshCw,
  'see-logs': ScrollText,
  'switch-profile': ArrowLeftRight
};

const FIX_ICON: Record<FixAction['kind'], LucideIcon> = {
  'set-port': ArrowRight,
  setup: Wrench,
  focus: Pencil,
  link: ExternalLink,
  go: ArrowRight
};

const STEP_MARK: Record<RowState, { Icon: LucideIcon; className: string }> = {
  running: { Icon: Loader2, className: 'animate-spin text-muted' },
  ok: { Icon: CheckCircle2, className: 'text-ok' },
  note: { Icon: AlertTriangle, className: 'text-warn' },
  failed: { Icon: XCircle, className: 'text-danger' }
};

/** "Now", for how long the server has run and the last run's day: read again every 15 s while it runs. */
function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [running]);
  return now;
}

/**
 * Home: whether this Mac can test now, and the one next step (homeState). It
 * says so in a title, a sentence and one primary button, with the state's own
 * content between: the first-run checklist, Set up's steps while it runs, and,
 * once running, the test address. Raw words (a quoted message, what a check
 * found) are in the mono face and marked data-raw, as quoted rather than the
 * app's own; the technical ones show only with technical details on.
 *
 * The buttons keep one place in the page from state to state, so a pressed
 * button that changes (Start becomes Stop) keeps keyboard focus. When the one
 * with focus goes with its state (a state with no button), focus goes to the
 * title, which says what is happening now, rather than to nowhere.
 */
export function Home(p: HomeProps) {
  const { server, profile, profiles, readiness, issues } = p;

  // "Use port N": the next free port after the one in use, looked for again with each answer.
  const blocker = blockerOf(readiness, issues, profile.server.port);
  const freePort = useNextFreePort(blocker?.kind === 'port-in-use' ? blocker.port : null, readiness);
  const now = useNow(server.status === 'running');

  const view = homeState({
    server,
    profile,
    profileName: (id) => {
      const found = profiles.find((x) => x.id === id);
      return found === undefined ? null : nameOf(found.name);
    },
    readiness,
    checking: p.checking,
    installing: p.installing,
    issues,
    lastRun: p.lastRun,
    // Until the Logs screen finds the last problem line (Task 19), Home quotes none (R1).
    lastProblem: null,
    freePort,
    now
  });

  const root = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const focusWasHere = useRef(false);
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      focusWasHere.current = root.current?.contains(e.target as Node) ?? false;
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, []);
  // A button with focus that went with its state leaves focus nowhere: it goes to the title.
  useLayoutEffect(() => {
    const active = document.activeElement;
    if (focusWasHere.current && (active === null || active === document.body)) title.current?.focus();
  }, [view.kind, view.primary?.label, view.secondary?.label]);

  // A start or a stop under way: its button says it can't be pressed again, and keeps focus.
  const busyFor = (action: HomeAction) => (action.id === 'start' && p.startBusy) || (action.id === 'stop' && p.stopBusy);

  const press = (action: HomeAction) => {
    if (busyFor(action)) return;
    if (action.id !== 'quick-fix') p.onAction(action.id);
    else if (view.blocker) p.onQuickFix(quickFix(view.blocker, { freePort }).action);
  };

  const iconFor = (action: HomeAction): LucideIcon => {
    if (action.id !== 'quick-fix') return ACTION_ICON[action.id];
    return view.blocker ? FIX_ICON[quickFix(view.blocker, { freePort }).action.kind] : ArrowRight;
  };

  const button = (action: HomeAction | undefined, role: 'primary' | 'secondary') => {
    if (action === undefined) return null;
    const Icon = iconFor(action);
    const busy = busyFor(action);
    return (
      <Button
        key={role}
        data-testid={`home-${role}`}
        variant={role === 'secondary' ? 'secondary' : action.id === 'stop' ? 'danger' : 'primary'}
        aria-disabled={busy || undefined}
        onClick={() => press(action)}
        icon={
          busy ? (
            <Loader2 size={14} aria-hidden="true" className="animate-spin" />
          ) : (
            <Icon size={14} aria-hidden="true" />
          )
        }
      >
        {action.label}
      </Button>
    );
  };

  const running = view.kind === 'running';
  const { Icon: KindIcon, className: kindIconClass } = KIND_ICON[view.kind];

  return (
    <div ref={root} data-testid="home" data-kind={view.kind} className="mx-auto flex max-w-2xl flex-col gap-5 pt-6">
      <header>
        <div className="flex items-center gap-2">
          <KindIcon size={16} aria-hidden="true" className={cn('shrink-0', kindIconClass)} />
          <h1 ref={title} tabIndex={-1} data-testid="home-title" className="text-xl font-semibold text-ink outline-none">
            {view.title}
          </h1>
        </div>
        {view.sentence && <p className="mt-1 text-sm text-muted">{view.sentence}</p>}
        {view.detail && (
          <p data-raw className="mt-2 break-words font-mono text-xs text-muted">
            {view.detail}
          </p>
        )}
      </header>

      {running && <HomeLiveStrip />}
      {view.address && <AddressCard source={testAddressSource(server, profile, profiles)} />}
      {view.checklist && <Checklist items={view.checklist} />}
      {view.kind === 'setting-up' && p.setupProgress.length > 0 && <SetupSteps rows={p.setupProgress} />}
      {p.technicalDetails && view.technical && (
        <Raw label={HOME.cantStart.reported}>
          <p>{view.technical.detail}</p>
          {view.technical.remediation && <p className="mt-1">{view.technical.remediation}</p>}
        </Raw>
      )}
      {p.technicalDetails && view.kind === 'crashed' && server.lastError && (
        <Raw label={HOME.crashed.reported}>
          <p>{server.lastError}</p>
        </Raw>
      )}

      <div className="flex flex-wrap items-center gap-3 empty:hidden">
        {button(view.primary, 'primary')}
        {button(view.secondary, 'secondary')}
      </div>

      {running && <FirstSignInCard />}
      {view.footer && <p className="text-xs text-muted">{view.footer}</p>}
    </div>
  );
}

/** First run's list: each thing Set up puts on this Mac, ✓ when it is there, ○ and "— not installed yet" when not. */
function Checklist({ items }: { items: ChecklistItem[] }) {
  const words = HOME.firstRun;
  return (
    <ul aria-label={words.checklistLabel} className="space-y-2">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2 text-sm text-ink">
          {item.done ? (
            <span role="img" aria-label={words.installed} className="shrink-0">
              <CheckCircle2 size={16} aria-hidden="true" className="text-ok" />
            </span>
          ) : item.unknown ? (
            <CircleDashed size={16} aria-hidden="true" className="shrink-0 text-dim" />
          ) : (
            <Circle size={16} aria-hidden="true" className="shrink-0 text-dim" />
          )}
          <span>{item.label}</span>
          {!item.done && <span className="text-muted">{item.unknown ? words.couldNotCheck : words.notInstalled}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Set up's steps as it runs (A3's rows): a mark, the step in plain words, and a failed step's error, quoted. */
function SetupSteps({ rows }: { rows: SetupProgress[] }) {
  const words = HOME.settingUp;
  return (
    <ul aria-label={words.stepsLabel} className="space-y-1.5 rounded-lg border border-line bg-surface px-4 py-3">
      {rows.map((row) => {
        const state = rowState(row);
        const detail = rowDetail(row);
        const { Icon, className } = STEP_MARK[state];
        return (
          <li key={row.step} className="text-sm">
            <div className="flex items-center gap-2">
              <span role="img" aria-label={words.step[state]} className="shrink-0">
                <Icon size={14} aria-hidden="true" className={className} />
              </span>
              <span className="text-ink">{stepLabel(row.step)}</span>
            </div>
            {detail && state === 'failed' && (
              <p data-raw className="ml-6 break-words font-mono text-2xs text-muted">
                {detail}
              </p>
            )}
            {detail && state === 'note' && <p className="ml-6 text-xs text-muted">{detail}</p>}
          </li>
        );
      })}
    </ul>
  );
}

/** Words quoted as they are (technical details on): a plain label, then the raw text in the mono face. */
function Raw({ label, children }: { label: string; children: ReactNode }) {
  const labelId = useId();
  return (
    <section aria-labelledby={labelId} className="rounded-lg border border-line bg-surface px-4 py-3">
      <h2 id={labelId} className="text-xs font-medium text-muted">
        {label}
      </h2>
      <div data-raw className="mt-1 break-words font-mono text-xs text-ink">
        {children}
      </div>
    </section>
  );
}
