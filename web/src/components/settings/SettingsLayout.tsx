import * as React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { PageHeaderNav } from '../ui/page-header';
import { SETTINGS_SECTIONS } from './settings-sections';
import { LinkTabs } from '../ui/LinkTabs';

/** The Settings sections, under the page's own header. */
export const SettingsTabs: React.FC = () => (
  <LinkTabs
    label="Settings sections"
    tabs={SETTINGS_SECTIONS.map((s) => ({ id: s.id, label: s.label, to: s.path }))}
  />
);

/**
 * Every Settings section renders inside this. Each page keeps its own
 * PageHeader (its title, description and actions); the context adds the
 * "Settings" eyebrow and the section links beneath it, so no page has to.
 */
export const SettingsLayout: React.FC = () => (
  <PageHeaderNav.Provider value={{ eyebrow: 'Settings', nav: <SettingsTabs /> }}>
    <Outlet />
  </PageHeaderNav.Provider>
);

/** An old admin URL, sent to its section with its query and hash. */
export const MovedToSettings: React.FC<{ to: string }> = ({ to }) => {
  const { search, hash } = useLocation();
  return <Navigate to={`${to}${search}${hash}`} replace />;
};
