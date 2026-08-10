import { Service } from 'typedi';
import { ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import log from '../logger';

export type TrackedKind =
  | 'wda'
  | 'ffmpeg'
  | 'adb-reverse'
  | 'ios-mjpeg'
  | 'log-tailer'
  | 'other';

export interface TrackedProcess {
  id: string;
  sessionId?: string;
  udid?: string;
  kind: TrackedKind;
  pid: number;
  process: ChildProcess;
  startedAt: number;
}

export interface TerminateOptions {
  gracefulMs?: number;
}

@Service()
export class ProcessRegistry {
  private log = log.scope('ProcessRegistry');
  private processes = new Map<string, TrackedProcess>();

  track(opts: { sessionId?: string; udid?: string; kind: TrackedKind; process: ChildProcess }): string {
    const id = randomUUID();
    const entry: TrackedProcess = {
      id,
      sessionId: opts.sessionId,
      udid: opts.udid,
      kind: opts.kind,
      pid: opts.process.pid || -1,
      process: opts.process,
      startedAt: Date.now(),
    };
    this.processes.set(id, entry);
    opts.process.once('exit', () => this.processes.delete(id));
    return id;
  }

  untrack(id: string): void {
    this.processes.delete(id);
  }

  snapshot(): TrackedProcess[] {
    return Array.from(this.processes.values());
  }

  async terminate(id: string, { gracefulMs = 5000 }: TerminateOptions = {}): Promise<void> {
    const entry = this.processes.get(id);
    if (!entry) return;
    const { process: child, pid, kind } = entry;

    const exited = new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
    });

    try {
      if (process.platform === 'win32') {
        child.kill('SIGTERM');
      } else {
        try {
          process.kill(-pid, 'SIGTERM');
        } catch {
          child.kill('SIGTERM');
        }
      }
    } catch (err: any) {
      this.log.debug(`SIGTERM failed for ${kind}/${pid}: ${err.message}`);
    }

    const timedOut = await Promise.race([
      exited.then(() => false),
      new Promise<boolean>((r) => setTimeout(() => r(true), gracefulMs)),
    ]);

    if (timedOut) {
      try {
        if (process.platform === 'win32') {
          child.kill('SIGKILL');
        } else {
          try {
            process.kill(-pid, 'SIGKILL');
          } catch {
            child.kill('SIGKILL');
          }
        }
      } catch (err: any) {
        this.log.warn(`SIGKILL failed for ${kind}/${pid}: ${err.message}`);
      }
    }

    this.processes.delete(id);
  }

  async terminateForSession(sessionId: string, opts?: TerminateOptions): Promise<void> {
    const targets = this.snapshot().filter((p) => p.sessionId === sessionId);
    await Promise.all(targets.map((t) => this.terminate(t.id, opts)));
  }

  async terminateForUdid(udid: string, opts?: TerminateOptions): Promise<void> {
    const targets = this.snapshot().filter((p) => p.udid === udid);
    await Promise.all(targets.map((t) => this.terminate(t.id, opts)));
  }

  async terminateAll(opts?: TerminateOptions): Promise<void> {
    const targets = this.snapshot();
    await Promise.all(targets.map((t) => this.terminate(t.id, opts)));
  }

  /**
   * SIGKILL every tracked process group, synchronously. The last-resort net
   * for `terminateAll()`.
   *
   * `terminateAll()` is async and runs in the shutdown handler's Phase 3, and
   * on SIGTERM that phase does not run: Appium's own handler closes the HTTP
   * server and exits the process first — measured against a real device, the
   * log reaches "Shutdown signal received" and Appium's "Received SIGTERM",
   * then the process is gone without ever logging "sanitized". Everything
   * tracked here — go-ios, WDA, iproxy, ffmpeg — was surviving that exit.
   *
   * `process.on('exit')` is the last hook that always runs and it forbids
   * async work, which rules out `terminate()`'s SIGTERM-then-wait-then-SIGKILL
   * escalation: there is no later tick in which to observe the wait. So this
   * goes straight to SIGKILL. That is the right trade at this point — the
   * alternative is not a graceful stop, it is an orphan.
   *
   * Negative pid targets the process GROUP, matching `terminate()`, so a
   * sidecar's own children (iproxy under go-ios) go with it.
   */
  killAllSync(): number {
    let killed = 0;
    for (const { process: child, pid, kind } of this.processes.values()) {
      try {
        if (process.platform === 'win32') {
          child.kill('SIGKILL');
        } else {
          try {
            process.kill(-pid, 'SIGKILL');
          } catch {
            child.kill('SIGKILL');
          }
        }
        killed += 1;
      } catch {
        /* already gone is the desired state; never throw from an exit hook */
        void kind;
      }
    }
    this.processes.clear();
    return killed;
  }
}
