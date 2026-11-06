import * as React from 'react';
import { NavLink } from 'react-router-dom';
import './link-tabs.css';

export interface LinkTab {
  id: string;
  label: string;
  /** Router path (under the /xenon basename). */
  to: string;
}

/**
 * Tabs that are pages: each is a link with its own URL, so back, middle-click
 * and bookmarks work, and the current one has aria-current="page". Not ARIA
 * tabs (role="tab"), which would promise arrow-key switching within one page.
 */
export const LinkTabs: React.FC<{ label: string; tabs: LinkTab[] }> = ({ label, tabs }) => (
  <nav aria-label={label} className="link-tabs">
    {tabs.map((t) => (
      <NavLink
        key={t.id}
        to={t.to}
        end
        className={({ isActive }) => `link-tab${isActive ? ' is-active' : ''}`}
      >
        {t.label}
      </NavLink>
    ))}
  </nav>
);
