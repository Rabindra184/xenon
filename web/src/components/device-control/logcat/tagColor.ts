/**
 * Per-tag colouring, the way Android Studio's Logcat does it.
 *
 * A single colour for every tag makes a fast-scrolling log unreadable: the eye
 * has nothing to lock onto when following one component. Giving each tag its
 * own stable colour is what turns a wall of text into something scannable.
 *
 * Requirements this has to meet, in order:
 *
 * 1. **Stable.** The same tag must get the same colour on every render, in
 *    every session, on every machine. So: a pure hash of the tag, not a
 *    counter, not insertion order, not `Math.random`. A tag's colour changing
 *    between reloads would be worse than no colouring at all.
 * 2. **Legible on the app's dark surface.** Every entry below is a light,
 *    desaturated tone; nothing dark enough to disappear and nothing so
 *    saturated it competes with the level colours.
 * 3. **Distinct from the level colours.** Level already means something —
 *    amber for W, red for E/F, green for I. Those hues are deliberately absent
 *    here so a tag can never be misread as a severity.
 */

/**
 * Curated so adjacent hues stay tellable apart at 11.5px. Amber, red and green
 * are omitted on purpose (see 3 above); the palette runs blues → violets →
 * teals → pinks, which is the widest span left after removing the severity
 * hues.
 */
export const TAG_COLORS: readonly string[] = [
  '#7dd3fc', // sky
  '#c4b5fd', // violet
  '#5eead4', // teal
  '#f0abfc', // fuchsia
  '#93c5fd', // blue
  '#a5b4fc', // indigo
  '#67e8f9', // cyan
  '#d8b4fe', // purple
  '#f9a8d4', // pink
  '#99f6e4', // aquamarine
  '#bae6fd', // pale sky
  '#e9d5ff', // pale purple
];

/**
 * FNV-1a. Chosen over `hash = hash * 31 + c` because that variant clusters
 * badly on the strings this actually sees: real logcat tags share long
 * prefixes (`Wifi`, `WifiService`, `WifiP2pService`, `NetworkController…`),
 * and a weak mixer hands prefix-siblings adjacent buckets — which is exactly
 * the set of tags a reader most needs to tell apart. FNV-1a's per-character
 * multiply diffuses those into unrelated slots.
 *
 * `>>> 0` after each step keeps it in unsigned 32-bit space; `Math.imul` does
 * the multiply with 32-bit overflow semantics rather than drifting into
 * float territory past 2^53.
 */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Stable colour for a tag. Empty/absent tags get the muted body colour rather
 * than an arbitrary palette entry — colouring nothing as if it were something
 * is a lie the eye acts on.
 */
export function tagColor(tag: string): string {
  if (!tag) return 'var(--text-muted)';
  return TAG_COLORS[fnv1a(tag) % TAG_COLORS.length];
}
