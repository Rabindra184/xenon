import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ChevronDown, Info, Search, Shield } from 'lucide-react';
import { isThemeV2 } from '../../lib/theme-flag';
import './header.css';

/* ============================================================
 * v1 Header — preserved verbatim.
 * ============================================================ */

const HeaderV1: React.FC = () => {
  const navigate = useNavigate();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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

              <div className="dropdown-system-info">
                <div className="status-indicator">
                  <div className="status-dot online"></div>
                  <span>Node: Stable</span>
                </div>
                <span className="version-label">v{__XENON_VERSION__}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/* ============================================================
 * v2 Header — slim 44px, ⌘K search trigger.
 * ============================================================ */

const HeaderV2: React.FC = () => {
  const navigate = useNavigate();
  useLocation(); // re-render on route change so active indicators (future) stay fresh
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const ddRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ddRef.current && !ddRef.current.contains(e.target as Node)) setDropdownOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const openPalette = () => window.dispatchEvent(new CustomEvent('xenon.open-command-palette'));

  return (
    <div className="hdr2">
      <div className="hdr2-left" onClick={() => navigate('/')}>
        <img src="logo.svg" alt="Xenon" className="hdr2-logo" />
        <span className="hdr2-version">v{__XENON_VERSION__}</span>
      </div>

      <button type="button" className="hdr2-search" onClick={openPalette}>
        <Search size={13} />
        <span className="hdr2-search-placeholder">Search devices, sessions, settings…</span>
        <span className="hdr2-kbd">⌘K</span>
      </button>

      <div className="hdr2-right">
        <div className="hdr2-status">
          <span className="status-dot status-dot-ready" style={{ width: 6, height: 6 }} />
          <span>Online</span>
        </div>
        <div className="hdr2-profile-wrap" ref={ddRef}>
          <button
            type="button"
            className="hdr2-profile"
            onClick={() => setDropdownOpen((o) => !o)}
          >
            <span className="hdr2-avatar">
              <Shield size={14} />
            </span>
            <span className="hdr2-profile-name">Administrator</span>
            <ChevronDown size={12} />
          </button>
          {dropdownOpen && (
            <div className="hdr2-profile-menu">
              <div className="hdr2-menu-section">
                <div className="hdr2-menu-head">Workspace</div>
                <div className="hdr2-menu-row">
                  <span>Registry</span>
                  <span>Default</span>
                </div>
                <div className="hdr2-menu-row">
                  <span>Node</span>
                  <span>Root · Primary</span>
                </div>
              </div>
              <div className="hdr2-menu-divider" />
              <div className="hdr2-menu-section">
                <div className="hdr2-menu-head">System</div>
                <div className="hdr2-menu-row">
                  <span>● Stable</span>
                  <span>v{__XENON_VERSION__}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const Header: React.FC = () => (isThemeV2() ? <HeaderV2 /> : <HeaderV1 />);
export default Header;
