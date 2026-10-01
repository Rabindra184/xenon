/** GET /xenon/api/session-summary: the Sessions page's summary strip. */
export interface ISessionPeriodCounts {
  total: number;
  passed: number;
  failed: number;
  running: number;
}

export interface ISessionSummary {
  /** Start of the period, or null for all time (or one build). */
  since: string | null;
  current: ISessionPeriodCounts & { medianMs: number | null; p90Ms: number | null };
  /** The period of the same length before it; null without one. */
  previous: ISessionPeriodCounts | null;
  runningNow: { sessions: number; devices: number };
}
