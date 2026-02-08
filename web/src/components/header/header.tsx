import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import './header.css';
import {
  Atom as XenonLogo,
  Settings,
  User,
  ChevronDown,
  BookOpen,
  ShieldCheck,
  LineChart,
  Brain,
  Info,
  Shield,
} from 'lucide-react';
import { getEnabledNavItems } from '../../config/navigation';

const Header: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const navItems = getEnabledNavItems();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isActive = (path: string) => location.pathname === path;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleNavClick = (path: string) => {
    navigate(path);
    setDropdownOpen(false);
  };

  return (
    <div className="header-container">
      <div className="header-left">
        <div className="header-logo-container" onClick={() => navigate('/')}>
          <XenonLogo size={45} className="header-logo-image" />
          <div className="header-logo">
            Xenon
            <span className="logo-badge">OSS</span>
          </div>
        </div>
        <div className="header-nav">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={`header-nav__item ${isActive(item.path) ? 'active' : ''}`}
              onClick={() => handleNavClick(item.path)}
            >
              <span className="header-nav__icon">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="header-right">
        <div className="header-actions">
          <div className="header-status-pill">
            <div className="status-dot"></div>
            <span>System Online</span>
          </div>
        </div>

        <div className="profile-dropdown-container" ref={dropdownRef}>
          <button
            className={`profile-trigger ${dropdownOpen ? 'open' : ''}`}
            onClick={() => setDropdownOpen(!dropdownOpen)}
          >
            <div className="avatar-preview">
              <Shield size={16} />
            </div>
            <div className="profile-info-compact">
              <span className="profile-name">Administrator</span>
              <span className="profile-role">Root Node</span>
            </div>
            <ChevronDown size={14} className={`chevron-icon ${dropdownOpen ? 'rotate' : ''}`} />
          </button>

          {dropdownOpen && (
            <div className="profile-dropdown animate-slide-up">
              {/* Section 1: Context */}
              <div className="dropdown-group">
                <div className="dropdown-section-header">
                  <Info size={12} />
                  <span>Workspace Context</span>
                </div>
                <div className="dropdown-context-item">
                  <p className="context-label">Current Registry</p>
                  <p className="context-value">Xenon Default Registry</p>
                </div>
                <div className="dropdown-context-item">
                  <p className="context-label">Active Node</p>
                  <p className="context-value">Root Node • Primary</p>
                </div>
              </div>

              <div className="dropdown-divider"></div>

              {/* Section 2: Operations */}
              <div className="dropdown-group">
                <div className="dropdown-section-header">
                  <Settings size={12} />
                  <span>Administration</span>
                </div>
                <button className="dropdown-item" onClick={() => handleNavClick('/settings')}>
                  <ShieldCheck size={16} />
                  <span>Infrastructure Control</span>
                </button>

                <button className="dropdown-item" onClick={() => handleNavClick('/ai-settings')}>
                  <Brain size={16} />
                  <span>AI Intelligence</span>
                </button>

                <button className="dropdown-item" onClick={() => handleNavClick('/maintenance')}>
                  <ShieldCheck size={16} />
                  <span>Maintenance & Retention</span>
                </button>

                <button className="dropdown-item" onClick={() => window.open(window.location.origin + '/xenon/api-docs', '_blank')}>
                  <BookOpen size={16} />
                  <span>API Documentation</span>
                </button>
              </div>

              <div className="dropdown-divider"></div>

              {/* Section 3: System Status (Non-interactive) */}
              <div className="dropdown-system-info">
                <div className="status-indicator">
                  <div className="status-dot online"></div>
                  <span>Node: Stable</span>
                </div>
                <span className="version-label">v1.2.4-stable</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Header;
