import { CapturedRequest } from './types';

export interface HarHeader {
  name: string;
  value: string;
}

export interface HarEntry {
  startedDateTime: string;
  time: number;
  request: {
    method: string;
    url: string;
    httpVersion: string;
    headers: HarHeader[];
    queryString: HarHeader[];
    cookies: HarHeader[];
    headersSize: number;
    bodySize: number;
    postData?: { mimeType: string; text: string };
  };
  response: {
    status: number;
    statusText: string;
    httpVersion: string;
    headers: HarHeader[];
    cookies: HarHeader[];
    content: { size: number; mimeType: string; text?: string };
    redirectURL: string;
    headersSize: number;
    bodySize: number;
  };
  cache: Record<string, never>;
  timings: { send: number; wait: number; receive: number };
  _mocked?: boolean;
  _modified?: boolean;
  _mockId?: string;
}

export interface HarDocument {
  log: {
    version: '1.2';
    creator: { name: string; version: string; comment?: string };
    entries: HarEntry[];
  };
}

const toHarHeaders = (h: Record<string, string>): HarHeader[] =>
  Object.entries(h).map(([name, value]) => ({ name, value: String(value) }));

export function buildHar(requests: CapturedRequest[], sessionId: string): HarDocument {
  return {
    log: {
      version: '1.2',
      creator: {
        name: 'Xenon Interceptor',
        version: '1.0',
        comment: `session=${sessionId}`,
      },
      entries: requests.map((r) => toEntry(r)),
    },
  };
}

function toEntry(r: CapturedRequest): HarEntry {
  const reqMime = r.reqHeaders['content-type'] || r.reqHeaders['Content-Type'] || '';
  const resMime = r.resHeaders['content-type'] || r.resHeaders['Content-Type'] || '';
  const entry: HarEntry = {
    startedDateTime: new Date(r.ts).toISOString(),
    time: r.durationMs,
    request: {
      method: r.method,
      url: r.url,
      httpVersion: 'HTTP/1.1',
      headers: toHarHeaders(r.reqHeaders),
      queryString: [],
      cookies: [],
      headersSize: -1,
      bodySize: r.reqBody ? r.reqBody.length : 0,
      ...(r.reqBody ? { postData: { mimeType: reqMime || 'text/plain', text: r.reqBody } } : {}),
    },
    response: {
      status: r.resStatus,
      statusText: '',
      httpVersion: 'HTTP/1.1',
      headers: toHarHeaders(r.resHeaders),
      cookies: [],
      content: {
        size: r.resBody ? r.resBody.length : 0,
        mimeType: resMime || 'text/plain',
        ...(r.resBody != null ? { text: r.resBody } : {}),
      },
      redirectURL: '',
      headersSize: -1,
      bodySize: r.resBody ? r.resBody.length : 0,
    },
    cache: {},
    timings: { send: 0, wait: r.durationMs, receive: 0 },
  };
  if (r.mocked) entry._mocked = true;
  if (r.modified) entry._modified = true;
  if (r.mockId) entry._mockId = r.mockId;
  return entry;
}
