import * as RadioGroup from '@radix-ui/react-radio-group';
import { cn } from '../../cn';
import { clearsOnClick, segmentedItems, type SegmentedOption } from '../../segmentedModel';

export type { SegmentedOption };

/** Names the group: an `aria-label`, or the id of a visible row label in `aria-labelledby`. */
export type SegmentedName =
  | { 'aria-label': string; 'aria-labelledby'?: never }
  | { 'aria-labelledby': string; 'aria-label'?: never };

/**
 * `clearable` is for a schema enum where nothing chosen means the default:
 * clicking (or pressing Space on) the chosen option clears it, and `onChange`
 * gets `undefined`. Without it a choice stays chosen, and `onChange` only ever
 * gets a value.
 */
export type SegmentedChoice =
  | { clearable?: false; onChange: (value: string) => void }
  | { clearable: true; onChange: (value: string | undefined) => void };

export type SegmentedProps = SegmentedName &
  SegmentedChoice & {
    options: readonly SegmentedOption[];
    /** `undefined` when nothing is chosen. */
    value: string | undefined;
    disabled?: boolean;
  };

/**
 * Segmented control for small enums, built on a Radix radio group: arrow keys
 * move and select, Tab enters and leaves the group once.
 */
export function Segmented(props: SegmentedProps) {
  const { options, value, disabled } = props;
  // Only a clearable group may report "nothing chosen".
  const clear = props.clearable ? () => props.onChange(undefined) : null;
  return (
    <RadioGroup.Root
      aria-label={props['aria-label']}
      aria-labelledby={props['aria-labelledby']}
      // '' keeps the group controlled while nothing is chosen.
      value={value ?? ''}
      onValueChange={(next) => props.onChange(next)}
      disabled={disabled}
      className="inline-flex rounded-md border border-dim bg-surface p-0.5 data-[disabled]:opacity-50"
    >
      {segmentedItems(options).map((item) => (
        <RadioGroup.Item
          key={item.value}
          value={item.value}
          // A radio group never un-selects: a click on the chosen one clears it here, when allowed.
          onClick={() => {
            if (clear && clearsOnClick(item.value, value, true)) clear();
          }}
          className={cn(
            'focus-ring h-6 rounded px-2.5 text-xs font-medium transition-colors',
            'text-muted hover:text-ink data-[state=checked]:bg-accent data-[state=checked]:text-accent-fg'
          )}
        >
          {item.label}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
