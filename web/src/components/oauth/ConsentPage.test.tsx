import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const api = vi.hoisted(() => ({
  read: vi.fn(),
  answer: vi.fn(),
}));
vi.mock('../../api-service', () => ({
  default: { getOAuthConsent: api.read, answerOAuthConsent: api.answer },
}));
const auth = vi.hoisted(() => ({ refresh: vi.fn(async () => {}) }));
vi.mock('../../auth/auth-context', () => ({
  useAuth: () => ({
    refresh: auth.refresh,
    me: { userId: 'u1', email: 'tess@lab.example', name: 'Tess', role: 'MEMBER' },
  }),
}));
const leave = vi.hoisted(() => ({ backToAgent: vi.fn(() => true) }));
vi.mock('./backToAgent', () => leave);

import ConsentPage from './ConsentPage';

const REQUEST = {
  requestId: 'req-1',
  client: { id: 'client-1', name: 'Claude Code' },
  hub: 'https://xenon.example.com',
  redirectUri: 'http://127.0.0.1:47831/callback',
  scopes: ['appium:use', 'xenon:devices:read', 'xenon:devices:lock'],
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
};

function renderAt(url = '/oauth/consent/req-1') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/oauth/consent/:requestId" element={<ConsentPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ConsentPage', () => {
  beforeEach(() => {
    api.read.mockReset().mockResolvedValue({ ok: true, request: REQUEST });
    api.answer.mockReset();
    leave.backToAgent.mockClear();
    auth.refresh.mockClear();
  });

  it('names the agent, the hub and each scope in plain words, and Allow posts allow: true', async () => {
    api.answer.mockResolvedValue({ redirectTo: 'http://127.0.0.1:47831/callback?code=c&state=s' });
    renderAt();

    expect(await screen.findByRole('heading', { name: /claude code/i })).toBeInTheDocument();
    expect(api.read).toHaveBeenCalledWith('req-1');
    expect(screen.getByText('xenon.example.com')).toBeInTheDocument();
    const asked = screen.getByRole('list', { name: /what it can do/i });
    expect(asked).toHaveTextContent('Start Appium sessions on phones, as you');
    expect(asked).toHaveTextContent("See the lab's phones and what they are doing");
    expect(asked).toHaveTextContent('Reserve phones and give them back');
    expect(screen.getByText(/tess@lab\.example/)).toBeInTheDocument();

    userEvent.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(api.answer).toHaveBeenCalledWith('req-1', true));
    await waitFor(() =>
      expect(leave.backToAgent).toHaveBeenCalledWith(
        'http://127.0.0.1:47831/callback?code=c&state=s',
      ),
    );
  });

  it("ConsentPage's Deny posts allow: false", async () => {
    api.answer.mockResolvedValue({
      redirectTo: 'http://127.0.0.1:47831/callback?error=access_denied&state=s',
    });
    renderAt();
    userEvent.click(await screen.findByRole('button', { name: 'Deny' }));
    await waitFor(() => expect(api.answer).toHaveBeenCalledWith('req-1', false));
    await waitFor(() =>
      expect(leave.backToAgent).toHaveBeenCalledWith(
        'http://127.0.0.1:47831/callback?error=access_denied&state=s',
      ),
    );
  });

  it('says where the browser goes back to, since the name is whatever the agent chose', async () => {
    renderAt();
    const back = await screen.findByText(/after you answer, you go back to/i);
    expect(back).toHaveTextContent('After you answer, you go back to 127.0.0.1.');
  });

  it('names an app by its link scheme when the address has no host', async () => {
    api.read.mockResolvedValue({
      ok: true,
      request: { ...REQUEST, client: { id: 'c', name: 'Cursor' }, redirectUri: 'cursor:/oauth/cb' },
    });
    renderAt();
    expect(await screen.findByText(/after you answer, you go back to/i)).toHaveTextContent(
      'the app that opens cursor: links',
    );
  });

  it('goes only where the answer says, never to an address in the page URL', async () => {
    api.answer.mockResolvedValue({ redirectTo: 'http://127.0.0.1:47831/callback?code=c' });
    renderAt(
      '/oauth/consent/req-1?redirect_uri=https%3A%2F%2Fevil.example&redirectTo=https%3A%2F%2Fevil.example',
    );
    userEvent.click(await screen.findByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(leave.backToAgent).toHaveBeenCalledTimes(1));
    expect(leave.backToAgent).toHaveBeenCalledWith('http://127.0.0.1:47831/callback?code=c');
  });

  it('answers once: both buttons are disabled while the answer is sent', async () => {
    let resolve: (v: { redirectTo: string }) => void = () => {};
    api.answer.mockReturnValue(new Promise((r) => (resolve = r)));
    renderAt();
    userEvent.click(await screen.findByRole('button', { name: 'Allow' }));
    expect(screen.getByRole('button', { name: 'Allow' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled();
    resolve({ redirectTo: 'http://127.0.0.1:47831/callback?code=c' });
    await waitFor(() => expect(leave.backToAgent).toHaveBeenCalled());
    expect(api.answer).toHaveBeenCalledTimes(1);
  });

  it('says a request that is gone has expired or was answered, with nothing to click', async () => {
    api.read.mockResolvedValue({ ok: false, status: 404 });
    renderAt();
    expect(await screen.findByText(/expired or was already answered/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Allow' })).not.toBeInTheDocument();
  });

  it('reads the sign-in again when the server says it is gone (401)', async () => {
    api.read.mockResolvedValue({ ok: false, status: 401 });
    renderAt();
    await waitFor(() => expect(auth.refresh).toHaveBeenCalled());
  });

  it('offers only Deny when the agent asked for nothing this account can give', async () => {
    api.read.mockResolvedValue({ ok: true, request: { ...REQUEST, scopes: [] } });
    renderAt();
    expect(await screen.findByText(/asked for nothing your account can give/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Allow' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeEnabled();
  });

  it('shows a refused answer on the page and lets the user try again', async () => {
    api.answer.mockRejectedValueOnce(
      Object.assign(new Error('Too many sign-ins'), { status: 429 }),
    );
    renderAt();
    userEvent.click(await screen.findByRole('button', { name: 'Allow' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many sign-ins');
    expect(screen.getByRole('button', { name: 'Allow' })).toBeEnabled();
    expect(leave.backToAgent).not.toHaveBeenCalled();
  });
});
