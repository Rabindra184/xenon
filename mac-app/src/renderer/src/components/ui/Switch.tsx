import { useId } from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';

/**
 * An on/off setting: its name, an optional plain-words description, and the
 * switch. The name is a real <label>, so clicking it flips the switch and a
 * screen reader reads it with the control. The off track uses the `dim` colour,
 * which has 3:1 against the page; the thumb's position, not colour alone, shows
 * the state.
 */
export function Switch({
  checked,
  onCheckedChange,
  label,
  description,
  id,
  disabled
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  description?: string;
  id?: string;
  disabled?: boolean;
}) {
  const generated = useId();
  const switchId = id ?? generated;
  const descriptionId = `${switchId}-description`;

  return (
    <div className="flex min-h-8 items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={switchId} className="text-sm font-medium leading-6 text-ink">
          {label}
        </label>
        {description && (
          <p id={descriptionId} className="-mt-0.5 pb-1 text-xs text-muted">
            {description}
          </p>
        )}
      </div>
      <SwitchPrimitive.Root
        id={switchId}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-describedby={description ? descriptionId : undefined}
        className="focus-ring inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 data-[state=checked]:bg-accent data-[state=unchecked]:bg-dim"
      >
        <SwitchPrimitive.Thumb className="pointer-events-none block h-4 w-4 rounded-full bg-surface shadow-sm transition-transform data-[state=checked]:translate-x-6 data-[state=unchecked]:translate-x-1" />
      </SwitchPrimitive.Root>
    </div>
  );
}
