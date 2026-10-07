import { expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Appearance } from '../../src/shared/preferences';

// What every e2e spec does to drive the app: launch it, move between places,
// set preferences, make a profile, press ⌘⏎. launchApp() remembers the app it
// opened, so the helpers that need it can be called with no arguments.

export const appDir = path.resolve(__dirname, '..', '..');
export const shotsDir = path.join(appDir, 'test', 'e2e', 'screenshots');

export type PlaceName = 'Home' | 'Setup' | 'Settings' | 'Logs';

let launched: { app: ElectronApplication; page: Page } | null = null;

function current(): { app: ElectronApplication; page: Page } {
  if (!launched) throw new Error('Call launchApp() first');
  return launched;
}

/**
 * Launches the REAL built app (out/) with a throwaway user-data-dir, so a run
 * never touches the developer's own profiles, preferences or Keychain secrets,
 * and waits until the first profile is on screen (the profiles and option list
 * have come back from the main process).
 */
export async function launchApp(): Promise<{ app: ElectronApplication; page: Page }> {
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'xenon-e2e-'));
  const app = await electron.launch({
    args: [appDir, `--user-data-dir=${userDataDir}`],
    cwd: appDir,
    env: { ...process.env, NODE_ENV: 'test' }
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByTestId('profile-switcher')).toBeVisible({ timeout: 20_000 });
  launched = { app, page };
  return launched;
}

/** Opens a place from the sidebar. Places are vertical tabs, named exactly by their place, badge or not. */
export async function openPlace(name: PlaceName, page: Page = current().page): Promise<void> {
  const tab = page.getByRole('tab', { name, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

/** Shows or hides technical details (option names, folders, commands), as the View menu does. */
export async function setTechnical(page: Page, on: boolean): Promise<void> {
  await page.evaluate((technicalDetails) => window.xenon.prefs.set({ technicalDetails }), on);
}

/** Chooses System, Light or Dark, as the View menu does. */
export async function setAppearance(page: Page, appearance: Appearance): Promise<void> {
  await page.evaluate((a) => window.xenon.prefs.set({ appearance: a }), appearance);
}

/** Clicks an item of the application menu, as its accelerator would. */
async function clickMenuItem(app: ElectronApplication, menu: string, match: { label?: string; accelerator?: string }) {
  await app.evaluate(
    ({ Menu }, { menu, match }) => {
      const top = Menu.getApplicationMenu()?.items.find((i) => i.label === menu);
      const item = top?.submenu?.items.find((i) =>
        match.label ? i.label === match.label : i.accelerator === match.accelerator
      );
      if (!item) throw new Error(`No ${match.label ?? match.accelerator} item in the ${menu} menu`);
      item.click();
    },
    { menu, match }
  );
}

/**
 * File > New Profile, then waits until the new profile is saved and on screen.
 * It becomes the open profile only once the main process has saved it, and
 * anything typed before then edits the previous profile.
 */
export async function createProfile(page: Page = current().page, app: ElectronApplication = current().app) {
  const count = () => page.evaluate(async () => (await window.xenon.profiles.list()).length);
  const before = await count();
  await clickMenuItem(app, 'File', { label: 'New Profile' });
  await expect.poll(count).toBe(before + 1);
  await expect(page.getByTestId('profile-switcher')).toHaveText('New profile');
}

/**
 * What ⌘⏎ does: the Server menu's Start item. Playwright's key events go
 * straight to the page and never reach a native menu accelerator, so click the
 * menu item itself, which is what the accelerator runs.
 */
export async function pressStartShortcut(app: ElectronApplication = current().app): Promise<void> {
  await clickMenuItem(app, 'Server', { accelerator: 'Cmd+Return' });
}
