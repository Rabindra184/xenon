import type { ISession } from '../../interfaces/ISession';

export type StatusKey = 'all' | 'passed' | 'failed' | 'running';

export function buildStatusCounts(sessions: ISession[]): Record<StatusKey, number> {
  const out: Record<StatusKey, number> = { all: sessions.length, passed: 0, failed: 0, running: 0 };
  for (const s of sessions) {
    if (s.status === 'ended' || s.status === 'passed') out.passed += 1;
    else if (s.status === 'failed') out.failed += 1;
    else if (s.status === 'running') out.running += 1;
  }
  return out;
}

export function deviceNameOrFallback(s: ISession): string {
  const n = s.device_name?.trim();
  return n && n.length > 0 ? n : 'Unknown Device';
}

export function platformLabel(s: ISession): string {
  const p = s.device_platform ?? '';
  if (!p) return '—';
  const lower = p.toLowerCase();
  if (lower === 'ios') return 'iOS';
  if (lower === 'tvos') return 'tvOS';
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function osVersionLabel(s: ISession): string {
  return s.device_version ? `v${s.device_version}` : '';
}

export function formatAbsoluteTime(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy}, ${hh}:${mi}:${ss}`;
}

export function sessionDurationMs(s: ISession): number | null {
  if (!s.startTime) return null;
  const start = Date.parse(s.startTime);
  if (!Number.isFinite(start)) return null;
  const end = s.endTime ? Date.parse(s.endTime) : Date.now();
  if (!Number.isFinite(end)) return null;
  return Math.max(0, end - start);
}

export function humanDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '—';
  const totalS = ms / 1000;
  const h = Math.floor(totalS / 3600);
  const m = Math.floor((totalS % 3600) / 60);
  const s = totalS - h * 3600 - m * 60;
  const sPart = s.toFixed(1);
  if (h > 0) return `${h}h ${m}m ${sPart}s`;
  if (m > 0) return `${m}m ${sPart}s`;
  return `${sPart}s`;
}

export function shortId(id: string, head = 10, tail = 4): string {
  if (!id) return '';
  if (id.length <= head + tail + 1) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}

export function humanizeFailureCategory(cat?: string | null): string {
  if (!cat) return '';
  return cat
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}
