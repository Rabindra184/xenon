import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../ui/toast';
import AgentsPage from './AgentsPage';

/** What the server answers, by path; anything else is a 404. */
let answers: Record<string, { status: number; body?: unknown }>;
let calls: Array<{ method: string; url: string }>;

function json(status: number, body?: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const GRANTS = [
  {
    id: 'g1',
    clientName: 'Claude Code',
    scopes: ['appium:use', 'xenon:devices:read'],
    createdAt: '2026-11-14T10:00:00.000Z',
    lastUsedAt: '2026-11-15T09:00:00.000Z',
  },
  {
    id: 'g2',
    clientName: 'Cursor',
    scopes: ['xenon:devices:read'],
    createdAt: '2026-11-13T10:00:00.000Z',
    lastUsedAt: null,
  },
];

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/agents']}>
      <ToastProvider>
        <AgentsPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('AgentsPage', () => {
  let writeText: (text: string) => Promise<void>;
  beforeEach(() => {
    calls = [];
    answers = {
      'GET /xenon/api/capabilities': {
        status: 200,
        body: {
          features: {
            mcpServer: { path: '/xenon/mcp', url: 'https://xenon.example.com/xenon/mcp' },
          },
        },
      },
      'GET /xenon/api/oauth/grants': { status: 200, body: GRANTS },
      'DELETE /xenon/api/oauth/grants/g1': { status: 204 },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.url;
        const method = (init?.method ?? 'GET').toUpperCase();
        calls.push({ method, url });
        const a = answers[`${method} ${url}`];
        return a ? json(a.status, a.body) : json(404, { error: 'not_found' });
      }),
    );
    writeText = vi.fn(async () => {}) as unknown as (text: string) => Promise<void>;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("AgentsPage shows one copyable command per agent with this hub's URL", async () => {
    renderPage();
    const commands = await screen.findByRole('list', { name: /add xenon to your agent/i });
    const rows = within(commands).getAllByRole('listitem');
    expect(rows.map((r) => within(r).getByRole('heading').textContent)).toEqual([
      'Claude Code',
      'Codex',
      'Gemini CLI',
      'Cursor',
      'VS Code',
      'Windsurf',
      'Claude Desktop',
    ]);
    for (const row of rows) {
      expect(within(row).getByRole('button', { name: /^copy/i })).toBeInTheDocument();
    }
    expect(
      screen.getByText('claude mcp add --transport http xenon https://xenon.example.com/xenon/mcp'),
    ).toBeInTheDocument();

    userEvent.click(screen.getByRole('button', { name: 'Copy the Claude Code command' }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        'claude mcp add --transport http xenon https://xenon.example.com/xenon/mcp',
      ),
    );
    expect(
      await screen.findByRole('button', { name: 'Copy the Claude Code command' }),
    ).toHaveTextContent('Copied');
  });

  it('gives every agent the installer on a plain-HTTP lab, and says why', async () => {
    answers['GET /xenon/api/capabilities'] = {
      status: 200,
      body: {
        features: { mcpServer: { path: '/xenon/mcp', url: 'http://lab-mac:4723/xenon/mcp' } },
      },
    };
    renderPage();
    const commands = await screen.findByRole('list', { name: /add xenon to your agent/i });
    expect(
      within(commands).getByText(
        'npx @xenon-device-management/mcp add --hub http://lab-mac:4723 --client claude-code',
      ),
    ).toBeInTheDocument();
    expect(within(commands).queryByText(/^claude mcp add/)).not.toBeInTheDocument();
    expect(screen.getByText(/plain http/i)).toBeInTheDocument();
  });

  it('AgentsPage lists my connected agents and Revoke calls DELETE /oauth/grants/:id', async () => {
    renderPage();
    const table = await screen.findByRole('table', { name: /connected agents/i });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Claude Code');
    expect(rows[0]).toHaveTextContent('Start Appium sessions on phones, as you');
    expect(rows[1]).toHaveTextContent('Cursor');
    expect(rows[1]).toHaveTextContent('Never');

    answers['GET /xenon/api/oauth/grants'] = { status: 200, body: [GRANTS[1]] };
    userEvent.click(within(rows[0]).getByRole('button', { name: 'Sign out Claude Code' }));
    await waitFor(() =>
      expect(calls).toContainEqual({ method: 'DELETE', url: '/xenon/api/oauth/grants/g1' }),
    );
    await waitFor(() => {
      const left = within(screen.getByRole('table', { name: /connected agents/i }))
        .getAllByRole('row')
        .slice(1);
      expect(left).toHaveLength(1);
      expect(left[0]).toHaveTextContent('Cursor');
    });
  });

  it("doesn't sign an agent out when the confirmation is cancelled", async () => {
    (window.confirm as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
    renderPage();
    const table = await screen.findByRole('table', { name: /connected agents/i });
    userEvent.click(within(table).getByRole('button', { name: 'Sign out Claude Code' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('says when no agent is signed in yet', async () => {
    answers['GET /xenon/api/oauth/grants'] = { status: 200, body: [] };
    renderPage();
    expect(await screen.findByText(/no agent is signed in yet/i)).toBeInTheDocument();
  });

  it('with sign-in off, still gives the commands and says agents connect without signing in', async () => {
    delete answers['GET /xenon/api/oauth/grants'];
    renderPage();
    expect(
      await screen.findByRole('list', { name: /add xenon to your agent/i }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/connect without signing in/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('says so on a server that has no tools for agents', async () => {
    answers['GET /xenon/api/capabilities'] = { status: 200, body: { features: {} } };
    renderPage();
    expect(await screen.findByText(/aren't available on this server/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('list', { name: /add xenon to your agent/i }),
    ).not.toBeInTheDocument();
  });
});
