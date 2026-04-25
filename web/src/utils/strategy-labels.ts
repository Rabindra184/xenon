// Maps Appium locator strategy strings (as they appear in `findElement(strategy, value)`
// calls and in the `original_strategy` / `healed_strategy` columns on SessionLog)
// to human-readable display labels.
//
// `xenon:visual` is a sentinel for visual-AI heals (coordinate-based) — it
// has no portable Appium snippet, only a label.
export const STRATEGY_LABELS: Record<string, string> = {
  'accessibility id': 'Accessibility ID',
  xpath: 'XPath',
  id: 'ID',
  name: 'Name',
  'class name': 'Class Name',
  '-android uiautomator': 'UiAutomator',
  '-ios predicate string': 'iOS Predicate',
  '-ios class chain': 'iOS Class Chain',
  'xenon:visual': 'Visual AI (coords)',
};

export function formatStrategy(strategy: string | null | undefined): string {
  if (!strategy) return '(unknown strategy)';
  return STRATEGY_LABELS[strategy] ?? strategy;
}
