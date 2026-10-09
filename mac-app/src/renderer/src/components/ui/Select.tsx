import { useId } from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';

export interface SelectOption {
  /** Must not be empty: an empty value is how a Select shows its placeholder. */
  value: string;
  label: string;
}

/**
 * A pick-one list, on Radix: type to jump, arrow keys, Escape to close. Its name
 * is a real <label>. `value` undefined shows the placeholder.
 */
export function Select({
  label,
  value,
  onValueChange,
  options,
  placeholder,
  id,
  disabled
}: {
  label: string;
  value: string | undefined;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  id?: string;
  disabled?: boolean;
}) {
  const generated = useId();
  const selectId = id ?? generated;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={selectId} className="text-sm font-medium text-ink">
        {label}
      </label>
      <SelectPrimitive.Root value={value ?? ''} onValueChange={onValueChange} disabled={disabled}>
        <SelectPrimitive.Trigger
          id={selectId}
          className="focus-ring inline-flex h-8 w-56 items-center justify-between gap-2 rounded-md border border-dim bg-surface2 px-2 text-sm text-ink disabled:opacity-50 data-[placeholder]:text-dim"
        >
          <SelectPrimitive.Value placeholder={placeholder} />
          <SelectPrimitive.Icon>
            <ChevronDown size={14} className="text-muted" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
            position="popper"
            sideOffset={4}
            // Radix measures the trigger; a style, not an arbitrary Tailwind value.
            style={{ minWidth: 'var(--radix-select-trigger-width)' }}
            className="z-50 max-h-64 overflow-hidden rounded-md border border-line-strong bg-surface2 text-sm text-ink shadow-md"
          >
            <SelectPrimitive.Viewport className="p-1">
              {options.map((option) => (
                <SelectPrimitive.Item
                  key={option.value}
                  value={option.value}
                  className="relative flex h-8 cursor-default select-none items-center rounded pl-7 pr-2 outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface"
                >
                  <SelectPrimitive.ItemIndicator className="absolute left-2 inline-flex items-center">
                    <Check size={14} className="text-accent" />
                  </SelectPrimitive.ItemIndicator>
                  <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
    </div>
  );
}
