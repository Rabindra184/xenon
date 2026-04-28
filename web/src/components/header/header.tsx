import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, Search, Shield } from 'lucide-react';

type Staleness = 'fresh' | 'aging' | 'stale';

// Tracks elapsed time since this Header mounted. It's a rough proxy for
// "time since you last saw a data update" — resets on page reload but
// not on websocket events (Phase 4 will wire a real last-event timestamp
// via a ConnectionContext once the dashboard data layer is refactored).
function useRelativeTime(): { label: string; staleness: Staleness } {
  const [tick, setTick] = useState(0);
  const [startedAt] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 5000);
    return () => clearInterval(id);
  }, []);
  const secs = Math.floor((Date.now() - startedAt) / 1000) + tick * 0;
  const mins = Math.floor(secs / 60);
  const hrs = Math.floor(mins / 60);
  const label =
    secs < 10 ? 'Updated just now' :
    secs < 60 ? `Updated ${secs}s ago` :
    mins < 60 ? `Updated ${mins}m ago` :
                `Updated ${hrs}h ago`;
  const staleness: Staleness = mins >= 10 ? 'stale' : mins >= 2 ? 'aging' : 'fresh';
  return { label, staleness };
}

const Header: React.FC = () => {
  const navigate = useNavigate();
  const { label: rel, staleness } = useRelativeTime();
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
          <span
            className={`hidden md:inline text-xs font-mono transition-colors ${
              staleness === 'stale'
                ? 'text-[var(--red)]'
                : staleness === 'aging'
                  ? 'text-[var(--amber)]'
                  : 'text-[var(--text-dim)]'
            }`}
            title={
              staleness === 'stale'
                ? 'Data is stale — reconnection may be needed.'
                : staleness === 'aging'
                  ? 'Data hasn’t updated in a while.'
                  : 'Live data.'
            }
          >
            {rel}
          </span>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--green)]/10 border border-[var(--green)]/20">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--green)] pulse-dot" />
            <span className="text-[11px] font-medium text-[var(--green)]">Online</span>
          </div>
          <div className="relative" ref={ddRef}>
            <button
              type="button"
              className="flex items-center gap-2 h-9 px-2.5 rounded-md border border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--surface)] transition-colors"
              onClick={() => setDropdownOpen((o) => !o)}
              aria-haspopup="true"
              aria-expanded={dropdownOpen}
            >
              <Shield className="h-4 w-4 text-[var(--text-muted)]" />
              <span className="text-sm text-[var(--text)]">Administrator</span>
              <ChevronDown className="h-3.5 w-3.5 text-[var(--text-dim)]" />
            </button>
            {dropdownOpen && (
              <div className="absolute top-full right-0 mt-2 w-64 rounded-md border border-[var(--border)] bg-[var(--surface)] shadow-lg overflow-hidden">
                <div className="px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-[var(--text-dim)] mb-1">
                    Workspace
                  </div>
                  <div className="flex items-center justify-between text-xs text-[var(--text)]">
                    <span className="text-[var(--text-muted)]">Registry</span>
                    <span>Default</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-[var(--text)] mt-1">
                    <span className="text-[var(--text-muted)]">Node</span>
                    <span>Root · Primary</span>
                  </div>
                </div>
                <div className="h-px bg-[var(--border)]" />
                <div className="px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-[var(--text-dim)] mb-1">
                    System
                  </div>
                  <div className="flex items-center justify-between text-xs text-[var(--text)]">
                    <span className="flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--green)]" />
                      Stable
                    </span>
                    <span className="font-mono text-[var(--text-muted)]">
                      v{__XENON_VERSION__}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
