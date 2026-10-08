import { useEffect, useRef, useState } from 'react';
import { SETTINGS } from '../../copy/settings';
import { fromInput, toDisplay, type NumberUnit } from '../../numberField';
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
 *  - It keeps what is typed as a draft, and commits on blur or Enter, and only
 *    when the text changed, so looking at a value (or tabbing past it) never
 *    rewrites it: 100000 ms shows as 1.7, and stays 100000 until it is edited.
 *  - An empty box commits `undefined`: back to the default, not 0.
 *  - A draft that is not valid shows its error and commits nothing. `error`
 *    carries a problem with the stored value, from outside. The draft's error
 *    shows in its place while there is one.
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

  const commit = () => {
    editing.current = false;
    // The browser reports text it will not call a number ("1e", "-") as ''. Read that now, not when it
    // was typed: emptying such a box fires no change (the value stays ''), so a flag set on change
    // would still say "1e" after the box was cleared.
    if (input.current?.validity.badInput) {
      setDraftError(SETTINGS.numberField.notANumber);
      return;
    }
    if (text === shown) {
      setDraftError(undefined);
      return;
    }
    const result = fromInput(text, unit, { min, max, integer: Number.isInteger(stepBy) });
    if (!result.ok) {
      setDraftError(result.error);
      return;
    }
    setDraftError(undefined);
    if (result.value === value) {
      // Same number, written another way ("5.0"): show it the usual way and write nothing.
      setText(shown);
      return;
    }
    onCommit(result.value);
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
          onChange={(e) => {
            editing.current = true;
            setText(e.target.value);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
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
