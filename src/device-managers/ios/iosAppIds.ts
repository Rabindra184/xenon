/**
 * Executable name → bundle identifier, for the iOS log stream.
 *
 * An os_trace record names the binary that logged (`/…/Food Truck`), never the
 * app it belongs to. Android has no such gap: a process name there IS the
 * package name, so `package:com.google.android.gms` already filters by app id.
 * Mapping the executable back to its bundle id is what makes one filter
 * grammar mean the same thing on both platforms.
 *
 * Pure, so the shape of `ios apps` output is pinned by tests rather than by a
 * device being plugged in.
 */

interface InstalledApp {
  CFBundleExecutable?: string;
  CFBundleIdentifier?: string;
}

/**
 * Build the lookup from `ios apps` JSON.
 *
 * Tolerant by design: this runs at stream start, and a device that cannot list
 * its apps must degrade to executable names rather than take the log stream
 * down with it. Anything unparseable yields an empty map, which is exactly the
 * "no translation available" case.
 */
export function parseInstalledApps(json: string): Map<string, string> {
  const out = new Map<string, string>();
  let apps: unknown;
  try {
    apps = JSON.parse(json);
  } catch {
    return out;
  }
  if (!Array.isArray(apps)) return out;

  for (const app of apps as InstalledApp[]) {
    const exe = app?.CFBundleExecutable;
    const id = app?.CFBundleIdentifier;
    // Both halves or nothing — a half-populated entry would map an executable
    // to undefined and hide the record's real process name behind it.
    if (typeof exe === 'string' && exe && typeof id === 'string' && id) {
      // First writer wins. Two apps sharing an executable name is not
      // something this can resolve from a name alone, and silently switching
      // which one a filter means is worse than picking one and staying put.
      if (!out.has(exe)) out.set(exe, id);
    }
  }
  return out;
}

/**
 * The app id for a process, or the process name when it is not an app.
 *
 * System daemons — backboardd, locationd — are not installed apps and keep
 * their own names, which is precisely what Android does for surfaceflinger and
 * zygote64. The result is that on both platforms an app shows as its app id
 * and a daemon shows as itself.
 */
export function appIdForProcess(
  process: string | undefined,
  map: Map<string, string>,
): string | undefined {
  if (!process) return process;
  return map.get(process) ?? process;
}
