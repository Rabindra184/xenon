import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { SettingsLayout, MovedToSettings } from './SettingsLayout';
import { SETTINGS_SECTIONS } from './settings-sections';
import { PageHeader } from '../ui/page-header';

const Where = () => {
  const { pathname, search, hash } = useLocation();
  return <output data-testid="where">{`${pathname}${search}${hash}`}</output>;
};

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/settings" element={<SettingsLayout />}>
          <Route index element={<PageHeader title="General page" />} />
          <Route path="teams" element={<PageHeader title="Teams page" />} />
        </Route>
        {SETTINGS_SECTIONS.filter((s) => s.oldPath).map((s) => (
          <Route key={s.id} path={s.oldPath} element={<MovedToSettings to={s.path} />} />
        ))}
        <Route path="*" element={null} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

describe('the Settings area', () => {
  it('puts the section links and the "Settings" eyebrow in the page’s own header', () => {
    renderAt('/settings/teams');
    const header = screen.getByRole('heading', { name: 'Teams page' }).closest('header')!;
    expect(header).toHaveTextContent('Settings');
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(header).toContainElement(nav);
    expect(Array.from(nav.querySelectorAll('a')).map((a) => a.textContent)).toEqual(
      SETTINGS_SECTIONS.map((s) => s.label),
    );
  });

  it('marks only the open section current', () => {
    renderAt('/settings/teams');
    expect(screen.getByRole('link', { name: 'Teams' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'General' })).not.toHaveAttribute('aria-current');
  });

  it('marks General current at /settings itself', () => {
    renderAt('/settings');
    expect(screen.getByRole('link', { name: 'General' })).toHaveAttribute('aria-current', 'page');
  });

  // Bookmarks, docs and the command palette's old deep links keep working.
  it.each(SETTINGS_SECTIONS.filter((s) => s.oldPath).map((s) => [s.oldPath!, s.path]))(
    'sends %s to %s, keeping its query and hash',
    (oldPath, newPath) => {
      renderAt(`${oldPath}?team=t1#top`);
      expect(screen.getByTestId('where')).toHaveTextContent(`${newPath}?team=t1#top`);
    },
  );

  it('leaves a header outside Settings as it was', () => {
    render(
      <MemoryRouter>
        <PageHeader title="Devices" />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Devices' }).closest('header')).toHaveClass('pb-4');
  });
});
