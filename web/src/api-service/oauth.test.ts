import { describe, it, expect, vi, afterEach } from 'vitest';
import XenonApiService from './index';

type Sent = { url: string; init?: RequestInit };

function stubFetch(status: number, body?: unknown): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      sent.push({ url, init });
      return new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  return sent;
}

describe('the agent sign-in calls', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('answers a consent with POST /oauth/consent/:id { allow } and returns redirectTo', async () => {
    const sent = stubFetch(200, { redirectTo: 'http://127.0.0.1:5000/cb?code=c' });
    await expect(XenonApiService.answerOAuthConsent('req/1', true)).resolves.toEqual({
      redirectTo: 'http://127.0.0.1:5000/cb?code=c',
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe('/xenon/api/oauth/consent/req%2F1');
    expect(sent[0].init?.method).toBe('POST');
    expect(JSON.parse(String(sent[0].init?.body))).toEqual({ allow: true });
    expect((sent[0].init?.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json',
    );
  });

  it('rejects a refused answer with its status', async () => {
    stubFetch(404, { error: 'not_found', message: 'Sign-in request not found' });
    await expect(XenonApiService.answerOAuthConsent('gone', false)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('reads the waiting request, or the status when there is none', async () => {
    stubFetch(404, { error: 'not_found' });
    await expect(XenonApiService.getOAuthConsent('gone')).resolves.toEqual({
      ok: false,
      status: 404,
    });
  });

  it('lists sign-ins; null only when the route is not served; throws on a failure', async () => {
    stubFetch(200, [{ id: 'g1' }]);
    await expect(XenonApiService.getAgentSignIns()).resolves.toEqual([{ id: 'g1' }]);
    stubFetch(404, { error: true });
    await expect(XenonApiService.getAgentSignIns()).resolves.toBeNull();
    stubFetch(500, { error: 'internal' });
    await expect(XenonApiService.getAgentSignIns()).rejects.toThrow();
  });

  it("reads the MCP server from /capabilities: null when there is none, throws when it can't ask", async () => {
    stubFetch(200, { features: { mcpServer: { url: 'https://x/xenon/mcp' } } });
    await expect(XenonApiService.getMcpServer()).resolves.toEqual({ url: 'https://x/xenon/mcp' });
    stubFetch(200, { features: {} });
    await expect(XenonApiService.getMcpServer()).resolves.toBeNull();
    stubFetch(429, { error: 'rate_limited' });
    await expect(XenonApiService.getMcpServer()).rejects.toThrow();
  });
});
