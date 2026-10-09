import { useEffect, useRef } from 'react';
import type { MenuAction, WindowMenuAction } from '@shared/types';
import { isPlaceMenuAction, menuActionReady, placeForMenuAction, type MenuReadiness, type Place } from '../navigation';

/**
 * What each menu action the window handles does. Every one must be here: a new
 * MenuAction fails to compile until it is handled (or is a place, or main's).
 * View's places open through `onPlace` instead.
 */
export type MenuHandlers = Record<WindowMenuAction, () => void>;

/**
 * Acts on the application menu and the menu-bar icon. View's ⌘1–⌘4 open their
 * place; every other action runs its handler. Both are read when an action
 * runs, so they can be fresh each render.
 *
 * Nothing listens until the profiles are read: an action sent sooner (Start
 * Server from the menu-bar icon, into a window that is just opening) waits in
 * the preload. Once listening, an action that acts on what a start would
 * launch waits here until the open profile's settings are checked (see
 * menuActionReady), and is then done; the others are done at once. Copy Test
 * Address waits the same way for the server's status.
 */
export function useMenuActions(handlers: MenuHandlers, onPlace: (place: Place) => void, ready: MenuReadiness): void {
  const current = useRef({ handlers, onPlace, ready });
  current.current = { handlers, onPlace, ready };
  const held = useRef<MenuAction[]>([]);

  const act = (action: MenuAction) => {
    const place = placeForMenuAction(action);
    if (place) current.current.onPlace(place);
    // 'open-dashboard' is main's own and never sent here.
    else if (!isPlaceMenuAction(action) && action !== 'open-dashboard') current.current.handlers[action]();
  };
  const actRef = useRef(act);
  actRef.current = act;

  useEffect(() => {
    if (!ready.profiles) return;
    return window.xenon.onMenuAction((action) => {
      if (menuActionReady(action, current.current.ready)) actRef.current(action);
      else held.current.push(action);
    });
  }, [ready.profiles]);

  // What waited is done once what it waited for is read, in the order it came; the rest wait on.
  useEffect(() => {
    if (held.current.length === 0) return;
    const waiting = held.current.splice(0);
    for (const action of waiting) {
      if (menuActionReady(action, current.current.ready)) actRef.current(action);
      else held.current.push(action);
    }
  }, [ready.server, ready.settings]);
}
