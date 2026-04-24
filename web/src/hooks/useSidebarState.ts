import { useCallback, useEffect, useState } from 'react';

export type SidebarState = 'collapsed' | 'expanded' | 'pinned-open';
const KEY = 'xenon.sidebar';

export function useSidebarState() {
  const [persisted, setPersisted] = useState<SidebarState>(() => {
    try {
      const v = window.localStorage.getItem(KEY);
      return v === 'pinned-open' ? 'pinned-open' : 'collapsed';
    } catch {
      return 'collapsed';
    }
  });
  const [hover, setHover] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(KEY, persisted);
    } catch {
      // ignore quota errors
    }
  }, [persisted]);

  const togglePin = useCallback(() => {
    setPersisted((s) => (s === 'pinned-open' ? 'collapsed' : 'pinned-open'));
  }, []);

  const state: SidebarState =
    persisted === 'pinned-open' ? 'pinned-open' : hover ? 'expanded' : 'collapsed';

  return { state, isPinned: persisted === 'pinned-open', setHover, togglePin };
}
