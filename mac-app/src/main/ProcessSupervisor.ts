import { spawn, ChildProcess } from 'node:child_process';
import { createWriteStream, writeFileSync, type WriteStream } from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import type { LogLine, Profile, ServerState } from '@shared/types';
import { buildLaunchPlan, type BuildContext } from './LaunchBuilder';
import { buildEnv, which } from './env';
import { logsDir } from './paths';

const READY_MARKERS = [/Appium REST http interface listener started/i, /Could not start REST http/i];
const STOP_GRACE_MS = 8000;
const MAX_BUFFERED_LOGS = 5000;

export interface SupervisorDeps {
  resolveAppiumHome(profile: Profile): string;
  resolveConfigYamlPath(profile: Profile): string;
  /** Decrypt the secrets a profile references. Returns a partial map. */
  resolveSecrets(profile: Profile): BuildContext['secretValues'];
  /** Defaults for schema-required keys, merged into the generated config. */
  requiredDefaults(): Record<string, unknown>;
}

/**
 * Owns the single supervised Appium+Xenon child process. Emits:
 *  - 'log'   (LogLine)      streamed stdout/stderr/system lines
 *  - 'state' (ServerState)  every lifecycle transition
 */
export class ProcessSupervisor extends EventEmitter {
  private child: ChildProcess | null = null;
  private state: ServerState = ProcessSupervisor.idleState();
  private logs: LogLine[] = [];
  private stopTimer: NodeJS.Timeout | null = null;
  private logStream: WriteStream | null = null;

  constructor(private deps: SupervisorDeps) {
    super();
  }

  private static idleState(): ServerState {
    return {
      status: 'stopped',
      profileId: null,
      pid: null,
      port: null,
      dashboardUrl: null,
      startedAt: null,
      logFile: null,
      exitCode: null,
      exitSignal: null,
      lastError: null
    };
  }

  getState(): ServerState {
    return this.state;
  }

  getLogs(): LogLine[] {
    return this.logs;
  }

  isActive(): boolean {
    return this.state.status === 'starting' || this.state.status === 'running' || this.state.status === 'stopping';
  }

  private setState(patch: Partial<ServerState>): void {
    this.state = { ...this.state, ...patch };
    this.emit('state', this.state);
  }

  private pushLog(stream: LogLine['stream'], text: string): void {
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/\s+$/, '');
      if (!line) continue;
      const entry: LogLine = { ts: Date.now(), stream, text: line };
      this.logs.push(entry);
      if (this.logs.length > MAX_BUFFERED_LOGS) this.logs.shift();
      this.logStream?.write(`${new Date(entry.ts).toISOString()} [${stream}] ${line}\n`);
      this.emit('log', entry);
      this.maybeDetectReady(line);
    }
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

  async start(profile: Profile): Promise<ServerState> {
    if (this.isActive()) {
      throw new Error('A server is already running. Stop it before starting another.');
    }

    const appiumBin = await which('appium');
    if (!appiumBin) {
      const msg = 'Could not find the `appium` binary on PATH. Install Appium 3 (npm i -g appium).';
      this.setState({ status: 'crashed', lastError: msg });
      throw new Error(msg);
    }

    const appiumHome = this.deps.resolveAppiumHome(profile);
    const configYamlPath = this.deps.resolveConfigYamlPath(profile);
    const secretValues = this.deps.resolveSecrets(profile);

    const plan = buildLaunchPlan(profile, {
      appiumHome,
      configYamlPath,
      secretValues,
      requiredDefaults: this.deps.requiredDefaults()
    });
    writeFileSync(configYamlPath, plan.spec.configYaml, 'utf8');

    // Open a per-run log file for audit/support (timestamped, profile-named).
    const safeName = profile.name.replace(/[^a-z0-9-_]+/gi, '_').slice(0, 40) || 'server';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logFile = path.join(logsDir(), `${safeName}-${stamp}.log`);
    this.logStream = createWriteStream(logFile, { flags: 'a' });

    this.logs = [];
    this.setState({
      status: 'starting',
      profileId: profile.id,
      port: profile.server.port,
      dashboardUrl: null,
      startedAt: Date.now(),
      logFile,
      exitCode: null,
      exitSignal: null,
      lastError: null
    });
    this.pushLog('system', `Launching: ${appiumBin} ${plan.args.join(' ')}`);
    this.pushLog('system', `APPIUM_HOME=${appiumHome}`);

    const env = await buildEnv(plan.env);
    const child = spawn(appiumBin, plan.args, { env, cwd: appiumHome });
    this.child = child;
    this.setState({ pid: child.pid ?? null });

    child.stdout?.on('data', (b: Buffer) => this.pushLog('stdout', b.toString('utf8')));
    child.stderr?.on('data', (b: Buffer) => this.pushLog('stderr', b.toString('utf8')));

    child.on('error', (err) => {
      this.pushLog('system', `Process error: ${err.message}`);
      this.setState({ status: 'crashed', lastError: err.message });
      this.cleanup();
    });

    child.on('exit', (code, signal) => {
      if (this.stopTimer) {
        clearTimeout(this.stopTimer);
        this.stopTimer = null;
      }
      const wasStopping = this.state.status === 'stopping';
      this.pushLog('system', `Process exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`);
      this.setState({
        status: wasStopping || code === 0 ? 'stopped' : 'crashed',
        pid: null,
        exitCode: code,
        exitSignal: signal,
        lastError: wasStopping || code === 0 ? null : `Appium exited with code ${code ?? signal}`
      });
      this.cleanup();
    });

    return this.state;
  }

  /** Graceful stop: SIGINT (lets Xenon reap go-ios/iproxy sidecars) then SIGTERM/SIGKILL. */
  async stop(): Promise<void> {
    if (!this.child || !this.isActive()) return;
    const child = this.child;
    this.setState({ status: 'stopping' });
    this.pushLog('system', 'Stopping server (SIGINT)…');
    child.kill('SIGINT');

    this.stopTimer = setTimeout(() => {
      if (this.child === child && !child.killed) {
        this.pushLog('system', 'Still running after grace period; sending SIGKILL.');
        child.kill('SIGKILL');
      }
    }, STOP_GRACE_MS);
  }

  /** Synchronous best-effort teardown for app quit. */
  killNow(): void {
    if (this.child && this.isActive()) {
      try {
        this.child.kill('SIGINT');
      } catch {
        /* ignore */
      }
    }
  }

  private cleanup(): void {
    this.child = null;
    this.logStream?.end();
    this.logStream = null;
  }
}
