import EventEmitter from 'events';
import B from 'bluebird';
import _ from 'lodash';
import { SubProcess, exec } from 'teen_process';

export interface ProfilingData {
  timestamp: string;
  cpu: string;
  memory: string;
  total_cpu_used: number;
  total_memory_used: number;
  raw_cpu_log: string;
  raw_memory_log: string;
}

export interface DeviceInfo {
  total_cpu: number;
  total_memory: number | string;
  api_level: number;
}

export class AndroidAppProfiler extends EventEmitter {
  private adb: any;
  private logs: Array<ProfilingData>;
  private deviceUDID: string;
  private appPackage: string;
  private proc: SubProcess | null;
  private deviceInfo?: DeviceInfo;

  constructor(opts: { adb: any; deviceUDID: string; appPackage: string }) {
    super();
    this.adb = opts.adb;
    this.logs = [];
    this.deviceUDID = opts.deviceUDID;
    this.appPackage = opts.appPackage;
    this.proc = null;
  }

  async startCapture(): Promise<void> {
    let started = false;

    return await new B(async (resolve_B, _reject_B) => {
      const resolve = function (...args: any[]) {
        started = true;
        resolve_B(...args);
      };

      const _reject = function (...args: any[]) {
        started = true;
        _reject_B(...args);
      };

      this.deviceInfo = await this.getDeviceInfo();
      const defaultArgs = this.adb.executable?.defaultArgs || [];
      const cmd = [
        ...defaultArgs,
        '-s',
        this.deviceUDID,
        'shell',
        'top',
        '-o',
        '%CPU,RSS,ARGS',
        '-s',
        '1',
        '-d',
        '2',
      ];

      /* -m argument is only supported after api level 28 */
      if (_.isNumber(this.deviceInfo.api_level) && this.deviceInfo.api_level >= 28) {
        cmd.push('-m', '20');
      }

      this.proc = new SubProcess(this.adb.executable?.path || 'adb', cmd);
      this.proc.on('exit', (_code, _signal) => {
        this.proc = null;
        if (!started) {
          resolve();
        }
      });

      this.proc.on('lines-stdout', (lines: string[]) => {
        resolve();
        if (!lines[3]) {
          return;
        }
        const slicedLines = lines.slice(4);
        const sysInfo = {
          total_cpu_used: this.getSystemCpuUsage(lines[3]),
          total_memory_used: this.getSystemMemoryUsage(lines[1]),
          raw_cpu_log: lines[3],
          raw_memory_log: lines[1],
        };
        /* Logs received is not in proper format so ignore the entry */
        if (sysInfo.total_cpu_used == 0 && sysInfo.total_memory_used == 0) {
          return;
        }
        for (const line of slicedLines) {
          if (new RegExp(/\r/g).test(line)) {
            line
              .split(/\r/g)
              .filter((l: string) => !!l)
              .forEach((l: string) => this.outputHandler(sysInfo, _.trim(l)));
          } else {
            this.outputHandler(sysInfo, _.trim(line));
          }
        }
      });
      await this.proc.start(0);
    });
  }

  private outputHandler(
    generalCpuInfo: {
      total_cpu_used: number;
      total_memory_used: number;
      raw_cpu_log: string;
      raw_memory_log: string;
    },
    output: string,
  ) {
    //remove all ascii characters from the log line
    /* eslint-disable no-control-regex */
    output = output.replace(
      /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
      '',
    );
    // Use a regex to split by one or more spaces and filter out any empty strings
    const parts = output.trim().split(/\s+/);
    if (parts.length < 3) {
      return;
    }
    const [cpu, memory, pkg] = parts;

    // Filter out invalid samples or headers that cause graph 'drops to zero'
    if (!cpu || cpu === '0' || cpu === '%CPU' || isNaN(parseFloat(cpu))) {
      return;
    }

    const outputObj: ProfilingData = {
      timestamp: new Date().toISOString(),
      cpu: cpu || '0',
      memory: memory || '0',
      ...generalCpuInfo,
    };
    if (pkg === this.appPackage) {
      this.logs.push(outputObj);
      this.emit('output', outputObj);
    }
  }

  async stopCapture(): Promise<void> {
    if (!this.proc || !this.proc.isRunning) {
      this.proc = null;
      return;
    }
    this.proc.removeAllListeners('exit');
    await this.proc.stop();
    this.proc = null;
  }

  getLogs(): ProfilingData[] {
    return _.uniqBy(this.logs, 'timestamp');
  }

  async getDeviceInfo(): Promise<DeviceInfo> {
    return {
      total_cpu: await this.getTotalCpus(),
      total_memory: await this.getTotalMemory(),
      api_level: await this.getAndroidApiLevel(),
    };
  }

  private async getAndroidApiLevel(): Promise<number> {
    if (this.deviceInfo?.api_level) return this.deviceInfo.api_level;
    const defaultArgs = this.adb.executable?.defaultArgs || [];
    const args = [
      ...defaultArgs,
      '-s',
      this.deviceUDID,
      'shell',
      'getprop',
      'ro.build.version.sdk',
    ];
    const out = await exec(this.adb.executable?.path || 'adb', args);
    return Number(out.stdout.trim());
  }

  private async getTotalCpus(): Promise<number> {
    const defaultArgs = this.adb.executable?.defaultArgs || [];
    const args = [...defaultArgs, '-s', this.deviceUDID, 'shell', 'cat', '/proc/cpuinfo'];
    const out = await exec(this.adb.executable?.path || 'adb', args);
    return out.stdout.match(/processor/g)?.length || 0;
  }

  private async getTotalMemory(): Promise<number | string> {
    const defaultArgs = this.adb.executable?.defaultArgs || [];
    const args = [...defaultArgs, '-s', this.deviceUDID, 'shell', 'cat', '/proc/meminfo'];
    const out = await exec(this.adb.executable?.path || 'adb', args);
    const match = out.stdout.match(/MemTotal:.*[0-9]/g);
    if (match && match.length) {
      return match[0].replace(/[^0-9]/g, '');
    }
    return 0;
  }

  private getSystemCpuUsage(logLine: string): number {
    if (!logLine) {
      return 0;
    }
    const data: Record<string, any> = {};
    ['cpu', 'idle'].forEach((type: string) => {
      const match = logLine.match(new RegExp(`([0-9]{0,})%${type}`));
      data[type] = match && match.length > 1 ? Number(match[1]) : 0;
    });

    let out = 0;
    ['user', 'nice', 'sys', 'iow', 'irq', 'sirq', 'host'].forEach((type: string) => {
      const match = logLine.match(new RegExp(`([0-9]{0,})%${type}`));
      out += match && match.length > 1 ? Number(match[1]) : 0;
    });
    return out > data['cpu'] ? data['cpu'] : out;
  }

  private getSystemMemoryUsage(logLine: string): number {
    if (!logLine) {
      return 0;
    }
    let match = logLine.match(new RegExp(/([0-9]{0,})k used/i));
    /* In some devices, memory will be shown in GB, so convert it back to KB */
    if (!match) {
      /* sample logLine "Mem:      5.5G total,      5.4G used,       71M free,       36M buffers" */
      match = logLine.match(new RegExp(/(([1-9]\d*)(\.\d+)?)G used/i));
      return match && match.length > 1 ? Math.ceil(parseFloat(match[1]) * 1024 * 1024) : 0;
    }
    return match && match.length > 1 ? Number(match[1]) : 0;
  }
}
