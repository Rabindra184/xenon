import * as fs from 'fs';
import * as path from 'path';
import { CapturedRequest } from './types';

// On-disk layout for finished sessions. Single source of truth for both writers
// (InterceptorService.stop) and readers (the REST router falling back when no
// live session state remains in memory).
//
// Layout: {assetsBase}/{sessionId}/interceptor/
//   - requests.json   { sessionId, udid, startedAt, stoppedAt, host, port, mocks, requests: CapturedRequest[] }
//   - session.har     a HAR 1.2 document
//
// Spill bodies (large response payloads exceeding the inline threshold) are NOT
// retained across session stop in v1 — RequestBuffer.clear() removes them and
// the dashboard renders missing bodies as null. Persisting large bodies is on
// the roadmap but requires a body-storage strategy; deferred to a future PR.
export interface ArchivePaths {
  dir: string;
  requests: string;
  har: string;
}

export function archivePaths(assetsBase: string, sessionId: string): ArchivePaths {
  const dir = path.join(assetsBase, sessionId, 'interceptor');
  return {
    dir,
    requests: path.join(dir, 'requests.json'),
    har: path.join(dir, 'session.har'),
  };
}

// Loads a finished session's captured requests from disk. Returns null when
// the archive is absent or unreadable; returns [] when the dump contains no
// requests array. Does NOT throw on malformed JSON — surfaces null instead, so
// the route can fall through to its 404 path cleanly.
export function loadArchivedRequests(
  assetsBase: string,
  sessionId: string,
): CapturedRequest[] | null {
  const { requests: file } = archivePaths(assetsBase, sessionId);
  if (!fs.existsSync(file)) return null;
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const list: CapturedRequest[] = Array.isArray(parsed?.requests) ? parsed.requests : [];
  // Spill files are deleted at session stop; their paths in the dump are dead.
  // Strip them so the dashboard cannot issue a body fetch that would 404.
  return list.map((req) => {
    if (req.bodyPath == null) return req;
    const cleaned: CapturedRequest = { ...req, resBody: req.resBody ?? null };
    delete cleaned.bodyPath;
    return cleaned;
  });
}

export function loadArchivedHar(assetsBase: string, sessionId: string): string | null {
  const { har: file } = archivePaths(assetsBase, sessionId);
  if (!fs.existsSync(file)) return null;
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}
