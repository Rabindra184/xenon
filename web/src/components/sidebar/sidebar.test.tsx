import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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

  it('places Recordings directly after Live devices, visible to a MEMBER', () => {
    auth.me = { userId: 'b', role: 'MEMBER' };
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );
    const nav = screen.getByRole('navigation');
    const labels = within(nav)
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label'));
    expect(labels).toContain('Recordings');
    const liveIdx = labels.indexOf('Live devices');
    expect(labels[liveIdx + 1]).toBe('Recordings');
  });
});
