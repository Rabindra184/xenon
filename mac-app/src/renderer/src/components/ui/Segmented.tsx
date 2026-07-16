import { cn } from '../../cn';

/**
 * Segmented control for small enums. Clicking the active option clears the
 * value back to "unset" (the schema default applies) — this replaces the
 * old select's "(default)" entry.
 */
export function Segmented({
  options,
  value,
  onChange,
  'aria-label': ariaLabel
}: {
  options: string[];
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  'aria-label'?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex rounded-md border border-line-strong bg-surface p-0.5"
    >
      {options.map((opt) => {
        const active = value === opt;
        return (
          <button
            key={opt}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(active ? undefined : opt)}
            className={cn(
              'focus-ring rounded px-2.5 py-1 text-xs font-medium transition-colors',
              active ? 'bg-accent/15 text-accent' : 'text-muted hover:text-ink'
            )}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}
