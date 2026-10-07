import { expect, _electron as electron, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Appearance } from '../../src/shared/preferences';

// What every e2e spec does to drive the app: launch it, move between places,
// set preferences, make and manage profiles, press ⌘⏎. launchApp() remembers the
// app it opened, so the helpers that need it can be called with no arguments.

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
  await expect(profileSwitcher(page)).toBeVisible({ timeout: 20_000 });
  launched = { app, page };
  return launched;
}

/** After the window was closed and opened again: the helpers act on this one from now on. */
export function adoptWindow(page: Page): void {
  current().page = page;
}

/** Opens a place from the sidebar. Places are vertical tabs, named exactly by their place, badge or not. */
export async function openPlace(name: PlaceName, page: Page = current().page): Promise<void> {
  const tab = page.getByRole('tab', { name, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

/**
 * Shows or hides technical details (option names, folders, commands), as the
 * View menu does, and waits until the window has it. A test that turns them on
 * needn't turn them off: the suite does after every test.
 */
export async function setTechnical(page: Page, on: boolean): Promise<void> {
  await page.evaluate((technicalDetails) => window.xenon.prefs.set({ technicalDetails }), on);
  await expect.poll(() => page.evaluate(() => window.xenon.prefs.get().then((p) => p.technicalDetails))).toBe(on);
}

/**
 * The server's status in its exact words, as the sidebar announces them
 * (politely). "Stopped" and "Stopped unexpectedly" are different statuses, so
 * assert with toHaveText, never toContainText.
 */
export const announcedStatus = (page: Page = current().page): Locator =>
  page.getByTestId('sidebar-status').locator('[role="status"][aria-live="polite"]');

/** The option names of the option list in use: a camelCase one in the app's own words is jargon. */
export async function optionKeys(page: Page = current().page): Promise<string[]> {
  return page.evaluate(async () => Object.keys((await window.xenon.getSchema()).schema.properties));
}

/**
 * The app's own words on screen, for the no-jargon check: the text of every
 * rendered element under `root`, and their placeholder, title and aria-label.
 * Leaves out [data-raw] (what the app quotes rather than writes: log lines, the
 * server's last message) and whatever matches `exclude`. Each piece is on its
 * own line, so words from neighbouring elements never run together.
 */
export async function ownWords(
  page: Page = current().page,
  opts: { root?: string; exclude?: string[] } = {}
): Promise<string> {
  return page.evaluate(
    ({ root, exclude }) => {
      const top = document.querySelector(root);
      if (!top) throw new Error(`Nothing matches ${root}`);
      const skip = ['[data-raw]', ...exclude].join(', ');
      const parts: string[] = [];
      for (const el of [top, ...top.querySelectorAll('*')]) {
        if (el.closest(skip) || !el.checkVisibility()) continue;
        for (const attr of ['placeholder', 'title', 'aria-label']) {
          const value = el.getAttribute(attr)?.trim();
          if (value) parts.push(value);
        }
        for (const node of el.childNodes) {
          const text = node.nodeType === Node.TEXT_NODE ? node.textContent?.trim() : '';
          if (text) parts.push(text);
        }
      }
      return parts.join('\n');
    },
    { root: opts.root ?? '#root', exclude: opts.exclude ?? [] }
  );
}

/** The items of one of the application menu's menus, as the main process built it: label, accelerator, checked. */
export async function menuItems(
  app: ElectronApplication,
  menu: string
): Promise<Array<{ label: string; accelerator?: string; checked: boolean; type: string }>> {
  return app.evaluate(({ Menu }, menu) => {
    const top = Menu.getApplicationMenu()?.items.find((i) => i.label === menu);
    return (top?.submenu?.items ?? []).map((i) => ({
      label: i.label,
      accelerator: i.accelerator ?? undefined,
      checked: i.checked,
      type: i.type
    }));
  }, menu);
}

/** Chooses System, Light or Dark, as the View menu does. */
export async function setAppearance(page: Page, appearance: Appearance): Promise<void> {
  await page.evaluate((a) => window.xenon.prefs.set({ appearance: a }), appearance);
}

/** Clicks an item of the application menu, as its accelerator would. */
export async function clickMenuItem(
  app: ElectronApplication,
  menu: string,
  match: { label?: string; accelerator?: string }
): Promise<void> {
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

/** The switcher's button: the open profile's name. */
export const profileSwitcher = (page: Page = current().page): Locator => page.getByTestId('profile-switcher');

/** Opens the profile switcher's popover and returns it. */
export async function openSwitcher(page: Page = current().page): Promise<Locator> {
  await profileSwitcher(page).click();
  const panel = page.getByRole('dialog', { name: 'Switch profile', exact: true });
  await expect(panel).toBeVisible();
  return panel;
}

/** Opens a profile from the switcher, and waits until it is the one on screen. */
export async function switchProfile(name: string, page: Page = current().page): Promise<void> {
  const panel = await openSwitcher(page);
  await panel.getByRole('radio', { name, exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(profileSwitcher(page)).toHaveText(name);
}

/**
 * Creates a profile from the switcher's "New profile…", then waits until the
 * new profile is saved and on screen. It becomes the open profile only once the
 * main process has saved it, and anything typed before then edits the previous
 * profile.
 */
export async function createProfile(page: Page = current().page): Promise<void> {
  const count = () => page.evaluate(async () => (await window.xenon.profiles.list()).length);
  const before = await count();
  const panel = await openSwitcher(page);
  await panel.getByRole('button', { name: 'New profile…', exact: true }).click();
  await expect.poll(count).toBe(before + 1);
  await expect(profileSwitcher(page)).toHaveText('New profile');
}

/**
 * The same through File > New Profile, which is quicker: the whole way there is
 * one call, so an edit made a moment before is still waiting to be saved.
 */
export async function createProfileFromMenu(
  page: Page = current().page,
  app: ElectronApplication = current().app
): Promise<void> {
  const count = () => page.evaluate(async () => (await window.xenon.profiles.list()).length);
  const before = await count();
  await clickMenuItem(app, 'File', { label: 'New Profile' });
  await expect.poll(count).toBe(before + 1);
  await expect(profileSwitcher(page)).toHaveText('New profile');
}

/** The Profiles sheet, once open. */
export const profilesSheet = (page: Page = current().page): Locator =>
  page.getByRole('dialog', { name: 'Profiles', exact: true });

/** Opens the Profiles sheet from the switcher's "Manage profiles…". */
export async function openProfilesSheet(page: Page = current().page): Promise<Locator> {
  const panel = await openSwitcher(page);
  await panel.getByRole('button', { name: 'Manage profiles…', exact: true }).click();
  const sheet = profilesSheet(page);
  await expect(sheet).toBeVisible();
  return sheet;
}

/** Closes the Profiles sheet with Escape, as a person would, and waits until it is gone. */
export async function closeProfilesSheet(page: Page = current().page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(profilesSheet(page)).toHaveCount(0);
}

/**
 * The row of the profile with exactly this name, in the sheet. It is found by
 * the name it shows, so it stops matching while the row is being renamed or
 * asking to be deleted: use pinRow for a row you act on.
 */
export const profileRow = (sheet: Locator, name: string): Locator =>
  // The inner locator is matched inside each row, so it starts from the page, not from the sheet.
  sheet.getByTestId('profile-row').filter({ has: sheet.page().getByText(name, { exact: true }) });

/** The same row, found by its profile's id, so it stays the same row whatever it shows. */
export async function pinRow(sheet: Locator, name: string): Promise<Locator> {
  const id = await profileRow(sheet, name).first().getAttribute('data-profile-id');
  if (!id) throw new Error(`No profile row named ${name}`);
  return sheet.locator(`[data-profile-id="${id}"]`);
}

/** Renames a profile in the sheet: Rename, type, Enter. */
export async function renameProfile(sheet: Locator, from: string, to: string): Promise<void> {
  const row = await pinRow(sheet, from);
  await row.getByRole('button', { name: 'Rename', exact: true }).click();
  const field = row.getByTestId('profile-name');
  await field.fill(to);
  await field.press('Enter');
  await expect(profileRow(sheet, to)).toBeVisible();
}

/** Deletes a profile in the sheet, through its confirmation. */
export async function deleteProfile(sheet: Locator, name: string): Promise<void> {
  const row = await pinRow(sheet, name);
  await row.getByRole('button', { name: 'Delete', exact: true }).click();
  await row.getByRole('button', { name: 'Confirm delete', exact: true }).click();
  await expect(row).toHaveCount(0);
}

/**
 * What ⌘⏎ does: the Server menu's Start item. Playwright's key events go
 * straight to the page and never reach a native menu accelerator, so click the
 * menu item itself, which is what the accelerator runs.
 */
export async function pressStartShortcut(app: ElectronApplication = current().app): Promise<void> {
  await clickMenuItem(app, 'Server', { accelerator: 'Cmd+Return' });
}
