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
}

export interface InterceptorOptions {
  enabled: boolean;
  bufferSize?: number;
  captureBodies?: boolean;
  mocks?: Mock[];
}
