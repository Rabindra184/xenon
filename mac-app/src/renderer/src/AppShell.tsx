import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { SHELL } from './copy/shell';
import { PLACES, type Place } from './navigation';
import { Sidebar, type SidebarProps } from './components/Sidebar';
import { TabPanel, Tabs } from './components/ui/Tabs';

export interface AppShellProps {
  place: Place;
  onPlace: (place: Place) => void;
  sidebar: SidebarProps;
  /** What each place shows. Only the chosen one is in the page. */
  places: Record<Place, ReactNode>;
}

const isPlace = (value: string): value is Place => (PLACES as readonly string[]).includes(value);

/**
 * The window: a skip link, the sidebar, and the chosen place in <main>. The
 * places are one set of vertical tabs whose list is in the sidebar and whose
 * panels are in <main>, so Up and Down move between them and each panel is
 * named by its place. Each place opens at its top.
 */
export function AppShell({ place, onPlace, sidebar, places }: AppShellProps) {
  const main = useRef<HTMLElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  // The places share one scroll area, so a place opened after scrolling down
  // another would open partway down. Back to the top before it is drawn; a
  // setting being focused on the new place (usePendingFocus) scrolls after.
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [place]);

  return (
    <div className="flex h-full bg-app text-ink">
      {/* The first Tab stop. It moves focus itself rather than changing the address. Shown below the
          40 px title bar, which holds the traffic lights (drawn over the page) and drags the window. */}
      <a
        href="#content"
        onClick={(e) => {
          e.preventDefault();
          main.current?.focus();
        }}
        className="focus-ring titlebar-no-drag sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-12 focus:z-50 focus:rounded-md focus:border focus:border-line-strong focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:text-ink focus:shadow-md"
      >
        {SHELL.skipToContent}
      </a>
      <Tabs
        value={place}
        onValueChange={(value) => isPlace(value) && onPlace(value)}
        orientation="vertical"
        className="flex min-w-0 flex-1"
      >
        <Sidebar {...sidebar} />
        <main id="content" ref={main} tabIndex={-1} className="flex min-w-0 flex-1 flex-col outline-none">
          <div className="titlebar-drag h-10 shrink-0" />
          <div ref={scroller} data-testid="place-scroll" className="min-h-0 flex-1 overflow-auto px-6 pb-6">
            {PLACES.map((p) => (
              // Logs fills the height. A hidden panel stays in the page (empty), so its display
              // is set only while it is chosen; a plain `flex` would override `hidden`.
              <TabPanel key={p} value={p} className={p === 'logs' ? 'h-full flex-col data-[state=active]:flex' : undefined}>
                {places[p]}
              </TabPanel>
            ))}
          </div>
        </main>
      </Tabs>
    </div>
  );
}
