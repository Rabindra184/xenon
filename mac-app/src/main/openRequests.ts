import { statSync } from 'node:fs';
import path from 'node:path';
import type { Profile, ServerState } from '@shared/types';
import { MAIN_COPY } from './copy';

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

/** Why `target` is not opened in Finder, as the window may say it, or null when it may be. */
export function folderRefusal(target: string): string | null {
  let isFolder: boolean;
  try {
    isFolder = statSync(target).isDirectory();
  } catch {
    return MAIN_COPY.openFolderMissing;
  }
  if (!isFolder || RUNS_WHEN_OPENED.test(path.basename(target))) return MAIN_COPY.openNotAFolder;
  return null;
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
     * otherwise to a plain sentence, as shell.openPath does: it never throws for a refused path.
     */
    async openPath(kind: unknown, profile?: unknown): Promise<string> {
      let target: string;
      if (kind === 'logs') target = d.logsDir();
      else if (kind === 'appiumHome') {
        const p = typeof profile === 'object' && profile !== null ? (profile as Profile) : undefined;
        target = d.appiumHome(p ?? ({ server: { appiumHome: '' } } as Profile));
      } else return MAIN_COPY.openNotAFolder;
      const refusal = folderRefusal(target);
      if (refusal !== null) return refusal;
      return d.openPath(target);
    }
  };
}
