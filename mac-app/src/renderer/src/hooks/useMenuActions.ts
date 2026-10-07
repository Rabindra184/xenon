import { useEffect, useRef } from 'react';
import type { MenuAction } from '@shared/types';
import { placeForMenuAction, type Place } from '../navigation';

/** What each menu action does, besides View's places, which open through `onPlace`. */
export type MenuHandlers = Partial<Record<MenuAction, () => void>>;

/**
 * Acts on the application menu and the menu-bar icon. View's ⌘1–⌘4 open their
 * place; every other action runs its handler. Both are read when an action
 * arrives, so they can be fresh each render. Nothing listens until `ready` (the
 * profiles and the server's status have been read): an action sent before then
 * (Start Server from the menu-bar icon, into a window that is just opening)
 * waits in the preload and is acted on once it is.
 */
export function useMenuActions(handlers: MenuHandlers, onPlace: (place: Place) => void, ready: boolean): void {
  const current = useRef({ handlers, onPlace });
  current.current = { handlers, onPlace };

  useEffect(() => {
    if (!ready) return;
    return window.xenon.onMenuAction((action) => {
      const place = placeForMenuAction(action);
      if (place) current.current.onPlace(place);
      else current.current.handlers[action]?.();
    });
  }, [ready]);
}
