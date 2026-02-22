import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
    Smartphone,
    Hammer,
    AppWindow,
    Bell,
    Settings,
    ShieldCheck,
    Brain,
    Info,
    BookOpen
} from 'lucide-react';
import { getEnabledNavItems } from '../../config/navigation';
import './sidebar.css';

interface SidebarItemProps {
    icon: React.ReactNode;
    label: string;
    path: string;
    active?: boolean;
    onClick: () => void;
}

const SidebarItem: React.FC<SidebarItemProps> = ({ icon, label, path, active, onClick }) => {
    return (
        <div className="sidebar-item-wrapper group" onClick={onClick}>
            {active && <div className="sidebar-active-indicator" />}
            <div className={`sidebar-icon-container ${active ? 'active' : ''}`}>
                {icon}
            </div>
            <div className="sidebar-tooltip">
                {label}
            </div>
        </div>
    );
};

export const Sidebar: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const navItems = getEnabledNavItems();

    const isActive = (path: string) => location.pathname === path;

    return (
        <aside className="app-sidebar">
            <div className="sidebar-nav">
                {navItems.map((item) => (
                    <SidebarItem
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
                <SidebarItem
                    icon={<Settings size={18} />}
                    label="Settings"
                    path="/settings"
                    active={isActive('/settings')}
                    onClick={() => navigate('/settings')}
                />
                <SidebarItem
                    icon={<Brain size={18} />}
                    label="AI Engine"
                    path="/ai-settings"
                    active={isActive('/ai-settings')}
                    onClick={() => navigate('/ai-settings')}
                />
                <SidebarItem
                    icon={<ShieldCheck size={18} />}
                    label="Maintenance"
                    path="/maintenance"
                    active={isActive('/maintenance')}
                    onClick={() => navigate('/maintenance')}
                />
                <SidebarItem
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

export default Sidebar;
