import * as RadioGroup from '@radix-ui/react-radio-group';
import { cn } from '../../cn';

/**
 * Segmented control for small enums, built on a Radix radio group: arrow keys
 * move and select, Tab enters and leaves the group once. Clicking the active
 * option clears the value back to "unset" (the schema default applies); this
 * replaces the old select's "(default)" entry.
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
    <RadioGroup.Root
      aria-label={ariaLabel}
      // '' keeps the group controlled while nothing is chosen.
      value={value ?? ''}
      onValueChange={onChange}
      className="inline-flex rounded-md border border-dim bg-surface p-0.5"
    >
      {options.map((opt) => (
        <RadioGroup.Item
          key={opt}
          value={opt}
          // A radio group never un-selects. Clicking the chosen one clears it here.
          onClick={() => {
            if (opt === value) onChange(undefined);
          }}
          className={cn(
            'focus-ring h-6 rounded px-2.5 text-xs font-medium transition-colors',
            'text-muted hover:text-ink data-[state=checked]:bg-accent data-[state=checked]:text-accent-fg'
          )}
        >
          {opt}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
