import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutGrid,
  Smartphone,
  Tv,
  AppWindow,
  MonitorPlay,
  Bell,
  Settings as SettingsIcon,
  Brain,
  ShieldCheck,
  HeartPulse,
  Users,
  Key,
  BookOpen,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../../auth/auth-context';

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

const items: NavItem[] = [
  // Read-style pages — visible to every authenticated user.
  { id: 'overview', label: 'Overview', icon: LayoutGrid, path: '/overview' },
  { id: 'devices', label: 'Devices', icon: Smartphone, path: '/devices' },
  { id: 'live-devices', label: 'Live Devices', icon: Tv, path: '/devices/live' },
  { id: 'apps', label: 'Apps', icon: AppWindow, path: '/apps' },
  { id: 'sessions', label: 'Sessions', icon: MonitorPlay, path: '/builds' },
  { id: 'selector-health', label: 'Selector Health', icon: HeartPulse, path: '/selector-health' },
  { id: 'notifications', label: 'Notifications', icon: Bell, path: '/notifications' },
  // Admin-only management surfaces.
  { id: 'settings', label: 'Settings', icon: SettingsIcon, path: '/settings', minRole: 'ADMIN' },
  { id: 'ai', label: 'AI', icon: Brain, path: '/ai-settings', minRole: 'ADMIN' },
  { id: 'maintenance', label: 'Maintenance', icon: ShieldCheck, path: '/maintenance', minRole: 'ADMIN' },
  { id: 'teams', label: 'Teams', icon: Users, path: '/teams', minRole: 'ADMIN' },
  { id: 'apikeys', label: 'API Keys', icon: Key, path: '/api-keys', minRole: 'ADMIN' },
];

const RANK = { SUPER_ADMIN: 3, ADMIN: 2, MEMBER: 1 } as const;
function visibleFor(role: string | undefined, minRole?: Role): boolean {
  if (!minRole) return true;
  const r = role ? (RANK[role as keyof typeof RANK] ?? 0) : 0;
  return r >= RANK[minRole];
}

const Sidebar: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { me } = useAuth();

  const visibleItems = items.filter((i) => visibleFor(me?.role, i.minRole));

  // Path normalization: remove trailing slashes for consistent matching
  const currentPath = location.pathname.replace(/\/$/, '') || '/';

  const bestMatch = visibleItems
    .filter(
      (i) =>
        currentPath === i.path ||
        currentPath.startsWith(i.path + '/'),
    )
    .sort((a, b) => b.path.length - a.path.length)[0];

  const isActive = (path: string) => bestMatch?.path === path;

  return (
    <aside className="fixed inset-y-0 left-0 z-30 w-14 border-r border-[var(--border)] bg-[var(--surface)] flex flex-col items-center py-3">
      <nav className="flex-1 flex flex-col gap-1 w-full items-center">
        {visibleItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.path);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => navigate(item.path)}
              className={`group relative w-full flex justify-center py-2.5 mx-1 rounded-md transition-colors ${active ? 'bg-[var(--surface-2)]' : 'hover:bg-[var(--surface-2)]/60'}`}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
            >
              <span
                className={`absolute left-0 top-1 bottom-1 w-[3px] rounded-r transition-all ${active ? 'bg-[var(--green)]' : 'bg-transparent'}`}
              />
              <Icon
                className={`h-[18px] w-[18px] transition-colors ${active ? 'text-[var(--green)]' : 'text-[var(--text-dim)] group-hover:text-[var(--text)]'}`}
                strokeWidth={active ? 2.25 : 2}
              />
              <span className="pointer-events-none absolute left-full ml-2 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-[var(--surface-2)] border border-[var(--border-strong)] px-2 py-1 text-xs text-[var(--text)] opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-lg">
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>
      <button
        type="button"
        className="group relative w-full flex justify-center py-2.5 mt-2"
        aria-label="API Docs"
        onClick={() => window.open(window.location.origin + '/xenon/api-docs', '_blank')}
      >
        <BookOpen className="h-[18px] w-[18px] text-[var(--text-dim)] group-hover:text-[var(--text)] transition-colors" />
        <span className="pointer-events-none absolute left-full ml-2 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-[var(--surface-2)] border border-[var(--border-strong)] px-2 py-1 text-xs text-[var(--text)] opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-lg">
          API Docs
        </span>
      </button>
    </aside>
  );
};

export { Sidebar };
export default Sidebar;
