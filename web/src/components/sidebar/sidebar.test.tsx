import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Sidebar from './sidebar';

vi.mock('../../auth/auth-context', () => ({
  useAuth: () => ({ me: { userId: 'a', role: 'SUPER_ADMIN' } }),
}));

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
    expect(icons.length).toBeGreaterThanOrEqual(13);
    const byIcon: Record<string, string[]> = {};
    for (const entry of icons) {
      const [label, icon] = entry.split('=');
      (byIcon[icon] ||= []).push(label);
    }
    const shared = Object.entries(byIcon).filter(([, labels]) => labels.length > 1);
    expect(shared).toEqual([]);
  });
});
