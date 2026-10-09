import { test, expect, _electron as electron, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { Appearance } from '../../src/shared/preferences';
import type { Profile } from '../../src/shared/types';
import {
  SANDBOX_SKIP,
  assertNoRealAppiumHome,
  inheritedEnv,
  makeThrowawayHome,
  xenonSandbox,
  type Resolved
} from './sandbox';

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
 * A port nothing listens on now, picked by the system. The seeded profile uses
 * 4723, where a developer's own server often runs; a test that needs a port
 * (Start on, or a real server) uses one of these instead, never 4723.
 */
export async function pickFreePort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as net.AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

/** An app this run launched and has not closed: its own folders, which the guard looks at. */
interface Launch {
  userDataDir: string;
  home: string;
}

const live = new Map<ElectronApplication, Launch>();

/**
 * Folders made for launches that have closed. A check the app ran (`appium plugin list` and the
 * like) can outlive the app by a moment and write its cache into them again after they were
 * removed, so they are removed once more at the next launch and as the run ends.
 */
const removed = new Set<string>();
const removeAgain = () => {
  for (const dir of removed) rmSync(dir, { recursive: true, force: true });
};
process.once('exit', removeAgain);

/**
 * The sandbox Appium folder (XENON_E2E_APPIUM_HOME, with Xenon in it) the app finds through its
 * shell's APPIUM_HOME, or null when there is none. A test that needs Xenon installed, or starts a
 * real server, calls needsXenonSandbox() first.
 */
export const sandboxAppiumHome = (): string | null => xenonSandbox();

/** Skips the test (or, outside a test, the file) with a plain reason when there is no sandbox Appium folder. */
export function needsXenonSandbox(): void {
  test.skip(sandboxAppiumHome() === null, SANDBOX_SKIP);
}

/**
 * The guard: fails, loudly, when the Appium folder an open app resolves (for any of its profiles,
 * or for a profile left on auto) or a launch config it wrote is the real ~/.appium or inside it.
 * The folders are read from the main process's own handlers (the real ones, when a test stands in
 * for one), so it works with the window closed, and nothing reads ~/.appium itself.
 */
export async function expectSandboxed(target?: ElectronApplication): Promise<Resolved[]> {
  const seen: Resolved[] = [];
  for (const [app, launch] of live) {
    if (target && app !== target) continue;
    const resolved = await resolvedAppiumHomes(app);
    assertNoRealAppiumHome(resolved, launch.userDataDir);
    seen.push(...resolved);
  }
  return seen;
}

async function resolvedAppiumHomes(app: ElectronApplication): Promise<Resolved[]> {
  return app.evaluate(async ({ ipcMain }) => {
    type Handler = (event: unknown, ...args: unknown[]) => unknown;
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
    const real = (globalThis as unknown as { realHandlers?: Map<string, Handler> }).realHandlers;
    const call = (channel: string, ...args: unknown[]) => (real?.get(channel) ?? handlers.get(channel)!)({}, ...args);
    const where = async (profile: unknown) => ((await call('server:resolvedAppiumHome', profile)) as { path: string }).path;
    const profiles = (await call('profiles:list')) as Array<{ name: string }>;
    return [
      { what: 'a profile on auto', path: await where({ server: { appiumHome: '' } }) },
      ...(await Promise.all(profiles.map(async (p) => ({ what: `profile “${p.name}”`, path: await where(p) }))))
    ];
  });
}

/**
 * Launches the REAL built app (out/) with a throwaway user-data-dir and a throwaway HOME, so a run
 * never touches the developer's own profiles, preferences, Keychain secrets or Appium folder, and
 * waits until the first profile is on screen (the profiles and option list have come back from the
 * main process).
 *
 * The HOME is made for this launch and removed when the app closes. Its shell startup files export
 * this process's PATH and Android SDK, so the app finds the same Node, Appium and adb the run does,
 * and, when XENON_E2E_APPIUM_HOME names a sandbox with Xenon in it, APPIUM_HOME: a profile left on
 * auto resolves to the sandbox, as a developer's own exported APPIUM_HOME would be. The Keychain is
 * Chromium's mock one (--use-mock-keychain), never the Mac's. Xenon's database is a file in the
 * throwaway HOME unless `env` names another. The guard runs once the window is up and again as the
 * app closes.
 *
 * `userDataDir` launches on a folder a run made before (a relaunch, or one seedProfiles filled),
 * `asCurrent: false` leaves the helpers acting on the app they act on now (a second app alongside
 * the suite's), `env` is added to the app's environment (which a server it starts inherits),
 * `prepareHome` fills the throwaway HOME before the app starts (folders for auto-detection to find)
 * and may return variables to add to the app's environment, and `sandbox: false` leaves APPIUM_HOME
 * unexported.
 */
export async function launchApp(
  opts: {
    userDataDir?: string;
    asCurrent?: boolean;
    env?: Record<string, string>;
    prepareHome?: (home: string) => Record<string, string> | void;
    sandbox?: boolean;
  } = {}
): Promise<{ app: ElectronApplication; page: Page; userDataDir: string; home: string }> {
  // First, before any folder is made: a sandbox named under the real ~/.appium stops the run here.
  const sandbox = opts.sandbox === false ? null : sandboxAppiumHome();
  const ownDataDir = opts.userDataDir === undefined;
  const userDataDir = opts.userDataDir ?? mkdtempSync(path.join(os.tmpdir(), 'xenon-e2e-'));
  const home = makeThrowawayHome({ appiumHome: sandbox });
  removeAgain();
  const removeFolders = () => {
    for (const dir of ownDataDir ? [home, userDataDir] : [home]) {
      removed.add(dir);
      rmSync(dir, { recursive: true, force: true });
    }
  };
  let app: ElectronApplication;
  try {
    const homeEnv = opts.prepareHome?.(home) ?? {};
    app = await electron.launch({
      args: [appDir, `--user-data-dir=${userDataDir}`, '--use-mock-keychain'],
      cwd: appDir,
      env: {
        ...inheritedEnv(),
        HOME: home,
        // Also in the environment, for when the login shell can't answer in time (a loaded Mac).
        ...(sandbox ? { APPIUM_HOME: sandbox } : {}),
        DATABASE_URL: `file:${path.join(home, 'xenon-e2e.db')}`,
        ...homeEnv,
        ...opts.env,
        NODE_ENV: 'test'
      }
    });
  } catch (err) {
    removeFolders();
    throw err;
  }
  live.set(app, { userDataDir, home });
  const close = app.close.bind(app);
  // Every way a spec closes an app runs the guard on it first, and removes the folders made for it.
  app.close = async () => {
    let guard: unknown = null;
    try {
      if (live.has(app)) await expectSandboxed(app);
    } catch (err) {
      // A closed or crashed app can't answer; what it wrote is still checked.
      guard = err instanceof Error && err.message.startsWith('E2E GUARD') ? err : null;
      if (guard === null) assertNoRealAppiumHome([], userDataDir);
    } finally {
      live.delete(app);
      try {
        await close();
      } finally {
        removeFolders();
      }
    }
    if (guard) throw guard;
  };
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    // The window's first profile, once main has answered: a launch takes a while on a loaded Mac.
    await expect(profileSwitcher(page)).toBeVisible({ timeout: 45_000 });
    const [auto] = await expectSandboxed(app);
    console.log(`[e2e] launched with HOME ${home}; a profile on auto uses ${auto.path}; not the real ~/.appium`);
    if (opts.asCurrent !== false) launched = { app, page };
    return { app, page, userDataDir, home };
  } catch (err) {
    await app.close().catch(() => undefined);
    throw err;
  }
}

/**
 * The Mac's clipboard text, read through the app. The suite runs on a
 * developer's own Mac, and a spec that copies (an address, the launch preview)
 * overwrites it, so the spec reads it first and puts it back with
 * restoreClipboard once it is done.
 */
export async function saveClipboard(app: ElectronApplication): Promise<string> {
  return app.evaluate(({ clipboard }) => clipboard.readText());
}

/** Puts back what saveClipboard read: through the app, or, if the app has gone, through pbcopy. */
export async function restoreClipboard(app: ElectronApplication | undefined, text: string): Promise<void> {
  try {
    if (!app) throw new Error('No app to restore the clipboard through');
    await app.evaluate(({ clipboard }, saved) => clipboard.writeText(saved), text);
  } catch {
    execFileSync('pbcopy', { input: text });
  }
}

/** Writes the profiles a launch on `userDataDir` starts with, in place of the seeded one. */
export function seedProfiles(userDataDir: string, profiles: Profile[]): void {
  writeFileSync(path.join(userDataDir, 'profiles.json'), JSON.stringify({ profiles }));
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

/** A line as the main process sends it to the window for Logs; `ts` is now when left out. */
export interface SentLogLine {
  stream: 'stdout' | 'stderr' | 'system';
  text: string;
  always?: boolean;
  problem?: boolean;
  ts?: number;
}

/**
 * The ids of the lines sendLogLines makes up. Main numbers its own lines from 1, one by one, so a run
 * never comes near these: a line sent here is never taken for one of main's, nor one of main's for it.
 */
let sentLineId = 1_000_000_000;

/**
 * Sends lines to Logs as the main process sends a server's output, so a test
 * can put known lines on screen without a server printing them. They reach the
 * window's buffer only, not the lines main keeps (so a window opened again
 * doesn't have them, and main quotes none of them after a crash: serverPrints
 * does that). Logs draws them within a moment (it gathers lines for 120 ms
 * before drawing).
 */
export async function sendLogLines(lines: SentLogLine[], app: ElectronApplication = current().app): Promise<void> {
  const numbered = lines.map((l) => ({ id: sentLineId++, ...l }));
  await app.evaluate(({ BrowserWindow }, lines) => {
    const now = Date.now();
    BrowserWindow.getAllWindows()[0].webContents.send(
      'evt:log',
      lines.map((l) => ({ ts: now, ...l }))
    );
  }, numbered);
}

type Handler = (event: unknown, ...args: unknown[]) => unknown;

/**
 * The server's state as the main process has it, asked of its own handler (the real one, when a test
 * stands in for it), so it can be read with the window closed.
 */
export async function mainServerState(
  app: ElectronApplication = current().app
): Promise<{ status: string; pid: number | null; port: number | null; crashLine?: { id: number; text: string } | null }> {
  return app.evaluate(async ({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
    const real = (globalThis as unknown as { realHandlers?: Map<string, Handler> }).realHandlers;
    return (await (real?.get('server:state') ?? handlers.get('server:state')!)({})) as {
      status: string;
      pid: number | null;
      port: number | null;
    };
  });
}

/**
 * Lines the running server prints, as if it printed them: put on its stdout or stderr in the main
 * process, where its own output arrives. Main takes them in as it takes the server's (each gets its
 * id, it keeps them, works a crash's line out from them, and sends them to the window), so they are
 * there in a window opened later too. The server's process is found among main's own (by the pid
 * main reports); there must be one running.
 */
export async function serverPrints(
  lines: Array<{ stream: 'stdout' | 'stderr'; text: string }>,
  app: ElectronApplication = current().app
): Promise<void> {
  const { pid } = await mainServerState(app);
  if (pid === null) throw new Error('No server is running to print the lines');
  await app.evaluate(
    (_electron, { pid, lines }) => {
      type Child = { pid?: number; stdout: { emit(e: string, b: Buffer): void }; stderr: { emit(e: string, b: Buffer): void } };
      const handles = (process as unknown as { _getActiveHandles(): unknown[] })._getActiveHandles();
      const child = handles.find((h): h is Child => !!h && (h as Child).pid === pid && !!(h as Child).stdout);
      if (!child) throw new Error(`The server's process ${pid} is not one of main's`);
      for (const l of lines) child[l.stream].emit('data', Buffer.from(`${l.text}\n`));
    },
    { pid, lines }
  );
}

/**
 * Closes the window, as its close button does; the app stays in the menu bar. Opens it again as the
 * menu-bar icon does (second-instance runs showWindow), and the helpers act on the new one from then
 * on. `between` runs while there is no window.
 */
export async function reopenWindow(between: () => Promise<void> = async () => undefined): Promise<Page> {
  const { app, page } = current();
  const closed = page.waitForEvent('close');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await closed;
  await between();
  const reopened = app.waitForEvent('window');
  await app.evaluate(({ app: electronApp }) => electronApp.emit('second-instance'));
  const next = await reopened;
  await next.waitForLoadState('domcontentloaded');
  current().page = next;
  await expect(profileSwitcher(next)).toBeVisible({ timeout: 45_000 });
  return next;
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
