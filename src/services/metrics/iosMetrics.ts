import { clamp, round1 } from './types';

/**
 * Device CPU % from one line of `ios sysmontap`, or null for any other line.
 * go-ios logs JSON lines; a reading is {"msg":"received CPU usage data",
 * "enabled_cpus":6,"cpu_total_load":77.5,...}. The load is summed over the
 * cores (an idle 6-core iPhone 14 Plus read 77 to 125), so it is divided by
 * them.
 */
export function parseSysmontapCpu(line: string): number | null {
  let o: any;
  try {
    o = JSON.parse(line);
  } catch {
    return null;
  }
  if (!o || typeof o.cpu_total_load !== 'number' || !Number.isFinite(o.cpu_total_load)) {
    return null;
  }
  const cores = [o.enabled_cpus, o.cpu_count].find((n) => typeof n === 'number' && n > 0) ?? 1;
  return round1(clamp(o.cpu_total_load / cores, 0, 100));
}
