/**
 * Pure helpers for Session Detail page rendering.
 */

export interface LogLike {
  timestamp?: string | number | null;
  message?: string | null;
  is_success?: boolean | null;
  command_name?: string | null;
  [k: string]: unknown;
}

/**
 * Extract `at …` stack frames from a failure_reason string. Returns up to
 * `max` frames; empty array when no frames are detectable.
 */
export function parseStackFromReason(reason?: string | null, max = 8): string[] {
  if (!reason) return [];
  const lines = reason.split(/\r?\n/);
  const frames: string[] = [];
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (/^at\s+/.test(trimmed)) {
      frames.push(trimmed);
      if (frames.length >= max) break;
    }
  }
  return frames;
}

/**
 * Snake_case failure category → Title Case label.
 */
export function humanizeFailureCategory(cat?: string | null): string {
  if (!cat) return '';
  return cat
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Parse a capabilities JSON string safely. Returns {} on parse failure.
 */
export function parseCapabilities(json?: string | null): Record<string, unknown> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Render any JS value as a short, human-readable string for the capabilities
 * table. Primitive values render directly; objects/arrays render as JSON
 * truncated to `maxLen`.
 */
export function humanizeCapabilityValue(value: unknown, maxLen = 200): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    const s = JSON.stringify(value);
    return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
  } catch {
    return String(value);
  }
}

/**
 * Shorten a session ID for display. The breadcrumb itself shows the full id,
 * but other places (log rows, copied reports) prefer a compact form.
 */
export function shortSessionId(id: string, head = 14, tail = 4): string {
  if (!id) return '';
  if (id.length <= head + tail + 1) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}
