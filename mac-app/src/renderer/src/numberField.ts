// The model behind NumberField: what a stored number looks like in the box,
// and what typed text turns back into. Pure, so the rules are unit-tested.
//
// A setting is stored in the unit the plugin wants (milliseconds), and shown in
// the unit a person thinks in (minutes). Bounds are about the number on screen.

export type NumberUnit = 'plain' | 'minutes-from-ms' | 'days';

export interface NumberBounds {
  min?: number;
  max?: number;
  integer?: boolean;
}

export type NumberParse = { ok: true; value: number | undefined } | { ok: false; error: string };

/** What a box says when its text is not a number. NumberField uses it too, for text the browser rejects before we see it. */
export const NOT_A_NUMBER = 'Enter a number.';

const MS_PER_MINUTE = 60_000;
/** Plain decimal notation only: no hex, exponent, Infinity or stray text. */
const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

/** The text for a stored value. Unset is an empty box, which means "use the default". */
export function toDisplay(value: number | undefined, unit: NumberUnit): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  if (unit === 'minutes-from-ms') return String(Math.round((value / MS_PER_MINUTE) * 10) / 10);
  return String(value);
}

/** The stored value for typed text, or the sentence that says what to fix. */
export function fromInput(text: string, unit: NumberUnit, bounds: NumberBounds): NumberParse {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: true, value: undefined };
  if (!DECIMAL.test(trimmed)) return { ok: false, error: NOT_A_NUMBER };

  const shown = Number(trimmed);
  if (bounds.integer && !Number.isInteger(shown)) return { ok: false, error: 'Enter a whole number.' };
  if (bounds.min !== undefined && shown < bounds.min) return { ok: false, error: `Enter ${bounds.min} or more.` };
  if (bounds.max !== undefined && shown > bounds.max) return { ok: false, error: `Enter ${bounds.max} or less.` };

  return { ok: true, value: unit === 'minutes-from-ms' ? Math.round(shown * MS_PER_MINUTE) : shown };
}
