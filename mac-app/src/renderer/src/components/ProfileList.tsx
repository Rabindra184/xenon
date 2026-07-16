import { useEffect, useRef, useState } from 'react';
import type { Profile } from '@shared/types';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { cn } from '../cn';

interface Props {
  profiles: Profile[];
  activeId: string | null;
  runningId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}

/** How long the armed "Delete?" confirm state stays active before reverting. */
const CONFIRM_TIMEOUT_MS = 4000;

function platformLabel(p: Profile): string {
  const v = p.settings.platform;
  return v === 'ios' ? 'iOS' : v === 'android' ? 'Android' : 'Both';
}

export function ProfileList({ profiles, activeId, runningId, onSelect, onCreate, onDuplicate, onDelete }: Props) {
  // Deletion is a two-step inline confirm: first click arms, second click deletes.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
  }, []);

  const armDelete = (id: string) => {
    setConfirmingId(id);
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    confirmTimer.current = setTimeout(() => setConfirmingId(null), CONFIRM_TIMEOUT_MS);
  };

  return (
    <div className="flex flex-col">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">Profiles</span>
        <button
          data-testid="new-profile"
          onClick={onCreate}
          title="New profile"
          aria-label="New profile"
          className="focus-ring rounded text-dim hover:text-accent"
        >
          <Plus size={16} />
        </button>
      </div>
      <div className="space-y-1">
        {profiles.map((p) => {
          const confirming = confirmingId === p.id;
          return (
            <div
              key={p.id}
              data-testid="profile-row"
              onClick={() => onSelect(p.id)}
              className={cn(
                'group flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-sm',
                p.id === activeId ? 'bg-accent/10 text-accent' : 'hover:bg-surface2'
              )}
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="flex items-center gap-2 truncate">
                  {p.id === runningId && <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent" />}
                  <span className="truncate">{p.name}</span>
                </span>
                <span className="flex items-center gap-1.5 text-[10px] text-dim">
                  <span className="rounded bg-surface2 px-1 py-px font-mono uppercase tracking-wide">
                    {platformLabel(p)}
                  </span>
                  <span className="font-mono">:{p.server.port}</span>
                </span>
              </span>
              {/* Opacity (not `hidden`) keeps these focusable for keyboard users. */}
              <span
                className={cn(
                  'flex items-center gap-1 transition-opacity',
                  confirming ? 'opacity-100' : 'opacity-0 focus-within:opacity-100 group-hover:opacity-100'
                )}
              >
                {confirming ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirmTimer.current) clearTimeout(confirmTimer.current);
                      setConfirmingId(null);
                      onDelete(p.id);
                    }}
                    aria-label="Confirm delete"
                    className="focus-ring rounded bg-danger px-1.5 py-0.5 text-[11px] font-medium text-white hover:bg-danger/80"
                  >
                    Delete?
                  </button>
                ) : (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDuplicate(p.id);
                      }}
                      className="focus-ring rounded text-dim hover:text-ink"
                      title="Duplicate"
                      aria-label="Duplicate"
                    >
                      <Copy size={13} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        armDelete(p.id);
                      }}
                      className="focus-ring rounded text-dim hover:text-danger"
                      title="Delete"
                      aria-label="Delete"
                    >
                      <Trash2 size={13} />
                    </button>
                  </>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
