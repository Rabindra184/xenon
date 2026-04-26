import { redactSecrets } from '../../logger';
import {
  BugReportMode,
  Manifest,
  ManifestArtifacts,
  ResolvedWindow,
} from './types';

interface SessionRow {
  id: string;
  status: string;
  startTime: Date | string;
  endTime: Date | string | null;
  device_udid: string;
  device_platform: string;
  device_name: string | null;
  device_version: string;
  desired_capabilities: string | null;
  failure_reason: string | null;
  ai_analysis: string | null;
}

export interface BuildManifestInput {
  session: SessionRow;
  window: ResolvedWindow;
  mode: BugReportMode;
  xenonVersion: string;
  generatedAt: string;
  artifacts: ManifestArtifacts;
  warnings: string[];
}

function parseCaps(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function iso(d: Date | string | null): string | null {
  if (!d) return null;
  return new Date(d).toISOString();
}

export function buildManifest(input: BuildManifestInput): Manifest {
  const startedAt = iso(input.session.startTime);
  const endedAt = iso(input.session.endTime);
  const durationMs =
    startedAt && endedAt
      ? new Date(endedAt).getTime() - new Date(startedAt).getTime()
      : null;

  const caps = redactSecrets(parseCaps(input.session.desired_capabilities));

  const lastCommand = input.session.failure_reason
    ? { name: 'unknown', args: null, errorMessage: input.session.failure_reason }
    : null;

  return {
    schemaVersion: '1.0',
    generatedAt: input.generatedAt,
    xenonVersion: input.xenonVersion,
    mode: input.mode,
    window: input.window,
    session: {
      id: input.session.id,
      status: input.session.status,
      startedAt,
      endedAt,
      durationMs,
    },
    device: {
      udid: input.session.device_udid,
      platform: input.session.device_platform,
      name: input.session.device_name,
      osVersion: input.session.device_version,
    },
    capabilities: caps,
    lastCommand,
    artifacts: input.artifacts,
    warnings: input.warnings,
  };
}
