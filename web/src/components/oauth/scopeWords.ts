/**
 * What each agent scope lets an agent do, in a tester's words. The names are
 * the server's (`src/services/token/mcpScopes.ts`); an unknown one is shown
 * as it is.
 */
const WORDS: Record<string, string> = {
  'xenon:devices:read': "See the lab's phones and what they are doing",
  'xenon:analytics:read': 'See test results, selector health and healed selectors',
  'appium:use': 'Start Appium sessions on phones, as you',
  'xenon:execute': "Run Xenon's own scripts in the sessions it starts",
  'xenon:devices:lock': 'Reserve phones and give them back',
  'xenon:recordings': "Record phones' screens",
};

export function scopeWords(scope: string): string {
  return WORDS[scope] ?? scope;
}
