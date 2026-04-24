import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutGrid,
  Smartphone,
  AppWindow,
  MonitorPlay,
  Bell,
  Settings as SettingsIcon,
  Brain,
  ShieldCheck,
  Users,
  Key,
  BookOpen,
} from 'lucide-react';

type NavItem = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  path: string;
};

const items: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: LayoutGrid, path: '/overview' },
  { id: 'devices', label: 'Devices', icon: Smartphone, path: '/devices' },
  { id: 'apps', label: 'Apps', icon: AppWindow, path: '/apps' },
  { id: 'sessions', label: 'Sessions', icon: MonitorPlay, path: '/builds' },
  { id: 'notifications', label: 'Notifications', icon: Bell, path: '/notifications' },
  { id: 'settings', label: 'Settings', icon: SettingsIcon, path: '/settings' },
  { id: 'ai', label: 'AI', icon: Brain, path: '/ai-settings' },
  { id: 'maintenance', label: 'Maintenance', icon: ShieldCheck, path: '/maintenance' },
  { id: 'teams', label: 'Teams', icon: Users, path: '/teams' },
  { id: 'apikeys', label: 'API Keys', icon: Key, path: '/api-keys' },
];

const Sidebar: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = (path: string) =>
    location.pathname === path || location.pathname.startsWith(path + '/');

  return (
    <aside className="fixed inset-y-0 left-0 z-30 w-14 border-r border-[var(--border)] bg-[var(--surface)] flex flex-col items-center py-3">
      <nav className="flex-1 flex flex-col gap-1 w-full items-center">
        {items.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.path);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => navigate(item.path)}
              className="group relative w-full flex justify-center py-2.5"
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
            >
              <span
                className={`absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r transition-all ${active ? 'bg-[var(--green)]' : 'bg-transparent'}`}
              />
              <Icon
                className={`h-[18px] w-[18px] transition-colors ${active ? 'text-[var(--text)]' : 'text-[var(--text-dim)] group-hover:text-[var(--text)]'}`}
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
