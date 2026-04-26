export interface CapturedRequest {
  id: string;
  sessionId: string;
  ts: number;
  method: string;
  url: string;
  host: string;
  path: string;
  reqHeaders: Record<string, string>;
  reqBody?: string | null;
  resStatus: number;
  resHeaders: Record<string, string>;
  resBody?: string | null;
  bodyPath?: string;
  durationMs: number;
  mocked: boolean;
  modified: boolean;
  mockId?: string;
  commandHint?: { commandName: string; commandTs: number };
}

export interface InterceptorActiveStatus {
  active: boolean;
  requests?: CapturedRequest[];
  error?: string;
}

const API_BASE = '/xenon/api/interceptor';

export async function fetchSessionRequests(sessionId: string): Promise<InterceptorActiveStatus> {
  const res = await fetch(`${API_BASE}/sessions/${encodeURIComponent(sessionId)}/requests`);
  if (res.status === 404) {
    const body = await res.json().catch(() => ({}));
    return { active: false, error: body?.error };
  }
  if (!res.ok) {
    return { active: false, error: `request failed (${res.status})` };
  }
  const body = await res.json();
  return { active: true, requests: body.requests || [] };
}

export async function fetchRequestDetail(
  sessionId: string,
  requestId: string,
): Promise<CapturedRequest | null> {
  const res = await fetch(
    `${API_BASE}/sessions/${encodeURIComponent(sessionId)}/requests/${encodeURIComponent(requestId)}`,
  );
  if (!res.ok) return null;
  return res.json();
}

export function harDownloadUrl(sessionId: string): string {
  return `${API_BASE}/sessions/${encodeURIComponent(sessionId)}/har`;
}
