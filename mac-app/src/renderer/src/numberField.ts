// The model behind NumberField: what a stored number looks like in the box,
// and what typed text turns back into. Pure, so the rules are unit-tested.
//
// A setting is stored in the unit the plugin wants (milliseconds), and shown in
// the unit a person thinks in (minutes). Bounds are about the number on screen.

import { SETTINGS } from './copy/settings';

export type NumberUnit = 'plain' | 'minutes-from-ms' | 'days';

export interface NumberBounds {
  min?: number;
  max?: number;
  integer?: boolean;
}

export type NumberParse = { ok: true; value: number | undefined } | { ok: false; error: string };

const WORDS = SETTINGS.numberField;

const MS_PER_MINUTE = 60_000;
/** Plain decimal notation only: no hex, exponent, Infinity or stray text. */
const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

/** The text for a stored value. Unset is an empty box, which means "use the default". */
export function toDisplay(value: number | undefined, unit: NumberUnit): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  if (unit === 'minutes-from-ms') return String(Math.round((value / MS_PER_MINUTE) * 10) / 10);
  return String(value);
}

/**
 * The error a number box shows after an edit, given the one it shows now and what the text parses as.
 * Typing (`change`) never shows or changes one, so nothing is announced on the way to a valid number
 * ("0" on the way to "0.5"); it only clears it once the text is valid. Leaving the box or Enter
 * (`settle`) shows the text's error, if it has one.
 */
export function draftErrorAfter(
  event: 'change' | 'settle',
  shown: string | undefined,
  parsed: NumberParse
): string | undefined {
  if (parsed.ok) return undefined;
  return event === 'settle' ? parsed.error : shown;
}

/** The stored value for typed text, or the sentence that says what to fix. */
export function fromInput(text: string, unit: NumberUnit, bounds: NumberBounds): NumberParse {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: true, value: undefined };
  if (!DECIMAL.test(trimmed)) return { ok: false, error: WORDS.notANumber };

  const shown = Number(trimmed);
  if (bounds.integer && !Number.isInteger(shown)) return { ok: false, error: WORDS.wholeNumber };
  if (bounds.min !== undefined && shown < bounds.min) return { ok: false, error: WORDS.atLeast(bounds.min) };
  if (bounds.max !== undefined && shown > bounds.max) return { ok: false, error: WORDS.atMost(bounds.max) };

  return { ok: true, value: unit === 'minutes-from-ms' ? Math.round(shown * MS_PER_MINUTE) : shown };
}
