/** The tree's share of the tree + details row, and where it is remembered. */
export const DEFAULT_SPLIT = 0.4;
export const MIN_TREE_PX = 240;
export const MIN_DETAILS_PX = 340;
export const SPLIT_STEP = 0.02;
export const DIVIDER_PX = 12;
export const SPLIT_KEY = 'xenon.omni.split';

export interface SplitLimits {
  min: number;
  max: number;
}
export type SplitStorage = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * The tree's allowed share of a row `width` px wide (the divider excluded).
 * Before the width is known (0) nothing is clamped. Too narrow for both
 * minimums, the tree gets its minimum and the details the rest.
 */
export function splitLimits(width: number): SplitLimits {
  if (!(width > 0)) return { min: 0, max: 1 };
  const min = Math.min(1, MIN_TREE_PX / width);
  return { min, max: Math.max(min, (width - MIN_DETAILS_PX) / width) };
}

export function clampSplit(share: number, width: number): number {
  const { min, max } = splitLimits(width);
  const s = Number.isFinite(share) ? share : DEFAULT_SPLIT;
  return Math.min(max, Math.max(min, s));
}

export function loadSplit(storage: SplitStorage | null): number {
  try {
    const v = Number.parseFloat(storage?.getItem(SPLIT_KEY) ?? '');
    return v > 0 && v < 1 ? v : DEFAULT_SPLIT;
  } catch {
    return DEFAULT_SPLIT;
  }
}

export function saveSplit(storage: SplitStorage | null, share: number): void {
  try {
    storage?.setItem(SPLIT_KEY, String(Math.round(share * 1000) / 1000));
  } catch {
    // Storage blocked or full: the divider keeps its position until reload.
  }
}

/** `window.localStorage`, or null where reading it throws (blocked site data). */
export function browserStorage(): SplitStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
