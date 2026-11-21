import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../ui/toast';

const auth = vi.hoisted(() => ({ authDisabled: false }));
vi.mock('../../auth/auth-context', () => ({
  useAuth: () => ({ me: { userId: 'u1', role: 'MEMBER', authDisabled: auth.authDisabled } }),
}));

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
    auth.authDisabled = false;
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
    // Sign out asks in the dashboard's own dialog, never the browser's.
    vi.spyOn(window, 'confirm').mockImplementation(() => {
      throw new Error('window.confirm was called');
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("AgentsPage shows each agent's command or config entry with this hub's URL", async () => {
    renderPage();
    const commands = await screen.findByRole('list', { name: /add xenon to your agent/i });
    const rows = within(commands).getAllByRole('listitem');
    expect(rows.map((r) => within(r).getByRole('heading').textContent)).toEqual([
      'Claude Code',
      'Codex',
      'Gemini CLI',
      'Cursor',
      'VS Code',
      'Windsurf (Devin Desktop)',
      'Claude Desktop',
    ]);
    // Every agent has something to copy.
    for (const row of rows) {
      expect(within(row).getByRole('button', { name: /^copy/i })).toBeInTheDocument();
    }
    expect(rows[6]).toHaveTextContent(
      'npx @xenon-device-management/mcp add --hub https://xenon.example.com --client claude-desktop',
    );
    expect(
      screen.getByText('claude mcp add --transport http xenon https://xenon.example.com/xenon/mcp'),
    ).toBeInTheDocument();
    // Cursor's is an entry for its settings file, which the row names.
    expect(rows[3]).toHaveTextContent('~/.cursor/mcp.json');
    expect(rows[3]).toHaveTextContent('"url": "https://xenon.example.com/xenon/mcp"');
    // Above the list, the installer, which sets up any of them.
    expect(
      screen.getByText('npx @xenon-device-management/mcp add --hub https://xenon.example.com'),
    ).toBeInTheDocument();
    userEvent.click(screen.getByRole('button', { name: 'Copy the Xenon installer command' }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        'npx @xenon-device-management/mcp add --hub https://xenon.example.com',
      ),
    );

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

  it('on a plain-HTTP lab on another computer, warns that the desktop app and some agents need HTTPS', async () => {
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
        'claude mcp add --transport http xenon http://lab-mac:4723/xenon/mcp',
      ),
    ).toBeInTheDocument();
    const note = screen.getByRole('note');
    expect(note).toHaveTextContent(/plain HTTP/);
    expect(note).toHaveTextContent(/Claude desktop app/);
    expect(note).toHaveTextContent(/another computer/);
    expect(note).toHaveTextContent(/HTTPS/);
    // The installer's bridge is a way through, but it encrypts nothing.
    expect(note).toHaveTextContent(/installer/);
    expect(note).toHaveTextContent(/encrypts nothing/);
    expect(commands).toHaveTextContent(/--header "x-xenon-access-key: ACCESS_KEY"/);
  });

  it("on a plain-HTTP lab on this computer, warns that the Claude desktop app won't sign in", async () => {
    answers['GET /xenon/api/capabilities'] = {
      status: 200,
      body: {
        features: { mcpServer: { path: '/xenon/mcp', url: 'http://localhost:4723/xenon/mcp' } },
      },
    };
    renderPage();
    const commands = await screen.findByRole('list', { name: /add xenon to your agent/i });
    const note = screen.getByRole('note');
    expect(note).toHaveTextContent(/Claude desktop app/);
    expect(note).toHaveTextContent(/even on this computer/);
    expect(note).toHaveTextContent(/installer/);
    expect(note).not.toHaveTextContent(/another computer/);
    expect(commands).toHaveTextContent(/--header "x-xenon-token: TOKEN"/);
  });

  it('gives no plain-HTTP warning on a lab with sign-in off: no agent signs in there', async () => {
    auth.authDisabled = true;
    answers['GET /xenon/api/capabilities'] = {
      status: 200,
      body: {
        features: { mcpServer: { path: '/xenon/mcp', url: 'http://lab-mac:4723/xenon/mcp' } },
      },
    };
    renderPage();
    const commands = await screen.findByRole('list', { name: /add xenon to your agent/i });
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    expect(commands).not.toHaveTextContent(/--header/);
  });

  it('gives no warning for a lab on https', async () => {
    answers['GET /xenon/api/capabilities'] = {
      status: 200,
      body: {
        features: {
          mcpServer: { path: '/xenon/mcp', url: 'https://xenon.example.com/xenon/mcp' },
        },
      },
    };
    renderPage();
    const commands = await screen.findByRole('list', { name: /add xenon to your agent/i });
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    expect(commands).not.toHaveTextContent(/--header/);
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
    // The dashboard's own dialog asks first; nothing is sent until it is answered.
    const dialog = await screen.findByRole('dialog', { name: 'Sign out Claude Code?' });
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    userEvent.click(within(dialog).getByRole('button', { name: 'Sign out' }));
    await waitFor(() =>
      expect(calls).toContainEqual({ method: 'DELETE', url: '/xenon/api/oauth/grants/g1' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => {
      const left = within(screen.getByRole('table', { name: /connected agents/i }))
        .getAllByRole('row')
        .slice(1);
      expect(left).toHaveLength(1);
      expect(left[0]).toHaveTextContent('Cursor');
    });
  });

  it("doesn't sign an agent out when the dialog is cancelled", async () => {
    renderPage();
    const table = await screen.findByRole('table', { name: /connected agents/i });
    userEvent.click(within(table).getByRole('button', { name: 'Sign out Claude Code' }));
    const dialog = await screen.findByRole('dialog', { name: 'Sign out Claude Code?' });
    userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('says when a sign-out fails, and closes the dialog', async () => {
    answers['DELETE /xenon/api/oauth/grants/g1'] = { status: 500, body: { error: 'internal' } };
    renderPage();
    const table = await screen.findByRole('table', { name: /connected agents/i });
    userEvent.click(within(table).getByRole('button', { name: 'Sign out Claude Code' }));
    const dialog = await screen.findByRole('dialog', { name: 'Sign out Claude Code?' });
    userEvent.click(within(dialog).getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText(/couldn't sign it out/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('says when no agent is signed in yet', async () => {
    answers['GET /xenon/api/oauth/grants'] = { status: 200, body: [] };
    renderPage();
    expect(await screen.findByText(/no agent is signed in yet/i)).toBeInTheDocument();
  });

  it('with sign-in off, still gives the commands and says agents connect without signing in', async () => {
    auth.authDisabled = true;
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

  it("says it couldn't load, not that agents aren't available, when the server fails", async () => {
    answers['GET /xenon/api/capabilities'] = { status: 500, body: { error: 'internal' } };
    renderPage();
    expect(await screen.findByText(/couldn't load this page/i)).toBeInTheDocument();
    expect(screen.queryByText(/aren't available/i)).not.toBeInTheDocument();

    answers['GET /xenon/api/capabilities'] = {
      status: 200,
      body: { features: { mcpServer: { url: 'https://xenon.example.com/xenon/mcp' } } },
    };
    userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('list', { name: /add xenon to your agent/i }),
    ).toBeInTheDocument();
  });

  it("says it couldn't load the connected agents, not that sign-in is off, when that fails", async () => {
    answers['GET /xenon/api/oauth/grants'] = { status: 500, body: { error: 'internal' } };
    renderPage();
    expect(await screen.findByText(/couldn't load your connected agents/i)).toBeInTheDocument();
    expect(screen.queryByText(/sign-in is turned off/i)).not.toBeInTheDocument();
  });

  it('keeps Sign out reachable beside an agent name with no spaces in it', async () => {
    const long = 'A'.repeat(100);
    answers['GET /xenon/api/oauth/grants'] = {
      status: 200,
      body: [{ ...GRANTS[0], clientName: long }],
    };
    renderPage();
    const table = await screen.findByRole('table', { name: /connected agents/i });
    const nameCell = within(table).getByText(long);
    expect(nameCell.className).toMatch(/overflow-wrap:anywhere/);
    expect(within(table).getByRole('button', { name: `Sign out ${long}` })).toBeInTheDocument();
  });
});
