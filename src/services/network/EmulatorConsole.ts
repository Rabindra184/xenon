import net from 'net';
import os from 'os';
import path from 'path';
import { promises as fsp } from 'fs';
import type { IDevice } from '../../interfaces/IDevice';

/**
 * An Android emulator's network shaping, as its console reports it:
 * `network status` gives speeds in bits/s (0: no limit) and latency in ms.
 */
export interface EmulatorShape {
  upKbps: number;
  downKbps: number;
  minLatencyMs: number;
  maxLatencyMs: number;
}

/** No limit and no delay: an emulator as it starts. */
export const UNSHAPED: EmulatorShape = { upKbps: 0, downKbps: 0, minLatencyMs: 0, maxLatencyMs: 0 };

/** How long one console conversation may take. */
export const CONSOLE_TIMEOUT_MS = 5_000;

/**
 * The console port of an emulator this server drives itself, or undefined.
 * Its serial is `emulator-<port>`, and the console listens on 127.0.0.1 at
 * that port. Only for an emulator on this machine's adb: one seen through a
 * remote adb server (`adbRemoteHost`) has its console on that machine, and
 * 127.0.0.1:<port> could be another emulator altogether.
 */
export function emulatorConsolePort(
  device: Pick<IDevice, 'udid' | 'platform' | 'realDevice'> & {
    adbRemoteHost?: string | null;
  },
): number | undefined {
  if (device.platform?.toLowerCase() !== 'android' || device.realDevice) return undefined;
  if (device.adbRemoteHost) return undefined;
  const match = /^emulator-(\d{2,5})$/.exec(device.udid);
  if (!match) return undefined;
  const port = Number(match[1]);
  return port > 0 && port < 65536 ? port : undefined;
}

/**
 * The emulator console's commands for a shape: speed `<up>:<down>` in kbps
 * (`full` for no limit) and delay `<min>:<max>` in ms (`none` for none).
 */
export function shapeCommands(shape: EmulatorShape): string[] {
  const speed = shape.upKbps || shape.downKbps ? `${shape.upKbps}:${shape.downKbps}` : 'full';
  const delay =
    shape.minLatencyMs || shape.maxLatencyMs
      ? `${shape.minLatencyMs}:${shape.maxLatencyMs}`
      : 'none';
  return [`network speed ${speed}`, `network delay ${delay}`];
}

/** The shape in `network status`'s answer. Throws when it isn't one. */
export function parseNetworkStatus(text: string): EmulatorShape {
  const bits = (label: string) => {
    const m = new RegExp(`${label} speed:\\s*(\\d+) bits/s`, 'i').exec(text);
    if (!m) throw new Error(`no ${label} speed in the console's network status`);
    return Math.round(Number(m[1]) / 1000);
  };
  const ms = (label: string) => {
    const m = new RegExp(`${label} latency:\\s*(\\d+) ms`, 'i').exec(text);
    if (!m) throw new Error(`no ${label} latency in the console's network status`);
    return Number(m[1]);
  };
  return {
    upKbps: bits('upload'),
    downKbps: bits('download'),
    minLatencyMs: ms('minimum'),
    maxLatencyMs: ms('maximum'),
  };
}

/**
 * Talks to an emulator's console over its TCP port (ENH-20). `adb emu`
 * passes commands on but answers nothing on current adb versions, so the
 * shape set can't be read back through it; the console itself answers each
 * command with `OK` or `KO: <why>`.
 *
 * When the emulator asks for authentication, the token is the one the
 * emulator writes for this user (`~/.emulator_console_auth_token`); an empty
 * file turns authentication off, as the emulator reads it.
 */
export class EmulatorConsole {
  constructor(
    private readonly port: number,
    private readonly opts: { host?: string; timeoutMs?: number; tokenFile?: string } = {},
  ) {}

  /** The emulator's current shape. */
  async readShape(): Promise<EmulatorShape> {
    const [status] = await this.run(['network status']);
    return parseNetworkStatus(status);
  }

  /** Sets the emulator's shape. */
  async applyShape(shape: EmulatorShape): Promise<void> {
    await this.run(shapeCommands(shape));
  }

  /** Each command's answer, the text before its `OK`. Throws on `KO`, a timeout or no console. */
  async run(commands: string[]): Promise<string[]> {
    const token = await this.token();
    return new Promise<string[]>((resolve, reject) => {
      const socket = net.connect({ host: this.opts.host ?? '127.0.0.1', port: this.port });
      const answers: string[] = [];
      const queue = [...(token ? [`auth ${token}`] : []), ...commands];
      const authing = token ? 1 : 0;
      let buffer = '';
      let current = '';
      let greeted = false;
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        if (error) reject(error);
        else resolve(answers.slice(authing));
      };
      const timer = setTimeout(
        () => finish(new Error(`the emulator console on port ${this.port} didn't answer in time`)),
        this.opts.timeoutMs ?? CONSOLE_TIMEOUT_MS,
      );
      const next = () => {
        const command = queue.shift();
        if (command === undefined) {
          socket.write('quit\r\n');
          return finish();
        }
        current = '';
        socket.write(`${command}\r\n`);
      };
      socket.setEncoding('utf8');
      socket.on('error', (e) =>
        finish(new Error(`no emulator console on port ${this.port}: ${e.message}`)),
      );
      socket.on('close', () =>
        finish(new Error(`the emulator console on port ${this.port} closed the connection`)),
      );
      socket.on('data', (chunk: string) => {
        buffer += chunk;
        let nl: number;
        while ((nl = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, nl).replace(/\r$/, '');
          buffer = buffer.slice(nl + 1);
          if (line === 'OK') {
            if (!greeted) greeted = true;
            else answers.push(current.trimEnd());
            next();
          } else if (line.startsWith('KO')) {
            return finish(
              new Error(
                `the emulator console refused a command: ${line.slice(2).replace(/^:\s*/, '')}`,
              ),
            );
          } else if (greeted) {
            current += `${line}\n`;
          }
        }
      });
    });
  }

  /** The console auth token, or undefined when the file is missing or empty. */
  private async token(): Promise<string | undefined> {
    const file = this.opts.tokenFile ?? path.join(os.homedir(), '.emulator_console_auth_token');
    try {
      const value = (await fsp.readFile(file, 'utf8')).trim();
      return value || undefined;
    } catch {
      return undefined;
    }
  }
}
