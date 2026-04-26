export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS' | string;

export type UrlMatcher = string | RegExp;

export interface MockMatch {
  url: UrlMatcher;
  method?: HttpMethod;
}

export interface RewriteRequest {
  url?: string;
  headers?: Record<string, string>;
  body?: string | Record<string, any>;
}

export interface RespondWith {
  status: number;
  headers?: Record<string, string>;
  body?: string | Record<string, any>;
  delayMs?: number;
}

export interface RewriteResponse {
  status?: number;
  headers?: Record<string, string>;
  bodyTransform?: 'jsonMerge' | 'replace';
  body?: string | Record<string, any>;
}

export interface Mock {
  id?: string;
  match: MockMatch;
  rewriteRequest?: RewriteRequest;
  respondWith?: RespondWith;
  rewriteResponse?: RewriteResponse;
}

export interface CompiledMock extends Mock {
  id: string;
  addedAt: number;
}

export interface RequestSummary {
  method: string;
  url: string;
  headers: Record<string, string>;
}

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
  // Set when the request never completed (e.g. TLS handshake rejected, DNS lookup
  // failed, connection refused). resStatus is -1 for these and there is no body.
  failed?: boolean;
  failureReason?: string;
  failureKind?: FailureKind;
}

export type FailureKind =
  | 'HTTPS_CLIENT_ERROR'
  | 'HTTPS_SERVER_ERROR'
  | 'OPEN_HTTPS_SERVER_ERROR'
  | 'ON_CONNECT_ERROR'
  | 'PROXY_TO_SERVER_REQUEST_ERROR';

export interface InterceptorOptions {
  enabled: boolean;
  bufferSize?: number;
  captureBodies?: boolean;
  mocks?: Mock[];
  // Capture-time host filtering (does not affect mock matching). Both lists
  // accept exact strings or globs (* = one DNS label, ** = zero or more).
  // - includeHosts: when present, only matching hosts are captured.
  // - excludeHosts: when present, matching hosts are dropped.
  // - Both can apply: include narrows, exclude carves out.
  includeHosts?: string[];
  excludeHosts?: string[];
}
