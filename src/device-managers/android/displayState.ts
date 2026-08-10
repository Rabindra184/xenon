/**
 * Whether the device's panel is lit.
 *
 * `off` is the one the dashboard acts on: a sleeping device streams a
 * perfectly black frame, which is indistinguishable from a broken stream or a
 * black-themed app until something says which it is.
 *
 * `doze` is always-on-display — the panel is showing a clock, so the frame is
 * not black and claiming "display is off" over it would be its own small lie.
 * Kept distinct rather than folded into `off` for exactly that reason.
 */
export type DisplayState = 'on' | 'off' | 'doze' | 'unknown';

/**
 * Read the state out of `dumpsys power`.
 *
 * Deliberately keyed on `Display Power: state=` rather than `mWakefulness=`:
 * measured on a Galaxy S9, a screen turned off by the power button reports
 * `mWakefulness=Dozing` while the panel is genuinely off and the stream is
 * pure black. Wakefulness describes the CPU's sleep state, not the panel's.
 *
 * Anything unrecognised is `unknown`, never a guess — the caller shows nothing
 * for `unknown`, and saying nothing is always better than telling someone
 * their screen is off while they are looking at it.
 */
export function parseDisplayState(dumpsys: string): DisplayState {
  const match = /Display Power:\s*state=(\w+)/i.exec(dumpsys || '');
  if (!match) return 'unknown';

  switch (match[1].toUpperCase()) {
    case 'ON':
    case 'VR':
      return 'on';
    case 'OFF':
      return 'off';
    case 'DOZE':
    case 'DOZE_SUSPEND':
    case 'ON_SUSPEND':
      return 'doze';
    default:
      return 'unknown';
  }
}
