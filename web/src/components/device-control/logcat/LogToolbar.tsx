import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Circle,
  CircleHelp,
  Download,
  Ellipsis,
  Pause,
  Play,
  Square,
  X,
} from 'lucide-react';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Menu, MenuDivider, MenuItem } from '../../ui/Menu';
import { Popover } from '../../ui/Popover';
import { formatCount } from './logFormat';

export type StreamStatus = 'Live' | 'Connecting' | 'Offline' | 'Denied';

export interface LogToolbarProps {
  status: StreamStatus;
  /** Why, when the status is Denied: shown as its title. */
  statusDetail?: string | null;
  query: string;
  onQueryChange(query: string): void;
  filterRef: React.RefObject<HTMLInputElement>;
  find: string;
  onFindChange(find: string): void;
  findRef: React.RefObject<HTMLInputElement>;
  hitCount: number;
  /** The current match, from 0. */
  activeHit: number;
  onStep(step: 1 | -1): void;
  following: boolean;
  onTogglePause(): void;
  recording: boolean;
  recordedLines: number;
  onToggleRecording(): void;
  onExport(): void;
  caseSensitive: boolean;
  onToggleCase(): void;
  wrap: boolean;
  onToggleWrap(): void;
  canCopySelected: boolean;
  onCopySelected(): void;
  onClearLines(): void;
}

const EXAMPLES: Array<[string, string]> = [
  ['tag:Wifi', 'lines whose tag contains Wifi'],
  ['package:com.example', 'lines from that app'],
  ['level:W', 'warnings and above'],
  ['-tag:chatty', 'hide a tag'],
];

/**
 * The Logs tab's one-row toolbar: status, filter, Find, then Pause, Record,
 * Export and a menu for the rest. It holds only whether its two popovers are
 * open; everything else belongs to the view.
 */
export function LogToolbar(p: LogToolbarProps) {
  const syntaxRef = useRef<HTMLButtonElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [syntaxOpen, setSyntaxOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Focus the first choice once the menu is open, so the arrow keys work.
  useEffect(() => {
    if (!menuOpen) return;
    menuRef.current?.querySelector<HTMLElement>('[role^="menuitem"]:not(:disabled)')?.focus();
  }, [menuOpen]);

  const closeMenu = () => {
    setMenuOpen(false);
    moreRef.current?.focus();
  };
  const choose = (action: () => void) => () => {
    closeMenu();
    action();
  };

  const error = p.status === 'Offline' || p.status === 'Denied';

  return (
    <div className="log-toolbar">
      <div className="log-status" role="status" title={p.statusDetail ?? undefined}>
        <span
          className={`log-live-dot${p.status === 'Live' ? ' active' : ''}${error ? ' is-error' : ''}`}
          aria-hidden="true"
        />
        {p.status}
      </div>

      <div className="log-filter">
        <Input
          ref={p.filterRef}
          type="text"
          className="log-field log-filter-input"
          placeholder="tag:Wifi package:com.example text"
          value={p.query}
          onChange={(e) => p.onQueryChange(e.target.value)}
          aria-label="Filter logs"
          spellCheck={false}
          autoComplete="off"
        />
        <span className="log-field-buttons">
          {p.query && (
            <button
              type="button"
              className="log-field-btn"
              onClick={() => p.onQueryChange('')}
              aria-label="Clear filter"
              title="Clear filter"
            >
              <X size={12} aria-hidden="true" />
            </button>
          )}
          <button
            ref={syntaxRef}
            type="button"
            className="log-field-btn"
            onClick={() => setSyntaxOpen((open) => !open)}
            aria-label="Filter syntax"
            aria-haspopup="dialog"
            aria-expanded={syntaxOpen}
            title="Filter syntax"
          >
            <CircleHelp size={13} aria-hidden="true" />
          </button>
        </span>
        <Popover
          open={syntaxOpen}
          onClose={() => setSyntaxOpen(false)}
          anchorRef={syntaxRef}
          placement="bottom-start"
        >
          <div className="log-syntax">
            <p>
              Terms are combined. Quote a value with spaces: <code>package:"Food Truck"</code>.
            </p>
            <dl>
              {EXAMPLES.map(([term, means]) => (
                <div key={term}>
                  <dt>
                    <code>{term}</code>
                  </dt>
                  <dd>{means}</dd>
                </div>
              ))}
            </dl>
            <p>Other words search the message.</p>
          </div>
        </Popover>
      </div>

      <div className="log-find">
        <Input
          ref={p.findRef}
          type="text"
          className="log-field log-find-input"
          placeholder="Find"
          value={p.find}
          onChange={(e) => p.onFindChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              p.onStep(e.shiftKey ? -1 : 1);
            }
          }}
          aria-label="Find in logs"
          spellCheck={false}
          autoComplete="off"
        />
        {p.find && (
          <span className="log-find-count" aria-live="polite">
            {p.hitCount ? `${p.activeHit + 1}/${p.hitCount}` : '0/0'}
          </span>
        )}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="log-icon-btn"
        onClick={() => p.onStep(-1)}
        disabled={!p.hitCount}
        aria-label="Previous match"
        title="Previous match (Shift+Enter)"
      >
        <ArrowUp size={14} aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="log-icon-btn"
        onClick={() => p.onStep(1)}
        disabled={!p.hitCount}
        aria-label="Next match"
        title="Next match (Enter)"
      >
        <ArrowDown size={14} aria-hidden="true" />
      </Button>

      <span className="log-toolbar-divider" aria-hidden="true" />

      <div className="log-actions">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={p.onTogglePause}
        >
          {p.following ? (
            <Pause size={13} aria-hidden="true" />
          ) : (
            <Play size={13} aria-hidden="true" />
          )}
          {p.following ? 'Pause' : 'Resume'}
        </Button>
        {/* Distinct from Export: Export saves the lines shown now; Record
            captures every line between an explicit start and stop, whatever
            the filter and past the buffer's 5,000 lines. */}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className={`log-record${p.recording ? ' is-recording' : ''}`}
          onClick={p.onToggleRecording}
          aria-pressed={p.recording}
        >
          {p.recording ? (
            <Square size={12} aria-hidden="true" />
          ) : (
            <Circle size={12} aria-hidden="true" />
          )}
          {p.recording ? `Stop · ${formatCount(p.recordedLines)} lines` : 'Record'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="log-icon-btn"
          onClick={p.onExport}
          aria-label="Export shown lines"
          title="Export shown lines"
        >
          <Download size={14} aria-hidden="true" />
        </Button>
        <Button
          ref={moreRef}
          type="button"
          variant="ghost"
          size="icon"
          className="log-icon-btn"
          onClick={() => setMenuOpen((open) => !open)}
          aria-label="More options"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="More options"
        >
          <Ellipsis size={14} aria-hidden="true" />
        </Button>
        <Popover open={menuOpen} onClose={closeMenu} anchorRef={moreRef} placement="bottom-end">
          <div ref={menuRef}>
            <Menu>
              <MenuItem checkbox checked={p.caseSensitive} onClick={choose(p.onToggleCase)}>
                Match case
              </MenuItem>
              <MenuItem checkbox checked={p.wrap} onClick={choose(p.onToggleWrap)}>
                Wrap long lines
              </MenuItem>
              <MenuDivider />
              {p.canCopySelected && (
                <MenuItem onClick={choose(p.onCopySelected)}>Copy selected lines</MenuItem>
              )}
              <MenuItem onClick={choose(p.onClearLines)}>Clear lines</MenuItem>
            </Menu>
          </div>
        </Popover>
      </div>
    </div>
  );
}
