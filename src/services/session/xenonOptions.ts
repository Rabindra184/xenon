import { ISessionCapability } from '../../interfaces/ISessionCapability';

/**
 * Xenon's own session options, and the one place their precedence is decided.
 *
 * `xe:options` is the documented namespace: the credentials (`accessKey` +
 * `token`, or `sessionToken`), the lease (`leaseId`, `leaseToken`), and
 * Xenon's other options (`healingTiers`, `interceptor`, `name`, ...).
 * `xenon:options` is still read as an alias. When a session sends both,
 * `xe:options` wins field by field: a field it sets is used, and every other
 * field falls back to `xenon:options`. A field set to null counts as unset.
 *
 * Nothing else is read. `df:options` came from appium-device-farm and is not
 * Xenon's.
 *
 * Every reader goes through `xenonOptionsOf` (a W3C request) or
 * `xenonOptionsIn` (one flat capability map), so the rule lives here only.
 */
export const XE_OPTIONS = 'xe:options';
export const XENON_OPTIONS = 'xenon:options';

/** Both namespaces, the winner first. */
export const OPTION_NAMESPACES = [XE_OPTIONS, XENON_OPTIONS] as const;

export type XenonOptions = Record<string, any>;

type Bucket = Record<string, any>;

export const isOptionsObject = (v: unknown): v is Bucket =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Xenon's options in one flat capability map: the merged request, a
 * session's returned capabilities, or a stored desired-capabilities row.
 * Always a fresh object.
 */
export function xenonOptionsIn(flatCaps: unknown): XenonOptions {
  const options: XenonOptions = {};
  if (!isOptionsObject(flatCaps)) return options;
  // Lowest precedence first, so the winner's fields are written last.
  for (const namespace of [...OPTION_NAMESPACES].reverse()) {
    const bag = flatCaps[namespace];
    if (!isOptionsObject(bag)) continue;
    for (const [field, value] of Object.entries(bag)) {
      if (value !== undefined && value !== null) options[field] = value;
    }
  }
  return options;
}

/**
 * The flat view of a W3C request that Xenon reads every capability from:
 * `firstMatch[0]` overlaid by `alwaysMatch`, as allocation merges them. W3C
 * forbids a key in both, so for a valid request this is their union; for one
 * Appium will go on to reject, alwaysMatch wins outright, key by key.
 */
export function mergedFirstMatch(caps: ISessionCapability | undefined): Bucket {
  const firstMatch = caps?.firstMatch;
  const first = Array.isArray(firstMatch) ? firstMatch[0] : undefined;
  const always = caps?.alwaysMatch;
  return Object.assign(
    {},
    isOptionsObject(first) ? first : {},
    isOptionsObject(always) ? always : {},
  );
}

/** Xenon's options for a W3C session request. Always a fresh object. */
export function xenonOptionsOf(caps: ISessionCapability | undefined): XenonOptions {
  return xenonOptionsIn(mergedFirstMatch(caps));
}

/** A non-empty string option, or undefined. */
export function stringOption(options: XenonOptions, field: string): string | undefined {
  const value = options[field];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
