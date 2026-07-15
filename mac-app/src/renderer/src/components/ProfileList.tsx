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

export function ProfileList({ profiles, activeId, runningId, onSelect, onCreate, onDuplicate, onDelete }: Props) {
  return (
    <div className="flex flex-col">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Profiles</span>
        <button onClick={onCreate} title="New profile" className="text-slate-400 hover:text-accent">
          <Plus size={16} />
        </button>
      </div>
      <div className="space-y-1">
        {profiles.map((p) => (
          <div
            key={p.id}
            onClick={() => onSelect(p.id)}
            className={cn(
              'group flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-sm',
              p.id === activeId ? 'bg-accent/10 text-accent' : 'hover:bg-slate-100 dark:hover:bg-slate-800'
            )}
          >
            <span className="flex items-center gap-2 truncate">
              {p.id === runningId && <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />}
              <span className="truncate">{p.name}</span>
            </span>
            <span className="hidden items-center gap-1 group-hover:flex">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDuplicate(p.id);
                }}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                title="Duplicate"
              >
                <Copy size={13} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(p.id);
                }}
                className="text-slate-400 hover:text-rose-500"
                title="Delete"
              >
                <Trash2 size={13} />
              </button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
