import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import XenonApiService from '../../api-service';
import { useCommandPalette } from '../../hooks/useCommandPalette';
import { CommandIndex, CommandItem, CommandKind } from './command-index';
import './command-palette.css';

const KIND_LABEL: Record<CommandKind, string> = {
  nav: 'Navigation',
  device: 'Devices',
  session: 'Sessions',
  team: 'Teams',
  key: 'API Keys',
  app: 'Apps',
};

// Display ordering for groups.
const KIND_ORDER: CommandKind[] = ['nav', 'device', 'session', 'team', 'key', 'app'];

export const CommandPalette: React.FC = () => {
  const { open, setOpen } = useCommandPalette();
  const [q, setQ] = React.useState('');
  const [cursor, setCursor] = React.useState(0);
  const navigate = useNavigate();
  const idxRef = React.useRef(new CommandIndex());
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Populate the index the first time the palette opens; refresh again on
  // each open so newly-created entities appear.
  React.useEffect(() => {
    if (!open) return;
    // Keys are intentionally left unindexed: XenonApiService has no
    // getApiKeys/getKeys client method (settings/api-keys.tsx fetches
    // '/xenon/api/apikeys' directly), and key secret material must never be
    // searchable even if that changes.
    Promise.all([
      XenonApiService.getDevices().catch(() => []),
      XenonApiService.getSessions().catch(() => []),
      XenonApiService.getApps().catch(() => []),
      XenonApiService.listTeams().catch(() => []),
    ]).then(([d, s, a, t]: [any, any, any, any]) => {
      if (Array.isArray(d)) idxRef.current.setDevices(d);
      if (Array.isArray(s)) idxRef.current.setSessions(s);
      if (Array.isArray(a)) idxRef.current.setApps(a);
      if (Array.isArray(t)) idxRef.current.setTeams(t);
    });
    // Focus the input after paint so placeholder is replaced.
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  // Reset search state when the palette closes.
  React.useEffect(() => {
    if (!open) {
      setQ('');
      setCursor(0);
    }
  }, [open]);

  const results: CommandItem[] = React.useMemo(
    () => idxRef.current.search(q, 8),
    // Recompute on open to re-render after async index population.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q, open],
  );

  const grouped = React.useMemo(() => {
    const m = new Map<CommandKind, CommandItem[]>();
    results.forEach((r) => {
      const arr = m.get(r.kind) || [];
      arr.push(r);
      m.set(r.kind, arr);
    });
    return m;
  }, [results]);

  const select = React.useCallback(
    (it: CommandItem) => {
      navigate(it.path);
      setOpen(false);
    },
    [navigate, setOpen],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, Math.max(results.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[cursor]) select(results[cursor]);
    }
  };

  if (!open) return null;

  // Walk groups in stable order and mark active using a running flatIdx so
  // arrow navigation aligns with the on-screen order.
  let flatIdx = -1;

  return (
    <div className="cp-overlay" onClick={() => setOpen(false)}>
      <div
        className="cp"
        role="dialog"
        aria-modal
        aria-label="Command palette"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cp-input-row">
          <Search size={14} />
          <input
            ref={inputRef}
            className="cp-input"
            placeholder="Search devices, sessions, settings…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setCursor(0);
            }}
            onKeyDown={onKeyDown}
          />
          <span className="cp-esc">ESC</span>
        </div>
        <div className="cp-results">
          {results.length === 0 && <div className="cp-empty">No results.</div>}
          {KIND_ORDER.filter((k) => grouped.has(k)).map((kind) => (
            <div key={kind} className="cp-group">
              <div className="cp-group-head">{KIND_LABEL[kind]}</div>
              {grouped.get(kind)!.map((it) => {
                flatIdx += 1;
                const active = flatIdx === cursor;
                return (
                  <button
                    key={it.id}
                    type="button"
                    className={`cp-item${active ? ' cp-item-active' : ''}`}
                    onMouseEnter={() => {
                      // Capture index locally so we don't race with flatIdx
                      // on the next render.
                      const myIdx = flatIdx;
                      setCursor(myIdx);
                    }}
                    onClick={() => select(it)}
                  >
                    <span className="cp-item-label">{it.label}</span>
                    {it.sub && <span className="cp-item-sub">{it.sub}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
export default CommandPalette;
