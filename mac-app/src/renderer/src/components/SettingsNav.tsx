import { cn } from '../cn';
import type { FormSection } from '../schemaForm';

export function SettingsNav({
  sections,
  activeId,
  onJump
}: {
  sections: FormSection[];
  activeId: string | null;
  onJump: (id: string) => void;
}) {
  return (
    <nav aria-label="Settings sections" className="flex flex-col gap-0.5">
      {sections.map((s) => (
        <button
          key={s.id}
          onClick={() => onJump(s.id)}
          className={cn(
            'focus-ring rounded px-2 py-1 text-left text-xs',
            s.id === activeId ? 'bg-accent/10 text-accent' : 'text-muted hover:text-ink'
          )}
        >
          {s.title}
        </button>
      ))}
    </nav>
  );
}
