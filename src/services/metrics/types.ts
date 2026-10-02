/**
 * One CPU and memory reading of a session's phone. CPU is a share of the
 * whole device (0–100); memory is in MB. A figure the platform can't give,
 * or the first sample's CPU (it needs a previous reading), is null.
 */
export interface MetricSample {
  at: number;
  deviceCpuPct: number | null;
  deviceMemMb: number | null;
  deviceMemTotalMb: number | null;
  appCpuPct: number | null;
  appMemMb: number | null;
  /** The package the app figures are for (Android), else null. */
  appId: string | null;
}

/** How often a session's phone is sampled. */
export const SAMPLE_INTERVAL_MS = 2_000;
/** How often a session's samples are written; a crash loses at most this much. */
export const FLUSH_INTERVAL_MS = 10_000;
/** A sampler that fails this many times in a row stops for its session. */
export const MAX_CONSECUTIVE_FAILURES = 5;
/** How long a looked-up foreground app is trusted (Android, no appPackage). */
export const FOREGROUND_REFRESH_MS = 10_000;
/** How often an iPhone sampler asks for its phone's tunnel again. */
export const TUNNEL_RENEW_MS = 30_000;
/** Samples waiting for a write that keeps failing: the newest 30 minutes. */
export const MAX_BUFFERED_SAMPLES = 900;

export interface SamplerHooks {
  onSample(sample: MetricSample): void;
  /** The sampler stopped itself after repeated failures. */
  onGiveUp(reason: string): void;
}

export interface MetricsSampler {
  start(): void;
  stop(): Promise<void>;
}

export const round1 = (n: number): number => Math.round(n * 10) / 10;
export const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
