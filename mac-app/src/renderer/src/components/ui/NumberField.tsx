import { useEffect, useRef, useState } from 'react';
import { SETTINGS } from '../../copy/settings';
import { draftErrorAfter, fromInput, toDisplay, type NumberUnit } from '../../numberField';
import { FieldFrame, fieldDescribedBy, useFieldId, type FieldProps } from './Field';
import { inputClasses } from './fieldStyles';

export type NumberFieldProps = FieldProps & {
  value: number | undefined;
  unit: NumberUnit;
  min?: number;
  max?: number;
  step?: number;
  /** The unit after the box ("min", "days"). It is read with the box, before the description. */
  suffix?: string;
  onCommit: (value: number | undefined) => void;
};

/**
 * A number box that shows a setting in the unit a person thinks in (minutes)
 * and stores it in the unit the plugin wants (milliseconds). See numberField.ts.
 *
 *  - Each edit that makes a valid number commits it at once (R50), so a start,
 *    a closed window or a reload right after typing has it. Only edits commit:
 *    looking at a value (or tabbing past it) never rewrites it, so 100000 ms
 *    shows as 1.7, and stays 100000 until it is edited.
 *  - Leaving the box, or Enter, ends the edit: the number is shown the usual
 *    way ("5.0" as 5), and the box follows the stored value again.
 *  - An empty box commits `undefined`: back to the default, not 0.
 *  - Text that is not a valid number commits nothing. Its error shows, and is
 *    announced, when the box is left or Enter is pressed, never while typing;
 *    it goes as soon as the text is valid again. `error` carries a problem with
 *    the stored value, from outside. The draft's error shows in its place while
 *    there is one.
 *  - `step` is the size of one arrow press and also what counts as a valid
 *    entry: a whole step (the default, 1) means whole numbers only. Minutes
 *    default to 0.1. `min` and `max` are in the displayed unit.
 */
export function NumberField({
  label,
  value,
  unit,
  min,
  max,
  step,
  suffix,
  onCommit,
  description,
  error,
  settingKey,
  id,
  disabled,
  hideLabel
}: NumberFieldProps) {
  const fieldId = useFieldId(id);
  const shown = toDisplay(value, unit);
  const [text, setText] = useState(shown);
  const [draftError, setDraftError] = useState<string | undefined>();
  const input = useRef<HTMLInputElement>(null);
  const editing = useRef(false);

  // Follow the stored value when it changes from outside (another profile, a reset), but not under the person's cursor.
  useEffect(() => {
    if (editing.current) return;
    setText(shown);
    setDraftError(undefined);
  }, [shown]);

  const stepBy = step ?? (unit === 'minutes-from-ms' ? 0.1 : 1);

  /**
   * The box's text as a value, or why it isn't one. The browser reports text it will not call a
   * number ("1e", "-") as '' with `badInput` set.
   */
  const parse = (draft: string, badInput: boolean) =>
    badInput
      ? ({ ok: false, error: SETTINGS.numberField.notANumber } as const)
      : fromInput(draft, unit, { min, max, integer: Number.isInteger(stepBy) });

  /**
   * Commits a valid draft that differs from the stored value. Its error shows (or goes) as
   * draftErrorAfter says for this event: only leaving the box or Enter shows one.
   */
  const take = (draft: string, badInput: boolean, event: 'change' | 'settle'): boolean => {
    const result = parse(draft, badInput);
    setDraftError((shown) => draftErrorAfter(event, shown, result));
    if (!result.ok) return false;
    // The same number written another way ("5.0") writes nothing.
    if (result.value !== value) onCommit(result.value);
    return true;
  };

  /** An edit: valid text goes to the profile now. */
  const change = (draft: string, badInput: boolean) => {
    editing.current = true;
    setText(draft);
    take(draft, badInput, 'change');
  };

  /**
   * The edit is over (blur or Enter). The box is read again: emptying text the browser held as not a
   * number fires no change (its value stays ''), so the last change may still say "1e". A valid number
   * is then shown the usual way; an invalid one stays, with its error, to be fixed.
   */
  const settle = () => {
    if (!editing.current) return;
    editing.current = false;
    if (take(text, input.current?.validity.badInput ?? false, 'settle')) setText(shown);
  };

  const message = draftError ?? error;
  const suffixId = suffix ? `${fieldId}-suffix` : undefined;

  return (
    <FieldFrame
      fieldId={fieldId}
      label={label}
      description={description}
      error={message}
      settingKey={settingKey}
      hideLabel={hideLabel}
    >
      <div className="flex items-center gap-2">
        <input
          ref={input}
          id={fieldId}
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={stepBy}
          value={text}
          disabled={disabled}
          onChange={(e) => change(e.target.value, e.currentTarget.validity.badInput)}
          onBlur={settle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') settle();
          }}
          // A wheel over a focused number box changes it. Scrolling the page must not.
          onWheel={(e) => e.currentTarget.blur()}
          aria-invalid={message ? true : undefined}
          aria-describedby={fieldDescribedBy(fieldId, { description, error: message }, suffixId)}
          className={`${inputClasses(!!message)} w-24`}
        />
        {suffix && (
          <span id={suffixId} className="text-sm text-muted">
            {suffix}
          </span>
        )}
      </div>
    </FieldFrame>
  );
}
