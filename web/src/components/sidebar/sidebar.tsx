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
import { isThemeV2 } from '../../lib/theme-flag';
import { useSidebarState } from '../../hooks/useSidebarState';
import { getEnabledNavItems } from '../../config/navigation';
import './sidebar.css';

/* ============================================================
 * v1 Sidebar — preserved verbatim
 * ============================================================ */

interface V1ItemProps {
  icon: React.ReactNode;
  label: string;
  path: string;
  active?: boolean;
  onClick: () => void;
}

const V1Item: React.FC<V1ItemProps> = ({ icon, label, active, onClick }) => (
  <div className="sidebar-item-wrapper group" onClick={onClick}>
    {active && <div className="sidebar-active-indicator" />}
    <div className={`sidebar-icon-container ${active ? 'active' : ''}`}>{icon}</div>
    <div className="sidebar-tooltip">{label}</div>
  </div>
);

const SidebarV1: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const navItems = getEnabledNavItems();
  const isActive = (path: string) => location.pathname === path;

  return (
    <aside className="app-sidebar">
      <div className="sidebar-nav">
        {navItems.map((item) => (
          <V1Item
            key={item.id}
            icon={item.icon}
            label={item.label}
            path={item.path}
            active={isActive(item.path)}
            onClick={() => navigate(item.path)}
          />
        ))}
      </div>
      <div className="sidebar-footer">
        <V1Item
          icon={<SettingsIcon size={18} />}
          label="Settings"
          path="/settings"
          active={isActive('/settings')}
          onClick={() => navigate('/settings')}
        />
        <V1Item
          icon={<Brain size={18} />}
          label="AI Engine"
          path="/ai-settings"
          active={isActive('/ai-settings')}
          onClick={() => navigate('/ai-settings')}
        />
        <V1Item
          icon={<ShieldCheck size={18} />}
          label="Maintenance"
          path="/maintenance"
          active={isActive('/maintenance')}
          onClick={() => navigate('/maintenance')}
        />
        <V1Item
          icon={<Users size={18} />}
          label="Teams"
          path="/teams"
          active={isActive('/teams')}
          onClick={() => navigate('/teams')}
        />
        <V1Item
          icon={<Key size={18} />}
          label="API Keys"
          path="/api-keys"
          active={isActive('/api-keys')}
          onClick={() => navigate('/api-keys')}
        />
        <V1Item
          icon={<BookOpen size={18} />}
          label="API Docs"
          path="/xenon/api-docs"
          active={false}
          onClick={() => window.open(window.location.origin + '/xenon/api-docs', '_blank')}
        />
      </div>
    </aside>
  );
};

/* ============================================================
 * v2 Sidebar — expandable, pinnable, grouped with counts
 * ============================================================ */

interface V2NavRow {
  id: string;
  label: string;
  icon: React.ReactNode;
  path?: string;
  onClick?: () => void;
  count?: number;
}

interface V2NavGroup {
  heading: string;
  rows: V2NavRow[];
}

const SidebarV2: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { state, isPinned, setHover, togglePin } = useSidebarState();
  const expanded = state !== 'collapsed';

  const isActive = (p: string) =>
    location.pathname === p || location.pathname.startsWith(p + '/');

  const groups: V2NavGroup[] = [
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

export const Sidebar: React.FC = () => (isThemeV2() ? <SidebarV2 /> : <SidebarV1 />);
export default Sidebar;
