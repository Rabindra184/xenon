import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import Apps from './apps';
import { ToastProvider } from '../ui/toast';
import XenonApiService from '../../api-service';

const MEMBER = { userId: 'me', email: 'me@acme.com', name: 'Me', role: 'MEMBER', teams: [] };
const ADMIN = { ...MEMBER, role: 'ADMIN' };
const auth = vi.hoisted(() => ({ me: null as any }));
vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ me: auth.me ?? MEMBER }) }));

vi.mock('../../api-service', () => ({
  default: {
    getApps: vi.fn(),
    getDevices: vi.fn().mockResolvedValue([]),
    uploadApp: vi.fn().mockResolvedValue({ success: true }),
    listTeams: vi.fn(),
    setAppTeam: vi.fn().mockResolvedValue(undefined),
  },
}));

const APPS = [
  {
    id: 'a1',
    name: 'wda-signed.ipa',
    packageName: 'internal.bundle',
    platform: 'ios',
    version: '1.0.0',
    size: 6300000,
    createdAt: '2026-08-12T21:20:28Z',
    teamId: null,
    team: null,
  },
  {
    id: 'a2',
    name: 'payments.apk',
    packageName: 'com.acme.payments',
    platform: 'android',
    version: '2.1.0',
    size: 1200000,
    createdAt: '2026-08-13T10:00:00Z',
    teamId: 't-pay',
    team: { id: 't-pay', name: 'Payments' },
  },
];
const TEAMS = [
  { id: 't-pay', name: 'Payments' },
  { id: 't-ios', name: 'iOS guild' },
];

const renderApps = () =>
  render(
    <ToastProvider>
      <Apps />
    </ToastProvider>,
  );

beforeEach(() => {
  auth.me = null;
  vi.mocked(XenonApiService.getApps).mockResolvedValue(APPS as any);
  vi.mocked(XenonApiService.listTeams).mockResolvedValue(TEAMS);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(XenonApiService.uploadApp).mockClear();
  vi.mocked(XenonApiService.setAppTeam).mockClear();
  vi.mocked(XenonApiService.listTeams).mockClear();
});

describe('Apps upload actions', () => {
  it('has one primary action: Upload app. Refresh is secondary', async () => {
    renderApps();
    const refresh = await screen.findByRole('button', { name: /Refresh/ });
    const upload = screen.getByRole('button', { name: /Upload app/ });
    expect(refresh).toHaveClass('btn-secondary');
    expect(refresh).not.toHaveClass('btn-primary');
    expect(upload).toHaveClass('btn-primary');
  });

  it('opens the file picker when Upload app is clicked', async () => {
    const pick = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    renderApps();
    fireEvent.click(await screen.findByRole('button', { name: /Upload app/ }));
    expect(pick).toHaveBeenCalledTimes(1);
    expect(pick.mock.instances[0]).toMatchObject({ type: 'file', accept: '.apk,.ipa' });
  });

  it('uploads the chosen file', async () => {
    const { container } = renderApps();
    await screen.findByRole('button', { name: /Upload app/ });
    const input = container.querySelector('input[type=file]') as HTMLInputElement;
    const file = new File(['x'], 'app.apk');
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(XenonApiService.uploadApp).toHaveBeenCalledWith(file, null));
  });

  it('the empty-state upload card is a focusable button that opens the picker', async () => {
    vi.mocked(XenonApiService.getApps).mockResolvedValueOnce([]);
    const pick = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    renderApps();
    const card = await screen.findByRole('button', { name: /Upload your first app/ });
    card.focus();
    expect(card).toHaveFocus();
    fireEvent.click(card);
    expect(pick).toHaveBeenCalledTimes(1);
    expect(pick.mock.instances[0]).toMatchObject({ type: 'file', accept: '.apk,.ipa' });
  });
});

describe('Apps team column', () => {
  it("shows each app's team, or Shared", async () => {
    renderApps();
    expect(await screen.findByText('Team')).toBeInTheDocument();
    const shared = (await screen.findByText('wda-signed.ipa')).closest(
      '.artifact-row',
    ) as HTMLElement;
    const team = screen.getByText('payments.apk').closest('.artifact-row') as HTMLElement;
    expect(within(shared).getByText('Shared')).toBeInTheDocument();
    expect(within(team).getByText('Payments')).toBeInTheDocument();
  });

  it('a member does not load the team list, which is admin-only', async () => {
    renderApps();
    await screen.findByText('payments.apk');
    expect(XenonApiService.listTeams).not.toHaveBeenCalled();
  });
});

describe('Apps upload dialog (admin)', () => {
  beforeEach(() => {
    auth.me = ADMIN;
  });

  it('asks for a team first: Shared by default, or any team', async () => {
    const pick = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    renderApps();
    fireEvent.click(await screen.findByRole('button', { name: /Upload app/ }));
    const dialog = await screen.findByRole('dialog', { name: /Upload app/ });
    const select = within(dialog).getByLabelText('Team') as HTMLSelectElement;
    await waitFor(() => expect(select.options).toHaveLength(3));
    expect(Array.from(select.options).map((o) => o.text)).toEqual([
      'Shared',
      'Payments',
      'iOS guild',
    ]);
    expect(select.value).toBe('');
    expect(pick).not.toHaveBeenCalled();
  });

  it('sends the chosen team with the file', async () => {
    const pick = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    const { container } = renderApps();
    fireEvent.click(await screen.findByRole('button', { name: /Upload app/ }));
    const dialog = await screen.findByRole('dialog', { name: /Upload app/ });
    const select = within(dialog).getByLabelText('Team') as HTMLSelectElement;
    await waitFor(() => expect(select.options).toHaveLength(3));
    fireEvent.change(select, { target: { value: 't-ios' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Choose file/ }));
    expect(pick).toHaveBeenCalledTimes(1);

    const input = container.querySelector('input[type=file]') as HTMLInputElement;
    const file = new File(['x'], 'guild.ipa');
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(XenonApiService.uploadApp).toHaveBeenCalledWith(file, 't-ios'));
  });

  it('sends no team for Shared', async () => {
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    const { container } = renderApps();
    fireEvent.click(await screen.findByRole('button', { name: /Upload app/ }));
    const dialog = await screen.findByRole('dialog', { name: /Upload app/ });
    fireEvent.click(within(dialog).getByRole('button', { name: /Choose file/ }));
    const input = container.querySelector('input[type=file]') as HTMLInputElement;
    const file = new File(['x'], 'shared.apk');
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(XenonApiService.uploadApp).toHaveBeenCalledWith(file, null));
  });
});

describe('Apps move to team (admin)', () => {
  it('is offered to admins only', async () => {
    renderApps();
    await screen.findByText('payments.apk');
    expect(screen.queryByRole('button', { name: /Move .* to team/ })).toBeNull();
  });

  it('moves an app to the chosen team and reloads the list', async () => {
    auth.me = ADMIN;
    renderApps();
    fireEvent.click(await screen.findByRole('button', { name: 'Move payments.apk to team' }));
    const dialog = await screen.findByRole('dialog', { name: /Move to team/ });
    expect(within(dialog).getByText('payments.apk')).toBeInTheDocument();
    const select = within(dialog).getByLabelText('Team') as HTMLSelectElement;
    await waitFor(() => expect(select.options).toHaveLength(3));
    expect(select.value).toBe('t-pay');
    const loads = vi.mocked(XenonApiService.getApps).mock.calls.length;

    fireEvent.change(select, { target: { value: '' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));

    await waitFor(() => expect(XenonApiService.setAppTeam).toHaveBeenCalledWith('a2', null));
    await waitFor(() =>
      expect(vi.mocked(XenonApiService.getApps).mock.calls.length).toBeGreaterThan(loads),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('keeps the dialog open and says why when the move fails', async () => {
    auth.me = ADMIN;
    vi.mocked(XenonApiService.setAppTeam).mockRejectedValueOnce(new Error('team not found'));
    renderApps();
    fireEvent.click(await screen.findByRole('button', { name: 'Move payments.apk to team' }));
    const dialog = await screen.findByRole('dialog', { name: /Move to team/ });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
    expect(await screen.findByText(/team not found/)).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: /Move to team/ })).toBeInTheDocument();
  });
});
