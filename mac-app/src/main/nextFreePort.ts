import { isPortInUse } from './portProbe';

const HIGHEST_PORT = 65535;

/**
 * The first free port from `from` upwards, looking at `tries` ports at most
 * and never above 65535; null when they are all taken. The ports are asked
 * about one at a time, in order, so the answer is the lowest free one.
 */
export async function nextFreePort(
  from: number,
  probe: (port: number) => Promise<boolean> = isPortInUse,
  tries = 50
): Promise<number | null> {
  if (!Number.isFinite(from)) return null;
  const first = Math.max(1, Math.floor(from));
  const last = Math.min(HIGHEST_PORT, first + tries - 1);
  for (let port = first; port <= last; port += 1) {
    if (!(await probe(port))) return port;
  }
  return null;
}
