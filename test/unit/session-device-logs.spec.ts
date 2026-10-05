import 'reflect-metadata';
import { expect } from 'chai';
import request from 'supertest';
import { PassThrough } from 'stream';
import {
  LogcatStreamService,
  type ChildProcessLike,
} from '../../src/device-managers/android/LogcatStreamService';
import type { LogcatMultiplexer } from '../../src/device-managers/android/LogcatMultiplexer';
import { PackageResolver } from '../../src/services/logcat/PackageResolver';
import { SessionDeviceLogs, WRITE_BATCH } from '../../src/services/logcat/SessionDeviceLogs';
import {
  DEVICE_LOG_ERROR_LIMIT,
  DEVICE_LOG_LINE_LIMIT,
  UNKNOWN_CLOCK,
  type DeviceClock,
  type DeviceLogLine,
} from '../../src/services/logcat/deviceLogBook';
import type { IDevice } from '../../src/interfaces/IDevice';
import { useScratchDatabase } from '../helpers/scratch-database';
import { ADMIN, selectorHealthApp } from '../helpers/selector-health-fixture';

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

// How the Device logs tab reads a line's level for its "Errors only" filter
// (web log-derive.ts `logLineLevel`, whose own tests hold it to lines in the
// shape these rows have; the web package can't be imported here).
const DASHBOARD_THREADTIME = /^\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+\s+\d+\s+\d+\s+([VDIWEF])\s/;
const levelOf = (message: string) => DASHBOARD_THREADTIME.exec(message)?.[1] ?? null;

/** A threadtime line logged at `at` by this machine's local clock. */
function lineAt(at: number, msg: string, level = 'I', tag = 'Tag', pid = 4127): string {
  const t = new Date(at);
  return (
    `${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}:` +
    `${pad(t.getSeconds())}.${pad(t.getMilliseconds(), 3)}  ${pid}  ${pid} ${level} ${tag}: ${msg}\n`
  );
}

/** An `adb logcat` child whose output the test writes. */
function fakeProc() {
  const stdout = new PassThrough();
  const handlers: Record<string, ((a?: unknown) => void)[]> = {};
  return {
    stdout,
    killed: false,
    on(ev: string, cb: (a?: unknown) => void) {
      (handlers[ev] ||= []).push(cb);
    },
    /** The process ends, as when the phone restarts or is unplugged. */
    exit() {
      stdout.end();
      (handlers.close || []).forEach((h) => h());
    },
    kill() {
      this.killed = true;
    },
  };
}
type FakeProc = ReturnType<typeof fakeProc>;

/** The real stream service, its `adb logcat` children fake. */
class FakeLogcatStreams extends LogcatStreamService {
  procs: FakeProc[] = [];
  protected async spawnLogcat(): Promise<ChildProcessLike> {
    const proc = fakeProc();
    this.procs.push(proc);
    return proc as unknown as ChildProcessLike;
  }
  protected makeResolver(): PackageResolver {
    return new PackageResolver(async () => '  PID NAME\n 4127 com.example.app\n');
  }
  get proc(): FakeProc {
    return this.procs[this.procs.length - 1];
  }
}

class TestDeviceLogs extends SessionDeviceLogs {
  clock: DeviceClock | null = UNKNOWN_CLOCK;
  /** The size of each write, in order. */
  writes: number[] = [];
  constructor(readonly logcat: FakeLogcatStreams) {
    super();
  }
  protected context() {
    return { pluginArgs: { bindHostOrIp: '127.0.0.1' }, port: 4723, nodeId: 'this-server' } as any;
  }
  protected streams() {
    return this.logcat;
  }
  protected async readClock() {
    return this.clock;
  }
  protected flushIntervalMs() {
    return 60_000;
  }
  protected retryFirstMs() {
    return 1;
  }
  protected async writeLines(sessionId: string, lines: DeviceLogLine[], first: number) {
    this.writes.push(lines.length);
    await super.writeLines(sessionId, lines, first);
  }
}

const PHONE: IDevice = {
  udid: 'phone-1',
  platform: 'android',
  host: 'http://127.0.0.1:4723',
  nodeId: 'this-server',
} as IDevice;

/** Lets readline, the stream's package lookups and the mux deliver what was written. */
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
};

const until = async (check: () => boolean, ms = 2_000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
};

/** The session's Device logs as the session page gets them. */
async function deviceLogs(
  sessionId: string,
): Promise<Array<{ message: string; timestamp: string }>> {
  const res = await request(selectorHealthApp(ADMIN)).get(`/session/${sessionId}/logs/device`);
  expect(res.status, res.text).to.equal(200);
  return res.body;
}

const textOf = (rows: Array<{ message: string }>) =>
  rows.map((r) => r.message.replace(/^.*?Tag {5}: /, ''));

describe("An Android session's Device logs", function () {
  this.timeout(60_000);
  const scratch = useScratchDatabase();
  let logcat: FakeLogcatStreams;
  let logs: TestDeviceLogs;
  let sessionId: string;
  let count = 0;

  beforeEach(async () => {
    count += 1;
    sessionId = `dl-session-${count}`;
    await scratch.db.session.create({
      data: {
        id: sessionId,
        device_udid: PHONE.udid,
        device_platform: 'android',
        device_version: '10',
        desired_capabilities: '{}',
        session_capabilities: '{}',
        node_id: 'this-server',
        has_live_video: false,
      },
    });
    logcat = new FakeLogcatStreams();
    logs = new TestDeviceLogs(logcat);
  });

  afterEach(async () => {
    await logs.stop(sessionId);
    await logcat.cleanup();
  });

  it('keeps the lines after the first 100, each once, in order, however many commands ran', async () => {
    const since = Date.now() - 60_000;
    await logs.start({ sessionId, device: PHONE, since });
    // History from before the session, as `logcat -T` sends it first.
    for (let i = 0; i < 20; i++) logcat.proc.stdout.write(lineAt(since - 600_000 + i, `old ${i}`));
    // 250 lines over the run, a batch between each "command".
    for (let batch = 0; batch < 5; batch++) {
      for (let i = 0; i < 50; i++) {
        const n = batch * 50 + i;
        logcat.proc.stdout.write(lineAt(since + 1_000 + n, `line ${n}`));
      }
      await settle();
    }

    await logs.stop(sessionId);

    const rows = await deviceLogs(sessionId);
    expect(textOf(rows)).to.deep.equal(Array.from({ length: 250 }, (_, n) => `line ${n}`));
  });

  it("keeps each line's level and time, so Errors only finds a crash", async () => {
    const since = Date.now() - 60_000;
    await logs.start({ sessionId, device: PHONE, since });
    const crashAt = since + 30_123;
    logcat.proc.stdout.write(
      lineAt(crashAt - 5, 'Start proc com.example.app', 'I', 'ActivityManager'),
    );
    logcat.proc.stdout.write(lineAt(crashAt, 'FATAL EXCEPTION: main', 'E', 'AndroidRuntime'));
    logcat.proc.stdout.write(
      lineAt(crashAt, 'Process: com.example.app, PID: 4127', 'E', 'AndroidRuntime'),
    );
    logcat.proc.stdout.write(
      lineAt(crashAt + 1, 'Sending signal. PID: 4127 SIG: 9', 'I', 'Process'),
    );
    await settle();
    await logs.stop(sessionId);

    const rows = await deviceLogs(sessionId);

    expect(rows.map((r) => levelOf(r.message))).to.deep.equal(['I', 'E', 'E', 'I']);
    expect(rows.map((r) => new Date(r.timestamp).getTime())).to.deep.equal([
      crashAt - 5,
      crashAt,
      crashAt,
      crashAt + 1,
    ]);
    expect(rows[1].message).to.match(/ E AndroidRuntime: FATAL EXCEPTION: main$/);
  });

  it("keeps a stack trace's lines in order, though they share a millisecond and a write", async () => {
    const since = Date.now() - 60_000;
    await logs.start({ sessionId, device: PHONE, since });
    const at = since + 10_000;
    const frames = Array.from(
      { length: 40 },
      (_, i) => `\tat com.example.Frame${i}.run(Frame.java:${i})`,
    );
    for (const frame of frames) logcat.proc.stdout.write(lineAt(at, frame, 'E', 'AndroidRuntime'));
    await settle();
    await logs.stop(sessionId);

    const rows = await deviceLogs(sessionId);
    expect(rows.map((r) => r.message.replace(/^.*AndroidRuntime: /, ''))).to.deep.equal(frames);
    // SQLite returns rows of one `createdAt` in the order they were written,
    // and Postgres in any order: each row's `createdAt` is its own.
    const created = rows.map((r: any) => new Date(r.createdAt).getTime());
    expect(
      created.every((t, i) => i === 0 || t > created[i - 1]),
      String(created),
    ).to.equal(true);
  });

  it('writes as the session runs, in batches, not a row at a time', async () => {
    const since = Date.now() - 60_000;
    await logs.start({ sessionId, device: PHONE, since });
    for (let i = 0; i < WRITE_BATCH + 10; i++)
      logcat.proc.stdout.write(lineAt(since + i, `line ${i}`));
    await settle();

    // A full batch is written while the session runs, without waiting for
    // its end or the interval (a minute here).
    const written = () => scratch.db.log.count({ where: { session_id: sessionId } });
    const end = Date.now() + 2_000;
    while ((await written()) < WRITE_BATCH && Date.now() < end) await settle();
    expect(await written()).to.be.at.least(WRITE_BATCH);
    expect(logs.isRecording(sessionId)).to.equal(true);

    await logs.stop(sessionId);
    expect(await written()).to.equal(WRITE_BATCH + 10);
    expect(logs.writes).to.have.length(2);
    expect(Math.max(...logs.writes)).to.equal(WRITE_BATCH);
  });

  it('picks up again after the phone restarts, without saving its history twice', async () => {
    const since = Date.now() - 60_000;
    await logs.start({ sessionId, device: PHONE, since });
    const first = logcat.proc;
    first.stdout.write(lineAt(since + 1_000, 'before 1'));
    first.stdout.write(lineAt(since + 2_000, 'before 2'));
    await settle();

    first.exit();
    await until(() => logcat.procs.length === 2);
    // The new stream starts with history the session already has, then a
    // line of the same millisecond it hadn't seen, then new lines.
    logcat.proc.stdout.write(lineAt(since + 1_000, 'before 1'));
    logcat.proc.stdout.write(lineAt(since + 2_000, 'before 2'));
    logcat.proc.stdout.write(lineAt(since + 2_000, 'also at 2'));
    logcat.proc.stdout.write(lineAt(since + 9_000, 'after'));
    await settle();
    await logs.stop(sessionId);

    expect(textOf(await deviceLogs(sessionId))).to.deep.equal([
      'before 1',
      'before 2',
      "Xenon: The phone's log was interrupted. Lines may be missing from here.",
      'also at 2',
      'after',
    ]);
  });

  it("shares the phone's stream with the Logs viewer, and never stops it", async () => {
    const since = Date.now() - 60_000;
    const mux = await logcat.start(PHONE.udid);
    const viewer: string[] = [];
    mux.addClient(
      (r) => viewer.push(r.message),
      () => true,
    );

    await logs.start({ sessionId, device: PHONE, since });
    expect(logcat.procs).to.have.length(1);
    logcat.proc.stdout.write(lineAt(since + 1, 'shared'));
    await settle();
    await logs.stop(sessionId);

    expect(viewer).to.deep.equal(['shared']);
    expect(logcat.proc.killed).to.equal(false);
    expect(logcat.getMultiplexer(PHONE.udid)).to.equal(mux);
    expect(textOf(await deviceLogs(sessionId))).to.deep.equal(['shared']);
  });

  it('keeps the stream from its idle stop while the session runs, and lets it go after', async () => {
    await logs.start({ sessionId, device: PHONE, since: Date.now() });
    const mux = logcat.getMultiplexer(PHONE.udid) as LogcatMultiplexer;
    expect(mux.emptySince).to.equal(undefined);

    await logs.stop(sessionId);

    expect(mux.emptySince).to.be.a('number');
  });

  it(`holds to ${DEVICE_LOG_LINE_LIMIT} lines, then ${DEVICE_LOG_ERROR_LIMIT} errors`, async () => {
    const since = Date.now() - 600_000;
    await logs.start({ sessionId, device: PHONE, since });
    const total = DEVICE_LOG_LINE_LIMIT + 3_000;
    let chunk = '';
    for (let i = 0; i < total; i++) {
      // Past the limit, five lines in six are errors: 2,500 errors, 500 others.
      const level = i >= DEVICE_LOG_LINE_LIMIT && i % 6 !== 0 ? 'E' : 'D';
      chunk += lineAt(since + 1_000 + i, `line ${i}`, level);
      if (i % 1_000 === 999) {
        logcat.proc.stdout.write(chunk);
        chunk = '';
        await settle();
      }
    }
    await settle();
    await logs.stop(sessionId);

    const rows = await deviceLogs(sessionId);
    expect(rows).to.have.length(DEVICE_LOG_LINE_LIMIT + 1 + DEVICE_LOG_ERROR_LIMIT + 1);
    expect(textOf(rows.slice(0, DEVICE_LOG_LINE_LIMIT))).to.deep.equal(
      Array.from({ length: DEVICE_LOG_LINE_LIMIT }, (_, i) => `line ${i}`),
    );
    expect(rows[DEVICE_LOG_LINE_LIMIT].message).to.equal(
      'Xenon: This session reached 10,000 device log lines. From here on, only errors are kept.',
    );
    const errors = rows.slice(DEVICE_LOG_LINE_LIMIT + 1, -1);
    expect(errors.every((r) => levelOf(r.message) === 'E')).to.equal(true);
    expect(rows[rows.length - 1].message).to.equal(
      "Xenon: 1,000 device log lines were left out to keep this session's log within its limit.",
    );
  });

  it("only records this server's own Android phones", () => {
    expect(logs.appliesTo(PHONE)).to.equal(true);
    expect(logs.appliesTo({ ...PHONE, nodeId: 'a-node' } as IDevice)).to.equal(false);
    expect(logs.appliesTo({ ...PHONE, platform: 'ios' } as IDevice)).to.equal(false);
    expect(logs.appliesTo({ ...PHONE, cloud: true } as unknown as IDevice)).to.equal(false);
    expect(logs.appliesTo(undefined)).to.equal(false);
  });

  it("reads lines as this server's time when the phone's clock can't be read", async () => {
    logs.clock = null;
    const since = Date.now() - 60_000;
    await logs.start({ sessionId, device: PHONE, since });
    logcat.proc.stdout.write(lineAt(since - 600_000, 'before'));
    logcat.proc.stdout.write(lineAt(since + 10, 'during'));
    await settle();
    await logs.stop(sessionId);

    expect(textOf(await deviceLogs(sessionId))).to.deep.equal(['during']);
  });

  it('stops however often it is told to', async () => {
    await logs.start({ sessionId, device: PHONE, since: Date.now() });
    await logs.stop(sessionId);
    await logs.stop(sessionId);
    expect(logs.isRecording(sessionId)).to.equal(false);
  });

  it('starts nothing when stopped before the phone answered', async () => {
    let answer!: (c: DeviceClock) => void;
    logs.clock = null;
    (logs as any).readClock = () => new Promise<DeviceClock>((r) => (answer = r));
    const started = logs.start({ sessionId, device: PHONE, since: Date.now() });
    await logs.stop(sessionId);
    answer(UNKNOWN_CLOCK);
    await started;

    expect(logcat.procs).to.have.length(0);
  });
});
