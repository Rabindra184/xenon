import { spawn, ChildProcess } from 'node:child_process';
import { createWriteStream, writeFileSync, type WriteStream } from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import type { CrashLine, LaunchSpec, LogLine, Profile, ServerState, XenonSchema } from '@shared/types';
import { LOG_LINES_KEPT, crashLineOf } from '@shared/logView';
import { buildLaunchPlan, skippedSettingsLine, type BuildContext, type LaunchPlan } from './LaunchBuilder';
import { requiredDefaults } from './configDefaults';
import { buildEnv, which } from './env';
import { logsDir } from './paths';
import { LogBatcher } from './logBatcher';
import { StopEscalator } from './stopEscalation';
import { fileStem } from './fileNames';

const READY_MARKERS = [/Appium REST http interface listener started/i, /Could not start REST http/i];
// Log-emit coalescing. Appium's boot / iOS-streaming output is a firehose;
// emitting (and IPC-serialising) one line at a time stalls the Electron main
// thread. These bound it to at most one 'log' emit per window or per batch.
const LOG_EMIT_FLUSH_MS = 80;
const LOG_EMIT_MAX_BATCH = 250;
/**
 * How long a crash's line waits for the server's output to close after it exits. The close is when
 * the last lines it printed are in (they can come after the exit); a helper the server started can
 * hold its output open, so the line is settled after this at the latest.
 */
export const CRASH_LINES_WAIT_MS = 2000;

/** What marks a line: shown with technical details off (`always`), or a problem with no error word (`problem`). */
interface LineMarks {
  always?: boolean;
  problem?: boolean;
}

/** Same line, by id and words (or both none). */
const sameLine = (a: CrashLine | null, b: CrashLine | null): boolean =>
  a === b || (a !== null && b !== null && a.id === b.id && a.text === b.text);

export interface SupervisorDeps {
  resolveAppiumHome(profile: Profile): string;
  resolveConfigYamlPath(profile: Profile): string;
  /** Decrypt the secrets a profile references. Returns a partial map. */
  resolveSecrets(profile: Profile): BuildContext['secretValues'];
  /** The option list of the Xenon this profile will start; see SchemaService.effectiveSchema(). */
  schemaFor(profile: Profile): XenonSchema;
}

/**
 * Owns the single supervised Appium+Xenon child process, and the lines Logs shows (R67): the run's
 * output, the app's own system lines, and its diagnostics, each with an id from one counter for the
 * app's whole life. A window reads them when it opens (getLogs) and clears them (clearLogs); after a
 * crash, the line Home quotes is worked out here and kept in the state (`crashLine`). Emits:
 *  - 'log'   (LogLine[])    streamed stdout/stderr/system lines, coalesced
 *  - 'state' (ServerState)  every lifecycle transition, and a crash's line once it is settled
 */
export class ProcessSupervisor extends EventEmitter {
  private child: ChildProcess | null = null;
  private state: ServerState = ProcessSupervisor.idleState();
  private logs: LogLine[] = [];
  private nextLogId = 1;
  /**
   * A crash whose line waits for the server's output to close: that child, the lines there were at
   * the exit with every line since (a Clear in between changes nothing), and the timer that settles
   * it if the close never comes.
   */
  private crashWait: { child: ChildProcess; lines: LogLine[]; timer: ReturnType<typeof setTimeout> } | null = null;
  private stopWaiters: Array<() => void> = [];
  private logStream: WriteStream | null = null;
  private readonly logBatcher: LogBatcher<LogLine>;
  private readonly escalator: StopEscalator;

  constructor(private deps: SupervisorDeps) {
    super();
    this.escalator = new StopEscalator({
      kill: (signal) => {
        try {
          this.child?.kill(signal);
        } catch {
          /* already gone */
        }
      },
      // The stop steps tell the person how the server is ending, so Logs always shows them.
      log: (text) => this.pushLog('system', text, { always: true })
    });
    this.logBatcher = new LogBatcher<LogLine>({
      flushMs: LOG_EMIT_FLUSH_MS,
      maxBatch: LOG_EMIT_MAX_BATCH,
      onFlush: (batch) => this.emit('log', batch)
    });
  }

  private static idleState(): ServerState {
    return {
      status: 'stopped',
      profileId: null,
      pid: null,
      port: null,
      basePath: null,
      appiumHome: null,
      dashboardUrl: null,
      startedAt: null,
      logFile: null,
      exitCode: null,
      exitSignal: null,
      lastError: null,
      crashLine: null
    };
  }

  getState(): ServerState {
    return this.state;
  }

  /** The lines kept now, oldest first: what a window that opens starts from. */
  getLogs(): LogLine[] {
    return this.logs;
  }

  /**
   * Clear in Logs: the lines the window had, through the newest of them (`throughId`), go here too,
   * so a window opened later doesn't bring them back. Lines after it (on their way to the window
   * when it cleared) stay, as they do there. A crash's line is not changed.
   */
  clearLogs(throughId: number): void {
    this.logs = this.logs.filter((l) => l.id > throughId);
  }

  /**
   * A line of the app's own for Logs that is not about the run (a diagnostic, a downloaded update):
   * kept and sent with the run's lines, under the same ids. With technical details only, unless `always`.
   */
  note(text: string, marks: Pick<LineMarks, 'always'> = {}): void {
    for (const line of this.linesOf(text)) this.keep('system', line, marks);
  }

  isActive(): boolean {
    return this.state.status === 'starting' || this.state.status === 'running' || this.state.status === 'stopping';
  }

  private setState(patch: Partial<ServerState>): void {
    this.state = { ...this.state, ...patch };
    this.emit('state', this.state);
  }

  /** The non-empty lines of some text, without the spaces they end in. */
  private linesOf(text: string): string[] {
    return text
      .split(/\r?\n/)
      .map((raw) => raw.replace(/\s+$/, ''))
      .filter((line) => line !== '');
  }

  /** Gives a line its id, keeps it (the oldest beyond LOG_LINES_KEPT go), and queues it for the window. */
  private keep(stream: LogLine['stream'], text: string, marks: LineMarks): LogLine {
    const entry: LogLine = {
      id: this.nextLogId++,
      ts: Date.now(),
      stream,
      text,
      ...(marks.always ? { always: true } : {}),
      ...(marks.problem ? { problem: true } : {})
    };
    this.logs.push(entry);
    if (this.logs.length > LOG_LINES_KEPT) this.logs.shift();
    this.crashWait?.lines.push(entry);
    // Coalesced for the renderer.
    this.logBatcher.push(entry);
    return entry;
  }

  /**
   * A line of the run: kept, written to the run's log file, and read for readiness. `always` marks a
   * system line Logs shows even with technical details off (LogLine.always); the lines that leave it
   * out are for technical details only. `problem` marks a crash's exit line (R68).
   */
  private pushLog(stream: LogLine['stream'], text: string, marks: LineMarks = {}): void {
    for (const line of this.linesOf(text)) {
      const entry = this.keep(stream, line, marks);
      this.logStream?.write(`${new Date(entry.ts).toISOString()} [${stream}] ${line}\n`);
      // Readiness detection stays per-line + synchronous so the 'running' transition is never
      // delayed by batching.
      this.maybeDetectReady(line);
    }
  }

  /**
   * After a crash's exit: its line is worked out again once the server's output has closed (or
   * CRASH_LINES_WAIT_MS on), from the lines there were at the exit and those that came after.
   */
  private awaitCrashLines(child: ChildProcess): void {
    this.endCrashWait();
    const timer = setTimeout(() => this.settleCrashLine(child), CRASH_LINES_WAIT_MS);
    (timer as { unref?: () => void }).unref?.();
    this.crashWait = { child, lines: this.logs.slice(), timer };
  }

  /** The crash's line, settled: announced only when the late lines changed it. Once per crash. */
  private settleCrashLine(child: ChildProcess): void {
    const wait = this.crashWait;
    if (wait === null || wait.child !== child) return;
    this.endCrashWait();
    if (this.state.status !== 'crashed') return;
    const crashLine = crashLineOf(wait.lines);
    if (!sameLine(crashLine, this.state.crashLine)) this.setState({ crashLine });
  }

  private endCrashWait(): void {
    if (this.crashWait !== null) clearTimeout(this.crashWait.timer);
    this.crashWait = null;
  }

  private maybeDetectReady(line: string): void {
    if (this.state.status !== 'starting') return;
    if (READY_MARKERS[0].test(line)) {
      const host = this.state.dashboardUrl ? null : '127.0.0.1';
      const port = this.state.port;
      const dashboardUrl = host && port ? `http://${host}:${port}/xenon/` : this.state.dashboardUrl;
      this.setState({ status: 'running', dashboardUrl });
    }
  }

  /** The launch plan for a profile, as start() makes it: its Appium folder, its Keychain secrets, the option list it will start. */
  private planFor(profile: Profile): { plan: LaunchPlan; appiumHome: string; configYamlPath: string } {
    const appiumHome = this.deps.resolveAppiumHome(profile);
    const configYamlPath = this.deps.resolveConfigYamlPath(profile);
    const schema = this.deps.schemaFor(profile);
    const plan = buildLaunchPlan(profile, {
      appiumHome,
      configYamlPath,
      secretValues: this.deps.resolveSecrets(profile),
      schema,
      requiredDefaults: requiredDefaults(schema),
      // The child inherits this process's environment under the plan's (buildEnv).
      inheritedEnv: process.env
    });
    return { plan, appiumHome, configYamlPath };
  }

  /**
   * The launch a start of this profile would make, for the preview: the same
   * plan, Keychain secrets and all, but only its renderer-safe description
   * (env names, never values). Writes and starts nothing.
   */
  preview(profile: Profile): LaunchSpec {
    return this.planFor(profile).plan.spec;
  }

  async start(profile: Profile): Promise<ServerState> {
    if (this.isActive()) {
      throw new Error('A server is already running. Stop it before starting another.');
    }

    // A new start ends whatever the last crash was waiting for, and its line goes.
    this.endCrashWait();
    const appiumBin = await which('appium');
    if (!appiumBin) {
      const msg = 'Could not find the `appium` binary on PATH. Install Appium 3 (npm i -g appium).';
      this.setState({ status: 'crashed', lastError: msg, crashLine: null });
      throw new Error(msg);
    }

    const { plan, appiumHome, configYamlPath } = this.planFor(profile);
    writeFileSync(configYamlPath, plan.spec.configYaml, 'utf8');

    // Open a per-run log file for audit/support (timestamped, profile-named).
    const safeName = fileStem(profile.name, 'server', 40);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logFile = path.join(logsDir(), `${safeName}-${stamp}.log`);
    this.logStream = createWriteStream(logFile, { flags: 'a' });

    this.logs = [];
    this.setState({
      status: 'starting',
      profileId: profile.id,
      port: profile.server.port,
      basePath: profile.server.basePath,
      appiumHome: typeof profile.server.appiumHome === 'string' ? profile.server.appiumHome : '',
      dashboardUrl: null,
      startedAt: Date.now(),
      logFile,
      exitCode: null,
      exitSignal: null,
      lastError: null,
      crashLine: null
    });
    this.pushLog('system', `Launching: ${appiumBin} ${plan.args.join(' ')}`);
    this.pushLog('system', `APPIUM_HOME=${appiumHome}`);
    const skippedLine = skippedSettingsLine(plan.skippedSettings);
    if (skippedLine) this.pushLog('system', skippedLine);

    const env = await buildEnv(plan.env);
    const child = spawn(appiumBin, plan.args, { env, cwd: appiumHome });
    this.child = child;
    this.setState({ pid: child.pid ?? null });

    child.stdout?.on('data', (b: Buffer) => this.pushLog('stdout', b.toString('utf8')));
    child.stderr?.on('data', (b: Buffer) => this.pushLog('stderr', b.toString('utf8')));

    child.on('error', (err) => {
      this.pushLog('system', `Process error: ${err.message}`, { always: true });
      this.setState({ status: 'crashed', lastError: err.message, crashLine: crashLineOf(this.logs) });
      this.escalator.exited();
      this.cleanup();
    });

    child.on('exit', (code, signal) => {
      this.escalator.exited();
      const wasStopping = this.state.status === 'stopping';
      const crashed = !(wasStopping || code === 0);
      // A crash's exit line is a problem though it has no error word (R68); a requested stop's is not.
      this.pushLog('system', `Process exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`, {
        always: true,
        problem: crashed
      });
      // Said at once, from the lines in now; the lines still on their way are read once the
      // output has closed (awaitCrashLines).
      if (crashed) this.awaitCrashLines(child);
      this.setState({
        status: crashed ? 'crashed' : 'stopped',
        pid: null,
        exitCode: code,
        exitSignal: signal,
        lastError: crashed ? `Appium exited with code ${code ?? signal}` : null,
        crashLine: crashed ? crashLineOf(this.logs) : null
      });
      this.cleanup();
    });

    // Both of its outputs have closed: every line the server printed is in.
    child.on('close', () => this.settleCrashLine(child));

    return this.state;
  }

  /** Graceful stop: SIGINT (lets Xenon drain and reap go-ios/iproxy sidecars), then SIGTERM/SIGKILL. */
  async stop(): Promise<void> {
    if (!this.child || !this.isActive()) return;
    this.setState({ status: 'stopping' });
    this.escalator.begin();
  }

  /** Resolves once no child is running; at once if none is. */
  whenStopped(): Promise<void> {
    if (!this.child) return Promise.resolve();
    return new Promise((resolve) => this.stopWaiters.push(resolve));
  }

  /**
   * Skip the graceful wait (a second quit): SIGTERM now so Xenon's 'exit' hook
   * can still reap its sidecars, then SIGKILL 2 s later if it is still alive; at
   * once if the stop ladder has already sent SIGTERM. No-op when no child is running.
   */
  forceStop(): void {
    if (!this.child) return;
    // A forced stop is still a requested stop: report Stopped, not Crashed.
    if (this.state.status !== 'stopping') this.setState({ status: 'stopping' });
    this.escalator.forceQuick();
  }

  private cleanup(): void {
    this.child = null;
    this.logBatcher.flush(); // push any trailing lines (e.g. the exit notice) now
    this.logStream?.end();
    this.logStream = null;
    const waiters = this.stopWaiters;
    this.stopWaiters = [];
    for (const resolve of waiters) resolve();
  }
}
