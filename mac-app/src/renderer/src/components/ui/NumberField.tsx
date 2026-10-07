import { useEffect, useId, useRef, useState } from 'react';
import { NOT_A_NUMBER, fromInput, toDisplay, type NumberUnit } from '../../numberField';
import { ERROR_CLASSES, LABEL_CLASSES, inputClasses } from './fieldStyles';

/**
 * A number box that shows a setting in the unit a person thinks in (minutes)
 * and stores it in the unit the plugin wants (milliseconds). See numberField.ts.
 *
 *  - It keeps what is typed as a draft, and commits on blur or Enter, and only
 *    when the text changed, so looking at a value (or tabbing past it) never
 *    rewrites it: 100000 ms shows as 1.7, and stays 100000 until it is edited.
 *  - An empty box commits `undefined`: back to the default, not 0.
 *  - A draft that is not valid shows its error and commits nothing. `error`
 *    carries a problem with the stored value, from outside.
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
  error,
  settingKey,
  id
}: {
  label: string;
  value: number | undefined;
  unit: NumberUnit;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  onCommit: (value: number | undefined) => void;
  error?: string;
  settingKey?: string;
  id?: string;
}) {
  const generated = useId();
  const fieldId = id ?? generated;
  const suffixId = `${fieldId}-suffix`;
  const errorId = `${fieldId}-error`;

  const shown = toDisplay(value, unit);
  const [text, setText] = useState(shown);
  const [draftError, setDraftError] = useState<string | undefined>();
  // Set while the browser holds text it will not call a number ("1e", "-"), which it reports as ''.
  const unreadable = useRef(false);
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
    if (unreadable.current) {
      setDraftError(NOT_A_NUMBER);
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

  return (
    <div data-setting-key={settingKey} className="flex flex-col gap-1">
      <label htmlFor={fieldId} className={LABEL_CLASSES}>
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={fieldId}
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={stepBy}
          value={text}
          onChange={(e) => {
            editing.current = true;
            unreadable.current = e.currentTarget.validity.badInput;
            setText(e.target.value);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
          }}
          // A wheel over a focused number box changes it. Scrolling the page must not.
          onWheel={(e) => e.currentTarget.blur()}
          aria-invalid={message ? true : undefined}
          aria-describedby={[suffix ? suffixId : null, message ? errorId : null].filter(Boolean).join(' ') || undefined}
          className={`${inputClasses(!!message)} w-24`}
        />
        {suffix && (
          <span id={suffixId} className="text-sm text-muted">
            {suffix}
          </span>
        )}
      </div>
      {message && (
        <p id={errorId} role="alert" className={ERROR_CLASSES}>
          {message}
        </p>
      )}
    </div>
  );
}
