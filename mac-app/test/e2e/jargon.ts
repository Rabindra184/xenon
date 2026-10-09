// The no-jargon rule, as a pure function: with technical details off, the app's
// own words never contain option keys, environment names, commands or paths.
//
// The e2e reads the text of #root with every [data-raw] subtree removed (text
// the app quotes rather than writes: log lines, Home's "Last message",
// technical-detail blocks) and expects no hits. Unit tests import this file
// too, in vitest's node environment, so it imports nothing.

/** Upper-case words that are ordinary in a sentence. */
const PLAIN_CAPS = new Set(['HTTP', 'HTTPS', 'JSON']);

/** An environment name or other upper-case identifier: APPIUM_HOME, ANDROID_HOME. */
const CAPS = /\b[A-Z][A-Z0-9_]{3,}\b/g;

/**
 * A command. Case-sensitive, so "Appium" in a sentence passes. A command word
 * counts when a space, a line break or the end of the text follows it, so the
 * last word of "npm i -g appium" is found too.
 */
const COMMAND = /\b(npm|appium|brew)(?=\s|$)|xcode-select/g;

/** An absolute or home-relative folder path, at the start or after a space, quote or bracket. */
const PATH = /(?:^|[\s“"(])(?:~?\/)(?:[\w.-]+\/)+/g;

const URL = /https?:\/\/\S+/g;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every hit in `text`: option keys with a capital letter (whole words), upper-case names, commands and paths. */
export function findJargon(text: string, optionKeys: string[]): string[] {
  const hits: string[] = [];

  for (const key of optionKeys) {
    // A key in lower case alone ("hub") reads as a word; only camelCase keys are jargon.
    if (!/[A-Z]/.test(key)) continue;
    const whole = new RegExp(`(?<![\\w.])${escapeRegExp(key)}(?![\\w])`, 'g');
    for (const m of text.matchAll(whole)) hits.push(m[0]);
  }

  for (const m of text.matchAll(CAPS)) {
    if (!PLAIN_CAPS.has(m[0])) hits.push(m[0]);
  }

  for (const m of text.matchAll(COMMAND)) hits.push(m[0]);

  // A web address is not a folder, though it has slashes.
  for (const m of text.replace(URL, ' ').matchAll(PATH)) hits.push(m[0].replace(/^[\s“"(]/, ''));

  return hits;
}
