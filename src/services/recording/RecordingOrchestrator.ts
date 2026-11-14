import { Service, Container } from 'typedi';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { trace, metrics, SpanStatusCode, Counter, Histogram, Span } from '@opentelemetry/api';
import {
  COMPOSITE_MAX_INPUTS,
  VideoPipelineService,
  type CompositeGeometry,
} from '../VideoPipelineService';
import { DashboardEventManager } from '../../dashboard/event-manager';
import { BusyPrecheck, BusyEntry } from './busy-precheck';
import {
  RecordingStore,
  failReasonFromError,
  type FinalizeInput,
  type RecordingStatus,
} from './recording-store';
import { ConcurrencyGate } from './concurrency-gate';
import {
  blockDevice as defaultBlockDevice,
  releaseManualHold as defaultReleaseManualHold,
} from '../../data-service/device-service';
import { DeviceStoreFactory } from '../../data-service/device-store';
import { holdsClaim } from '../../data-service/deviceClaims';
import { prisma } from '../../prisma';
import { formatManualLock, isManualLock } from './manualLock';
import type { ObservedPhone } from './observerSessions';
import { recordingSourceFor, type RecordingSource } from './nodeRecordingSource';
import { phoneKey, type RecordedPhone } from './recordedPhone';
import { ensureMjpegForRecording } from './ensureMjpegForRecording';
import { probeVideoDurationMs } from './probeDuration';
import { annotationImagePath } from './annotationImage';
import { readRecordingTiming, writeRecordingTiming } from './recordingTiming';
import { ATTR, METRIC, OUTCOME } from '../telemetry/attributes';
import log from '../../logger';
import { ARTIFACT_STORE } from '../artifacts/ArtifactStore';
import type { ArtifactStore } from '../artifacts/ArtifactStore';

export type { RecordedPhone } from './recordedPhone';

const recLog = log.scope('RecordingOrchestrator');

/** Below this size after stop, treat the mp4 as empty/corrupt. */
const MIN_PLAYABLE_MP4_BYTES = 1024;

/** How often an observer group checks that its phones' claims still name its sessions. */
const OBSERVER_CHECK_MS = 10_000;

/**
 * Observer group ids, and who started each, remembered after they stop, so
 * add-device still refuses them and their starter can still write them.
 */
const OBSERVER_GROUPS_REMEMBERED = 1_000;

/** Endings of sessions no group filmed yet, remembered for a start that comes after. */
const ENDED_EARLY_REMEMBERED = 1_000;

/** The waits before the second and third try of a recording's finalize write. */
const FINALIZE_RETRY_DELAYS_MS = [250, 1_000];

/** How often a recording whose finalize write kept failing is tried again. */
const UNFINISHED_RETRY_MS = 30_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Add to an insertion-ordered set, dropping the oldest entries past `max`. */
function addBounded(set: Set<string>, value: string, max: number): void {
  set.delete(value);
  set.add(value);
  while (set.size > max) set.delete(set.values().next().value as string);
}

// Lazy-init OTel instruments. Module-load order vs. TracingService init does
// not matter — the OTel API returns Noop instruments until a real
// MeterProvider is registered.
let otelLoaded = false;
let attemptsCounter: Counter;
let failuresCounter: Counter;
let compositeFailuresCounter: Counter;
let durationHistogram: Histogram;
let deviceCountHistogram: Histogram;

function ensureOtelInstruments() {
  if (otelLoaded) return;
  const meter = metrics.getMeter('xenon.recording');
  attemptsCounter = meter.createCounter(METRIC.RECORDING_ATTEMPTS, {
    description: 'Number of recording group start / addDevice attempts.',
  });
  failuresCounter = meter.createCounter(METRIC.RECORDING_FAILURES, {
    description: 'Recording attempts that failed, labeled by fail_reason.',
  });
  compositeFailuresCounter = meter.createCounter(METRIC.RECORDING_COMPOSITE_FAILURES, {
    description:
      'Composite (mosaic mp4) ffmpeg failures. Non-fatal — per-device recordings continue.',
  });
  durationHistogram = meter.createHistogram(METRIC.RECORDING_DURATION_MS, {
    description: 'Per-recording duration on stop, labeled by outcome.',
    unit: 'ms',
  });
  deviceCountHistogram = meter.createHistogram(METRIC.RECORDING_DEVICE_COUNT, {
    description: 'Number of devices in a recording group at start time.',
  });
  otelLoaded = true;
}

/**
 * Canonical on-disk location for a group's composite mp4. Kept as a single
 * helper so the router, bundle, and orchestrator all agree on the path
 * without needing a schema column. Sits in a `_groups/<groupId>` subtree to
 * stay clear of per-recording-id folders.
 *
 * A group's composite comes in parts: a phone added to a running group
 * (add-device) ends the part in progress and starts the next one with every
 * phone then recording. Part 1 is `composite.mp4`, as for every group before
 * parts; part n is `composite-<n>.mp4`.
 */
export function compositeOutputPath(groupId: string, part = 1): string {
  return (Container.get(ARTIFACT_STORE) as ArtifactStore).resolve(
    '_groups',
    groupId,
    compositePartFileName(part),
  );
}

/** The file name of a composite part, as on disk and in the downloads. */
export function compositePartFileName(part: number): string {
  return part === 1 ? 'composite.mp4' : `composite-${part}.mp4`;
}

/** Which recording sits in which cell of a composite part, beside it. */
export function compositeLayoutPath(groupId: string, part = 1): string {
  return path.join(
    path.dirname(compositeOutputPath(groupId)),
    part === 1 ? 'composite.json' : `composite-${part}.json`,
  );
}

/**
 * Written beside a composite part when its ffmpeg ended on its own while the
 * group was still recording and no later part had replaced it: that part
 * covers the group only up to then.
 */
export function compositeEndedPath(groupId: string, part = 1): string {
  return path.join(
    path.dirname(compositeOutputPath(groupId)),
    part === 1 ? 'composite-ended.json' : `composite-${part}-ended.json`,
  );
}

/** composite.mp4 (part 1) or composite-<n>.mp4 for n >= 2; never a rendered copy. */
const COMPOSITE_PART_FILE = /^composite(?:-([2-9]|[1-9]\d+))?\.mp4$/;

/**
 * The group's composite parts on disk, in order (1 for composite.mp4). Empty
 * when it has none, or no ArtifactStore (unit tests).
 */
export function listCompositeParts(groupId: string): number[] {
  let names: string[];
  try {
    names = fs.readdirSync(path.dirname(compositeOutputPath(groupId)));
  } catch {
    return [];
  }
  const parts: number[] = [];
  for (const name of names) {
    const m = COMPOSITE_PART_FILE.exec(name);
    if (m) parts.push(m[1] === undefined ? 1 : Number(m[1]));
  }
  return parts.sort((a, b) => a - b);
}

export interface CompositeEndedFile {
  version: 1;
  /** ffmpeg's exit code; null when a signal ended it. */
  exitCode: number | null;
  /** ISO time the exit was noticed. */
  endedAt: string;
}

/** A composite part's ended note, or null when it has none (or none readable). */
export function readCompositeEnded(groupId: string, part = 1): CompositeEndedFile | null {
  try {
    const note = JSON.parse(fs.readFileSync(compositeEndedPath(groupId, part), 'utf8'));
    if (note?.version !== 1 || typeof note.endedAt !== 'string') return null;
    return {
      version: 1,
      exitCode: typeof note.exitCode === 'number' ? note.exitCode : null,
      endedAt: note.endedAt,
    };
  } catch {
    // No note, an unreadable one, or no ArtifactStore (unit tests).
    return null;
  }
}

export interface CompositeLayoutFile {
  version: 1;
  cellW: number;
  cellH: number;
  cols: number;
  rows: number;
  cells: Array<{ index: number; udid: string; recordingId: string }>;
  /**
   * Where the part starts on the group's timeline, in ms after t=0. Absent
   * for a composite started with the group, which starts at t=0.
   */
  startMs?: number;
  /** Where the next part took over, in ms after t=0; absent for the last part. */
  endMs?: number;
}

export class RecordingError extends Error {
  constructor(
    public readonly code:
      | 'device_busy'
      | 'concurrency_cap'
      | 'observer_group'
      /** add-device on a group with no recording still running. */
      | 'group_not_recording',
    public readonly busyDevices?: BusyEntry[],
    public readonly limit?: number,
    public readonly active?: number,
  ) {
    super(code);
  }
}

export interface StartInput {
  /**
   * The phones to record, each by udid and host: two servers can report the
   * same udid (an emulator's name repeats), and each is its own phone with
   * its own source, hold and row.
   */
  phones: RecordedPhone[];
  sessionId?: string;
  /**
   * Observer mode (ENH-06): the caller's own Appium sessions and the phones
   * they run on, one per phone, in the same order as `phones`. The recording
   * holds nothing on those phones, and the whole group stops as soon as any of
   * the sessions ends (sessionEnded, or the claim check every
   * observerCheckMs).
   */
  observe?: ObservedPhone[];
  note?: string;
  /**
   * The caller's user id (`resolveActor(req).userId`), never a credential's
   * id. Embedded in every manual lock this recording takes, so other users
   * and sessions can tell "mine" from "someone else's", and stored as the
   * recording's `started_by`. Required for the multi-user safety model.
   */
  actorId: string;
}

export interface StartedRecording {
  id: string;
  udid: string;
  /** The phone's host: two servers can report a phone of one udid. */
  host: string;
  status: string;
  /** The session an observer recording films. */
  sessionId?: string;
}

/** One recording as a stop reports it. */
export interface FinalizedRecording {
  id: string;
  udid: string;
  host: string;
  /** RECORDING only for one whose finalize write failed: it is still open. */
  status: RecordingStatus | string;
  durationMs?: number;
  sizeBytes?: number;
}

/**
 * How a finalize write went: this call ended the row (`won`), the row had
 * already ended (`lost`: another ending won), or the write failed every try
 * (`failed`: the row is still RECORDING).
 */
type EndOutcome = 'won' | 'lost' | 'failed';

/**
 * A recording whose capture has stopped and whose end is decided, but whose
 * row could not be written. It keeps its gate slot and its phone, as its row
 * says it records, until a later write (the timer, a stop, the next boot's
 * recovery) ends it.
 */
interface UnfinishedEnd {
  groupId: string;
  udid: string;
  host: string;
  input: FinalizeInput;
  /** Lets go of the phone; for an observer recording, only hands back its stream. */
  release: () => Promise<void>;
  timer?: NodeJS.Timeout;
}

export interface BlockDeviceFn {
  (udid: string, host: string, sessionId?: string): Promise<boolean | void>;
}
export interface UnblockDeviceFn {
  (udid: string, host: string): Promise<void>;
}

/**
 * The live preview's leave path, as a page that stops watching uses it: after
 * a short grace, the phone's preview is stopped and its hold released unless
 * someone watches it or another recording reads it. Imported when called:
 * control.ts is a router, loaded long after this service.
 */
function leaveDevice(udid: string): void {
  void import('../../app/routers/control')
    .then(({ previewLeaves }) => previewLeaves.leave(udid))
    .catch((err: any) => {
      recLog.warn(`Could not hand ${udid} to the preview's leave path: ${err?.message ?? err}`);
    });
}

export interface OrchestratorDeps {
  busyPrecheck?: BusyPrecheck;
  store?: RecordingStore;
  gate?: ConcurrencyGate;
  videoPipeline?: VideoPipelineService;
  blockDeviceFn?: BlockDeviceFn;
  eventMgr?: DashboardEventManager;
  unblockDeviceFn?: UnblockDeviceFn;
  /**
   * Resolves a live MJPEG loopback port before ffmpeg starts. Injected in
   * unit tests so stream services need not be registered in the DI container.
   */
  ensureMjpegPortFn?: (udid: string, host: string) => Promise<number>;
  /**
   * For another server's phone (a node's, on a hub), a loopback relay to its
   * node's stream, read in place of ensureMjpegPortFn's port; null for this
   * server's own phone. See nodeRecordingSource.ts.
   */
  nodeSourceFn?: (phone: RecordedPhone, actorId: string) => Promise<RecordingSource | null>;
  /**
   * Reads how long the finished mp4 actually is. Injected in unit tests so
   * finalizing a recording never spawns ffmpeg.
   */
  probeDurationMsFn?: (filePath: string) => Promise<number | undefined>;
  /**
   * Hands a phone whose recording has ended to the live preview's leave path
   * (control.ts previewLeaves), which releases its hold once nobody watches
   * it. Injected in unit tests.
   */
  leaveDeviceFn?: (udid: string) => void;
  /** Wall clock for recording timings. Injected in unit tests. */
  now?: () => number;
  /**
   * Whether the Session row exists. Recording.session_id is a foreign key, so
   * an observer recording writes it only then: a local session with the
   * dashboard off has no row.
   */
  sessionRowExistsFn?: (sessionId: string) => Promise<boolean>;
  /**
   * Whether the phone's claim still names the session (deviceClaims.ts
   * holdsClaim). With a host, only that host's row is read.
   */
  claimHoldsFn?: (udid: string, sessionId: string, host?: string) => Promise<boolean>;
  /** How often an observer group checks its phones' claims. */
  observerCheckMs?: number;
  /** Waits before each further try of a finalize write. */
  finalizeRetryDelaysMs?: number[];
  /** How often a recording whose finalize write kept failing is tried again. */
  unfinishedRetryMs?: number;
}

/** A lookup that fails counts as no row: the recording goes on without the link. */
async function sessionRowExists(sessionId: string): Promise<boolean> {
  try {
    const row = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { id: true },
    });
    return row !== null;
  } catch (err: any) {
    recLog.debug(`Session row lookup for ${sessionId} failed: ${err?.message ?? err}`);
    return false;
  }
}

/**
 * A lookup that fails counts as still held: a store hiccup must not stop a
 * recording. The next check, or the session's own ending, decides.
 */
async function claimHolds(udid: string, sessionId: string, host?: string): Promise<boolean> {
  try {
    const rows = await DeviceStoreFactory.getStore().findDevices(
      host === undefined ? { udid } : { udid, host },
    );
    return rows.some((row) => holdsClaim(row, { sessionId }));
  } catch (err: any) {
    recLog.debug(`Claim lookup for ${udid} (${sessionId}) failed: ${err?.message ?? err}`);
    return true;
  }
}

/**
 * The recording source of a phone: its row, read by udid and host, and then
 * a relay to its node for another server's phone, or null for this server's
 * own (or a phone with no row), which is read from its own stream.
 */
async function nodeSourceFor(phone: RecordedPhone, actorId: string) {
  const device = await DeviceStoreFactory.getStore().findDevice({
    udid: phone.udid,
    host: phone.host,
  });
  return device ? recordingSourceFor(device, actorId) : null;
}

/** An observer group while it records: its phones, and the timer that checks their claims. */
interface ObserverGroup {
  sessions: ObservedPhone[];
  /** Its recordings, so a stop that can't read the store still ends their captures. */
  recordingIds: string[];
  timer: NodeJS.Timeout;
  /** A check is running; the next tick doesn't start another. */
  checking: boolean;
}

/** One phone's cell in a composite part: whose recording, read from which port. */
interface CompositeCellInput {
  udid: string;
  mjpegPort: number;
  recordingId: string;
}

/** The composite part a group records now: its number, its pipeline key and its cells. */
interface CompositePart {
  part: number;
  /** The pipeline's key for its ffmpeg: the group id for part 1. */
  key: string;
  cells: CompositeCellInput[];
}

/** An observer start still being built: the endings of its sessions that arrived meanwhile. */
interface PendingObserverStart {
  sessionIds: Set<string>;
  ended: boolean;
}

@Service()
export class RecordingOrchestrator {
  // All deps are public so tests can rebind a single one without rebuilding.
  public unblockDeviceFn: UnblockDeviceFn;
  public blockDeviceFn: BlockDeviceFn;
  public ensureMjpegPortFn: (udid: string, host: string) => Promise<number>;
  public nodeSourceFn: (phone: RecordedPhone, actorId: string) => Promise<RecordingSource | null>;
  public probeDurationMsFn: (filePath: string) => Promise<number | undefined>;
  public leaveDeviceFn: (udid: string) => void;
  public now: () => number;
  public sessionRowExistsFn: (sessionId: string) => Promise<boolean>;
  public claimHoldsFn: (udid: string, sessionId: string, host?: string) => Promise<boolean>;
  private readonly observerCheckMs: number;
  private readonly finalizeRetryDelaysMs: number[];
  private readonly unfinishedRetryMs: number;
  private readonly _deps: Required<
    Omit<
      OrchestratorDeps,
      | 'blockDeviceFn'
      | 'unblockDeviceFn'
      | 'ensureMjpegPortFn'
      | 'nodeSourceFn'
      | 'probeDurationMsFn'
      | 'leaveDeviceFn'
      | 'now'
      | 'sessionRowExistsFn'
      | 'claimHoldsFn'
      | 'observerCheckMs'
      | 'finalizeRetryDelaysMs'
      | 'unfinishedRetryMs'
    >
  >;
  /**
   * Recording ids currently being closed out. Both the user-initiated stop and
   * an ffmpeg self-exit finalize rows, and they can land at the same instant —
   * this keeps exactly one of them doing it.
   */
  private readonly finalizing = new Set<string>();
  /** The relays node phones' recordings read, by recording id, until finalized. */
  private readonly nodeSources = new Map<string, RecordingSource>();
  /** Observer groups still recording, by group id. */
  private readonly observerGroups = new Map<string, ObserverGroup>();
  /**
   * The observer groups filming each session, by session id. More than one
   * when two starts of one session raced past the busy check: an observer
   * start takes no hold that would serialize them.
   */
  private readonly observedBy = new Map<string, Set<string>>();
  /**
   * Sessions that ended while no group filmed them and no start was building
   * one (the newest 1,000): a start that comes after, from a route that looked
   * the session up just before it ended, stops its group as soon as it is built.
   */
  private readonly endedEarly = new Set<string>();
  /** Observer starts not yet registered, so an ending during one is not lost. */
  private readonly pendingObserverStarts = new Set<PendingObserverStart>();
  /** Recording ids of observer recordings not yet finalized: they release no hold. */
  private readonly observerRecordings = new Set<string>();
  /** Every observer group id, stopped ones included (the newest 1,000), for add-device. */
  private readonly observerGroupIds = new Set<string>();
  /**
   * Who started each observer group (the same newest 1,000), so a credential
   * with only the sessions scope may write its own group and nobody else's.
   */
  private readonly observerGroupStarters = new Map<string, string>();
  /**
   * Phones (`udid@host`) a start or add-device is starting now. The row that
   * makes isRecording refuse a second start is written only after the hold,
   * the source port (up to 90 s for a node's relay) and a Session lookup, so
   * a phone is reserved here from the busy check until its start is over.
   */
  private readonly starting = new Set<string>();
  /** Recordings whose finalize write failed, by id: see UnfinishedEnd. */
  private readonly unfinished = new Map<string, UnfinishedEnd>();
  /** Groups a stop is closing now: add-device refuses them. */
  private readonly stoppingGroups = new Set<string>();
  /** Each recording's source port while it records, for a later composite part. */
  private readonly sourcePorts = new Map<string, number>();
  /** The composite part each group records now (or last started), by group id. */
  private readonly composites = new Map<string, CompositePart>();
  /**
   * Each group's composite change in progress (nextCompositePart), so two
   * add-devices change it one after the other and a stop waits for it.
   */
  private readonly compositeWork = new Map<string, Promise<void>>();

  constructor(deps: OrchestratorDeps = {}) {
    this._deps = {
      busyPrecheck: deps.busyPrecheck ?? Container.get(BusyPrecheck),
      store: deps.store ?? Container.get(RecordingStore),
      gate: deps.gate ?? Container.get(ConcurrencyGate),
      videoPipeline: deps.videoPipeline ?? Container.get(VideoPipelineService),
      eventMgr: deps.eventMgr ?? Container.get(DashboardEventManager),
    };
    this.blockDeviceFn = deps.blockDeviceFn ?? defaultBlockDevice;
    // A recording's end lets go of its manual hold and nothing else: a
    // session's claim on the phone stays. Whose hold it is isn't known on
    // every path (recoverOnBoot, a node's phone), so any manual hold.
    this.unblockDeviceFn =
      deps.unblockDeviceFn ??
      (async (udid, host) => void (await defaultReleaseManualHold(udid, host)));
    this.ensureMjpegPortFn = deps.ensureMjpegPortFn ?? ensureMjpegForRecording;
    this.nodeSourceFn = deps.nodeSourceFn ?? nodeSourceFor;
    this.probeDurationMsFn = deps.probeDurationMsFn ?? probeVideoDurationMs;
    this.leaveDeviceFn = deps.leaveDeviceFn ?? leaveDevice;
    this.now = deps.now ?? Date.now;
    this.sessionRowExistsFn = deps.sessionRowExistsFn ?? sessionRowExists;
    this.claimHoldsFn = deps.claimHoldsFn ?? claimHolds;
    this.observerCheckMs = deps.observerCheckMs ?? OBSERVER_CHECK_MS;
    this.finalizeRetryDelaysMs = deps.finalizeRetryDelaysMs ?? FINALIZE_RETRY_DELAYS_MS;
    this.unfinishedRetryMs = deps.unfinishedRetryMs ?? UNFINISHED_RETRY_MS;
  }

  private get busyPrecheck() {
    return this._deps.busyPrecheck;
  }
  private get store() {
    return this._deps.store;
  }
  private get gate() {
    return this._deps.gate;
  }
  private get videoPipeline() {
    return this._deps.videoPipeline;
  }
  private get eventMgr() {
    return this._deps.eventMgr;
  }

  /**
   * Start a recording group. Atomic — if any phone is busy or the cap would be
   * exceeded, no rows are written, no ffmpeg is spawned, no manual blocks are
   * taken.
   */
  async start(input: StartInput): Promise<{
    groupId: string;
    recordings: StartedRecording[];
    startedAt: Date;
    compositeEnabled: boolean;
  }> {
    ensureOtelInstruments();
    const { phones, actorId } = input;
    if (!actorId) {
      throw new Error('RecordingOrchestrator.start: actorId is required');
    }

    const span = trace.getTracer('xenon.recording').startSpan('xenon.recording.start', {
      attributes: { [ATTR.RECORDING_DEVICE_COUNT]: phones.length },
    });
    attemptsCounter.add(1);
    deviceCountHistogram.record(phones.length);

    try {
      const result = await this._startInternal(input, span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err: any) {
      const failReason = err instanceof RecordingError ? err.code : (err?.message ?? 'unknown');
      failuresCounter.add(1, { fail_reason: failReason });
      span.setAttributes({ [ATTR.RECORDING_FAIL_REASON]: failReason });
      span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR, message: failReason });
      throw err;
    } finally {
      span.end();
    }
  }

  private async _startInternal(
    input: StartInput,
    span: Span,
  ): Promise<{
    groupId: string;
    recordings: StartedRecording[];
    startedAt: Date;
    compositeEnabled: boolean;
  }> {
    const { phones, observe } = input;
    if (!observe) return this.buildGroup(input, span);
    if (
      observe.length !== phones.length ||
      observe.some((p, i) => phoneKey(p) !== phoneKey(phones[i]))
    ) {
      throw new Error('RecordingOrchestrator.start: phones must be the observed phones');
    }
    // A session can end while its group is being built, before sessionEnded
    // can find the group. Its ending is noted here and acted on once the
    // group exists.
    const pending: PendingObserverStart = {
      sessionIds: new Set(observe.map((p) => p.sessionId)),
      ended: false,
    };
    this.pendingObserverStarts.add(pending);
    let out: Awaited<ReturnType<RecordingOrchestrator['buildGroup']>>;
    try {
      out = await this.buildGroup(input, span);
    } finally {
      this.pendingObserverStarts.delete(pending);
    }
    // Registered in the same step as the pending entry goes, so no ending
    // falls between the two.
    this.watchObserverGroup(
      out.groupId,
      input.actorId,
      observe,
      out.recordings.map((r) => r.id),
    );
    // An ending noted before the start began is used up here.
    let endedBefore = false;
    for (const p of observe) {
      if (this.endedEarly.delete(p.sessionId)) endedBefore = true;
    }
    let stopped: Awaited<ReturnType<RecordingOrchestrator['stop']>> | undefined;
    if (pending.ended || endedBefore) {
      recLog.info(`Observer group ${out.groupId}: a session ended as it started; stopping it.`);
      stopped = await this.stopObserverGroup(out.groupId);
    } else {
      // A session that ended without its ending reaching sessionEnded leaves
      // no note: its phone's claim says so.
      stopped = await this.checkObserverGroup(out.groupId);
    }
    if (stopped) {
      const status = new Map(stopped.recordings.map((r) => [r.id, r.status]));
      out.recordings = out.recordings.map((r) => ({ ...r, status: status.get(r.id) ?? r.status }));
    }
    return out;
  }

  /**
   * Reserve the phones for this start (see `starting`), then build the group.
   * A phone another start is starting is refused as one already recording.
   */
  private async buildGroup(
    input: StartInput,
    span: Span,
  ): Promise<{
    groupId: string;
    recordings: StartedRecording[];
    startedAt: Date;
    compositeEnabled: boolean;
  }> {
    const taken = this.reservePhones(input.phones);
    try {
      return await this.buildReservedGroup(input, span);
    } finally {
      this.releasePhones(taken);
    }
  }

  /**
   * Reserve each phone for a start, or throw `device_busy` (reason
   * `recording_other_group`, as for a phone already recording) and reserve
   * none when another start has one of them. Answers the keys to release.
   */
  private reservePhones(phones: RecordedPhone[]): string[] {
    const taken: string[] = [];
    const busy: BusyEntry[] = [];
    for (const phone of phones) {
      const key = phoneKey(phone);
      if (this.starting.has(key) || taken.includes(key)) {
        busy.push({ udid: phone.udid, host: phone.host, reason: 'recording_other_group' });
      } else {
        taken.push(key);
      }
    }
    if (busy.length > 0) throw new RecordingError('device_busy', busy);
    for (const key of taken) this.starting.add(key);
    return taken;
  }

  private releasePhones(keys: string[]): void {
    for (const key of keys) this.starting.delete(key);
  }

  private async buildReservedGroup(
    input: StartInput,
    span: Span,
  ): Promise<{
    groupId: string;
    recordings: StartedRecording[];
    startedAt: Date;
    compositeEnabled: boolean;
  }> {
    const { phones, sessionId, actorId, observe } = input;
    // By phoneKey (`udid@host`): two servers' phones can share a udid.
    const observed = observe ? new Map(observe.map((p) => [phoneKey(p), p] as const)) : undefined;

    // Layer 2 atomic pre-check: busy state. An observed phone's own session
    // is no conflict: recording it is the point.
    const busy = observed
      ? await this.busyPrecheck.findBusy(
          phones,
          actorId,
          undefined,
          new Map(observe!.map((p) => [phoneKey(p), p.sessionId])),
        )
      : await this.busyPrecheck.findBusy(phones, actorId);
    if (busy.length > 0) {
      throw new RecordingError('device_busy', busy);
    }

    // Pre-allocate ids and reserve cap slots atomically.
    const recordingIds = phones.map(() => uuidv4());
    if (!this.gate.tryAcquire(recordingIds)) {
      throw new RecordingError(
        'concurrency_cap',
        undefined,
        this.gate.getLimit(),
        this.gate.activeCount(),
      );
    }

    const groupId = uuidv4();
    span.setAttributes({ [ATTR.RECORDING_GROUP_ID]: groupId });
    const startedAt = new Date();
    const acquiredBlocks: RecordedPhone[] = [];

    // Take manual blocks transactionally, each on its own phone (udid and
    // host). If any fails, roll back. An observer recording holds nothing:
    // the phone is its session's.
    try {
      for (const { udid, host } of observed ? [] : phones) {
        await this.blockDeviceFn(udid, host, formatManualLock(actorId, udid));
        acquiredBlocks.push({ udid, host });
      }
    } catch (err: any) {
      recLog.warn(`Block acquisition failed mid-flight: ${err?.message}`);
      for (const a of acquiredBlocks) {
        await this.tryUnblock(a.udid, a.host);
      }
      for (const id of recordingIds) this.gate.release(id);
      throw new RecordingError('device_busy', [{ udid: 'unknown', reason: 'unknown' }]);
    }

    // Create rows and spawn ffmpeg per device. MJPEG must be live first —
    // Android H.264 preview does not open an MJPEG port.
    const recordings: StartedRecording[] = [];
    // Each started recording's phone and port, in the order started.
    const started: Array<{ recordingId: string; phone: RecordedPhone; mjpegPort: number }> = [];
    const spawned: Array<{ filePath: string; spawnedAtMs: number }> = [];
    for (let i = 0; i < phones.length; i++) {
      const id = recordingIds[i];
      const phone = phones[i];
      const { udid, host } = phone;
      const filePath = (Container.get(ARTIFACT_STORE) as ArtifactStore).resolve(
        id,
        'video',
        `${id}.mp4`,
      );
      const watched = observed?.get(phoneKey(phone));
      // Before anything can finalize it (its ffmpeg may exit at once).
      if (watched) this.observerRecordings.add(id);
      let rowWritten = false;
      try {
        const mjpegPort = await this.sourcePort(id, phone, actorId);
        // Recording.session_id is a foreign key: an observed session's id is
        // written only when its Session row exists.
        const rowSessionId = watched
          ? (await this.sessionRowExistsFn(watched.sessionId).catch(() => false))
            ? watched.sessionId
            : null
          : (sessionId ?? null);
        await this.store.create({
          id,
          groupId,
          deviceUdid: udid,
          deviceHost: host,
          filePath,
          sessionId: rowSessionId,
          deviceSnapshot: null,
          startedBy: actorId,
        });
        rowWritten = true;
        await this.videoPipeline.startRecording({
          sessionId: id,
          udid,
          outputPath: filePath,
          mjpegPort,
          // ffmpeg can end before anyone presses Stop — most often because the
          // device stopped answering and the MJPEG server disconnected it.
          onExit: (code) => void this.handleSourceEnded(id, code),
        });
        // startRecording resolves as its ffmpeg spawns: this video's t=0.
        spawned.push({ filePath, spawnedAtMs: this.now() });
        started.push({ recordingId: id, phone, mjpegPort });
        this.sourcePorts.set(id, mjpegPort);
        recordings.push(
          watched
            ? { id, udid, host, status: 'RECORDING', sessionId: watched.sessionId }
            : { id, udid, host, status: 'RECORDING' },
        );
      } catch (err: any) {
        recLog.error(`Failed to start recording for ${udid}: ${err?.message}`);
        await this.closeNodeSource(id);
        // Mark this one failed but continue with the rest of the group. An
        // observer recording holds nothing to let go of.
        await this.endFailedStart({
          id,
          groupId,
          phone,
          rowWritten,
          failReason: failReasonFromError('spawn_failed', err),
          release: watched ? async () => {} : () => this.tryUnblock(udid, host),
        });
        this.eventMgr.emitRecordingFailed({
          groupId,
          recordingId: id,
          udid,
          host,
          reason: err?.message ?? 'spawn_failed',
        });
        // Per-device spawn failure is non-fatal at the group level — the rest
        // of the devices keep recording — but we still want a failure tick so
        // dashboards can surface flaky devices.
        failuresCounter.add(1, { fail_reason: 'spawn_failed' });
        span.addEvent('device_spawn_failed', { udid, reason: err?.message ?? 'spawn_failed' });
      }
    }

    // Mosaic composite: one mp4 with all devices side-by-side. Skipped for
    // single-device groups (the per-device mp4 IS the "whole screen").
    let compositeEnabled = false;
    if (recordings.length >= 2) {
      try {
        // Each cell is one recording's phone, by its own port: two phones
        // of one udid are two cells.
        const compositeInputs = started
          .filter((s) => s.mjpegPort)
          .map((s) => ({ udid: s.phone.udid, mjpegPort: s.mjpegPort, recordingId: s.recordingId }));
        if (compositeInputs.length >= 2) {
          const compositePath = compositeOutputPath(groupId);
          const geometry = await this.videoPipeline.startComposite({
            groupId,
            inputs: compositeInputs.map(({ udid, mjpegPort }) => ({ udid, mjpegPort })),
            outputPath: compositePath,
            onExit: (code) => this.compositeEndedEarly(groupId, code),
          });
          recLog.info(`Composite recording started for group ${groupId} → ${compositePath}`);
          compositeEnabled = true;
          this.composites.set(groupId, { part: 1, key: groupId, cells: compositeInputs });
          this.writeCompositeLayout(groupId, geometry, compositeInputs);
        } else {
          recLog.warn(
            `Composite skipped for group ${groupId}: not enough MJPEG ports resolved (${compositeInputs.length}/${recordings.length}).`,
          );
          span.addEvent('composite_skipped', {
            resolved_inputs: compositeInputs.length,
            recordings: recordings.length,
          });
        }
      } catch (err: any) {
        // Composite failure is non-fatal — per-device recordings continue.
        recLog.warn(`Composite start failed for group ${groupId}: ${err?.message}`);
        compositeFailuresCounter.add(1);
        span.addEvent('composite_failed', { reason: err?.message ?? 'unknown' });
      }
    }
    span.setAttributes({ [ATTR.RECORDING_COMPOSITE_ENABLED]: compositeEnabled });

    // Each started recording, named by its phone's udid and host: `started`
    // has one entry per entry of `recordings`, in the same order.
    this.eventMgr.emitRecordingStarted({
      groupId,
      recordings: started.map((s) => ({
        id: s.recordingId,
        udid: s.phone.udid,
        host: s.phone.host,
      })),
      startedAt,
    });
    // The dashboard stamps its t=0 when this returns, and every mark's
    // timecode counts from it. The per-device videos started earlier.
    const groupT0Ms = this.now();
    for (const s of spawned) this.recordTiming(s.filePath, s.spawnedAtMs, groupT0Ms);
    return { groupId, recordings, startedAt, compositeEnabled };
  }

  /**
   * Close out one recording: stop its ffmpeg, size the file, decide the terminal
   * status, persist it, release the gate slot and the device lock, and record
   * the metrics. Shared by the user-initiated stop path and by
   * handleSourceEnded, so the two can never drift.
   *
   * `failReason` says why a recording that still stops cleanly ended
   * (`session_ended` for an observer group); a FAILED one keeps its own.
   * An observer recording releases no hold (it never held the phone); its
   * end only hands the phone's stream to the leave path (handBackStream).
   *
   * A recording whose earlier finalize write failed was already stopped and
   * its end decided: that end is written now, nothing is stopped again.
   */
  private async finalizeRecording(
    r: any,
    opts: { endedBySource?: boolean; failReason?: string } = {},
  ): Promise<{ result: FinalizedRecording; outcome: EndOutcome }> {
    // Both entry points land here and this is where the instruments are used;
    // handleSourceEnded has no reason to know they are lazily created.
    ensureOtelInstruments();
    const leftOver = this.unfinished.get(r.id);
    if (leftOver) return this.endRecording(r, leftOver);
    let status: 'STOPPED' | 'FAILED' = 'STOPPED';
    let failReason: string | undefined;
    try {
      await this.videoPipeline.stopRecording(r.id);
    } catch (err: any) {
      status = 'FAILED';
      failReason = failReasonFromError('ffmpeg_stop_failed', err);
    }
    const endedAt = new Date();
    // Its ffmpeg is done reading; a group's composite stops before this.
    this.sourcePorts.delete(r.id);
    const fromNode = this.nodeSources.has(r.id);
    await this.closeNodeSource(r.id);
    // How long the video actually is, not how long the session was open. Those
    // agree only while capture keeps up: a recording whose device died at 26s
    // and was stopped 5 minutes later reported 5m36s for a 35s file (#204).
    // Wall-clock is not lost — started_at and ended_at are both persisted, so
    // it stays derivable, while the media duration is not recoverable later
    // without re-reading the file. Probed after stopRecording so the faststart
    // remux has happened and the header carries a duration; falls back to
    // wall-clock whenever the probe can't answer.
    const wallClockMs = r.started_at ? Date.now() - new Date(r.started_at).getTime() : undefined;
    let durationMs = wallClockMs;
    try {
      const probed = await this.probeDurationMsFn(r.file_path);
      if (probed !== undefined) durationMs = probed;
    } catch (err: any) {
      recLog.debug(`duration probe failed for ${r.id}, using wall-clock: ${err?.message ?? err}`);
    }
    let sizeBytes: number | undefined;
    try {
      sizeBytes = fs.statSync(r.file_path).size;
    } catch {
      // File may not exist on FAIL; leave size undefined.
    }
    if (status === 'STOPPED' && (sizeBytes === undefined || sizeBytes < MIN_PLAYABLE_MP4_BYTES)) {
      status = 'FAILED';
      failReason = 'empty_or_corrupt_mp4';
      recLog.warn(
        `Recording ${r.id} for ${r.device_udid} produced unusable file ` +
          `(size=${sizeBytes ?? 'missing'} bytes)`,
      );
    }
    // A recording whose source ended still produced valid video — just less of
    // it than was asked for. Keeping it STOPPED leaves the mp4 downloadable;
    // recording why it ended keeps "this is shorter than you expected" visible
    // in the data rather than only in the log.
    if (opts.endedBySource && status === 'STOPPED') {
      failReason = 'source_ended';
    } else if (opts.failReason && status === 'STOPPED') {
      failReason = opts.failReason;
    }
    const udid: string = r.device_udid;
    const host: string = r.device_host ?? '127.0.0.1';
    const observer = this.observerRecordings.has(r.id);
    return this.endRecording(r, {
      groupId: r.group_id,
      udid,
      host,
      input: { status, durationMs, sizeBytes, failReason, endedAt },
      release: observer
        ? async () => this.handBackStream(udid, fromNode)
        : () => this.letGoOfDevice(udid, host, fromNode),
    });
  }

  /**
   * Write a recording's decided end, and on success record its metrics and
   * warm its annotated render. Reports the row as this call left it: its new
   * status, the status another ending gave it, or RECORDING when the write
   * failed.
   */
  private async endRecording(
    r: any,
    end: Omit<UnfinishedEnd, 'timer'>,
  ): Promise<{ result: FinalizedRecording; outcome: EndOutcome }> {
    const outcome = await this.writeEnd(r.id, end);
    const base = { id: r.id as string, udid: end.udid, host: r.device_host ?? end.host };
    if (outcome === 'failed') return { result: { ...base, status: 'RECORDING' }, outcome };
    if (outcome === 'lost') return { result: await this.asItStands(r, base), outcome };
    const { status, durationMs, sizeBytes, failReason } = end.input;
    if (durationMs !== undefined) {
      durationHistogram.record(durationMs, {
        outcome: status === 'STOPPED' ? OUTCOME.SUCCESS : OUTCOME.FAILURE,
      });
    }
    if (status === 'FAILED') {
      // The code alone (`ffmpeg_stop_failed`, not its message): a label takes
      // a bounded set of values.
      const code = (failReason ?? 'ffmpeg_stop_failed').split(':')[0];
      failuresCounter.add(1, { fail_reason: code });
    }
    // Fix E: warm the annotated-mp4 cache off the critical path so a later
    // Download is served from cache instead of an on-demand burn-in. Only
    // for finalized recordings that actually carry annotations.
    if (status === 'STOPPED' && ((r.annotations?.length as number) ?? 0) > 0) {
      this.prewarmAnnotatedRender(r.id);
    }
    return { result: { ...base, status, durationMs, sizeBytes }, outcome };
  }

  /** A row another ending finalized, as it now stands. */
  private async asItStands(
    r: any,
    base: { id: string; udid: string; host: string },
  ): Promise<FinalizedRecording> {
    try {
      const now: any = await this.store.findById(r.id);
      if (now) {
        return {
          ...base,
          status: now.status,
          durationMs: now.duration_ms ?? undefined,
          sizeBytes: now.size_bytes ?? undefined,
        };
      }
    } catch (err: any) {
      recLog.debug(`Reading ${r.id} after another ending failed: ${err?.message ?? err}`);
    }
    return { ...base, status: r.status };
  }

  /**
   * Write a recording's end, trying again after each of finalizeRetryDelaysMs,
   * then let go of what it held, only as its row says it ended:
   *
   * - `won`: this write ended it. Its gate slot, observer marker and phone go.
   * - `lost`: it had already ended (finalize is a RECORDING-only transition).
   *   Whoever ended it let go of the phone; the slot and marker are dropped
   *   here too, which is nothing when that was this process.
   * - `failed`: the row still says RECORDING, so the slot and the phone are
   *   kept, as for a recording still running, and the end is kept in
   *   `unfinished` for the timer, a later stop or the next boot to write.
   *   Through 2.36 the error was logged and everything let go of, and the
   *   phone was refused as recording (the busy check, stream/stop, the leave
   *   path) until the server restarted.
   */
  private async writeEnd(id: string, end: Omit<UnfinishedEnd, 'timer'>): Promise<EndOutcome> {
    let won: boolean | undefined;
    let lastError: any;
    for (let attempt = 0; attempt <= this.finalizeRetryDelaysMs.length; attempt++) {
      if (attempt > 0) await sleep(this.finalizeRetryDelaysMs[attempt - 1]);
      try {
        won = await this.store.finalize(id, end.input);
        break;
      } catch (err: any) {
        lastError = err;
      }
    }
    const prior = this.unfinished.get(id);
    if (won === undefined) {
      const entry: UnfinishedEnd = { ...end, timer: prior?.timer };
      if (!entry.timer) entry.timer = this.retryUnfinishedLater(id);
      this.unfinished.set(id, entry);
      recLog.error(
        `Recording ${id} for ${end.udid} could not be marked ${end.input.status} ` +
          `(${this.finalizeRetryDelaysMs.length + 1} tries: ${lastError?.message ?? lastError}). ` +
          `Its capture has stopped; it keeps its phone and its recording slot while its row ` +
          `says RECORDING, and is written again every ${Math.round(this.unfinishedRetryMs / 1000)} s, ` +
          'on a stop of its group, or at the next start.',
      );
      return 'failed';
    }
    if (prior?.timer) clearTimeout(prior.timer);
    this.unfinished.delete(id);
    this.gate.release(id);
    this.observerRecordings.delete(id);
    if (!won) return 'lost';
    await end.release();
    return 'won';
  }

  private retryUnfinishedLater(id: string): NodeJS.Timeout {
    const timer = setTimeout(() => void this.retryUnfinished(id), this.unfinishedRetryMs);
    timer.unref?.();
    return timer;
  }

  /** The timer's write of an unfinished recording's end. Never throws. */
  private async retryUnfinished(id: string): Promise<void> {
    const pending = this.unfinished.get(id);
    if (!pending) return;
    pending.timer = undefined;
    if (this.finalizing.has(id)) {
      // A stop is writing it now; look again later in case that fails too.
      pending.timer = this.retryUnfinishedLater(id);
      return;
    }
    this.finalizing.add(id);
    try {
      const { result, outcome } = await this.endRecording(
        { id, group_id: pending.groupId, device_udid: pending.udid, device_host: pending.host },
        pending,
      );
      if (outcome === 'won') {
        recLog.info(`Recording ${id} is now marked ${result.status}.`);
        this.eventMgr.emitRecordingStopped({ groupId: pending.groupId, recordings: [result] });
      }
    } catch (err: any) {
      recLog.warn(`Writing the end of recording ${id} failed: ${err?.message ?? err}`);
    } finally {
      this.finalizing.delete(id);
    }
  }

  /**
   * A recording whose start failed: its row, if written, is ended FAILED (with
   * writeEnd's retries and rules); with no row there is nothing to write, and
   * its slot, observer marker and phone go at once.
   */
  private async endFailedStart(failed: {
    id: string;
    groupId: string;
    phone: RecordedPhone;
    rowWritten: boolean;
    failReason: string;
    release: () => Promise<void>;
  }): Promise<void> {
    const { id, phone } = failed;
    if (!failed.rowWritten) {
      this.gate.release(id);
      this.observerRecordings.delete(id);
      await failed.release();
      return;
    }
    await this.writeEnd(id, {
      groupId: failed.groupId,
      udid: phone.udid,
      host: phone.host,
      input: { status: 'FAILED', failReason: failed.failReason, endedAt: new Date() },
      release: failed.release,
    });
  }

  /**
   * The ffmpeg for one recording exited without us asking it to.
   *
   * The usual cause is the source ending: the device stopped answering, so the
   * MJPEG server disconnected its clients (see AndroidStreamService and issue
   * #200) and ffmpeg saw end-of-input. The mp4 is valid, just shorter than
   * requested. Nothing else reconciles the row, so without this it sits at
   * RECORDING — no ended_at, no duration, no size — until a manual Stop or
   * until recoverOnBoot marks it FAILED on the next server restart, which is
   * both late and wrong for a recording that ended cleanly. See issue #203.
   */
  private async handleSourceEnded(recordingId: string, code: number | null): Promise<void> {
    if (this.finalizing.has(recordingId)) return; // a stop is already on it
    this.finalizing.add(recordingId);
    try {
      const r: any = await this.store.findById(recordingId);
      if (!r || r.status !== 'RECORDING') return;
      recLog.warn(
        `Recording ${recordingId} for ${r.device_udid}: ffmpeg exited on its own ` +
          `(${code === null ? 'signal' : `code ${code}`}); finalizing it here rather than ` +
          'leaving the row open until someone presses Stop.',
      );
      const { result, outcome } = await this.finalizeRecording(r, { endedBySource: true });
      // Only the ending that ended it says so: a stop that won reports its own.
      if (outcome === 'won') {
        this.eventMgr.emitRecordingStopped({ groupId: r.group_id, recordings: [result] });
      }
    } catch (err: any) {
      recLog.warn(`source-ended finalize failed for ${recordingId}: ${err?.message ?? err}`);
    } finally {
      this.finalizing.delete(recordingId);
    }
  }

  /**
   * Stop all recordings in a group. Each recording is finalized independently
   * (one ffmpeg failure does not abort the others), the gate slot is released,
   * and the manual block is released. Idempotent.
   *
   * `failReason` is recorded on each recording that stops cleanly; an
   * observer group is stopped with `session_ended`.
   */
  async stop(
    groupId: string,
    opts: { failReason?: string } = {},
  ): Promise<{
    groupId: string;
    recordings: FinalizedRecording[];
  }> {
    ensureOtelInstruments();
    const span = trace.getTracer('xenon.recording').startSpan('xenon.recording.stop', {
      attributes: { [ATTR.RECORDING_GROUP_ID]: groupId },
    });
    // Before anything is awaited, so a second ending of one of its sessions,
    // or the claim check's next tick, finds the group already stopping.
    const observer = this.observerGroups.get(groupId);
    this.unwatchObserverGroup(groupId);
    // add-device refuses a group being stopped: a phone added once the group
    // was read here would go on recording after the stop.
    this.stoppingGroups.add(groupId);

    try {
      // Stop the composite first so its ffmpeg flushes its trailer cleanly
      // before we start tearing down per-device sources. A part an
      // add-device is starting (and the part it replaces) is done first: the
      // newest part is the one to end. Part 1's key is the group id.
      await this.compositeWork.get(groupId);
      const part = this.composites.get(groupId);
      this.composites.delete(groupId);
      try {
        await this.videoPipeline.stopComposite(part?.key ?? groupId);
      } catch (err: any) {
        recLog.warn(`Composite stop failed for group ${groupId}: ${err?.message}`);
        compositeFailuresCounter.add(1);
        span.addEvent('composite_stop_failed', { reason: err?.message ?? 'unknown' });
      }
      const recordings = await this.store.listGroup(groupId);
      const out: FinalizedRecording[] = [];
      for (const r of recordings as any[]) {
        // A phone whose recording already ended (its source ended, or this
        // is a second stop), or that handleSourceEnded is finalizing now, is
        // reported as it stands. Finalizing it again overwrote its end,
        // duration and fail_reason, and let go of the phone a second time.
        if (r.status === 'STOPPED' || r.status === 'FAILED' || this.finalizing.has(r.id)) {
          out.push({
            id: r.id,
            udid: r.device_udid,
            host: r.device_host,
            status: r.status,
            durationMs: r.duration_ms ?? undefined,
            sizeBytes: r.size_bytes ?? undefined,
          });
          continue;
        }
        // Claim it so an ffmpeg exit landing mid-stop doesn't finalize the same
        // row from handleSourceEnded at the same time.
        // A row that handleSourceEnded finalized after the group was read is
        // still RECORDING in this read: finalize is a transition from
        // RECORDING, so that ending stands and this one lets go of nothing.
        this.finalizing.add(r.id);
        try {
          out.push((await this.finalizeRecording(r, { failReason: opts.failReason })).result);
        } finally {
          this.finalizing.delete(r.id);
        }
      }
      this.prewarmCompositeRender(groupId);
      // A row whose finalize write failed still records, as far as anyone can
      // tell: it is not announced as stopped.
      this.eventMgr.emitRecordingStopped({
        groupId,
        recordings: out.filter((r) => r.status !== 'RECORDING'),
      });
      span.setStatus({ code: SpanStatusCode.OK });
      return { groupId, recordings: out };
    } catch (err: any) {
      // Nothing watches an observer group any more (unwatched above), so its
      // captures must not depend on the store answering: each phone's ffmpeg
      // is stopped from memory. Its rows stay open until a later stop or the
      // next boot's recovery closes them.
      if (observer) await this.stopCapturesOf(groupId, observer.recordingIds);
      span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR, message: err?.message ?? 'unknown' });
      throw err;
    } finally {
      this.stoppingGroups.delete(groupId);
      span.end();
    }
  }

  /** Stop each recording's ffmpeg and node relay, each on its own; never throws. */
  private async stopCapturesOf(groupId: string, recordingIds: string[]): Promise<void> {
    recLog.warn(`Stopping observer group ${groupId} failed; stopping its captures directly.`);
    for (const id of recordingIds) {
      try {
        await this.videoPipeline.stopRecording(id);
      } catch (err: any) {
        recLog.warn(`Stopping the capture of ${id} failed: ${err?.message ?? err}`);
      }
      await this.closeNodeSource(id);
    }
  }

  /**
   * One of the sessions an observer group films has ended (forgetSessionMemory
   * calls this for every ending, observed or not). The whole group stops, the
   * composite included: the phones' streams go on after the session, and the
   * group must not go on filming the next test on them. A second call stops
   * nothing more. A session no group films (yet) is noted: a start for it
   * still being built, or one that comes after (endedEarly, the newest
   * 1,000), stops its group as soon as it is built. Never throws.
   */
  async sessionEnded(sessionId: string): Promise<void> {
    try {
      let pendingStart = false;
      for (const pending of this.pendingObserverStarts) {
        if (pending.sessionIds.has(sessionId)) {
          pending.ended = true;
          pendingStart = true;
        }
      }
      const groupIds = [...(this.observedBy.get(sessionId) ?? [])];
      if (groupIds.length === 0) {
        if (!pendingStart) addBounded(this.endedEarly, sessionId, ENDED_EARLY_REMEMBERED);
        return;
      }
      for (const groupId of groupIds) {
        recLog.info(`Session ${sessionId} ended; stopping observer group ${groupId}.`);
        await this.stopObserverGroup(groupId);
      }
    } catch (err: any) {
      recLog.warn(
        `Stopping the recording of ended session ${sessionId} failed: ${err?.message ?? err}`,
      );
    }
  }

  /** stop(groupId) for an ended session: `session_ended`, and never throws. */
  private async stopObserverGroup(
    groupId: string,
  ): Promise<Awaited<ReturnType<RecordingOrchestrator['stop']>> | undefined> {
    try {
      return await this.stop(groupId, { failReason: 'session_ended' });
    } catch (err: any) {
      recLog.warn(`Stopping observer group ${groupId} failed: ${err?.message ?? err}`);
      return undefined;
    }
  }

  /** Whether the group was started in observer mode (add-device refuses it). */
  isObserverGroup(groupId: string): boolean {
    return this.observerGroupIds.has(groupId);
  }

  /**
   * The user who started an observer group, while it is remembered (until a
   * restart, or 1,000 newer observer groups); undefined for any other group.
   */
  observerGroupStarter(groupId: string): string | undefined {
    return this.observerGroupStarters.get(groupId);
  }

  /**
   * Note an observer group, and while it records, watch its sessions: the
   * hook's map, and a timer that checks every observerCheckMs that each
   * phone's claim still names its session, for an ending the hook missed.
   */
  private watchObserverGroup(
    groupId: string,
    starter: string,
    sessions: ObservedPhone[],
    recordingIds: string[],
  ) {
    addBounded(this.observerGroupIds, groupId, OBSERVER_GROUPS_REMEMBERED);
    this.observerGroupStarters.delete(groupId);
    this.observerGroupStarters.set(groupId, starter);
    while (this.observerGroupStarters.size > OBSERVER_GROUPS_REMEMBERED) {
      this.observerGroupStarters.delete(this.observerGroupStarters.keys().next().value as string);
    }
    if (recordingIds.length === 0) return;
    const timer = setInterval(() => void this.checkObserverGroup(groupId), this.observerCheckMs);
    timer.unref();
    this.observerGroups.set(groupId, { sessions, recordingIds, timer, checking: false });
    for (const p of sessions) {
      const groups = this.observedBy.get(p.sessionId) ?? new Set<string>();
      groups.add(groupId);
      this.observedBy.set(p.sessionId, groups);
    }
  }

  private unwatchObserverGroup(groupId: string): void {
    const group = this.observerGroups.get(groupId);
    if (!group) return;
    clearInterval(group.timer);
    this.observerGroups.delete(groupId);
    for (const p of group.sessions) {
      const groups = this.observedBy.get(p.sessionId);
      groups?.delete(groupId);
      if (groups?.size === 0) this.observedBy.delete(p.sessionId);
    }
  }

  /**
   * The backstop: the first observed phone whose claim no longer names its
   * session ends this group, by its own id (another group of that session has
   * its own check). A lookup that fails stops nothing. Answers the stop's
   * result when it stopped the group. Never throws.
   */
  private async checkObserverGroup(
    groupId: string,
  ): Promise<Awaited<ReturnType<RecordingOrchestrator['stop']>> | undefined> {
    const group = this.observerGroups.get(groupId);
    if (!group || group.checking) return undefined;
    group.checking = true;
    try {
      for (const p of group.sessions) {
        let holds = true;
        try {
          holds = await this.claimHoldsFn(p.udid, p.sessionId, p.host);
        } catch (err: any) {
          recLog.debug(`Claim check of ${p.udid} (${p.sessionId}) failed: ${err?.message ?? err}`);
        }
        if (this.observerGroups.get(groupId) !== group) return undefined; // stopped meanwhile
        if (!holds) {
          recLog.warn(
            `Observer group ${groupId}: ${p.udid} no longer runs session ${p.sessionId}; stopping the group.`,
          );
          return await this.stopObserverGroup(groupId);
        }
      }
      return undefined;
    } finally {
      group.checking = false;
    }
  }

  /**
   * Fire-and-forget, like the per-device pre-render: burn marks into each
   * part of the composite now so its download is served warm. Only parts
   * with a layout record and marks do any work.
   */
  private prewarmCompositeRender(groupId: string): void {
    void (async () => {
      for (const part of listCompositeParts(groupId)) {
        try {
          if (!fs.existsSync(compositeLayoutPath(groupId, part))) continue;
          const { AnnotationRenderService } = await import('./annotation-render');
          const out = await Container.get(AnnotationRenderService).resolveCompositePath(
            groupId,
            part,
          );
          if (out.annotated) {
            recLog.info(`Pre-rendered annotated composite part ${part} for ${groupId}`);
          }
        } catch (err: any) {
          recLog.warn(
            `Composite pre-render failed for ${groupId} part ${part}: ${err?.message ?? err}`,
          );
        }
      }
    })();
  }

  /** Best effort: without it the video's marks are simply not shifted. */
  private recordTiming(filePath: string, spawnedAtMs: number, groupT0Ms: number): void {
    try {
      writeRecordingTiming(filePath, { spawnedAtMs, groupT0Ms });
    } catch (err: any) {
      recLog.warn(`Recording timing not saved for ${filePath}: ${err?.message ?? err}`);
    }
  }

  /** The group's t=0, from any of its recordings that has a timing record. */
  private async groupT0Ms(groupId: string, exceptId?: string): Promise<number | undefined> {
    try {
      for (const r of (await this.store.listGroup(groupId)) as any[]) {
        if (r.id === exceptId || !r.file_path) continue;
        const t0 = readRecordingTiming(r.file_path)?.groupT0Ms;
        if (t0 !== undefined) return t0;
      }
    } catch {
      /* unknown t=0: leave this device unshifted */
    }
    return undefined;
  }

  /**
   * The group's composite ffmpeg ended on its own while the group still
   * records. Not fatal: each phone has its own recording, which goes on.
   * Noted beside the composite (composite-ended.json), where the downloads
   * read it, and counted as a composite failure. The group's stop still
   * calls stopComposite, which remuxes what was written. Through 2.36 its
   * exit only dropped the pipeline's handle: nobody heard of it.
   */
  private compositeEndedEarly(groupId: string, code: number | null, part = 1): void {
    recLog.warn(
      `Composite${part === 1 ? '' : ` part ${part}`} for group ${groupId} ended on its own (${
        code === null ? 'signal' : `code ${code}`
      }); it covers the group only up to now. The phones' own recordings go on.`,
    );
    compositeFailuresCounter.add(1);
    try {
      const note: CompositeEndedFile = {
        version: 1,
        exitCode: code,
        endedAt: new Date(this.now()).toISOString(),
      };
      const file = compositeEndedPath(groupId, part);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(note, null, 2));
    } catch (err: any) {
      recLog.warn(`Composite end not recorded for ${groupId}: ${err?.message ?? err}`);
    }
  }

  /**
   * Record the composite's cells so marks can be burned into it later. Best
   * effort: without the file the composite is simply served without marks.
   */
  private writeCompositeLayout(
    groupId: string,
    geometry: CompositeGeometry | undefined,
    inputs: Array<{ udid: string; recordingId: string }>,
    part = 1,
    startMs?: number,
  ): void {
    if (!geometry) return;
    try {
      const layout: CompositeLayoutFile = {
        version: 1,
        cellW: geometry.cellW,
        cellH: geometry.cellH,
        cols: geometry.cols,
        rows: geometry.rows,
        cells: inputs.map((input, index) => ({
          index,
          udid: input.udid,
          recordingId: input.recordingId,
        })),
        ...(startMs === undefined ? {} : { startMs }),
      };
      const file = compositeLayoutPath(groupId, part);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(layout, null, 2));
    } catch (err: any) {
      recLog.warn(`Composite layout not recorded for ${groupId}: ${err?.message ?? err}`);
    }
  }

  /**
   * Put the group's phones still recording into a new composite part, after
   * an add-device: through 2.36 the composite kept the phones it started
   * with, and an added phone was in no side-by-side video. The new part
   * starts first and the part in progress stops after it, so the group's
   * side-by-side video has no gap between parts. Changes run one at a time
   * per group (compositeWork), and a stop waits for the one in progress.
   *
   * Resolves once the new part has started, or nothing was started; the old
   * part's stop goes on behind it. Never throws: the phone's own recording
   * has started, and a composite is not worth failing it for.
   */
  private nextCompositePart(groupId: string): Promise<void> {
    let partStarted!: () => void;
    const started = new Promise<void>((resolve) => (partStarted = resolve));
    const prior = this.compositeWork.get(groupId) ?? Promise.resolve();
    const work: Promise<void> = prior
      .then(() => this.startNextPart(groupId, partStarted))
      .catch((err: any) => {
        recLog.warn(`New composite part for group ${groupId} failed: ${err?.message ?? err}`);
        compositeFailuresCounter.add(1);
      })
      .finally(() => {
        partStarted();
        if (this.compositeWork.get(groupId) === work) this.compositeWork.delete(groupId);
      });
    this.compositeWork.set(groupId, work);
    return started;
  }

  /**
   * The next part's work. Its cells are the recordings still running whose
   * port is known here: the current part's cells first, in their order, then
   * the rest in the group's order. Nothing starts for fewer than two (nothing
   * to put side by side), the current part's cells (nothing new), more than
   * the composite's six cells, or a group being stopped.
   */
  private async startNextPart(groupId: string, partStarted: () => void): Promise<void> {
    if (this.stoppingGroups.has(groupId)) return;
    const current = this.composites.get(groupId);
    const rows: any[] = await this.store.listGroup(groupId);
    const live = rows.filter(
      (r) =>
        r.status === 'RECORDING' &&
        this.sourcePorts.has(r.id) &&
        !this.unfinished.has(r.id) &&
        !this.finalizing.has(r.id),
    );
    const rank = (id: string) => {
      const at = current ? current.cells.findIndex((c) => c.recordingId === id) : -1;
      return at < 0 ? Number.MAX_SAFE_INTEGER : at;
    };
    const cells: CompositeCellInput[] = live
      .map((r, order) => ({ r, order }))
      .sort((a, b) => rank(a.r.id) - rank(b.r.id) || a.order - b.order)
      .map(({ r }) => ({
        udid: r.device_udid,
        mjpegPort: this.sourcePorts.get(r.id) as number,
        recordingId: r.id,
      }));
    if (cells.length < 2) return;
    if (
      current &&
      cells.length === current.cells.length &&
      cells.every((c, i) => c.recordingId === current.cells[i].recordingId)
    ) {
      return;
    }
    if (cells.length > COMPOSITE_MAX_INPUTS) {
      recLog.warn(
        `Composite of group ${groupId} unchanged: ${cells.length} phones record, and a composite ` +
          `holds at most ${COMPOSITE_MAX_INPUTS}.`,
      );
      return;
    }
    const t0 = await this.groupT0Ms(groupId);
    if (this.stoppingGroups.has(groupId)) return;
    const part = (current?.part ?? 0) + 1;
    const key = part === 1 ? groupId : `${groupId}#part-${part}`;
    const outputPath = compositeOutputPath(groupId, part);
    const geometry = await this.videoPipeline.startComposite({
      groupId: key,
      inputs: cells.map(({ udid, mjpegPort }) => ({ udid, mjpegPort })),
      outputPath,
      onExit: (code) => this.compositeEndedEarly(groupId, code, part),
    });
    // startComposite resolves as its ffmpeg spawns: this part's t=0.
    const startMs = t0 === undefined ? undefined : Math.max(0, this.now() - t0);
    this.composites.set(groupId, { part, key, cells });
    this.writeCompositeLayout(groupId, geometry, cells, part, startMs);
    recLog.info(
      `Composite part ${part} of group ${groupId} started with ${cells.length} phones → ${outputPath}`,
    );
    partStarted();
    if (!current) return;
    try {
      await this.videoPipeline.stopComposite(current.key);
    } catch (err: any) {
      recLog.warn(
        `Stopping composite part ${current.part} of group ${groupId} failed: ${err?.message ?? err}`,
      );
      compositeFailuresCounter.add(1);
    }
    if (startMs !== undefined) this.noteCompositePartEnd(groupId, current.part, startMs);
  }

  /**
   * A part's marks stop where the next part's start: noted in its layout
   * (`endMs`), so a mark drawn later isn't pinned to its last frame. Best
   * effort: without it a later mark shows briefly at the part's end.
   */
  private noteCompositePartEnd(groupId: string, part: number, endMs: number): void {
    try {
      const file = compositeLayoutPath(groupId, part);
      const layout = JSON.parse(fs.readFileSync(file, 'utf8')) as CompositeLayoutFile;
      fs.writeFileSync(file, JSON.stringify({ ...layout, endMs }, null, 2));
    } catch (err: any) {
      recLog.debug(`Composite part ${part} of ${groupId}: end not noted: ${err?.message ?? err}`);
    }
  }

  /**
   * Fire-and-forget: burn annotations into `<id>.annotated.mp4` right after
   * stop so the dashboard Download is served from a warm cache instead of an
   * on-demand encode. Best-effort — a Download that races this render falls
   * back to the same on-demand path, and any failure is logged, not thrown.
   */
  private prewarmAnnotatedRender(recordingId: string): void {
    void (async () => {
      try {
        const { AnnotationRenderService } = await import('./annotation-render');
        await Container.get(AnnotationRenderService).resolvePlayablePath(recordingId);
        recLog.info(`Pre-rendered annotated mp4 for ${recordingId}`);
      } catch (err: any) {
        recLog.warn(`Annotated pre-render failed for ${recordingId}: ${err?.message ?? err}`);
      }
    })();
  }

  /**
   * Let go of a phone whose recording has ended.
   *
   * This server's own phone goes to the live preview's leave path, as a page
   * that stops watching it does. After a short grace, which also lets this
   * recording's own ffmpeg connection drop, its preview is stopped and its
   * hold released, unless someone watches it or another recording reads it.
   * Whether its stream is running says nothing: the recording starts the
   * stream itself when none runs (ensureMjpegForRecording). Taking that
   * stream for a preview's kept the phone held, with nobody watching, until
   * the stream's idle watchdog ten minutes later.
   *
   * A node's phone has no stream on this server, so nobody here watches it:
   * its hold goes at once.
   */
  private async letGoOfDevice(udid: string, host: string, fromNode: boolean): Promise<void> {
    if (fromNode) {
      await this.tryUnblock(udid, host);
      return;
    }
    this.leaveDeviceFn(udid);
  }

  /**
   * An observer recording's end: it held nothing, so it lets go of nothing,
   * but it may have started the phone's stream (ensureMjpegForRecording, and
   * on Android stopped the H.264 preview for it). This server's own phone
   * goes to the preview's leave path, as a held recording's end does: after
   * the grace its stream stops unless someone watches it or another
   * recording reads it. That path releases only a manual hold, so the
   * phone's session claim stays. A node's phone has no stream here. Through
   * 2.36 nothing was handed back, and the stream ran until its idle
   * watchdog, about ten minutes later.
   */
  private handBackStream(udid: string, fromNode: boolean): void {
    if (!fromNode) this.leaveDeviceFn(udid);
  }

  async addBookmark(
    groupId: string,
    recordingId: string,
    timecodeMs: number,
    label: string,
    note?: string,
  ) {
    const bm = await this.store.addBookmark(recordingId, label, timecodeMs, note);
    this.eventMgr.emitRecordingBookmark({ groupId, bookmark: bm });
    return bm;
  }

  async addAnnotation(
    groupId: string,
    recordingId: string,
    ann: {
      timecodeMs: number;
      shape: string;
      geometry: string;
      color: string;
      text?: string;
      author?: string;
    },
    /** The mark as the preview drew it; burned in instead of the drawbox fallback. */
    png?: Buffer,
  ) {
    const a = await this.store.addAnnotation(recordingId, ann);
    if (png) {
      try {
        const rec: any = await this.store.findById(recordingId);
        if (rec?.file_path) {
          const file = annotationImagePath(rec.file_path, a.id);
          await fs.promises.mkdir(path.dirname(file), { recursive: true });
          await fs.promises.writeFile(file, png);
        }
      } catch (err: any) {
        // The row is saved, so the mark still renders, just with the drawbox fallback.
        recLog.warn(`annotation image not saved for ${a.id}: ${err?.message ?? err}`);
      }
    }
    this.eventMgr.emitRecordingAnnotation({ groupId, annotation: a });
    return a;
  }

  /**
   * "Clear marks": closes the open marks of the group's recordings. With
   * `onlyRecordingIds`, only of those among them: the phones the caller can
   * see, since a group can hold another team's phone. Undefined means the
   * whole group, which is what the button does for an admin.
   */
  async clearAnnotations(
    groupId: string,
    timecodeMs: number,
    onlyRecordingIds?: string[],
  ): Promise<{ cleared: number }> {
    const rows = await this.store.listGroup(groupId);
    const ids = rows
      .map((r: any) => r.id as string)
      .filter((id) => !onlyRecordingIds || onlyRecordingIds.includes(id));
    const cleared = await this.store.clearAnnotations(ids, timecodeMs);
    return { cleared };
  }

  /**
   * Add a single phone, by udid and host, to a running recording group.
   * Atomic — if the group is no longer recording, the phone is busy or the
   * concurrency cap would be exceeded, no row is written and no ffmpeg is
   * spawned. Once its recording runs, the group's composite moves to a new
   * part with the phone in it (nextCompositePart).
   */
  async addDevice(
    groupId: string,
    phone: RecordedPhone,
    actorId: string,
  ): Promise<{ recording: StartedRecording }> {
    ensureOtelInstruments();
    if (!actorId) {
      throw new Error('RecordingOrchestrator.addDevice: actorId is required');
    }
    // An observer group records the sessions it was started with, nothing else.
    if (this.isObserverGroup(groupId)) {
      throw new RecordingError('observer_group');
    }

    const span = trace.getTracer('xenon.recording').startSpan('xenon.recording.add_device', {
      attributes: { [ATTR.RECORDING_GROUP_ID]: groupId },
    });
    attemptsCounter.add(1);

    try {
      const result = await this._addDeviceInternal(groupId, phone, actorId);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err: any) {
      const failReason = err instanceof RecordingError ? err.code : (err?.message ?? 'unknown');
      failuresCounter.add(1, { fail_reason: failReason });
      span.setAttributes({ [ATTR.RECORDING_FAIL_REASON]: failReason });
      span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR, message: failReason });
      throw err;
    } finally {
      span.end();
    }
  }

  /**
   * Whether a group still records: a stop isn't closing it, and a row of it
   * other than `exceptId` is RECORDING and isn't one whose finalize write
   * failed (its capture has stopped).
   */
  private async groupIsRecording(groupId: string, exceptId?: string): Promise<boolean> {
    if (this.stoppingGroups.has(groupId)) return false;
    const rows: any[] = await this.store.listGroup(groupId);
    return rows.some(
      (r) => r.id !== exceptId && r.status === 'RECORDING' && !this.unfinished.has(r.id),
    );
  }

  private async _addDeviceInternal(
    groupId: string,
    phone: RecordedPhone,
    actorId: string,
  ): Promise<{ recording: StartedRecording }> {
    // Through 2.36 a phone could be added to a group stopped the day before:
    // its recording ran alone, under a group nobody would stop again.
    if (!(await this.groupIsRecording(groupId))) {
      throw new RecordingError('group_not_recording');
    }
    const taken = this.reservePhones([phone]);
    try {
      return await this.addReservedDevice(groupId, phone, actorId);
    } finally {
      this.releasePhones(taken);
    }
  }

  private async addReservedDevice(
    groupId: string,
    phone: RecordedPhone,
    actorId: string,
  ): Promise<{ recording: StartedRecording }> {
    const { udid, host } = phone;
    // Layer 2 atomic pre-check: busy state.
    const busy = await this.busyPrecheck.findBusy([phone], actorId);
    if (busy.length > 0) {
      throw new RecordingError('device_busy', busy);
    }

    const recordingId = uuidv4();
    if (!this.gate.tryAcquire([recordingId])) {
      throw new RecordingError(
        'concurrency_cap',
        undefined,
        this.gate.getLimit(),
        this.gate.activeCount(),
      );
    }

    try {
      await this.blockDeviceFn(udid, host, formatManualLock(actorId, udid));
    } catch (err: any) {
      this.gate.release(recordingId);
      throw new RecordingError('device_busy', [{ udid, reason: 'unknown' }]);
    }

    const filePath = (Container.get(ARTIFACT_STORE) as ArtifactStore).resolve(
      recordingId,
      'video',
      `${recordingId}.mp4`,
    );
    let rowWritten = false;
    try {
      const mjpegPort = await this.sourcePort(recordingId, phone, actorId);
      await this.store.create({
        id: recordingId,
        groupId,
        deviceUdid: udid,
        deviceHost: host,
        filePath,
        sessionId: null,
        deviceSnapshot: null,
        startedBy: actorId,
      });
      rowWritten = true;
      // The source port can take a while (a node's relay): a stop that read
      // the group meanwhile didn't see this row, and would never stop it.
      if (!(await this.groupIsRecording(groupId, recordingId))) {
        throw new RecordingError('group_not_recording');
      }
      await this.videoPipeline.startRecording({
        sessionId: recordingId,
        udid,
        outputPath: filePath,
        mjpegPort,
        // As for a group's first phones: a source that ends finalizes the row.
        // Through 2.36 an added phone had no onExit, and its row stayed
        // RECORDING until a Stop or a restart.
        onExit: (code) => void this.handleSourceEnded(recordingId, code),
      });
      this.sourcePorts.set(recordingId, mjpegPort);
      // Joined after t=0: its marks shift back by how late it started.
      const spawnedAtMs = this.now();
      const groupT0Ms = await this.groupT0Ms(groupId, recordingId);
      if (groupT0Ms !== undefined) this.recordTiming(filePath, spawnedAtMs, groupT0Ms);
    } catch (err: any) {
      recLog.error(`Failed to add device ${udid} to group ${groupId}: ${err?.message}`);
      await this.closeNodeSource(recordingId);
      const stopped = err instanceof RecordingError && err.code === 'group_not_recording';
      await this.endFailedStart({
        id: recordingId,
        groupId,
        phone,
        rowWritten,
        failReason: stopped ? 'group_not_recording' : failReasonFromError('spawn_failed', err),
        release: () => this.tryUnblock(udid, host),
      });
      this.eventMgr.emitRecordingFailed({
        groupId,
        recordingId,
        udid,
        host,
        reason: err?.message ?? 'spawn_failed',
      });
      throw err;
    }

    const recording: StartedRecording = { id: recordingId, udid, host, status: 'RECORDING' };
    this.eventMgr.emitRecordingStarted({
      groupId,
      recordings: [{ id: recordingId, udid, host }],
      startedAt: new Date(),
    });
    await this.nextCompositePart(groupId);
    return { recording };
  }

  /**
   * Boot-time recovery: any RECORDING row left from a previous process is
   * marked FAILED with reason=server_restart and its manual block is released.
   * Mirrors the existing session-cleanup pattern.
   */
  async recoverOnBoot(): Promise<void> {
    ensureOtelInstruments();
    let orphans: any[];
    try {
      orphans = await this.store.listActive();
    } catch (err: any) {
      recLog.warn(`recoverOnBoot listActive failed: ${err?.message}`);
      return;
    }
    for (const o of orphans) {
      const host = o.device_host ?? '127.0.0.1';
      // Its hold goes only once this ends the row: a row another server ended
      // meanwhile was let go of there. A write that fails every try is kept
      // and written again on the timer.
      const outcome = await this.writeEnd(o.id, {
        groupId: o.group_id,
        udid: o.device_udid,
        host,
        input: { status: 'FAILED', failReason: 'server_restart', endedAt: new Date() },
        release: async () => {
          if (await this.stillHoldsOwnHold(o, host)) await this.tryUnblock(o.device_udid, host);
        },
      });
      if (outcome === 'won') failuresCounter.add(1, { fail_reason: 'server_restart' });
    }
    if (orphans.length > 0) {
      recLog.warn(`Recovered ${orphans.length} orphan recordings on boot.`);
    }

    // Also free devices that still hold a manual_* lock with no live stream
    // (e.g. process death after stream/start but before stream/stop).
    try {
      const { DeviceStoreFactory } = await import('../../data-service/device-store');
      const { isManualLock } = await import('./manualLock');
      const devices = await DeviceStoreFactory.getStore().getDevices({});
      for (const d of devices) {
        if (!d.busy || !isManualLock(d.session_id)) continue;
        let live = false;
        try {
          const { default: IOSStreamService } =
            await import('../../device-managers/ios/IOSStreamService');
          if (Container.get(IOSStreamService).getStreamStatus(d.udid)) live = true;
        } catch {
          /* ignore */
        }
        if (!live) {
          try {
            const { default: AndroidStreamService } =
              await import('../../device-managers/android/AndroidStreamService');
            if (Container.get(AndroidStreamService).getStreamStatus(d.udid)) live = true;
          } catch {
            /* ignore */
          }
        }
        if (!live) {
          try {
            const { default: AndroidH264StreamService } =
              await import('../../device-managers/android/AndroidH264StreamService');
            if (Container.get(AndroidH264StreamService).getMultiplexer(d.udid)) live = true;
          } catch {
            /* ignore */
          }
        }
        if (live) continue;
        recLog.warn(
          `recoverOnBoot: releasing orphaned manual lock on ${d.udid} (${d.session_id})`,
        );
        await this.tryUnblock(d.udid, d.host);
      }
    } catch (err: any) {
      recLog.warn(`recoverOnBoot manual-lock sweep failed: ${err?.message}`);
    }
  }

  /**
   * Whether a leftover recording's phone still holds that recording's own hold
   * (`manual_<started_by>_<udid>`, or any manual hold for a row that names no
   * starter). Anything else on the phone is someone else's: an observer
   * recording's phone runs its session, which on a hub can outlive the
   * restart, and releasing it would end that session's claim. A row that
   * can't be read is left alone.
   */
  private async stillHoldsOwnHold(o: any, host: string): Promise<boolean> {
    try {
      const device = await DeviceStoreFactory.getStore().findDevice({
        udid: o.device_udid,
        host,
      });
      const held = o.started_by
        ? device?.session_id === formatManualLock(o.started_by, o.device_udid)
        : isManualLock(device?.session_id);
      if (!held) {
        recLog.debug(
          `recoverOnBoot: ${o.device_udid} no longer holds recording ${o.id}'s hold; leaving it.`,
        );
      }
      return held;
    } catch (err: any) {
      recLog.debug(
        `recoverOnBoot: could not read ${o.device_udid}'s row; leaving it: ${err?.message ?? err}`,
      );
      return false;
    }
  }

  /**
   * The loopback port a recording reads: this server's own phone's MJPEG
   * stream, or, for another server's phone, a relay to the node its host
   * names, kept until the recording is finalized (nodeRecordingSource.ts).
   */
  private async sourcePort(
    recordingId: string,
    phone: RecordedPhone,
    actorId: string,
  ): Promise<number> {
    const relay = await this.nodeSourceFn(phone, actorId);
    if (!relay) return this.ensureMjpegPortFn(phone.udid, phone.host);
    this.nodeSources.set(recordingId, relay);
    return relay.port;
  }

  private async closeNodeSource(recordingId: string): Promise<void> {
    const relay = this.nodeSources.get(recordingId);
    if (!relay) return;
    this.nodeSources.delete(recordingId);
    await relay.close().catch((err: any) => {
      recLog.warn(`Closing the node relay of ${recordingId} failed: ${err?.message ?? err}`);
    });
  }

  private async tryUnblock(udid: string, host: string): Promise<void> {
    try {
      await this.unblockDeviceFn(udid, host);
    } catch (err: any) {
      recLog.warn(`Best-effort unblock failed for ${udid}@${host}: ${err?.message}`);
    }
  }
}
