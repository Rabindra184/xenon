import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, Search, Shield } from 'lucide-react';

function useRelativeTime() {
  const [tick, setTick] = useState(0);
  const [startedAt] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 5000);
    return () => clearInterval(id);
  }, []);
  const secs = Math.floor((Date.now() - startedAt) / 1000) + tick * 0;
  if (secs < 10) return 'Updated just now';
  if (secs < 60) return `Updated ${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `Updated ${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `Updated ${hrs}h ago`;
}

const Header: React.FC = () => {
  const navigate = useNavigate();
  const rel = useRelativeTime();
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
            <div className="h-7 w-7 rounded-md bg-[var(--green)] flex items-center justify-center text-black font-bold text-sm">
              X
            </div>
            <div className="flex flex-col leading-tight text-left">
              <span className="text-[13px] font-semibold tracking-wide text-[var(--text)]">
                XENON
              </span>
              <span className="text-[9px] text-[var(--text-dim)] tracking-widest uppercase">
                Device Ops
              </span>
            </div>
          </div>
          <span className="font-mono text-[11px] text-[var(--text-dim)] px-1.5 py-0.5 rounded border border-[var(--border)]">
            v{__XENON_VERSION__}
          </span>
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
          <span className="hidden md:inline text-xs text-[var(--text-dim)] font-mono">
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
