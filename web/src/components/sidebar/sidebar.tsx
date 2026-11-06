import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutGrid,
  Smartphone,
  Tv,
  Film,
  AppWindow,
  MonitorPlay,
  Settings as SettingsIcon,
  HeartPulse,
  BookOpen,
  PanelLeftClose,
  PanelLeftOpen,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../../auth/auth-context';
import { useSidebar } from '../../lib/sidebar';

type Role = 'SUPER_ADMIN' | 'ADMIN' | 'MEMBER';

type NavItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  path: string;
  // Highest privilege required to see this item. Items without `minRole`
  // are visible to every authenticated user (read-style pages).
  minRole?: Role;
};

type NavGroup = { id: string; label: string; items: NavItem[] };

// What a tester looks for, in the order they work: the lab, then their test
// runs, then administration. Every admin page is a section of Settings (its
// tabs: settings-sections.ts), so Admin is one entry.
const groups: NavGroup[] = [
  {
    id: 'lab',
    label: 'Lab',
    items: [
      { id: 'overview', label: 'Overview', icon: LayoutGrid, path: '/overview' },
      { id: 'devices', label: 'Devices', icon: Smartphone, path: '/devices' },
      { id: 'live-devices', label: 'Live devices', icon: Tv, path: '/devices/live' },
      { id: 'apps', label: 'Apps', icon: AppWindow, path: '/apps' },
    ],
  },
  {
    id: 'testing',
    label: 'Testing',
    items: [
      { id: 'sessions', label: 'Sessions', icon: MonitorPlay, path: '/builds' },
      { id: 'recordings', label: 'Recordings', icon: Film, path: '/recordings' },
      {
        id: 'selector-health',
        label: 'Selector health',
        icon: HeartPulse,
        path: '/selector-health',
      },
    ],
  },
  {
    id: 'admin',
    label: 'Admin',
    items: [
      // Notifications is a section of Settings: webhooks are admin-only on the
      // server, so a member who opened it got a page whose every call was refused.
      {
        id: 'settings',
        label: 'Settings',
        icon: SettingsIcon,
        path: '/settings',
        minRole: 'ADMIN',
      },
    ],
  },
];

const RANK = { SUPER_ADMIN: 3, ADMIN: 2, MEMBER: 1 } as const;
function visibleFor(role: string | undefined, minRole?: Role): boolean {
  if (!minRole) return true;
  const r = role ? (RANK[role as keyof typeof RANK] ?? 0) : 0;
  return r >= RANK[minRole];
}

const tooltip =
  'pointer-events-none absolute left-full ml-2 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-[var(--surface-2)] border border-[var(--border-strong)] px-2 py-1 text-xs text-[var(--text)] opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity z-50 shadow-overlay';

const Sidebar: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { me } = useAuth();
  const { expanded, canExpand, toggle } = useSidebar();

  const visibleGroups = groups
    .map((g) => ({ ...g, items: g.items.filter((i) => visibleFor(me?.role, i.minRole)) }))
    .filter((g) => g.items.length > 0);
  const visibleItems = visibleGroups.flatMap((g) => g.items);

  // Path normalization: remove trailing slashes for consistent matching
  const currentPath = location.pathname.replace(/\/$/, '') || '/';

  const bestMatch = visibleItems
    .filter((i) => currentPath === i.path || currentPath.startsWith(i.path + '/'))
    .sort((a, b) => b.path.length - a.path.length)[0];

  const isActive = (path: string) => bestMatch?.path === path;

  // Expanded: icon and label in a row. The rail: the icon centred, the label a
  // tooltip on hover or keyboard focus.
  const row = expanded ? 'justify-start gap-2.5 px-2.5 py-2' : 'justify-center py-2.5';

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-30 w-[var(--sidebar-width)] border-r border-[var(--border)] bg-[var(--surface)] flex flex-col py-3 ${expanded ? 'px-2' : 'items-center'}`}
    >
      <nav
        aria-label="Main"
        className={`flex-1 flex flex-col w-full ${expanded ? '' : 'items-center'}`}
      >
        {visibleGroups.map((group, gi) => (
          <div
            key={group.id}
            role="group"
            aria-labelledby={`nav-group-${group.id}`}
            className="w-full"
          >
            {expanded ? (
              <div
                id={`nav-group-${group.id}`}
                className={`px-2.5 pb-1 text-caption font-medium text-[var(--text-dim)] ${gi === 0 ? 'pt-1' : 'pt-4'}`}
              >
                {group.label}
              </div>
            ) : (
              <>
                <span id={`nav-group-${group.id}`} className="sr-only">
                  {group.label}
                </span>
                {gi > 0 && (
                  <div className="mx-3 my-2 border-t border-[var(--border)]" aria-hidden="true" />
                )}
              </>
            )}
            <div className="flex flex-col gap-0.5 w-full">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.path);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => navigate(item.path)}
                    className={`group relative w-full flex items-center rounded-md transition-colors ${row} ${active ? 'bg-[var(--surface-2)]' : 'hover:bg-[var(--surface-2)]/60'}`}
                    aria-label={item.label}
                    aria-current={active ? 'page' : undefined}
                  >
                    <span
                      className={`absolute top-1 bottom-1 w-[3px] rounded-r transition-all ${expanded ? '-left-2' : 'left-0'} ${active ? 'bg-[var(--color-accent)]' : 'bg-transparent'}`}
                    />
                    <Icon
                      className={`h-[18px] w-[18px] shrink-0 transition-colors ${active ? 'text-[var(--color-accent)]' : 'text-[var(--text-dim)] group-hover:text-[var(--text)]'}`}
                      strokeWidth={active ? 2.25 : 2}
                      aria-hidden="true"
                    />
                    {expanded ? (
                      <span
                        className={`truncate text-label ${active ? 'font-medium text-[var(--text)]' : 'text-[var(--text-muted)] group-hover:text-[var(--text)]'}`}
                      >
                        {item.label}
                      </span>
                    ) : (
                      <span className={tooltip}>{item.label}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <button
        type="button"
        className={`group relative w-full flex items-center rounded-md mt-2 hover:bg-[var(--surface-2)]/60 ${row}`}
        aria-label="API docs"
        onClick={() => window.open(window.location.origin + '/xenon/api-docs', '_blank')}
      >
        <BookOpen
          className="h-[18px] w-[18px] shrink-0 text-[var(--text-dim)] group-hover:text-[var(--text)] transition-colors"
          aria-hidden="true"
        />
        {expanded ? (
          <span className="text-label text-[var(--text-muted)] group-hover:text-[var(--text)]">
            API docs
          </span>
        ) : (
          <span className={tooltip}>API docs</span>
        )}
      </button>
      {canExpand && (
        <button
          type="button"
          className={`group relative w-full flex items-center rounded-md hover:bg-[var(--surface-2)]/60 ${row}`}
          aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
          aria-expanded={expanded}
          onClick={toggle}
        >
          {expanded ? (
            <PanelLeftClose
              className="h-[18px] w-[18px] shrink-0 text-[var(--text-dim)] group-hover:text-[var(--text)]"
              aria-hidden="true"
            />
          ) : (
            <PanelLeftOpen
              className="h-[18px] w-[18px] shrink-0 text-[var(--text-dim)] group-hover:text-[var(--text)]"
              aria-hidden="true"
            />
          )}
          {expanded ? (
            <span className="text-label text-[var(--text-muted)] group-hover:text-[var(--text)]">
              Collapse
            </span>
          ) : (
            <span className={tooltip}>Expand sidebar</span>
          )}
        </button>
      )}
    </aside>
  );
};

export { Sidebar };
export default Sidebar;
