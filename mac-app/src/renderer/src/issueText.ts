// What a problem with a setting says, in the unit of the place it is said.
// A number outside its bounds is checked in the unit Xenon stores it in
// (milliseconds), and a box can show it in another (minutes, in Essentials):
// the bound is said the way that box's own errors say it (numberField.ts). Pure,
// so the rules are unit-tested.

import type { ValidationIssue } from '@shared/types';
import { SETTINGS } from './copy/settings';
import { ESSENTIALS } from './essentials';
import { toDisplay, type NumberUnit } from './numberField';

type Bound = NonNullable<ValidationIssue['bound']>;

/**
 * A bound in the words a number box uses for one, in `unit`: "Enter 0.5 or more." for 30000 ms in
 * minutes. `suffix` follows the number ("Enter 0.5 min or more."), for a line away from the box,
 * whose unit is beside it.
 */
export function boundMessage(bound: Bound, unit: NumberUnit, suffix?: string): string {
  const shown = (n: number): string => `${toDisplay(n, unit)}${suffix ? ` ${suffix}` : ''}`;
  return 'min' in bound ? SETTINGS.numberField.atLeast(shown(bound.min)) : SETTINGS.numberField.atMost(shown(bound.max));
}

/** The issue's message for a box in `unit`: a bound in that unit, anything else as it is. */
export function issueMessage(issue: ValidationIssue, unit: NumberUnit = 'plain', suffix?: string): string {
  return issue.bound ? boundMessage(issue.bound, unit, suffix) : issue.message;
}

/** Essentials' number row for an option, if it has one. */
function essentialsNumber(path: string) {
  const control = ESSENTIALS.find((row) => row.optionKey === path)?.control;
  return control?.kind === 'number' ? control : undefined;
}

/** The issue's message under its Essentials box: a bound in the unit that box shows (minutes for a wait). */
export function essentialsIssueMessage(issue: ValidationIssue): string {
  return issueMessage(issue, essentialsNumber(issue.path)?.unit ?? 'plain');
}

/**
 * The issue's message in Settings' list of problems, which names it by its Essentials label: a bound
 * in the unit that row shows, with its unit word when that isn't the stored unit ("Enter 0.5 min or
 * more."), since the list is away from the box. Anything else as it is.
 */
export function listedIssueMessage(issue: ValidationIssue): string {
  const control = essentialsNumber(issue.path);
  if (!control || control.unit !== 'minutes-from-ms') return issue.message;
  return issueMessage(issue, control.unit, control.suffix);
}
