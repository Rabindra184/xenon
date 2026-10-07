/**
 * Which profile the window opens with: the one it had open last on this Mac
 * (closing the window ends the page, and the menu-bar icon's Start reopens it
 * to start that profile), else the first. A profile deleted since is not
 * there to open.
 */
export function profileToOpen(list: ReadonlyArray<{ id: string }>, lastOpen: string | null): string | null {
  if (lastOpen !== null && list.some((p) => p.id === lastOpen)) return lastOpen;
  return list[0]?.id ?? null;
}
