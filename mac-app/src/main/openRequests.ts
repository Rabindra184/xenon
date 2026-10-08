import { realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Profile, ServerState } from '@shared/types';

// What the window asks main to open: the dashboard in the browser, a folder in Finder. Main does not
// take the window's word for what to open (M8). The dashboard is main's own running server's,
// whatever address the window sends. A folder is opened only when it is one, and not a program:
// an imported profile's Appium folder can name a .command script or an app, which opening would run.

export interface OpenDeps {
  openExternal(url: string): Promise<void>;
  /** Electron's shell.openPath: '' when it opened, else what went wrong. */
  openPath(target: string): Promise<string>;
  serverState(): Pick<ServerState, 'status' | 'dashboardUrl'>;
  logsDir(): string;
  appiumHome(profile: Profile | undefined): string;
}

/**
 * Folders macOS runs or installs when they are opened, rather than showing what is in them: apps and
 * their kin, installer packages, Automator workflows, system add-ons. Never a folder to look in.
 */
const RUNS_WHEN_OPENED =
  /\.(app|appex|action|bundle|component|framework|kext|mdimporter|mpkg|pkg|plugin|prefpane|qlgenerator|saver|service|workflow|xpc)$/i;

/**
 * Why a folder isn't opened. The window says neither: any answer but '' is "Couldn’t open that
 * folder." there (R82), so these are reasons, not words (R83).
 */
export type OpenRefusal = 'missing' | 'not-a-folder';

/**
 * What to open in Finder for `target`: the folder itself, its links followed first, so a link to an app
 * or a script is judged as what it points to, and what opens is what was judged (R83). Refused when it
 * isn't there, isn't a folder, or is (or is named as) one macOS runs when it is opened.
 */
export function folderToOpen(target: string): { open: string } | { refused: OpenRefusal } {
  let real: string;
  let isFolder: boolean;
  try {
    real = realpathSync(target);
    isFolder = statSync(real).isDirectory();
  } catch {
    return { refused: 'missing' };
  }
  if (!isFolder || RUNS_WHEN_OPENED.test(path.basename(real)) || RUNS_WHEN_OPENED.test(path.basename(target))) {
    return { refused: 'not-a-folder' };
  }
  return { open: real };
}

export function openRequests(d: OpenDeps) {
  return {
    /** Opens main's own dashboard for the running server, and nothing when none runs. True when it opened. */
    async openDashboard(_asked?: unknown): Promise<boolean> {
      const { status, dashboardUrl } = d.serverState();
      if (status !== 'running' || !dashboardUrl) return false;
      await d.openExternal(dashboardUrl);
      return true;
    },
    /**
     * Opens the log folder or a profile's Appium folder in Finder. Resolves to '' when it opened, and
     * otherwise to why not (a refusal, or shell.openPath's own error): it never throws for a refused path.
     */
    async openPath(kind: unknown, profile?: unknown): Promise<string> {
      let target: string;
      if (kind === 'logs') target = d.logsDir();
      else if (kind === 'appiumHome') {
        const p = typeof profile === 'object' && profile !== null ? (profile as Profile) : undefined;
        target = d.appiumHome(p ?? ({ server: { appiumHome: '' } } as Profile));
      } else return 'not-a-folder' satisfies OpenRefusal;
      const decided = folderToOpen(target);
      if ('refused' in decided) return decided.refused;
      return d.openPath(decided.open);
    }
  };
}
