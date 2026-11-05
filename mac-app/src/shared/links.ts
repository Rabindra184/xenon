// The web pages the window can ask the app to open. Only these names open
// anything: the window sends a name, never an address.
export const LINKS = {
  install: 'https://xenon-6e6.pages.dev/docs/xenon-control#what-you-need',
  /** How to reinstall a Xenon whose iPhone support is missing (Setup's iPhone support row). */
  reinstall: 'https://xenon-6e6.pages.dev/docs/xenon-control#when-iphone-support-is-missing'
} as const;

export type LinkName = keyof typeof LINKS;

/** The address for a link name, or null for anything that is not one of LINKS' own names. */
export function linkUrl(name: unknown): string | null {
  return typeof name === 'string' && Object.hasOwn(LINKS, name) ? LINKS[name as LinkName] : null;
}
