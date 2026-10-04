export type BugReportMode = 'slice' | 'full';

export interface BugReportOptions {
  sessionId: string;
  mode: BugReportMode;
  windowSec?: number;
  /**
   * Whether to add the session's network capture (`network.har`). It holds
   * every request the app made, headers and bodies included, so it goes only
   * to those who may read it on /interceptor: admins. Leaving it out is the
   * default.
   */
  includeNetwork?: boolean;
}

export interface ResolvedWindow {
  startedAt: string;
  endedAt: string;
  durationMs: number;
  requestedDurationMs: number;
}

export interface ManifestArtifacts {
  video: string | null;
  logs: string;
  network: string | null;
  aiSummary: string | null;
  screenshots: string[];
}

export interface Manifest {
  schemaVersion: '1.0';
  generatedAt: string;
  xenonVersion: string;
  mode: BugReportMode;
  window: ResolvedWindow;
  session: {
    id: string;
    status: string;
    startedAt: string | null;
    endedAt: string | null;
    durationMs: number | null;
  };
  device: {
    udid: string;
    platform: string;
    name: string | null;
    osVersion: string;
  };
  capabilities: Record<string, unknown>;
  lastCommand: { name: string; args: unknown; errorMessage: string | null } | null;
  artifacts: ManifestArtifacts;
  warnings: string[];
}

export const SLICE_DEFAULT_SEC = 60;
export const SLICE_MIN_SEC = 5;
export const SLICE_MAX_SEC = 600;
