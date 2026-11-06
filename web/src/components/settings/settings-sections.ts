/**
 * The Settings area's sections, in tab order. Every admin page lives here,
 * under /settings, so the sidebar has one Settings entry instead of seven.
 * `oldPath` is where the page lived before; it redirects here so bookmarks
 * and links in docs keep working.
 */
export interface SettingsSection {
  id: string;
  label: string;
  /** Full path, under the router's /xenon basename. */
  path: string;
  oldPath?: string;
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: 'general', label: 'General', path: '/settings' },
  { id: 'ai', label: 'AI engine', path: '/settings/ai', oldPath: '/ai-settings' },
  {
    id: 'maintenance',
    label: 'Maintenance',
    path: '/settings/maintenance',
    oldPath: '/maintenance',
  },
  {
    id: 'notifications',
    label: 'Notifications',
    path: '/settings/notifications',
    oldPath: '/notifications',
  },
  { id: 'teams', label: 'Teams', path: '/settings/teams', oldPath: '/teams' },
  { id: 'users', label: 'Users', path: '/settings/users', oldPath: '/users' },
  { id: 'api-keys', label: 'API keys', path: '/settings/api-keys', oldPath: '/api-keys' },
];
