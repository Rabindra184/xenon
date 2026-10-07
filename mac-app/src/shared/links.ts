// The web pages the window can ask the app to open. Only these names open
// anything: the window sends a name, never an address.
export const LINKS = {
  install: 'https://xenon-6e6.pages.dev/docs/xenon-control#what-you-need'
} as const;

export type LinkName = keyof typeof LINKS;

/** The address for a link name, or null for anything that is not one of LINKS' own names. */
export function linkUrl(name: unknown): string | null {
  return typeof name === 'string' && Object.hasOwn(LINKS, name) ? LINKS[name as LinkName] : null;
}
