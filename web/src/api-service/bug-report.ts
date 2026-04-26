export interface DownloadOptions {
  sessionId: string;
  mode: 'slice' | 'full';
  windowSec?: number;
}

export async function downloadBugReport(opts: DownloadOptions): Promise<void> {
  const params = new URLSearchParams({ mode: opts.mode });
  if (opts.mode === 'slice' && opts.windowSec) {
    params.set('windowSec', String(opts.windowSec));
  }
  const url = `/xenon/api/sessions/${encodeURIComponent(opts.sessionId)}/bug-report?${params.toString()}`;

  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body && body.error) msg = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }

  const cd = res.headers.get('content-disposition') || '';
  const match = /filename="([^"]+)"/.exec(cd);
  const filename = match ? match[1] : `bugreport-${opts.sessionId}.zip`;

  const blob = await res.blob();
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objUrl);
}
