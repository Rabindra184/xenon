import { MetricSample, clamp, round1 } from './types';

/** What one `adb shell` sample reads. Jiffies are cumulative since boot. */
export interface AndroidReading {
  cpuTotal: number;
  cpuIdle: number;
  memTotalKb: number | null;
  memAvailableKb: number | null;
  pid: number | null;
  appJiffies: number | null;
  appRssKb: number | null;
}

/**
 * An Android package name: two or more dot-separated identifiers. A session's
 * appPackage is client input and goes into a shell command, so nothing else
 * is ever used.
 */
export function isSafePackage(pkg: unknown): pkg is string {
  return typeof pkg === 'string' && /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(pkg);
}

/** A session's appPackage capability, in either spelling. Not yet validated. */
export function appPackageOf(caps: Record<string, unknown> | undefined): unknown {
  return caps?.['appium:appPackage'] ?? caps?.appPackage;
}

/** The one shell command a sample runs: device CPU and memory, then the app's. */
export function androidSampleCommand(pkg: string | null): string {
  const device = 'head -1 /proc/stat; grep -e ^MemTotal: -e ^MemAvailable: /proc/meminfo';
  if (pkg === null) return device;
  if (!isSafePackage(pkg)) throw new Error(`not a package name: ${pkg}`);
  return (
    `${device}; p=$(pidof ${pkg} | cut -d' ' -f1); echo "pid=$p"; ` +
    'if [ -n "$p" ]; then echo "stat=$(cut -d" " -f14,15 /proc/$p/stat)"; grep VmRSS /proc/$p/status; fi'
  );
}

const num = (m: RegExpMatchArray | null): number | null => (m ? Number(m[1]) : null);

export function parseAndroidReading(out: string): AndroidReading | null {
  const cpu = out.match(/^cpu\s+([\d\s]+)$/m);
  if (!cpu) return null;
  const f = cpu[1].trim().split(/\s+/).map(Number);
  if (f.length < 4 || f.some((n) => !Number.isFinite(n))) return null;
  // user nice system idle iowait irq softirq steal; guest time is already in user.
  const cpuTotal = f.slice(0, 8).reduce((a, b) => a + b, 0);
  const cpuIdle = f[3] + (f[4] ?? 0);
  const pid = num(out.match(/^pid=(\d+)\s*$/m));
  const stat = out.match(/^stat=(\d+) (\d+)\s*$/m);
  return {
    cpuTotal,
    cpuIdle,
    memTotalKb: num(out.match(/^MemTotal:\s+(\d+) kB/m)),
    memAvailableKb: num(out.match(/^MemAvailable:\s+(\d+) kB/m)),
    pid,
    appJiffies: pid !== null && stat ? Number(stat[1]) + Number(stat[2]) : null,
    appRssKb: pid !== null ? num(out.match(/^VmRSS:\s+(\d+) kB/m)) : null,
  };
}

const pct = (share: number): number => round1(clamp(share * 100, 0, 100));
const mb = (kb: number): number => round1(kb / 1024);

/**
 * A sample from this reading and the one before it. CPU needs both: the
 * first sample has none, and the app's needs the same process in both, so a
 * restarted app shows no CPU for one sample rather than a spike.
 */
export function androidSample(
  prev: AndroidReading | null,
  cur: AndroidReading,
  appId: string | null,
  at: number,
): MetricSample {
  let deviceCpuPct: number | null = null;
  let appCpuPct: number | null = null;
  const dTotal = prev ? cur.cpuTotal - prev.cpuTotal : 0;
  if (prev && dTotal > 0) {
    deviceCpuPct = pct(1 - (cur.cpuIdle - prev.cpuIdle) / dTotal);
    if (
      cur.pid !== null &&
      cur.pid === prev.pid &&
      cur.appJiffies !== null &&
      prev.appJiffies !== null
    ) {
      appCpuPct = pct((cur.appJiffies - prev.appJiffies) / dTotal);
    }
  }
  const hasApp = cur.pid !== null;
  return {
    at,
    deviceCpuPct,
    deviceMemMb:
      cur.memTotalKb !== null && cur.memAvailableKb !== null
        ? mb(cur.memTotalKb - cur.memAvailableKb)
        : null,
    deviceMemTotalMb: cur.memTotalKb !== null ? mb(cur.memTotalKb) : null,
    appCpuPct,
    appMemMb: hasApp && cur.appRssKb !== null ? mb(cur.appRssKb) : null,
    appId: hasApp ? appId : null,
  };
}

/** The foreground app from `dumpsys activity activities`, before and after Android 10. */
export function parseForegroundPackage(dumpsys: string): string | null {
  const m = dumpsys.match(
    /(?:topResumedActivity|mResumedActivity)[:=]\s*ActivityRecord\{\S+ u\d+ ([^\s/]+)\//,
  );
  return m && isSafePackage(m[1]) ? m[1] : null;
}
