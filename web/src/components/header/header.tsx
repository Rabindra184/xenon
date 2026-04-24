import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, Search, Shield } from 'lucide-react';
import { StatusDot } from '../ui/StatusDot';
import './header.css';

const Header: React.FC = () => {
  const navigate = useNavigate();
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
          <StatusDot kind="ready" />
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

export default Header;
