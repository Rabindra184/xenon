/**
 * What a stored fingerprint (`LocatorSignature.attributes`) says about which
 * element it is, as opposed to where the element was (x, y, width, height).
 *
 * Through 2.14 every learnt fingerprint held only the rect and the type: the
 * attribute reads failed (CommandInterceptor.triggerLearning). Fuzzy XML, which
 * weighs position above everything else, then healed a selector to whatever
 * element of that type sat at that spot. A fingerprint with no identity isn't
 * used for position, and is learnt again.
 */

/**
 * The attributes that say which element a fingerprint is. Not `value`: on a
 * text field it is what the test typed, which fingerprints no longer keep.
 */
export const FINGERPRINT_IDENTITY_ATTRIBUTES = [
  'resource-id',
  'content-desc',
  'accessibility-id',
  'text',
  'name',
  'label',
  'id',
  'hint',
] as const;

/**
 * A value that says something: a string with more than spaces in it, and not
 * "null", which is what UiAutomator2 answers for an attribute the element
 * hasn't set (its getAttribute is String(value)).
 */
export function meaningful(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.trim() !== 'null';
}

/** Whether a fingerprint says anything about which element it is. */
export function hasIdentity(attributes: Record<string, string> | undefined): boolean {
  return FINGERPRINT_IDENTITY_ATTRIBUTES.some((name) => meaningful(attributes?.[name]));
}

/**
 * The attributes learning asks a driver for: those it has. UiAutomator2
 * throws for `id` and `label`, and its `name` is the text again; WebDriverAgent
 * throws for anything but its own, so five of the old list were five failed
 * round trips per selector learnt.
 */
export function attributesToLearn(platformName: unknown): string[] {
  const platform = String(platformName ?? '').toLowerCase();
  if (platform === 'android') return ['resource-id', 'content-desc', 'text', 'hint'];
  if (platform === 'ios' || platform === 'tvos') return ['name', 'label'];
  return ['resource-id', 'content-desc', 'text', 'hint', 'name', 'label'];
}

/**
 * An Android resource-id without its package: `com.shop:id/pay` is `pay`.
 * Fuzzy XML's veto asks whether two ids are the same this way: ids of one
 * app share the package, and of a debug build another one. Its score still
 * compares whole ids, where the shared package earns a share of the weight.
 */
export function resourceIdName(resourceId: string): string {
  const at = resourceId.lastIndexOf(':id/');
  if (at >= 0) return resourceId.slice(at + 4);
  return resourceId.slice(resourceId.lastIndexOf('/') + 1);
}

/**
 * The identifier a developer gave the element, which stays when its text
 * changes: an Android resource-id, or an iOS accessibility identifier (`name`
 * when it isn't just the label; an element without one has its label as name).
 */
export function stableIdentifierOf(
  attributes: Record<string, string> | undefined,
): { attribute: 'resource-id' | 'name'; value: string } | null {
  const resourceId = attributes?.['resource-id'];
  if (meaningful(resourceId)) return { attribute: 'resource-id', value: resourceId };
  const name = attributes?.name;
  if (meaningful(name) && name !== attributes?.label) return { attribute: 'name', value: name };
  return null;
}

// Built at run time: the compiler's target predates Unicode property escapes
// in regular expression literals. Letters, their combining marks and digits,
// in any script.
const NOT_A_WORD = new RegExp('[^\\p{L}\\p{M}\\p{N}]+', 'gu');
const CAMEL_TURN = new RegExp('([\\p{Ll}\\p{N}])(\\p{Lu})', 'gu');

/** An identifier's words: split where camelCase turns and at anything but a letter or digit. */
function identifierWords(identifier: string): string[] {
  return identifier
    .normalize('NFC')
    .replace(CAMEL_TURN, '$1 $2')
    .toLowerCase()
    .split(NOT_A_WORD)
    .filter(Boolean);
}

/**
 * Whether two identifiers name the same element: they have the same words,
 * however written (btn-pay, pay_btn, payBtn). Any other pair names another
 * element, and the text decides: an id that gains words is as often another
 * element (pay_later, undo_delete) as a rename (checkout_pay), and letters
 * alone can't tell follow from unfollow, or checkout.cancel from
 * checkout.pay (64% of their letter pairs are shared). Two with no letter or
 * digit between them can't be told apart, and count as the same.
 */
export function sameIdentifier(a: string, b: string): boolean {
  const [wordsA, wordsB] = [new Set(identifierWords(a)), new Set(identifierWords(b))];
  if (wordsA.size !== wordsB.size) return false;
  return [...wordsA].every((w) => wordsB.has(w));
}

/**
 * Whether two texts read the same: case, punctuation and spacing aside, with
 * accents composed (NFC). Combining marks count: Hindi दें and दो differ only
 * by theirs. Nothing looser: "Log in" and "Log out", "Enable" and "Disable"
 * are as alike by their letters as a reworded label is.
 */
export function sameText(a: string, b: string): boolean {
  const read = (t: string) => t.normalize('NFC').toLowerCase().replace(NOT_A_WORD, ' ').trim();
  const [textA, textB] = [read(a), read(b)];
  return textA !== '' && textA === textB;
}
