import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Sidebar from './sidebar';

const auth = vi.hoisted(() => ({
  me: { userId: 'a', role: 'SUPER_ADMIN' } as { userId: string; role: string },
}));
vi.mock('../../auth/auth-context', () => ({
  useAuth: () => ({ me: auth.me }),
}));

afterEach(() => {
  auth.me = { userId: 'a', role: 'SUPER_ADMIN' };
});

describe('Sidebar', () => {
  // Users and Teams once shared an icon. In a 56px icon rail the icon is the
  // label, so two identical ones can't be told apart at a glance.
  it('gives every nav item its own icon', () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );
    const nav = screen.getByRole('navigation');
    const icons = within(nav)
      .getAllByRole('button')
      .map((b) => {
        const svg = b.querySelector('svg');
        const cls = Array.from(svg?.classList ?? []).find((c) => c.startsWith('lucide-'));
        return `${b.getAttribute('aria-label')}=${cls}`;
      });
    expect(icons.length).toBeGreaterThanOrEqual(8);
    const byIcon: Record<string, string[]> = {};
    for (const entry of icons) {
      const [label, icon] = entry.split('=');
      (byIcon[icon] ||= []).push(label);
    }
    const shared = Object.entries(byIcon).filter(([, labels]) => labels.length > 1);
    expect(shared).toEqual([]);
  });

  // The admin pages are sections of Settings now (settings-sections.ts):
  // one entry here instead of seven.
  it('has one Settings entry for an admin, and none of its sections', () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );
    const labels = within(screen.getByRole('navigation'))
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label'));
    expect(labels.filter((l) => l === 'Settings')).toHaveLength(1);
    for (const section of [
      'AI engine',
      'Maintenance',
      'Notifications',
      'Teams',
      'Users',
      'API keys',
    ])
      expect(labels).not.toContain(section);
  });

  // Webhooks are admin-only on the server: a member who opened Notifications
  // got a page whose every call was refused.
  it('shows a MEMBER no Settings and no Notifications', () => {
    auth.me = { userId: 'b', role: 'MEMBER' };
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );
    const labels = within(screen.getByRole('navigation'))
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label'));
    expect(labels).not.toContain('Settings');
    expect(labels).not.toContain('Notifications');
  });

  it('marks Settings current on any of its sections', () => {
    render(
      <MemoryRouter initialEntries={['/settings/teams']}>
        <Sidebar />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('groups the pages as Lab, Testing and Admin, in that order', () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );
    const groups = within(screen.getByRole('navigation')).getAllByRole('group');
    expect(
      groups.map((g) => [
        g.getAttribute('aria-labelledby'),
        within(g)
          .getAllByRole('button')
          .map((b) => b.getAttribute('aria-label')),
      ]),
    ).toEqual([
      ['nav-group-lab', ['Overview', 'Devices', 'Live devices', 'Apps']],
      ['nav-group-testing', ['Sessions', 'Recordings', 'Selector health']],
      ['nav-group-admin', ['Settings']],
    ]);
  });

  it('shows a MEMBER Lab and Testing, Recordings included', () => {
    auth.me = { userId: 'b', role: 'MEMBER' };
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );
    const groups = within(screen.getByRole('navigation')).getAllByRole('group');
    expect(groups.map((g) => g.getAttribute('aria-labelledby'))).toEqual([
      'nav-group-lab',
      'nav-group-testing',
    ]);
    expect(screen.getByRole('button', { name: 'Recordings' })).toBeInTheDocument();
  });
});

describe('Sidebar width', () => {
  const setWidth = (w: number) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
  };
  afterEach(() => {
    setWidth(1024);
    localStorage.clear();
    document.documentElement.removeAttribute('data-sidebar');
  });

  const renderSidebar = () =>
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );

  // Below 1440 an expanded sidebar would leave a page less room than it has
  // today at 1280, so there it is always the rail, with no toggle.
  it('is the rail below 1440, with no toggle', () => {
    setWidth(1439);
    renderSidebar();
    expect(document.documentElement).toHaveAttribute('data-sidebar', 'rail');
    expect(screen.queryByRole('button', { name: /sidebar/i })).toBeNull();
    // The group's name is still there for a screen reader, just not shown.
    expect(screen.getByText('Lab')).toHaveClass('sr-only');
  });

  it('shows labels and group names from 1440', () => {
    setWidth(1440);
    renderSidebar();
    expect(document.documentElement).toHaveAttribute('data-sidebar', 'expanded');
    expect(screen.getByText('Lab')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Devices' })).toHaveTextContent('Devices');
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('collapses on request, remembers it, and tells the page', () => {
    setWidth(1440);
    const heard = vi.fn();
    window.addEventListener('xenon:sidebar', heard);
    renderSidebar();
    heard.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(document.documentElement).toHaveAttribute('data-sidebar', 'rail');
    expect(localStorage.getItem('xenon.sidebar')).toBe('collapsed');
    expect(heard).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    window.removeEventListener('xenon:sidebar', heard);
  });

  it('stays collapsed on a wide screen once the user chose that', () => {
    setWidth(1600);
    localStorage.setItem('xenon.sidebar', 'collapsed');
    renderSidebar();
    expect(document.documentElement).toHaveAttribute('data-sidebar', 'rail');
  });
});
