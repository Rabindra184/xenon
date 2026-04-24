import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Smartphone,
  Hammer,
  AppWindow,
  Bell,
  Settings as SettingsIcon,
  Brain,
  ShieldCheck,
  Users,
  Key,
  BookOpen,
  PinOff,
  Pin,
} from 'lucide-react';
import { useSidebarState } from '../../hooks/useSidebarState';
import './sidebar.css';

interface NavRow {
  id: string;
  label: string;
  icon: React.ReactNode;
  path?: string;
  onClick?: () => void;
  count?: number;
}

interface NavGroup {
  heading: string;
  rows: NavRow[];
}

const Sidebar: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { state, isPinned, setHover, togglePin } = useSidebarState();
  const expanded = state !== 'collapsed';

  const isActive = (p: string) =>
    location.pathname === p || location.pathname.startsWith(p + '/');

  const groups: NavGroup[] = [
    {
      heading: 'WORKSPACE',
      rows: [
        {
          id: 'overview',
          label: 'Overview',
          icon: <LayoutDashboard size={16} />,
          path: '/overview',
        },
        { id: 'devices', label: 'Devices', icon: <Smartphone size={16} />, path: '/devices' },
        { id: 'sessions', label: 'Sessions', icon: <Hammer size={16} />, path: '/builds' },
        { id: 'apps', label: 'Apps', icon: <AppWindow size={16} />, path: '/apps' },
        {
          id: 'notifications',
          label: 'Notifications',
          icon: <Bell size={16} />,
          path: '/notifications',
        },
      ],
    },
    {
      heading: 'ADMIN',
      rows: [
        { id: 'settings', label: 'Settings', icon: <SettingsIcon size={16} />, path: '/settings' },
        { id: 'ai', label: 'AI Engine', icon: <Brain size={16} />, path: '/ai-settings' },
        {
          id: 'maint',
          label: 'Maintenance',
          icon: <ShieldCheck size={16} />,
          path: '/maintenance',
        },
        { id: 'teams', label: 'Teams', icon: <Users size={16} />, path: '/teams' },
        { id: 'keys', label: 'API Keys', icon: <Key size={16} />, path: '/api-keys' },
      ],
    },
  ];

  return (
    <aside
      className={`sb2${expanded ? ' sb2-expanded' : ''}${isPinned ? ' sb2-pinned' : ''}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="sb2-groups">
        {groups.map((g) => (
          <div key={g.heading} className="sb2-group">
            {expanded && <div className="sb2-heading">{g.heading}</div>}
            {g.rows.map((r) => {
              const active = r.path ? isActive(r.path) : false;
              return (
                <button
                  key={r.id}
                  type="button"
                  className={`sb2-row${active ? ' sb2-row-active' : ''}`}
                  onClick={() => {
                    if (r.onClick) r.onClick();
                    else if (r.path) navigate(r.path);
                  }}
                  title={!expanded ? r.label : undefined}
                >
                  <span className="sb2-icon">{r.icon}</span>
                  {expanded && <span className="sb2-label">{r.label}</span>}
                  {expanded && typeof r.count === 'number' && (
                    <span className="sb2-count">{r.count}</span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="sb2-footer">
        <button
          type="button"
          className="sb2-row"
          onClick={() => window.open(window.location.origin + '/xenon/api-docs', '_blank')}
          title={!expanded ? 'API Docs' : undefined}
        >
          <span className="sb2-icon">
            <BookOpen size={16} />
          </span>
          {expanded && <span className="sb2-label">API Docs</span>}
        </button>
        {expanded && (
          <button
            type="button"
            className="sb2-pin"
            onClick={togglePin}
            title={isPinned ? 'Unpin sidebar' : 'Pin sidebar open'}
          >
            {isPinned ? <PinOff size={14} /> : <Pin size={14} />}
            <span>{isPinned ? 'Unpin' : 'Pin'}</span>
          </button>
        )}
      </div>
    </aside>
  );
};

export { Sidebar };
export default Sidebar;
