import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, Search, LogOut, User as UserIcon } from 'lucide-react';
import { useAuth } from '../../auth/auth-context';
import { useConnectionStatus } from '../../hooks/useConnectionStatus';

const Header: React.FC = () => {
  const navigate = useNavigate();
  const { me, signOut } = useAuth();
  const connection = useConnectionStatus();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const ddRef = useRef<HTMLDivElement>(null);

  const initials = (me?.name ?? 'A').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const roleLabel =
    me?.role === 'SUPER_ADMIN' ? 'Super Admin' :
    me?.role === 'ADMIN'       ? 'Admin'       :
                                 'Member';

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ddRef.current && !ddRef.current.contains(e.target as Node)) setDropdownOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const openPalette = () => window.dispatchEvent(new CustomEvent('xenon.open-command-palette'));

  return (
    <header className="fixed top-0 left-14 right-0 z-20 h-14 border-b border-[var(--border)] bg-[var(--bg)]/80 backdrop-blur-md">
      <div className="flex items-center h-full px-4 gap-4">
        {/* Logo */}
        <button
          type="button"
          onClick={() => navigate('/overview')}
          className="flex items-center gap-3 min-w-0 cursor-pointer"
          aria-label="Xenon home"
        >
          <div className="flex items-center gap-2">
            <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="Xenon Logo" className="h-8 w-auto object-contain" />
          </div>
        </button>

        {/* Search */}
        <div className="flex-1 max-w-xl mx-auto">
          <button
            type="button"
            onClick={openPalette}
            className="relative w-full h-9 flex items-center text-left"
            aria-label="Open command palette"
          >
            <div className="w-full h-9 pl-9 pr-14 rounded-md bg-[var(--surface)] border border-[var(--border)] text-sm text-[var(--text-dim)] hover:border-[var(--border-strong)] hover:text-[var(--text)] transition-colors flex items-center">
              Search devices, sessions, settings…
            </div>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-dim)]" />
            <kbd className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[10px] text-[var(--text-dim)] border border-[var(--border)] rounded px-1.5 py-0.5">
              ⌘K
            </kbd>
          </button>
        </div>

        {/* Right */}
        <div className="flex items-center gap-3">
          {/* Driven by the real socket connection. Replaced a hardcoded
              "Online" pill and an "Updated Xm ago" timer that counted from
              when this header mounted and went red after 10 minutes. */}
          <div
            role="status"
            title={connection.title}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${
              connection.tone === 'live'
                ? 'bg-[var(--color-success)]/10 border-[var(--color-success)]/20 text-[var(--color-success)]'
                : connection.tone === 'reconnecting'
                  ? 'bg-[var(--amber)]/10 border-[var(--amber)]/25 text-[var(--amber)]'
                  : 'bg-[var(--red)]/10 border-[var(--red)]/25 text-[var(--red)]'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full bg-current ${connection.tone === 'live' ? 'pulse-dot' : ''}`}
              aria-hidden="true"
            />
            <span className="text-[11px] font-medium">{connection.label}</span>
          </div>
          <div className="relative" ref={ddRef}>
            <button
              type="button"
              className="flex items-center gap-2 h-9 pl-1.5 pr-2.5 rounded-md border border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--surface)] transition-colors"
              onClick={() => setDropdownOpen((o) => !o)}
              aria-haspopup="true"
              aria-expanded={dropdownOpen}
            >
              <span className="h-6 w-6 rounded-full bg-[var(--color-accent)]/15 text-[var(--color-accent)] text-[11px] font-semibold flex items-center justify-center">
                {initials}
              </span>
              <span className="flex flex-col items-start leading-tight">
                <span className="text-xs text-[var(--text)]">{me?.name ?? 'Account'}</span>
                <span className="text-[10px] text-[var(--text-dim)]">{roleLabel}</span>
              </span>
              <ChevronDown className="h-3.5 w-3.5 text-[var(--text-dim)]" />
            </button>
            {dropdownOpen && (
              <div className="absolute top-full right-0 mt-2 w-64 rounded-md border border-[var(--border)] bg-[var(--surface)] shadow-lg overflow-hidden">
                <div className="px-3 py-2">
                  <div className="text-[11px] text-[var(--text-dim)] mb-1">
                    System
                  </div>
                  {/* Only facts the client actually knows. The static "Registry ·
                      Default", "Node · Root · Primary" and "Stable" rows that
                      used to sit here described nothing real. */}
                  <div className="flex items-center justify-between text-xs text-[var(--text)]">
                    <span className="text-[var(--text-muted)]">Version</span>
                    <span className="font-mono text-[var(--text-muted)]">v{__XENON_VERSION__}</span>
                  </div>
                </div>
                <div className="h-px bg-[var(--border)]" />
                <button
                  type="button"
                  onClick={() => {
                    setDropdownOpen(false);
                    navigate('/profile');
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[var(--text)] hover:bg-[var(--bg)] text-left"
                >
                  <UserIcon className="h-3.5 w-3.5 text-[var(--text-dim)]" />
                  Profile
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDropdownOpen(false);
                    signOut();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[var(--red)] hover:bg-[var(--bg)] text-left"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
