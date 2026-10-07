import { useEffect, useState } from 'react';

/**
 * The next port nothing listens on after `inUse` (net:nextFreePort from
 * inUse + 1), for Home's "Use port N"; null while there is no port in use, while
 * it is being looked for, or when none of the next ones is free. It is looked
 * for again with every new answer (`answer`), since a port free a moment ago may
 * not be now.
 */
export function useNextFreePort(inUse: number | null, answer: unknown): number | null {
  const [found, setFound] = useState<{ inUse: number; port: number | null } | null>(null);
  useEffect(() => {
    if (inUse === null) return;
    let live = true;
    window.xenon.net.nextFreePort(inUse + 1).then(
      (port) => {
        if (live) setFound({ inUse, port });
      },
      () => {
        if (live) setFound({ inUse, port: null });
      }
    );
    return () => {
      live = false;
    };
  }, [inUse, answer]);
  return found !== null && found.inUse === inUse ? found.port : null;
}
