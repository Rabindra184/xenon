import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import './header.css';
import {
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
          <img src="logo.svg" alt="Xenon Logo" className="header-logo-image" />
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
