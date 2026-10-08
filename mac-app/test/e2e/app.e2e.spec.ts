import { test, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { accessibilityProblems, expectAccessible, expectAccessibleInBothThemes } from './a11y';
import { findJargon } from './jargon';
import {
  adoptWindow,
  announcedStatus,
  clickMenuItem,
  closeProfilesSheet,
  createProfile,
  createProfileFromMenu,
  deleteProfile,
  launchApp,
  menuItems,
  openPlace,
  openProfilesSheet,
  openSwitcher,
  optionKeys,
  pickFreePort,
  ownWords,
  pinRow,
  pressStartShortcut,
  profileRow,
  profileSwitcher,
  profilesSheet,
  renameProfile,
  restoreClipboard,
  saveClipboard,
  setAppearance,
  setTechnical,
  shotsDir,
  switchProfile
} from './helpers';

// Drives the REAL built Electron app (out/) with an isolated user-data-dir, so
// these tests exercise the full renderer -> preload -> main -> stores/services
// stack without touching the developer's real profiles or Keychain.
//
// Needs a Mac with Node and Appium (in the supported version range) installed
// and the Xenon plugin installed in the Appium folder the app auto-detects.
// The assertions that expect Start to be enabled depend on a passing live
// readiness check, which reads the real toolchain. On a Mac without these they
// fail, correctly, because Start says why it is off.

let app: ElectronApplication;
let page: Page;

// The seeded profile uses 4723, where a real server often runs on a developer
// machine, and Start stays off while a port is taken. Tests that need Start on
// switch to a port picked as free for this run instead. Nothing here binds or
// starts on 4723.
let freePort = 0;
/** The Mac's clipboard text before the run: copying the launch preview overwrites it, and it is put back after. */
let savedClipboard: string | null = null;

test.beforeAll(async () => {
  freePort = await pickFreePort();
  ({ app, page } = await launchApp());
  savedClipboard = await saveClipboard(app);
});

test.afterAll(async () => {
  if (savedClipboard !== null) await restoreClipboard(app, savedClipboard);
  await app?.close();
});

// Technical details are per Mac and change what Settings, Logs and the menus show. A test that
// turns them on leaves them on, so every test starts with them off, as a person's first run does.
test.afterEach(async () => {
  await setTechnical(page, false);
});

/** One of the tabs inside Settings. */
async function openSettingsTab(name: 'Essentials' | 'All settings' | 'Keys & accounts') {
  await openPlace('Settings');
  const tab = page.getByRole('tab', { name, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

/** The port box in Settings' Essentials. */
const portField = () => page.getByRole('spinbutton', { name: 'Port tests connect to', exact: true });

/** Opens Settings at Essentials and returns its port box. */
async function openPort() {
  await openSettingsTab('Essentials');
  return portField();
}

/** The open profile as stored. */
const storedProfile = () =>
  page.evaluate(async () => (await window.xenon.profiles.list()).find((p) => p.name === 'Local server')!);

/** A switch in Settings, by its exact name. */
const settingSwitch = (name: string) => page.getByRole('switch', { name, exact: true });

/** The pointers that stand in for a secret's box in All settings. */
const secretPointers = () => page.getByText(/is a secret — set it in Keys & accounts/);

/** Deletes the first profile in the sheet with this name, through its confirmation (more than one can share a name). */
async function deleteProfileNamed(sheet: Locator, name: string) {
  const row = await pinRow(sheet, name);
  await row.getByRole('button', { name: 'Delete', exact: true }).click();
  await row.getByRole('button', { name: 'Confirm delete', exact: true }).click();
  await expect(row).toHaveCount(0);
}

/**
 * Presses an arrow key and holds it for a moment. Radix moves between tabs on
 * keydown, and a press with no time between down and up doesn't always move it.
 */
async function pressHeld(key: string) {
  await page.keyboard.down(key);
  await page.waitForTimeout(80);
  await page.keyboard.up(key);
}

test('boots with a seeded profile and window chrome', async () => {
  await expect(page).toHaveTitle('Xenon Control');
  // First-run seed profile, and the window opens on Home.
  await expect(page.getByTestId('profile-switcher')).toHaveText('Local server');
  await expect(page.getByRole('tab', { name: 'Home', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.screenshot({ path: path.join(shotsDir, '01-boot.png') });
});

test('the sidebar shows the profile, places and status', async () => {
  await expect(page.getByTestId('profile-switcher')).toHaveText('Local server');
  const places = page.getByRole('tablist', { name: 'Places' }).getByRole('tab');
  await expect(places).toHaveCount(4);
  // Each tab is named exactly by its place, whatever badge it carries.
  for (const [i, name] of ['Home', 'Setup', 'Settings', 'Logs'].entries()) {
    await expect(places.nth(i)).toHaveAccessibleName(name);
  }
  // The status is announced politely when it changes, in its exact words ("Stopped", not "Stopped unexpectedly").
  await expect(announcedStatus(page)).toHaveText('Stopped');
  await expect(page.getByTestId('sidebar-status').getByRole('button', { name: 'Stopped', exact: true })).toBeVisible();
});

test('arrow keys move between places', async () => {
  const home = page.getByRole('tab', { name: 'Home', exact: true });
  const setup = page.getByRole('tab', { name: 'Setup', exact: true });
  await openPlace('Home');
  await home.focus();
  await pressHeld('ArrowDown');
  await expect(setup).toBeFocused();
  await expect(setup).toHaveAttribute('aria-selected', 'true');
  await pressHeld('ArrowUp');
  await expect(home).toBeFocused();
  await expect(home).toHaveAttribute('aria-selected', 'true');
});

test('skip to content', async () => {
  // A fresh page, so nothing has had focus yet.
  await page.reload();
  await expect(page.getByTestId('profile-switcher')).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  // Out of sight until it has focus, then on screen.
  expect((await skip.boundingBox())?.width ?? 0).toBeGreaterThan(20);
  // Below the 40 px title bar, where the traffic lights are drawn over the page, and not a drag
  // area, so clicking it follows it rather than moving the window.
  expect((await skip.boundingBox())?.y ?? 0).toBeGreaterThanOrEqual(40);
  expect(await skip.evaluate((el) => getComputedStyle(el).getPropertyValue('-webkit-app-region'))).toBe('no-drag');
  await page.keyboard.press('Enter');
  await expect(page.locator('main#content')).toBeFocused();
});

test('renders the schema-driven settings form with grouped sections', async () => {
  // Settings opens on Essentials; every option of the option list is in All settings, in the catalog's groups.
  await openPlace('Settings');
  await expect(page.getByRole('tab', { name: 'Essentials', exact: true })).toHaveAttribute('aria-selected', 'true');
  await openSettingsTab('All settings');
  for (const name of ['Phones', 'Tests', 'Recording & history', 'Sharing & sign-in', 'AI help', 'Phone health', 'Network', 'Storage & logs']) {
    await expect(page.getByRole('region', { name, exact: true })).toBeVisible();
  }
  // A representative field from the option list, in plain words.
  await expect(page.getByRole('spinbutton', { name: 'Tests at the same time', exact: true })).toBeVisible();
  // Secret-bearing settings point to Keys & accounts rather than offering a box: the three AI keys, the
  // cloud key and the proxy password, and with technical details on, the database file too.
  await expect(secretPointers().first()).toBeVisible();
  await expect(secretPointers()).toHaveCount(5);
  // The line saying which Xenon these options come from (installed or bundled depends on the machine)
  // is a technical detail.
  await expect(page.getByTestId('schema-source')).toHaveCount(0);
  await setTechnical(page, true);
  await expect(page.getByTestId('schema-source')).toContainText(/Xenon \d+\.\d+\.\d+/);
  await expect(secretPointers()).toHaveCount(6);
  // A pointer leads there.
  await page.locator('[data-setting-key="geminiApiKey"]').getByRole('button', { name: 'Open Keys & accounts', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Keys & accounts', exact: true })).toHaveAttribute('aria-selected', 'true');
  await openSettingsTab('All settings');
  await page.screenshot({ path: path.join(shotsDir, '02-settings.png'), fullPage: true });
  // No serious or critical WCAG 2.1 A/AA violation, in dark and in light, the sidebar included.
  await expectAccessibleInBothThemes(page, 'settings');
});

test('the accessibility check reads contrast below the fold of a scroll area, and puts the scroll back', async () => {
  await openPlace('Setup');
  await expect(page.getByText('Node.js')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  // A short scroll area at the end of the place, holding two probes below its
  // fold: near-white text straight on the light page (a contrast failure), and
  // text on a gradient (contrast axe can't work out). Out of the area's view,
  // axe can't see what is behind the first and marks it "incomplete", which the
  // check used to pass.
  const placed = await page.evaluate(() => {
    const tab = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Check again'))?.closest('.overflow-auto');
    if (!(tab instanceof HTMLElement)) throw new Error('No scroll area around Setup');
    const probe = (id: string, text: string, color: string, background?: string) => {
      const box = document.createElement('div');
      if (background) box.style.background = background;
      const p = document.createElement('p');
      p.id = id;
      p.textContent = text;
      p.style.color = color;
      box.append(p);
      return box;
    };
    const area = document.createElement('div');
    area.dataset.a11yProbe = '';
    area.style.cssText = 'height: 120px; overflow: auto;';
    area.tabIndex = 0; // a scroll area must be reachable by keyboard
    const spacer = document.createElement('div');
    spacer.style.height = '600px';
    const low = probe('a11y-probe-low', 'Near-white on the light page, below the fold', 'rgb(232, 233, 236)');
    const gradient = probe(
      'a11y-probe-gradient',
      'Text on a gradient, below the fold',
      'rgb(20, 20, 20)',
      'linear-gradient(90deg, rgb(255, 255, 255), rgb(30, 30, 30))'
    );
    area.append(spacer, low, gradient);
    tab.append(area);
    area.scrollTop = 40;
    return {
      scroll: [tab.scrollTop, area.scrollTop],
      belowFold: low.getBoundingClientRect().top > area.getBoundingClientRect().bottom
    };
  });
  expect(placed.belowFold).toBe(true);

  const scroll = () =>
    page.evaluate(() => {
      const area = document.querySelector<HTMLElement>('[data-a11y-probe]');
      const tab = area?.parentElement;
      return [tab?.scrollTop, area?.scrollTop];
    });
  try {
    // The probes are the only problems found: the grey one failed, the gradient one unmeasured.
    const problems = await accessibilityProblems(page);
    expect(problems.map((line) => line.split('\n'))).toEqual([
      [expect.stringMatching(/^serious color-contrast:/), '    #a11y-probe-low'],
      [expect.stringMatching(/^unmeasured color-contrast \(bgGradient\):/), '    #a11y-probe-gradient']
    ]);
    // Both scroll areas are back where they were.
    expect(await scroll()).toEqual(placed.scroll);
    // And expectAccessible fails on them.
    const failure = await expectAccessible(page, 'probe').then(
      () => 'passed',
      (error: Error) => error.message
    );
    expect(failure).toContain('#a11y-probe-low');
    expect(failure).toContain('#a11y-probe-gradient');
  } finally {
    await page.evaluate(() => document.querySelectorAll('[data-a11y-probe]').forEach((el) => el.remove()));
  }
});

test('persists a setting change through the store', async () => {
  await openSettingsTab('Essentials');
  const phones = page.getByRole('radiogroup', { name: 'Which phones', exact: true });
  const android = phones.getByRole('radio', { name: 'Android', exact: true });
  await android.click();
  await expect(android).toHaveAttribute('aria-checked', 'true');
  await expect.poll(async () => (await storedProfile()).settings.platform).toBe('android');
  // Re-read via a fresh selection round-trip: leave Settings and come back.
  await openPlace('Setup');
  await openPlace('Settings');
  await expect(phones.getByRole('radio', { name: 'Android', exact: true })).toHaveAttribute('aria-checked', 'true');
});

test('a setting changed just before creating a profile is kept', async () => {
  // The save waits 300 ms for typing to stop and holds one edit. Creating a
  // profile didn't save it first, so the new profile's first edit replaced it
  // and the setting was lost.
  // Base path is a technical setting.
  await setTechnical(page, true);
  await openSettingsTab('All settings');
  await page.getByTestId('settings-search').fill('');
  const original = ((await profileSwitcher(page).textContent()) ?? '').trim();
  const platform = page.getByRole('radiogroup', { name: 'Which phones', exact: true });
  const basePath = page.getByRole('textbox', { name: 'Base path', exact: true });
  const previous = (await platform.getByRole('radio', { checked: true }).textContent())?.trim();
  const changed = previous === 'iPhone' ? 'Both' : 'iPhone';

  const clickedAt = Date.now();
  await platform.getByRole('radio', { name: changed, exact: true }).click();
  // File > New Profile is one call, and the new profile's first edit follows at once, with a field
  // that is already on screen: both must land while the platform edit above is still waiting to be
  // saved. (waitForFunction polls on every frame; a web-first assertion would add 100 ms.)
  await clickMenuItem(app, 'File', { label: 'New Profile' });
  await page.waitForFunction(
    () => document.querySelector('[data-testid="profile-switcher"]')?.textContent?.trim() === 'New profile',
    undefined,
    { polling: 'raf' }
  );
  await basePath.fill('/probe/hub');
  const gap = Date.now() - clickedAt;
  // Past 300 ms the platform edit would have been saved by its own timer, and this test would pass
  // without the profile being saved first. Too slow to mean anything is a failure.
  expect(gap, 'the new profile’s first edit came too late to replace the waiting one').toBeLessThan(300);

  await expect.poll(() => page.evaluate(async () => (await window.xenon.profiles.list()).length)).toBe(2);
  await switchProfile(original);
  await expect(platform.getByRole('radio', { name: changed, exact: true })).toHaveAttribute('aria-checked', 'true');

  // Clean up: remove the probe and put the platform back.
  const sheet = await openProfilesSheet();
  await deleteProfile(sheet, 'New profile');
  await closeProfilesSheet();
  await expect(profileSwitcher(page)).toHaveText(original);
  if (previous) await platform.getByRole('radio', { name: previous, exact: true }).click();
});

test('creates, renames, and deletes a profile', async () => {
  await createProfile();

  let sheet = await openProfilesSheet();
  await renameProfile(sheet, 'New profile', 'QA Lab — iOS');
  // The open profile's new name is in the switcher too, and it is the one marked Current.
  await expect(profileSwitcher(page)).toHaveText('QA Lab — iOS');
  await expect(profileRow(sheet, 'QA Lab — iOS').getByText('Current', { exact: true })).toBeVisible();

  // Duplicate copies the profile, named for it, and opens the copy; Delete removes the copy again.
  await profileRow(sheet, 'QA Lab — iOS').getByRole('button', { name: 'Duplicate', exact: true }).click();
  await expect(profileRow(sheet, 'QA Lab — iOS (copy)')).toBeVisible();
  await expect(profileSwitcher(page)).toHaveText('QA Lab — iOS (copy)');
  await deleteProfile(sheet, 'QA Lab — iOS (copy)');
  await page.screenshot({ path: path.join(shotsDir, '03-profiles.png') });
  await closeProfilesSheet();

  // Persisted names show up in the switcher: reselect the seed profile then come back.
  await switchProfile('Local server');
  await switchProfile('QA Lab — iOS');
  const names = await page.evaluate(async () => (await window.xenon.profiles.list()).map((p) => p.name));
  expect(names).toEqual(['Local server', 'QA Lab — iOS']);
});

test('a new profile defaults to booted-only simulator discovery', async () => {
  await createProfile();
  let sheet = await openProfilesSheet();
  await renameProfile(sheet, 'New profile', 'Booted default probe');
  await closeProfilesSheet();
  // In Essentials, and found by its plain label in All settings.
  await openSettingsTab('Essentials');
  await expect(settingSwitch('Only simulators that are already running')).toHaveAttribute('aria-checked', 'true');
  await openSettingsTab('All settings');
  await page.getByTestId('settings-search').fill('Only simulators');
  await expect(settingSwitch('Only simulators that are already running')).toHaveAttribute('aria-checked', 'true');

  // Clean up: remove the probe profile.
  sheet = await openProfilesSheet();
  await deleteProfile(sheet, 'Booted default probe');
  await closeProfilesSheet();
});

test('deleting a profile requires an inline confirmation', async () => {
  await createProfile();
  const sheet = await openProfilesSheet();
  await renameProfile(sheet, 'New profile', 'Delete-me probe');

  const row = await pinRow(sheet, 'Delete-me probe');
  await row.getByRole('button', { name: 'Delete', exact: true }).click();
  // The first click only asks: the row says what is at stake, and nothing is deleted yet.
  await expect(row).toContainText('Delete “Delete-me probe”? Its settings can’t be recovered.');
  const stored = () => page.evaluate(async () => (await window.xenon.profiles.list()).map((p) => p.name));
  // (The rename is saved a moment after it is typed, as any edit to the open profile is.)
  await expect.poll(stored).toContain('Delete-me probe');
  // Cancel keeps the profile, and the safe choice had focus.
  await expect(row.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await row.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(row.getByRole('button', { name: 'Delete', exact: true })).toBeFocused();
  expect(await stored()).toContain('Delete-me probe');

  await row.getByRole('button', { name: 'Delete', exact: true }).click();
  await row.getByRole('button', { name: 'Confirm delete', exact: true }).click();
  await expect(sheet.getByText('Delete-me probe')).toHaveCount(0);
  await expect.poll(stored).not.toContain('Delete-me probe');
  await closeProfilesSheet();
});

test('deleting the open profile right after renaming it does not bring it back', async () => {
  // A rename of the open profile is saved 300 ms later, like any edit. Deleting the profile in that
  // window must drop the save with it, or the save would put the profile back.
  await createProfile();
  const sheet = await openProfilesSheet();
  const row = await pinRow(sheet, 'New profile');
  await row.getByRole('button', { name: 'Rename', exact: true }).click();
  await row.getByTestId('profile-name').fill('Brought-back probe');
  await row.getByTestId('profile-name').press('Enter');
  await row.getByRole('button', { name: 'Delete', exact: true }).click();
  await row.getByRole('button', { name: 'Confirm delete', exact: true }).click();
  await expect(row).toHaveCount(0);
  // Past the save window, on screen and on disk.
  await page.waitForTimeout(900);
  await expect(sheet.getByText('Brought-back probe')).toHaveCount(0);
  const names = await page.evaluate(async () => (await window.xenon.profiles.list()).map((p) => p.name));
  expect(names).not.toContain('Brought-back probe');
  expect(names).not.toContain('New profile');
  await closeProfilesSheet();
});

test('the switcher lists profiles with a summary and switches', async () => {
  // Switching profiles re-reads the whole app (preflight, option list, plugin version). Count the
  // preflights, to see that moving through the list does not.
  type Handler = (...args: unknown[]) => unknown;
  type Spy = { preflightCalls: number; originalPreflight?: Handler };
  await app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
    const g = globalThis as unknown as Spy;
    g.originalPreflight ??= handlers.get('toolchain:preflight');
    const original = g.originalPreflight!;
    g.preflightCalls = 0;
    handlers.set('toolchain:preflight', (...args) => {
      g.preflightCalls++;
      return original(...args);
    });
  });
  const preflights = () => app.evaluate(() => (globalThis as unknown as Spy).preflightCalls);
  try {
    // Deleting the open profile above left the first one open.
    await expect(profileSwitcher(page)).toHaveText('Local server');
    await page.waitForTimeout(500); // a check for the open profile may still be on its way
    let panel = await openSwitcher();
    // The profiles are a radio group, so arrow keys move between them.
    const list = panel.getByRole('radiogroup', { name: 'Profiles', exact: true });
    await expect(list.getByRole('radio')).toHaveCount(2);
    const seed = list.getByRole('radio', { name: 'Local server', exact: true });
    const lab = list.getByRole('radio', { name: 'QA Lab — iOS', exact: true });
    // Each is named by its profile and described by a one-line summary; the open one is checked.
    await expect(seed).toHaveAccessibleDescription(/^(Android|iPhone|Android and iPhone) · port \d+$/);
    await expect(lab).toHaveAccessibleDescription('Android and iPhone · port 4723');
    await expect(seed).toHaveAttribute('aria-checked', 'true');
    await expect(lab).toHaveAttribute('aria-checked', 'false');
    await expect(panel.getByRole('button', { name: 'New profile…', exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Manage profiles…', exact: true })).toBeVisible();

    // Focus starts on the open profile. An arrow key moves the check and nothing else: the switcher
    // still names the open profile, the list stays up, and no check of the other profile runs.
    const before = await preflights();
    await expect(seed).toBeFocused();
    await pressHeld('ArrowDown');
    await expect(lab).toBeFocused();
    await expect(lab).toHaveAttribute('aria-checked', 'true');
    await expect(seed).toHaveAttribute('aria-checked', 'false');
    await expect(profileSwitcher(page)).toHaveText('Local server');
    await expect(panel).toBeVisible();
    await pressHeld('ArrowUp');
    await pressHeld('ArrowDown');
    await expect(lab).toHaveAttribute('aria-checked', 'true');
    await page.waitForTimeout(600);
    expect(await preflights()).toBe(before);

    // Escape closes with the profile unchanged, and the list opens again on the open profile.
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(profileSwitcher(page)).toHaveText('Local server');
    await expect(profileSwitcher(page)).toBeFocused();
    await page.waitForTimeout(600);
    expect(await preflights()).toBe(before);
    panel = await openSwitcher();
    await expect(seed).toHaveAttribute('aria-checked', 'true');
    await expect(lab).toHaveAttribute('aria-checked', 'false');

    // Enter chooses the profile the check is on: it switches and closes, and focus is on the switcher.
    await pressHeld('ArrowDown');
    await expect(lab).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Enter');
    await expect(panel).toHaveCount(0);
    await expect(profileSwitcher(page)).toHaveText('QA Lab — iOS');
    await expect(profileSwitcher(page)).toBeFocused();
    // …and that is the one switch that re-reads the app.
    await expect.poll(preflights).toBeGreaterThan(before);

    // Space chooses too.
    panel = await openSwitcher();
    await expect(lab).toBeFocused();
    await pressHeld('ArrowUp');
    await expect(seed).toHaveAttribute('aria-checked', 'true');
    await expect(profileSwitcher(page)).toHaveText('QA Lab — iOS');
    await page.keyboard.press('Space');
    await expect(panel).toHaveCount(0);
    await expect(profileSwitcher(page)).toHaveText('Local server');
    await expect(profileSwitcher(page)).toBeFocused();

    // A click picks a profile and closes the list.
    panel = await openSwitcher();
    await lab.click();
    await expect(panel).toHaveCount(0);
    await expect(profileSwitcher(page)).toHaveText('QA Lab — iOS');
    await switchProfile('Local server');
  } finally {
    await app.evaluate(({ ipcMain }) => {
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
      const original = (globalThis as unknown as Spy).originalPreflight;
      if (original) handlers.set('toolchain:preflight', original);
    });
  }
});

test('File > Manage Profiles opens the sheet', async () => {
  await clickMenuItem(app, 'File', { label: 'Manage Profiles…' });
  const sheet = profilesSheet();
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId('profile-row')).toHaveCount(2);
  // Each row shows its name and its summary, and the open one says so.
  const lab = profileRow(sheet, 'QA Lab — iOS');
  await expect(lab).toContainText('Android and iPhone · port 4723');
  await expect(lab.getByText('Current', { exact: true })).toHaveCount(0);
  await expect(profileRow(sheet, 'Local server').getByText('Current', { exact: true })).toBeVisible();
  // The words are plain with technical details off.
  await setTechnical(page, false);
  expect(findJargon(await sheet.innerText(), [])).toEqual([]);
  await closeProfilesSheet();
});

test('closing the Profiles sheet returns focus to what opened it', async () => {
  // Watches for the moment the sheet leaves the page and notes what has focus then: focus must
  // already be back, not arrive on a timer a moment later.
  const watchClose = () =>
    page.evaluate(() => {
      const w = window as unknown as { focusAtClose?: string | null };
      w.focusAtClose = undefined;
      const observer = new MutationObserver(() => {
        if (document.querySelector('[role="dialog"]')) return;
        const el = document.activeElement;
        w.focusAtClose = el?.getAttribute('data-testid') ?? el?.getAttribute('role') ?? el?.tagName ?? null;
        observer.disconnect();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });
  const focusAtClose = () =>
    page.evaluate(() => (window as unknown as { focusAtClose?: string | null }).focusAtClose);

  // Opened from the switcher's menu: Escape and the close button both go back to the switcher.
  await openProfilesSheet();
  await watchClose();
  await page.keyboard.press('Escape');
  await expect(profilesSheet()).toHaveCount(0);
  await expect(profileSwitcher(page)).toBeFocused();
  expect(await focusAtClose()).toBe('profile-switcher');

  await openProfilesSheet();
  await profilesSheet().getByRole('button', { name: 'Close panel', exact: true }).click();
  await expect(profilesSheet()).toHaveCount(0);
  await expect(profileSwitcher(page)).toBeFocused();

  // Opened from File > Manage Profiles… while a place tab had focus: back to that tab.
  const settings = page.getByRole('tab', { name: 'Settings', exact: true });
  await settings.focus();
  await clickMenuItem(app, 'File', { label: 'Manage Profiles…' });
  await expect(profilesSheet()).toBeVisible();
  await watchClose();
  await page.keyboard.press('Escape');
  await expect(profilesSheet()).toHaveCount(0);
  await expect(settings).toBeFocused();
  expect(await focusAtClose()).toBe('tab');
});

test('a profile with no name still has a name in the switcher and the sheet', async () => {
  // A profile can come with no name (cleared, or from an imported file). Put two on disk and reload.
  await page.evaluate(async () => {
    const [base] = await window.xenon.profiles.list();
    for (const name of ['', '   ']) {
      await window.xenon.profiles.save({ ...base, id: crypto.randomUUID(), name });
    }
  });
  await page.reload();
  await expect(profileSwitcher(page)).toBeVisible({ timeout: 20_000 });

  const panel = await openSwitcher();
  const untitled = panel.getByRole('radio', { name: 'Untitled profile', exact: true });
  await expect(untitled).toHaveCount(2);
  await untitled.first().click();
  // The button is never an empty name.
  await expect(profileSwitcher(page)).toHaveText('Untitled profile');
  await expect(profileSwitcher(page)).toHaveAccessibleName('Untitled profile');

  // Each row of the sheet says it too, and the question names it the same way.
  const sheet = await openProfilesSheet();
  await expect(sheet.getByTestId('profile-row').filter({ hasText: 'Untitled profile' })).toHaveCount(2);
  await deleteProfileNamed(sheet, 'Untitled profile');
  await deleteProfileNamed(sheet, 'Untitled profile');
  await closeProfilesSheet();
  await expect(profileSwitcher(page)).toHaveText('Local server');
});

test('the switcher and the Profiles sheet pass the accessibility check in both themes', async () => {
  await openPlace('Home');
  await openSwitcher();
  await expectAccessibleInBothThemes(page, 'the profile switcher, open');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Switch profile', exact: true })).toHaveCount(0);

  const sheet = await openProfilesSheet();
  await expectAccessibleInBothThemes(page, 'the Profiles sheet, open');
  // A row being renamed, and one asking to be deleted, are also on screen at times.
  const lab = await pinRow(sheet, 'QA Lab — iOS');
  await lab.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(lab.getByTestId('profile-name')).toBeFocused();
  await expectAccessibleInBothThemes(page, 'the Profiles sheet, renaming');
  await page.keyboard.press('Escape');
  await expect(lab.getByRole('button', { name: 'Rename', exact: true })).toBeFocused();
  await lab.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(lab.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await expectAccessibleInBothThemes(page, 'the Profiles sheet, asking to delete');
  await lab.getByRole('button', { name: 'Cancel', exact: true }).click();
  await closeProfilesSheet();
});

test('Escape while renaming puts the old name back and keeps the sheet open', async () => {
  const sheet = await openProfilesSheet();
  const lab = await pinRow(sheet, 'QA Lab — iOS');
  await lab.getByRole('button', { name: 'Rename', exact: true }).click();
  await lab.getByTestId('profile-name').fill('Typed then abandoned');
  await page.keyboard.press('Escape');
  await expect(profilesSheet()).toBeVisible();
  await expect(profileRow(sheet, 'QA Lab — iOS')).toBeVisible();
  await expect(sheet.getByText('Typed then abandoned')).toHaveCount(0);
  // An empty name changes nothing either.
  await lab.getByRole('button', { name: 'Rename', exact: true }).click();
  await lab.getByTestId('profile-name').fill('  ');
  await lab.getByTestId('profile-name').press('Enter');
  await expect(profileRow(sheet, 'QA Lab — iOS')).toBeVisible();
  // Leaving the box saves what was typed.
  await lab.getByRole('button', { name: 'Rename', exact: true }).click();
  await lab.getByTestId('profile-name').fill('QA Lab — iOS 2');
  await sheet.getByRole('heading', { name: 'Profiles', exact: true }).click();
  await expect(profileRow(sheet, 'QA Lab — iOS 2')).toBeVisible();
  await renameProfile(sheet, 'QA Lab — iOS 2', 'QA Lab — iOS');
  await closeProfilesSheet();
});

test('the Profiles sheet says what an export left out', async () => {
  // A profile that holds a secret-looking environment variable, and a save dialog that picks a file.
  await createProfile();
  let sheet = await openProfilesSheet();
  await renameProfile(sheet, 'New profile', 'Export probe');
  await closeProfilesSheet();
  // Environment variables are technical: All settings' Technical group.
  await setTechnical(page, true);
  await openSettingsTab('All settings');
  await page.getByRole('region', { name: 'Technical', exact: true }).getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByPlaceholder('KEY').first().fill('MY_TOKEN');
  await page.getByPlaceholder('value').first().fill('super-secret-value');

  const dir = mkdtempSync(path.join(os.tmpdir(), 'xenon-export-'));
  const file = path.join(dir, 'probe.xenon-profile.json');
  await app.evaluate(({ dialog }, filePath) => {
    const g = globalThis as unknown as { originalSaveDialog?: typeof dialog.showSaveDialog };
    g.originalSaveDialog ??= dialog.showSaveDialog;
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as typeof dialog.showSaveDialog;
  }, file);
  try {
    await setTechnical(page, false);
    sheet = await openProfilesSheet();
    // The notice's live region is on the sheet before there is a notice, empty, so the notice is
    // announced when it comes into it.
    const live = sheet.locator('[role="status"][aria-live="polite"]');
    await expect(live).toHaveCount(1);
    await expect(live).toHaveText('');
    await sheet.getByRole('button', { name: 'Export…', exact: true }).click();
    // The notice counts the values left out and names none; the file has the name but not the value.
    const notice = sheet.getByRole('status').filter({ hasText: 'secret value' });
    await expect(live).toHaveText('1 secret value was left out — enter it again after importing');
    await expect(notice).toHaveText('1 secret value was left out — enter it again after importing');
    expect(findJargon(await sheet.innerText(), [])).toEqual([]);
    const exported = readFileSync(file, 'utf8');
    expect(exported).not.toContain('super-secret-value');
    expect(JSON.parse(exported).strippedEnv).toEqual(['MY_TOKEN']);
    // With technical details on, the names follow.
    await setTechnical(page, true);
    await expect(notice).toHaveText('1 secret value was left out — enter it again after importing: MY_TOKEN');
    await expectAccessibleInBothThemes(page, 'the Profiles sheet, with the export notice');
    // The notice goes when the sheet does.
    await closeProfilesSheet();
    sheet = await openProfilesSheet();
    await expect(sheet.getByText('secret value')).toHaveCount(0);
    await closeProfilesSheet();

    // File > Export Profile… with the sheet closed opens it, to say so. The sheet's live region must
    // be on the page, empty, before the notice comes into it, or the notice may not be heard: note
    // what the region holds the moment it appears.
    await page.evaluate(() => {
      const g = window as unknown as { regionAtMount?: string | null };
      g.regionAtMount = null;
      const observer = new MutationObserver(() => {
        const region = document.querySelector('[role="dialog"] [role="status"][aria-live="polite"]');
        if (!region) return;
        g.regionAtMount = region.textContent ?? '';
        observer.disconnect();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });
    await clickMenuItem(app, 'File', { label: 'Export Profile…' });
    await expect(profilesSheet()).toBeVisible();
    await expect(profilesSheet().getByText('1 secret value was left out', { exact: false })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { regionAtMount?: string | null }).regionAtMount)).toBe('');
    await expect(live).toHaveText(/^1 secret value was left out/);

    // A cancelled dialog saves nothing and says nothing.
    await app.evaluate(({ dialog }) => {
      dialog.showSaveDialog = (async () => ({ canceled: true, filePath: '' })) as typeof dialog.showSaveDialog;
    });
    await sheet.getByRole('button', { name: 'Export…', exact: true }).click();
    await expect(sheet.getByText('secret value')).toHaveCount(0);

    // Anything else done in the sheet makes the notice old news: a rename takes it away…
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as typeof dialog.showSaveDialog;
    }, file);
    await sheet.getByRole('button', { name: 'Export…', exact: true }).click();
    await expect(notice).toBeVisible();
    await renameProfile(sheet, 'Export probe', 'Export probe renamed');
    await expect(sheet.getByText('secret value')).toHaveCount(0);
    await expect(live).toHaveText('');
    // …and so does opening another profile, from anywhere.
    await sheet.getByRole('button', { name: 'Export…', exact: true }).click();
    await expect(notice).toBeVisible();
    await clickMenuItem(app, 'File', { label: 'New Profile' });
    await expect(profileSwitcher(page)).toHaveText('New profile');
    await expect(sheet.getByText('secret value')).toHaveCount(0);
    await deleteProfile(sheet, 'New profile');
  } finally {
    await app.evaluate(({ dialog }) => {
      const g = globalThis as unknown as { originalSaveDialog?: typeof dialog.showSaveDialog };
      if (g.originalSaveDialog) dialog.showSaveDialog = g.originalSaveDialog;
    });
    await setTechnical(page, false);
    rmSync(dir, { recursive: true, force: true });
  }

  // Clean up: remove the probe.
  await deleteProfile(profilesSheet(), 'Export probe renamed');
  await closeProfilesSheet();
  await expect(profileSwitcher(page)).toHaveText('Local server');
});

test('logs tab is reachable and distinct from the Log Folder button', async () => {
  // The place has role=tab; the folder opener is a button named "Open log folder", with technical details.
  await openPlace('Logs');
  await expect(page.getByRole('button', { name: 'Open log folder', exact: true })).toHaveCount(0);
  await setTechnical(page, true);
  await expect(page.getByRole('button', { name: 'Open log folder', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Logs', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('No output yet. Start the server to see logs.')).toBeVisible();
});

test('invalid JSON in a settings field shows an inline error and keeps the draft', async () => {
  await openSettingsTab('All settings');
  // Object-array fields render a table editor; JSON is the escape hatch.
  await page.getByRole('button', { name: 'Edit as JSON' }).first().click();
  const jsonField = page.getByPlaceholder('JSON').first();
  await jsonField.fill('[{"name": }]');
  await jsonField.blur();
  await expect(page.getByText(/Invalid JSON/).first()).toBeVisible();
  // The draft is preserved so the user can fix it rather than losing their input.
  await expect(jsonField).toHaveValue('[{"name": }]');
  await jsonField.fill('');
  await jsonField.blur();
  await expect(page.getByText(/Invalid JSON/)).not.toBeVisible();
  await page.getByRole('button', { name: 'Edit as table' }).first().click();
});

test('chip editor round-trips a string-array setting', async () => {
  await openSettingsTab('All settings');
  await page.getByTestId('settings-search').fill('Other computers');
  const chipInput = page.getByPlaceholder('add + Enter').first();
  await chipInput.fill('192.168.1.50:5555');
  await chipInput.press('Enter');
  await expect(page.getByText('192.168.1.50:5555')).toBeVisible();

  // Round-trip through the store: leave Settings and come back.
  await openPlace('Setup');
  await openPlace('Settings');
  await page.getByTestId('settings-search').fill('Other computers');
  await expect(page.getByText('192.168.1.50:5555')).toBeVisible();

  await page.getByRole('button', { name: 'Remove 192.168.1.50:5555' }).click();
  await expect(page.getByText('192.168.1.50:5555')).not.toBeVisible();
  await page.getByTestId('settings-search').fill('');
});

test('table editor round-trips an object-array setting', async () => {
  await openSettingsTab('All settings');
  await page.getByTestId('settings-search').fill('Simulators to offer');
  // Its columns are in plain words.
  const table = page.getByRole('group', { name: 'Simulators to offer', exact: true });
  await table.getByRole('button', { name: 'Add row' }).click();
  await expect(table.getByRole('columnheader', { name: 'iOS version', exact: true })).toBeVisible();
  const cell = page.getByRole('textbox', { name: 'Name row 1', exact: true });
  await cell.fill('iPhone 15');
  await cell.blur();

  await openPlace('Setup');
  await openPlace('Settings');
  await page.getByTestId('settings-search').fill('Simulators to offer');
  await expect(page.getByRole('textbox', { name: 'Name row 1', exact: true })).toHaveValue('iPhone 15');

  await page.getByRole('button', { name: 'Remove row' }).first().click();
  await page.getByTestId('settings-search').fill('');
});

test('Escape closes the launch preview modal', async () => {
  await setTechnical(page, true);
  await openSettingsTab('All settings');
  await page.getByTestId('preview-button').click();
  await expect(page.getByText('Launch preview — dry run')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('Launch preview — dry run')).not.toBeVisible();
});

test('launch preview traps Tab focus inside the dialog and restores it on close', async () => {
  await setTechnical(page, true);
  await openSettingsTab('All settings');
  await page.getByTestId('preview-button').click();
  await expect(page.getByText('Launch preview — dry run')).toBeVisible();

  // Tab well past the number of controls in the dialog; focus must never escape.
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    const inside = await page.evaluate(
      () => !!document.activeElement?.closest('[role="dialog"]')
    );
    expect(inside, `focus escaped the dialog on Tab #${i + 1}`).toBe(true);
  }
  // Shift+Tab wraps backwards without escaping either.
  await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);

  await page.keyboard.press('Escape');
  await expect(page.getByText('Launch preview — dry run')).not.toBeVisible();
  // Focus returns to the control that opened the modal.
  expect(await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe('preview-button');
});

test('clearing the port shows an error and blocks Start without storing NaN', async () => {
  const port = await openPort();
  const stored = () =>
    page.evaluate(async () => (await window.xenon.profiles.list()).find((p) => p.name === 'Local server')?.server.port);
  const lastGood = await stored();
  expect(typeof lastGood).toBe('number');

  await port.fill('');
  await expect(port).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Port: Port is required.')).toBeVisible();
  await expect(page.getByTestId('start-button')).toBeDisabled();
  // The sidebar says why, under Start and as its tooltip.
  await expect(page.getByText('Fix 1 setting first: Port')).toBeVisible();
  await expect(page.getByTestId('start-button')).toHaveAttribute('title', 'Fix 1 setting first: Port');

  // The invalid draft never reached the store: past the save's 300 ms wait it
  // still holds the last good port, rather than null or NaN.
  await page.waitForTimeout(500);
  expect(await stored()).toBe(lastGood);
  await port.fill(String(freePort));
  await expect(page.getByTestId('start-button')).toBeEnabled();
});

test('⌘Return with an invalid port does not start and focuses the port field', async () => {
  const port = await openPort();
  await port.fill('');
  await expect(page.getByText('Fix 1 setting first: Port')).toBeVisible();
  // Somewhere else entirely, so landing on the port is the shortcut's doing.
  await openPlace('Home');
  await expect(port).toHaveCount(0);

  await pressStartShortcut();
  await expect(page.getByRole('tab', { name: 'Settings', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(portField()).toBeFocused();
  await expect(announcedStatus(page)).toHaveText('Stopped');
  await expect(page.getByTestId('stop-button')).toHaveCount(0);

  await portField().fill(String(freePort));
  await expect(page.getByTestId('start-button')).toBeEnabled();
});

test('a port in use blocks Start with a plain reason and clears on its own', async () => {
  const taken = net.createServer();
  await new Promise<void>((resolve) => taken.listen(4799, resolve));
  let released = false;
  const setupTab = page.getByRole('tab', { name: 'Setup', exact: true });
  try {
    const port = await openPort();
    await port.fill('4799');
    const reason = 'Port 4799 is already in use by another app. Choose another port or close that app.';
    await expect(page.getByText(reason)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('start-button')).toBeDisabled();
    await expect(page.getByTestId('start-button')).toHaveAttribute('title', reason);
    // Setup carries its "!", which is the tab's description: its name is still just the place.
    await expect(setupTab).toHaveAccessibleName('Setup');
    await expect(setupTab).toHaveAccessibleDescription('Needs attention');
    // A pointer is told what the "!" means too.
    await expect(setupTab.locator('[title="Needs attention"]')).toHaveText('!');

    await new Promise((resolve) => taken.close(resolve));
    released = true;
    // Nothing in the app changed: coming back to the window is what re-checks.
    await page.evaluate(() => window.dispatchEvent(new FocusEvent('focus')));
    await expect(page.getByTestId('start-button')).toBeEnabled({ timeout: 2_000 });
    await expect(page.getByText(reason)).toHaveCount(0);
    await expect(setupTab).toHaveAccessibleDescription('');
  } finally {
    if (!released) await new Promise((resolve) => taken.close(resolve));
    await portField().fill(String(freePort));
  }
});

test('the Logs "Start server" link takes the same path as Start', async () => {
  const port = await openPort();
  await port.fill('');
  await openPlace('Logs');
  await page.getByRole('button', { name: 'Start server' }).click();
  // The port is in Settings, so the start goes there and puts the cursor in it.
  await expect(page.getByRole('tab', { name: 'Settings', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(portField()).toBeFocused();
  await expect(announcedStatus(page)).toHaveText('Stopped');

  await portField().fill(String(freePort));
});

test('profile edits survive a rapid-typing debounce window', async () => {
  // The base path is a text box whose edits are saved 300 ms after typing stops (a technical setting).
  await setTechnical(page, true);
  await openSettingsTab('All settings');
  const basePath = page.getByRole('textbox', { name: 'Base path', exact: true });
  const original = await basePath.inputValue();
  await basePath.fill('');
  // pressSequentially fires one input event per character — the save is debounced.
  await basePath.pressSequentially('/debounced/hub', { delay: 15 });
  // Switching profiles flushes the pending write; coming back proves it landed.
  await switchProfile('QA Lab — iOS');
  await expect(basePath).toHaveValue('/wd/hub');
  await switchProfile('Local server');
  await expect(basePath).toHaveValue('/debounced/hub');
  await basePath.fill(original);
  await expect(basePath).toHaveValue(original);
});

test('a save coming back does not overwrite what is typed after it went out', async () => {
  // A save takes 250 ms to be answered here. Type "/a", pause past the 300 ms so its save goes out,
  // type "b" while it is out, and "c" after it comes back: all three letters must be kept. The
  // answer used to put the draft back to "/a", and "c" was then typed on that.
  await setTechnical(page, true);
  const port = await openPort();
  const originalPort = await port.inputValue();
  const testsAtOnce = page.getByRole('spinbutton', { name: 'Tests at the same time', exact: true });
  const originalTests = await testsAtOnce.inputValue();
  await openSettingsTab('All settings');
  const basePath = page.getByRole('textbox', { name: 'Base path', exact: true });
  const original = await basePath.inputValue();
  type Handler = (...args: unknown[]) => unknown;
  type Slow = { originalSave?: Handler };
  const stored = () =>
    page.evaluate(async () => (await window.xenon.profiles.list()).find((p) => p.name === 'Local server')?.server.basePath);
  await app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
    const g = globalThis as unknown as Slow;
    g.originalSave ??= handlers.get('profiles:save');
    const save = g.originalSave!;
    handlers.set('profiles:save', async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 250));
      return save(...args);
    });
  });
  try {
    await basePath.fill('/a');
    await page.waitForTimeout(350); // its save went out at 300 ms and is still out
    await basePath.pressSequentially('b');
    await page.waitForTimeout(450); // …and has been answered by now
    // Read once, not retried: the old answer put "/a" back on screen for a moment, which a retry would wait out.
    expect(await basePath.inputValue(), 'the answer to the first save took the "b" off the screen').toBe('/ab');
    await basePath.pressSequentially('c');
    await expect(basePath).toHaveValue('/abc');
    await expect.poll(stored, { timeout: 5_000 }).toBe('/abc');

    // The port box keeps its own text, which an answer must not overwrite either: an emptied box is
    // still empty after the save of another edit comes back.
    await openSettingsTab('Essentials');
    await port.fill('');
    const otherTests = originalTests === '7' ? '6' : '7';
    await testsAtOnce.fill(otherTests);
    await testsAtOnce.press('Enter');
    await page.waitForTimeout(900);
    await expect(port).toHaveValue('');
    await expect.poll(async () => (await storedProfile()).settings.maxSessions, { timeout: 5_000 }).toBe(Number(otherTests));
  } finally {
    await app.evaluate(({ ipcMain }) => {
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
      const save = (globalThis as unknown as Slow).originalSave;
      if (save) handlers.set('profiles:save', save);
    });
    await openSettingsTab('Essentials');
    await port.fill(originalPort);
    await testsAtOnce.fill(originalTests);
    await testsAtOnce.press('Enter');
    await openSettingsTab('All settings');
    await basePath.fill(original);
    await expect.poll(stored, { timeout: 5_000 }).toBe(original);
  }
});

test('log console shows a line count, Clear button and start CTA when empty', async () => {
  await openPlace('Logs');
  await expect(page.getByText(/0 lines/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Clear', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Start server' })).toBeVisible();
});

test('Home and Logs pass the accessibility check in both themes', async () => {
  await openPlace('Home');
  await expectAccessibleInBothThemes(page, 'home');
  await openPlace('Logs');
  await expectAccessibleInBothThemes(page, 'logs');
});

test('All settings search finds by label, and by raw name only with technical details', async () => {
  await openSettingsTab('All settings');
  const search = page.getByTestId('settings-search');
  await expect(search).toHaveAttribute('placeholder', 'Search settings');
  const otherComputers = page.getByText('Other computers with Android phones', { exact: true });
  const testsAtOnce = page.getByRole('spinbutton', { name: 'Tests at the same time', exact: true });

  // By its label (any case), and by its help.
  await search.fill('other computers');
  await expect(otherComputers).toBeVisible();
  await expect(testsAtOnce).toHaveCount(0);
  await search.fill('wait their turn');
  await expect(testsAtOnce).toBeVisible();

  // Its raw name finds nothing with technical details off…
  await search.fill('adbRemote');
  await expect(page.getByText('No settings match ‘adbRemote’.', { exact: true })).toBeVisible();
  await expect(otherComputers).toHaveCount(0);
  // …and finds it with them on, its raw name beside it.
  await setTechnical(page, true);
  await expect(otherComputers).toBeVisible();
  await expect(page.locator('[data-setting-key="adbRemote"]').getByText('adbRemote', { exact: true })).toBeVisible();
  await expect(testsAtOnce).toHaveCount(0);

  await search.fill('zzz-no-match');
  await expect(page.getByText(/No settings match/)).toBeVisible();
  await search.fill('');
  await expect(testsAtOnce).toBeVisible();
});

test('the sidebar status says Stopped, and Setup names the installed Xenon', async () => {
  await expect(announcedStatus(page)).toHaveText('Stopped');
  // A definite answer, not a pending placeholder: either a version read from
  // this machine's Appium folder or an explicit "isn't installed".
  await openPlace('Setup');
  await expect(page.getByTestId('plugin-version')).toHaveText(/^Xenon (\d+\.\d+\.\d+ is installed|isn’t installed yet)$/);
});

test('Keys & accounts lists every Keychain secret in plain words, and Used by this profile follows the profile', async () => {
  // Nothing here saves a value: this suite runs on the Mac's own Keychain (keychain.e2e has a stand-in).
  await openSettingsTab('Keys & accounts');
  const keys = page.getByRole('tabpanel', { name: 'Keys & accounts', exact: true }).getByRole('region');
  const everyday = [
    'Gemini key',
    'OpenAI key',
    'Claude key',
    'Hub access key',
    'Hub token',
    'Email for password resets',
    // Each profile's own (R54).
    'Cloud access key — for this profile',
    'Proxy password — for this profile'
  ];
  await expect(keys).toHaveCount(everyday.length);
  for (const [i, name] of everyday.entries()) await expect(keys.nth(i)).toHaveAccessibleName(name);
  const gemini = page.getByRole('region', { name: 'Gemini key', exact: true });
  await expect(gemini).toContainText('Lets AI repair broken element lookups with Gemini.');
  await expect(gemini.getByText(/^(Saved|Not set)$/)).toBeVisible();
  // The environment names are technical details.
  await expect(page.getByText('XENON_HUB_TOKEN')).toHaveCount(0);
  // The cloud key and the proxy password are the profile's own: nothing to turn on.
  await expect(page.getByRole('switch', { name: /^Used by this profile: / })).toHaveCount(everyday.length - 2);
  await expect(settingSwitch('Used by this profile: Cloud access key')).toHaveCount(0);
  await expect(settingSwitch('Used by this profile: Proxy password')).toHaveCount(0);

  // Used by this profile, named for its secret, is the profile's own.
  const used = settingSwitch('Used by this profile: Gemini key');
  const before = (await storedProfile()).secretRefs.includes('XENON_GEMINI_API_KEY');
  await used.click();
  await expect(used).toHaveAttribute('aria-checked', String(!before));
  await expect.poll(async () => (await storedProfile()).secretRefs.includes('XENON_GEMINI_API_KEY')).toBe(!before);
  await page.screenshot({ path: path.join(shotsDir, '04-secrets.png'), fullPage: true });
  await used.click();
  await expect.poll(async () => (await storedProfile()).secretRefs.includes('XENON_GEMINI_API_KEY')).toBe(before);

  // With technical details on: each secret's environment name, and the database file last.
  await setTechnical(page, true);
  await expect(page.getByText('XENON_HUB_TOKEN', { exact: true })).toBeVisible();
  await expect(keys).toHaveCount(everyday.length + 1);
  await expect(keys.last()).toHaveAccessibleName('Database file');
});

test('env-vars editor adds an arbitrary variable to the profile', async () => {
  // In All settings' Technical group, with technical details on.
  await setTechnical(page, true);
  await openSettingsTab('All settings');
  const technical = page.getByRole('region', { name: 'Technical', exact: true });
  await expect(technical.getByRole('heading', { name: 'Environment variables' })).toBeVisible();
  await technical.getByRole('button', { name: 'Add', exact: true }).click();
  const keyInput = page.getByPlaceholder('KEY').first();
  await keyInput.fill('OTEL_EXPORTER_OTLP_ENDPOINT');
  await expect(keyInput).toHaveValue('OTEL_EXPORTER_OTLP_ENDPOINT');
  await expect(page.getByText(/saved in the profile as plain text/)).toHaveCount(0);
  // A variable named like a secret is pointed at its Keychain-backed row (A5's warning).
  await keyInput.fill('DATABASE_URL');
  await expect(page.getByText(/DATABASE_URL belongs in Keys & accounts, under Database file/)).toBeVisible();
  // PROXY_PASSWORD is not the proxy's password (R38): nothing sends it to Keys & accounts.
  await keyInput.fill('PROXY_PASSWORD');
  await expect(keyInput).toHaveValue('PROXY_PASSWORD');
  await expect(page.getByText(/belongs in Keys & accounts/)).toHaveCount(0);
  await keyInput.fill('OTEL_EXPORTER_OTLP_ENDPOINT');
  await expect(page.getByText(/saved in the profile as plain text/)).toHaveCount(0);
  await expect.poll(async () => Object.keys((await storedProfile()).env)).toContain('OTEL_EXPORTER_OTLP_ENDPOINT');
});

test('launch preview shows the resolved config', async () => {
  await setTechnical(page, true);
  await openSettingsTab('All settings');
  await page.getByTestId('preview-button').click();
  await expect(page.getByText('Launch preview — dry run')).toBeVisible();
  // Which legacy defaults are written depends on the Xenon installed on this
  // machine (a plugin without a `required` list gets none), so assert only
  // what every install produces.
  const configBlock = page.locator('pre');
  await expect(configBlock).toContainText('use-plugins');
  await expect(configBlock).toContainText('xenon:');
  await page.screenshot({ path: path.join(shotsDir, '07-preview.png') });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
});

test('copying the preview config shows a toast', async () => {
  await setTechnical(page, true);
  await openSettingsTab('All settings');
  await page.getByTestId('preview-button').click();
  await expect(page.getByText('Launch preview — dry run')).toBeVisible();
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(page.getByText('Config copied')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('Launch preview — dry run')).not.toBeVisible();
});

test('invalid config produces a validation issue and disables Start', async () => {
  // Start has two gates: validation, which answers at once, and the readiness
  // check that runs in the background. The invalid port turns Start off
  // immediately; the valid one brings it back once the readiness check agrees.
  const portInput = await openPort();
  await portInput.fill('70000'); // out of 1..65535 range
  await expect(page.getByText(/validation issue/i).first()).toBeVisible();
  await expect(page.getByTestId('start-button')).toBeDisabled();
  await page.screenshot({ path: path.join(shotsDir, '08-validation.png'), fullPage: true });
  await portInput.fill(String(freePort)); // restore
  await expect(page.getByTestId('start-button')).toBeEnabled();
});

/** One of Setup's rows, by its row id (node, appium, android-tools, xcode, xenon, android-support, ios-support, iphone-support). */
const setupRow = (id: string) => page.getByTestId(`setup-row-${id}`);
/** The one Set up button, under the groups. */
const setUpButton = () => page.getByTestId('setup-run');

test('Setup lists plain checks', async () => {
  await openPlace('Setup');
  await expect(setupRow('node')).toContainText('is ready.', { timeout: 20_000 });
  await expect(setupRow('appium')).toContainText('is ready.');
  await expect(page.getByRole('heading', { level: 1, name: 'Setup', exact: true })).toBeVisible();
  await expect(page.getByText(/^Everything this Mac needs to run tests\. Checked (just now|\d+ minutes? ago)\.$/)).toBeVisible();
  // Three checklists, each a named group: This Mac, Xenon, Phones.
  for (const name of ['This Mac', 'Xenon', 'Phones']) {
    await expect(page.getByRole('region', { name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('region', { name: 'This Mac', exact: true }).getByTestId('setup-row-node')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Xenon', exact: true }).getByTestId('plugin-version')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Phones', exact: true }).getByTestId('setup-row-android-support')).toBeVisible();
  // With technical details off, no row shows its raw words, and the whole window is in plain words.
  await expect(page.locator('[data-testid^="setup-row-"] [data-raw]')).toHaveCount(0);
  expect(findJargon(await ownWords(page), await optionKeys(page))).toEqual([]);
});

test('Setup announces a re-check once, as a summary, not row by row', async () => {
  await openPlace('Setup');
  await expect(setupRow('node')).toBeVisible({ timeout: 20_000 });
  const panel = page.getByRole('tabpanel', { name: 'Setup', exact: true });
  // One polite region on the screen; no row is a region of its own.
  await expect(panel.locator('[role="status"]')).toHaveCount(1);
  await expect(setupRow('node')).not.toHaveAttribute('role', 'status');
  const announced = panel.locator('[role="status"][aria-live="polite"]');
  const checkAgain = page.getByTestId('setup-check-again');
  await expect(checkAgain).toHaveText('Check again');
  await checkAgain.click();
  await expect(announced).toHaveText(/^(All checks passed\.|1 thing needs attention\.|\d+ things need attention\.)$/, {
    timeout: 20_000
  });
  // Check again keeps focus while it looks, and the time under the title is the new check's.
  await expect(checkAgain).toBeFocused();
  await expect(page.getByText('Everything this Mac needs to run tests. Checked just now.')).toBeVisible();
});

test('Setup runs toolchain checks', async () => {
  await openPlace('Setup');
  await expect(setupRow('node')).toBeVisible({ timeout: 20_000 });
  await expect(setupRow('appium')).toBeVisible();
  // The ports row for simulators and WebDriverAgent is retired: the plugin chooses those itself.
  await expect(page.getByText('Simulator / WDA ports')).toHaveCount(0);
  // The button says "Set up this Mac", under the groups, with what it does; the server is stopped here.
  await expect(setUpButton()).toHaveText('Set up this Mac');
  await expect(setUpButton()).toBeEnabled();
  await expect(setUpButton()).toHaveAccessibleDescription('Installs or updates whatever is missing.');
  await page.screenshot({ path: path.join(shotsDir, '05-setup.png'), fullPage: true });
  // No serious or critical WCAG 2.1 A/AA problem in either theme, contrast
  // included down the whole place, and nothing left out.
  await expectAccessibleInBothThemes(page, 'setup');
});

test('technical details show a row’s command with Copy, and the Android folder', async () => {
  // An Appium folder with nothing in it: no Xenon and no drivers, so Android support needs Set up
  // and its details give the command. Pinned in the profile, so the row says where it came from.
  const emptyHome = mkdtempSync(path.join(os.tmpdir(), 'xenon-empty-home-'));
  try {
    await setTechnical(page, true);
    await openSettingsTab('All settings');
    await page.getByTestId('appium-home').fill(emptyHome);
    await openPlace('Setup');

    // The Android folder the launcher injects, in the Android tools row's details.
    await expect(setupRow('android-tools')).toContainText(/ANDROID_HOME=|no Android SDK detected|SDK root could be resolved/, {
      timeout: 25_000
    });
    const android = setupRow('android-support');
    await expect(android).toContainText('Android support isn’t installed yet.', { timeout: 25_000 });
    await expect(android).toContainText('appium driver install uiautomator2');
    // Its own fix is shown too, in the mono face with the rest of the details.
    await expect(android.locator('[data-raw]')).toContainText('Install the platform drivers you need');
    await expect(android.locator('[data-raw]')).toHaveCSS('font-family', /JetBrains Mono/);

    await app.evaluate(({ clipboard }) => clipboard.writeText(''));
    await android.getByRole('button', { name: 'Copy the Android support command', exact: true }).click();
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('appium driver install uiautomator2');
    await expect(page.getByRole('status').getByText('Copied', { exact: true }).last()).toBeVisible();

    // The Xenon row names the Appium folder it looked in, and how that folder was chosen.
    await expect(setupRow('xenon')).toContainText(`Appium folder: ${emptyHome} (set in this profile)`);
    await expect(page.getByTestId('plugin-version')).toHaveText('Xenon isn’t installed yet');
    await expectAccessibleInBothThemes(page, 'setup, technical details on');

    // With technical details off, none of it shows.
    await setTechnical(page, false);
    await expect(android).toContainText('Android support isn’t installed yet.');
    await expect(android).not.toContainText('appium driver install');
    await expect(setupRow('android-tools')).not.toContainText('ANDROID_HOME');
    await expect(setupRow('xenon')).not.toContainText('Appium folder');
    expect(findJargon(await ownWords(page), await optionKeys(page))).toEqual([]);
  } finally {
    await setTechnical(page, true);
    await openSettingsTab('All settings');
    await page.getByTestId('appium-home').fill('');
    rmSync(emptyHome, { recursive: true, force: true });
  }
});

test('APPIUM_HOME auto-detects a home on this host', async () => {
  await setTechnical(page, true);
  await openSettingsTab('All settings');
  const input = page.getByTestId('appium-home');
  await expect(input).toHaveValue(''); // '' means auto — profiles stay portable
  // The placeholder shows what auto actually resolved to, so it isn't magic.
  await expect(input).toHaveAttribute('placeholder', /^auto: \//);
});

test('preflight blocks Start and surfaces blockers when the plugin is not installed', async () => {
  // Pin an Appium folder that definitely has no plugin. Without this the test is
  // host-dependent: auto-detection finds a real plugin-bearing home on a
  // developer machine, but not on CI.
  const emptyHome = mkdtempSync(path.join(os.tmpdir(), 'xenon-empty-home-'));
  await setTechnical(page, true);
  await openSettingsTab('All settings');
  await page.getByTestId('appium-home').fill(emptyHome);

  // Nobody pressed Start: the folder edit alone re-checks and turns it off.
  const start = page.getByTestId('start-button');
  await expect(start).toBeDisabled({ timeout: 25_000 });
  const reason = /Run Set up first|Port .* is already in use by another app/;
  await expect(start).toHaveAttribute('title', reason);

  // The shortcut doesn't start it either: it takes you to Setup.
  await pressStartShortcut();
  await expect(page.getByRole('tab', { name: 'Setup', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('readiness-blockers').getByText(reason).first()).toBeVisible();
  // The Xenon row says the same in its own words, and offers Set up.
  await expect(setupRow('xenon')).toContainText('Xenon isn’t installed yet');
  await expect(setupRow('xenon').getByRole('button', { name: 'Set up this Mac', exact: true })).toBeVisible();
  await expect(announcedStatus(page)).toHaveText('Stopped');
  await page.screenshot({ path: path.join(shotsDir, '06-preflight-block.png'), fullPage: true });
  // The blocker box reads in both themes (its words were danger-on-tint, 4.48:1 in light).
  await expectAccessibleInBothThemes(page, 'setup with blockers');
  // Home says the Mac is not ready: it needs Set up, or the port is taken.
  await openPlace('Home');
  await expect(page.getByTestId('home-title')).toHaveText(/^(Let’s get this Mac ready|Can’t start yet)$/);

  // Back to auto: the folder edit re-checks and Start comes back by itself.
  await openSettingsTab('All settings');
  await page.getByTestId('appium-home').fill('');
  await expect(start).toBeEnabled({ timeout: 25_000 });
  await openPlace('Setup');
  await expect(page.getByTestId('readiness-blockers')).toHaveCount(0);
});

test('Setup re-reads the plugin version when it changes underneath the app', async () => {
  // The reported bug: a launcher left open across `appium plugin update xenon`
  // in a terminal kept showing the version it read at launch — `plugin 1.18.1`
  // beside a server whose own banner said v1.20.0. Nothing re-read it.
  const home = mkdtempSync(path.join(os.tmpdir(), 'xenon-ver-home-'));
  const pkgDir = path.join(home, 'node_modules', '@xenon-device-management', 'xenon');
  mkdirSync(pkgDir, { recursive: true });
  const pkgJson = path.join(pkgDir, 'package.json');
  writeFileSync(pkgJson, JSON.stringify({ name: '@xenon-device-management/xenon', version: '1.0.0' }));

  await setTechnical(page, true);
  await openSettingsTab('All settings');
  await page.getByTestId('appium-home').fill(home);
  await openPlace('Setup');
  // The Xenon row's sentence, in the Xenon group, where the old footer's version line was.
  const version = setupRow('xenon').getByTestId('plugin-version');
  await expect(version).toHaveText('Xenon 1.0.0 is installed');

  // Upgrade it the way a terminal would — behind the app's back.
  writeFileSync(pkgJson, JSON.stringify({ name: '@xenon-device-management/xenon', version: '2.0.0' }));
  await expect(version).toHaveText('Xenon 1.0.0 is installed'); // still stale…
  await page.evaluate(() => window.dispatchEvent(new FocusEvent('focus')));
  await expect(version).toHaveText('Xenon 2.0.0 is installed'); // …until focus

  // And an Appium folder with no plugin says so, rather than naming a version.
  rmSync(pkgDir, { recursive: true, force: true });
  await page.evaluate(() => window.dispatchEvent(new FocusEvent('focus')));
  await expect(version).toHaveText('Xenon isn’t installed yet');

  await openSettingsTab('All settings');
  await page.getByTestId('appium-home').fill(''); // back to auto
  rmSync(home, { recursive: true, force: true });
});

test('after the Appium folder changes, Setup never says Xenon is installed beside “Run Set up first”', async () => {
  // Two Appium folders: one whose disk says Xenon 2.17.0 is there, one empty. Xenon's version is read
  // from disk at once; the check is stood in for in main, a moment slow and by folder, as the real one
  // is (debounced, then several seconds). Until the check of the new folder is back, what depends on
  // the folder shows as checking, so the two never disagree on screen.
  const setUpHome = mkdtempSync(path.join(os.tmpdir(), 'xenon-set-home-'));
  const pkgDir = path.join(setUpHome, 'node_modules', '@xenon-device-management', 'xenon');
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: '@xenon-device-management/xenon', version: '2.17.0' }));
  const emptyHome = mkdtempSync(path.join(os.tmpdir(), 'xenon-empty-home-'));
  await keepRealHandlers(['toolchain:preflight']);
  await app.evaluate(({ ipcMain }, setUpHome) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
    const ok = (id: string, label: string, detail: string) => ({ id, label, status: 'ok', code: 'ok', detail, blocking: false });
    handlers.set('toolchain:preflight', async (_event: unknown, profile: { server: { appiumHome: string } }) => {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      const setUp = profile.server.appiumHome === setUpHome;
      return {
        ok: setUp,
        checks: [
          ok('node', 'Node.js', 'v22.12.0'),
          ok('appium', 'Appium', '3.1.1'),
          ok('drivers', 'Appium drivers', setUp ? 'installed: uiautomator2, xcuitest' : 'installed: none'),
          ok('adb', 'Android SDK (adb)', 'Android Debug Bridge version 1.0.41 — ANDROID_HOME=/sdk'),
          ok('xcode', 'Xcode', 'Xcode 16.0'),
          ok('go-ios', 'iPhone support', 'Ready for iPhones')
        ],
        blockers: setUp ? [] : ["Run Set up first. Xenon isn't installed in the Appium folder this profile uses."]
      };
    });
  }, setUpHome);
  // Every change to the page is looked at: the Xenon row's sentence beside the reasons Start is off.
  await page.evaluate(() => {
    const w = window as unknown as { clashes: string[]; xenonSaid: string[]; folderWatch?: MutationObserver };
    w.clashes = [];
    w.xenonSaid = [];
    const look = () => {
      const xenon = document.querySelector('[data-testid="plugin-version"]')?.textContent ?? '';
      const banner = document.querySelector('[data-testid="readiness-blockers"]')?.textContent ?? '';
      if (xenon !== '' && w.xenonSaid.at(-1) !== xenon) w.xenonSaid.push(xenon);
      if (xenon.includes('Xenon 2.17.0 is installed') && banner.includes('Run Set up first')) w.clashes.push(`${xenon} | ${banner}`);
    };
    w.folderWatch = new MutationObserver(look);
    w.folderWatch.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  });
  const useFolder = async (folder: string) => {
    await setTechnical(page, true);
    await openSettingsTab('All settings');
    await page.getByTestId('appium-home').fill(folder);
    await openPlace('Setup');
  };
  const banner = page.getByTestId('readiness-blockers');
  const xenon = page.getByTestId('plugin-version');
  const phones = page.getByRole('region', { name: 'Phones', exact: true });
  try {
    await useFolder(emptyHome);
    await expect(xenon).toHaveText('Xenon isn’t installed yet', { timeout: 20_000 });
    await expect(banner).toContainText('Run Set up first');

    // To the set-up folder: its version is read at once, but the answer on screen is the empty one's.
    await useFolder(setUpHome);
    await expect(xenon).toHaveText('Checking Xenon…');
    await expect(phones.getByText('Checking…', { exact: true })).toBeVisible();
    await expect(page.getByTestId('setup-check-again').locator('.animate-spin')).toHaveCount(1);
    await expect(xenon).toHaveText('Xenon 2.17.0 is installed', { timeout: 20_000 });
    await expect(banner).toHaveCount(0);
    await expect(setupRow('android-support')).toContainText('Android support is installed.');

    // And back to the empty one.
    await useFolder(emptyHome);
    await expect(xenon).toHaveText('Checking Xenon…');
    await expect(xenon).toHaveText('Xenon isn’t installed yet', { timeout: 20_000 });
    await expect(banner).toContainText('Run Set up first');

    const seen = await page.evaluate(() => {
      const w = window as unknown as { clashes: string[]; xenonSaid: string[] };
      return { clashes: w.clashes, xenonSaid: w.xenonSaid };
    });
    expect(seen.clashes).toEqual([]);
    expect(seen.xenonSaid).toContain('Xenon 2.17.0 is installed');
  } finally {
    await page.evaluate(() => (window as unknown as { folderWatch?: MutationObserver }).folderWatch?.disconnect());
    await restoreHandlers();
    await setTechnical(page, true);
    await openSettingsTab('All settings');
    await page.getByTestId('appium-home').fill('');
    rmSync(setUpHome, { recursive: true, force: true });
    rmSync(emptyHome, { recursive: true, force: true });
  }
});

test('a check that could not run keeps This Mac, with one row that says so and Check again', async () => {
  await keepRealHandlers(['toolchain:preflight']);
  await app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
    handlers.set('toolchain:preflight', async () => {
      throw new Error('stand-in: the check could not run');
    });
  });
  try {
    await openPlace('Setup');
    await page.getByTestId('setup-check-again').click();
    const mac = page.getByRole('region', { name: 'This Mac', exact: true });
    await expect(mac.getByTestId('setup-row-mac')).toContainText('Couldn’t check this Mac.', { timeout: 15_000 });
    await expect(mac.getByTestId('setup-row-mac').getByRole('button', { name: 'Check again', exact: true })).toBeVisible();
    await expect(page.getByTestId('readiness-blockers')).toContainText("Couldn't check whether this Mac is ready.");
    expect(findJargon(await ownWords(page), await optionKeys(page))).toEqual([]);
    await expectAccessibleInBothThemes(page, 'setup, check could not run');

    // The check can run again. The row's Check again, from the keyboard: the row goes with the
    // Mac's own rows in its place, and focus goes to the first of them, not nowhere.
    await restoreHandlers();
    const again = mac.getByTestId('setup-row-mac').getByRole('button', { name: 'Check again', exact: true });
    await again.focus();
    await page.keyboard.press('Enter');
    await expect(setupRow('node')).toBeVisible({ timeout: 20_000 });
    await expect(mac.getByTestId('setup-row-mac')).toHaveCount(0);
    await expect(setupRow('node').locator('[data-row-sentence]')).toBeFocused();
  } finally {
    await restoreHandlers();
    await page.evaluate(() => window.dispatchEvent(new FocusEvent('focus')));
    await expect(setupRow('node')).toBeVisible({ timeout: 20_000 });
  }
});

test('the window follows the appearance preference', async () => {
  const html = page.locator('html');
  // The View > Appearance radio that is on, as the main process built it.
  const checkedAppearance = () =>
    app.evaluate(({ Menu }) => {
      const view = Menu.getApplicationMenu()?.items.find((i) => i.label === 'View');
      const appearance = view?.submenu?.items.find((i) => i.label === 'Appearance');
      return appearance?.submenu?.items.filter((i) => i.checked).map((i) => i.label);
    });

  try {
    // Playwright pins an Electron window to a light scheme unless told
    // otherwise, which would hide what nativeTheme does. Hand the choice back
    // to the app, as it is for a person.
    await page.emulateMedia({ colorScheme: null });

    // A fixed choice wins over the Mac's setting.
    await setAppearance(page, 'light');
    await expect(html).toHaveAttribute('data-theme', 'light', { timeout: 2_000 });
    await expect.poll(checkedAppearance).toEqual(['Light']);
    await setAppearance(page, 'dark');
    await expect(html).toHaveAttribute('data-theme', 'dark', { timeout: 2_000 });
    await expect.poll(checkedAppearance).toEqual(['Dark']);
    // The choice is saved, not only applied.
    expect(await page.evaluate(() => window.xenon.prefs.get())).toMatchObject({ appearance: 'dark' });

    // The View > Appearance menu does the same: it saves, the window follows,
    // and the menu is redrawn with the new choice on.
    await app.evaluate(({ Menu }) => {
      const view = Menu.getApplicationMenu()?.items.find((i) => i.label === 'View');
      const appearance = view?.submenu?.items.find((i) => i.label === 'Appearance');
      const light = appearance?.submenu?.items.find((i) => i.label === 'Light');
      if (!light) throw new Error('No Light item in the View > Appearance menu');
      light.click();
    });
    await expect(html).toHaveAttribute('data-theme', 'light', { timeout: 2_000 });
    await expect.poll(checkedAppearance).toEqual(['Light']);
    expect(await page.evaluate(() => window.xenon.prefs.get())).toMatchObject({ appearance: 'light' });

    // 'System' follows the Mac, and keeps following it with no reload: a marker
    // set on this page survives every change below.
    await page.evaluate(() => ((window as unknown as { themeProbe?: number }).themeProbe = 1));
    await setAppearance(page, 'system');
    await expect.poll(checkedAppearance).toEqual(['System']);
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(html).toHaveAttribute('data-theme', 'light', { timeout: 2_000 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(html).toHaveAttribute('data-theme', 'dark', { timeout: 2_000 });
    expect(await page.evaluate(() => (window as unknown as { themeProbe?: number }).themeProbe)).toBe(1);
  } finally {
    // Later tests get what they had before: the saved default, and Playwright's light scheme.
    await setAppearance(page, 'system');
    await page.emulateMedia({ colorScheme: 'light' });
  }
});

test('Logs carries a dot after the server stops unexpectedly, until Logs is opened', async () => {
  // A real crash needs a real server. Stand in for the supervisor instead: send
  // the window the state events it sends, from main, then put the real one back
  // (stopped: nothing in this suite starts a server).
  const idle = {
    status: 'stopped',
    profileId: null,
    pid: null,
    port: null,
    basePath: null,
    appiumHome: null,
    dashboardUrl: null,
    startedAt: null,
    logFile: null,
    exitCode: null,
    exitSignal: null,
    lastError: null
  };
  const send = (state: Record<string, unknown>) =>
    app.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0].webContents.send('evt:serverState', s), {
      ...idle,
      ...state
    });
  const status = page.getByTestId('sidebar-status');
  const announced = announcedStatus(page);
  const logs = page.getByRole('tab', { name: 'Logs', exact: true });
  // The open profile's server, so Home shows it as this profile's.
  const profileId = await page.evaluate(
    async () => (await window.xenon.profiles.list()).find((p) => p.name === 'Local server')!.id
  );
  try {
    await openPlace('Home');
    await send({
      status: 'running',
      profileId,
      port: freePort,
      startedAt: Date.now(),
      dashboardUrl: `http://127.0.0.1:${freePort}/xenon/`
    });
    await expect(announced).toHaveText('Running');
    await expect(page.getByTestId('stop-button')).toBeVisible();
    await expect(page.getByTestId('home').getByRole('button', { name: 'Open dashboard' })).toBeVisible();
    await expect(logs).toHaveAccessibleDescription('');

    await send({ status: 'crashed', profileId, exitCode: 1, lastError: 'Appium exited with code 1' });
    await expect(announced).toHaveText('Stopped unexpectedly');
    await expect(page.getByTestId('start-button')).toBeVisible();
    await expect(page.getByTestId('home-title')).toHaveText('Xenon stopped unexpectedly');
    // The dot is the tab's description; its name is still just the place.
    await expect(logs).toHaveAccessibleName('Logs');
    await expect(logs).toHaveAccessibleDescription('New problem');
    // A pointer is told what the dot means too.
    await expect(logs.locator('[title="New problem"]')).toBeVisible();
    // With technical details, Home quotes what the server reported, marked as quoted rather than the app's own words.
    await expect(page.locator('[data-raw]')).toHaveCount(0);
    await setTechnical(page, true);
    await expect(page.locator('[data-raw]')).toHaveText('Appium exited with code 1');
    await setTechnical(page, false);

    // Moving elsewhere keeps the dot; opening Logs clears it, and it stays cleared.
    await openPlace('Settings');
    await expect(logs).toHaveAccessibleDescription('New problem');
    await openPlace('Logs');
    await expect(logs).toHaveAccessibleDescription('');
    // The status word goes Home.
    await status.getByRole('button', { name: 'Stopped unexpectedly' }).click();
    await expect(page.getByRole('tab', { name: 'Home', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(logs).toHaveAccessibleDescription('');
  } finally {
    await send({});
    await expect(announced).toHaveText('Stopped');
  }
});

/** A stopped server, as the supervisor reports it. */
const IDLE_STATE = {
  status: 'stopped',
  profileId: null,
  pid: null,
  port: null,
  basePath: null,
  appiumHome: null,
  dashboardUrl: null,
  startedAt: null,
  logFile: null,
  exitCode: null,
  exitSignal: null,
  lastError: null
};

/** Sends the window server states, from main, as the supervisor does: each one an idle state with `states[i]` on top, in one go. */
async function sendServerStates(...states: Record<string, unknown>[]) {
  await app.evaluate(
    ({ BrowserWindow }, all) => {
      for (const s of all) BrowserWindow.getAllWindows()[0].webContents.send('evt:serverState', s);
    },
    states.map((state) => ({ ...IDLE_STATE, ...state }))
  );
}

test('Logs carries a dot when the server goes straight from stopped to stopped unexpectedly', async () => {
  // A start that fails before the server runs (no Appium found) goes stopped → crashed with no
  // starting in between, and starting → crashed can arrive together and be drawn in one render.
  // The dot follows every status main sends, not the ones drawn.
  const logs = page.getByRole('tab', { name: 'Logs', exact: true });
  try {
    await openPlace('Home');
    await expect(announcedStatus(page)).toHaveText('Stopped');
    await expect(logs).toHaveAccessibleDescription('');
    await sendServerStates({ status: 'crashed', lastError: 'Could not find Appium' });
    await expect(announcedStatus(page)).toHaveText('Stopped unexpectedly');
    await expect(logs).toHaveAccessibleDescription('New problem');
    await openPlace('Logs');
    await expect(logs).toHaveAccessibleDescription('');

    await sendServerStates({});
    await openPlace('Home');
    await expect(announcedStatus(page)).toHaveText('Stopped');
    await sendServerStates({ status: 'starting', port: freePort }, { status: 'crashed', exitCode: 1, lastError: 'boom' });
    await expect(announcedStatus(page)).toHaveText('Stopped unexpectedly');
    await expect(logs).toHaveAccessibleDescription('New problem');
  } finally {
    await sendServerStates({});
    await expect(announcedStatus(page)).toHaveText('Stopped');
    await openPlace('Logs');
    await expect(logs).toHaveAccessibleDescription('');
  }
});

test('each place opens at its top', async () => {
  const scroller = page.getByTestId('place-scroll');
  const scrollTop = () => scroller.evaluate((el) => el.scrollTop);
  const testsAtOnce = page.getByRole('spinbutton', { name: 'Tests at the same time', exact: true });
  await openSettingsTab('All settings');
  await expect(testsAtOnce).toBeVisible();
  // Deep into Settings…
  await scroller.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect.poll(scrollTop).toBeGreaterThan(400);
  // …then Setup opens at its top, and so does Settings when it is opened again.
  await openPlace('Setup');
  await expect(page.getByText('Node.js')).toBeVisible({ timeout: 20_000 });
  expect(await scrollTop()).toBe(0);
  await scroller.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await openPlace('Settings');
  await expect(testsAtOnce).toBeVisible();
  expect(await scrollTop()).toBe(0);
  // A tab inside Settings opens at its top too.
  await scroller.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect.poll(scrollTop).toBeGreaterThan(400);
  await openSettingsTab('Keys & accounts');
  expect(await scrollTop()).toBe(0);
});

test('View ⌘1–⌘4 open the four places', async () => {
  for (const [accelerator, name] of [
    ['Cmd+3', 'Settings'],
    ['Cmd+4', 'Logs'],
    ['Cmd+2', 'Setup'],
    ['Cmd+1', 'Home']
  ]) {
    await clickMenuItem(app, 'View', { accelerator });
    await expect(page.getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
  }
});

test('a menu action sent while the window is still loading is acted on once it is ready', async () => {
  // Start Server from the menu-bar icon reopens a closed window and sends it the Start at once. A
  // reload stands in for that window: the action goes out before the page can listen.
  await openPlace('Home');
  await page.reload({ waitUntil: 'commit' });
  await clickMenuItem(app, 'View', { label: 'Logs' });
  await expect(page.getByRole('tab', { name: 'Logs', exact: true })).toHaveAttribute('aria-selected', 'true', {
    timeout: 20_000
  });
  await expect(profileSwitcher(page)).toHaveText('Local server');
});

test('technical details reveal the Appium folder and launch preview', async () => {
  await openSettingsTab('All settings');
  const appiumHome = page.getByTestId('appium-home');
  const preview = page.getByTestId('preview-button');
  const technical = page.getByRole('region', { name: 'Technical', exact: true });
  const toggle = () => clickMenuItem(app, 'View', { accelerator: 'Alt+Cmd+T' });
  const checkbox = async () => (await menuItems(app, 'View')).find((i) => i.label === 'Show Technical Details');
  const serverItems = async () => (await menuItems(app, 'Server')).map((i) => i.label).filter(Boolean);

  // Off: nothing technical on screen, and none of it in the Server menu.
  await expect(appiumHome).toHaveCount(0);
  await expect(preview).toHaveCount(0);
  await expect(technical).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Base path', exact: true })).toHaveCount(0);
  expect(await checkbox()).toMatchObject({ type: 'checkbox', checked: false, accelerator: 'Alt+Cmd+T' });
  expect(await serverItems()).toEqual(['Start Server', 'Open Dashboard', 'Copy Test Address']);

  // ⌥⌘T (its View menu item): the Technical group with the Appium folder and the preview, and
  // the Server menu's technical items.
  await toggle();
  await expect(appiumHome).toBeVisible();
  await expect(preview).toBeVisible();
  await expect(technical.getByRole('textbox', { name: 'Base path', exact: true })).toBeVisible();
  await expect(technical.getByRole('button', { name: 'Export config', exact: true })).toBeVisible();
  await expect.poll(checkbox).toMatchObject({ checked: true });
  // The switch at the bottom of Essentials is the same preference.
  await openSettingsTab('Essentials');
  await expect(settingSwitch('Show technical details')).toHaveAttribute('aria-checked', 'true');
  await openSettingsTab('All settings');
  await expect.poll(serverItems).toEqual(['Start Server', 'Open Dashboard', 'Copy Test Address', 'Preview Launch…', 'Export Config…']);

  // And again, off.
  await toggle();
  await expect(appiumHome).toHaveCount(0);
  await expect(preview).toHaveCount(0);
  await expect.poll(checkbox).toMatchObject({ checked: false });
  await expect.poll(serverItems).toEqual(['Start Server', 'Open Dashboard', 'Copy Test Address']);
});

test('Server > Preview Launch… and Export Config… work from the menu', async () => {
  await setTechnical(page, true);
  await openPlace('Home');
  await clickMenuItem(app, 'Server', { label: 'Preview Launch…' });
  await expect(page.getByText('Launch preview — dry run')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('Launch preview — dry run')).toHaveCount(0);

  const dir = mkdtempSync(path.join(os.tmpdir(), 'xenon-config-'));
  const file = path.join(dir, 'probe.appium.yaml');
  await app.evaluate(({ dialog }, filePath) => {
    const g = globalThis as unknown as { originalSaveDialog?: typeof dialog.showSaveDialog };
    g.originalSaveDialog ??= dialog.showSaveDialog;
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as typeof dialog.showSaveDialog;
  }, file);
  try {
    await clickMenuItem(app, 'Server', { label: 'Export Config…' });
    await expect(page.getByText('Config saved', { exact: true })).toBeVisible();
    expect(readFileSync(file, 'utf8')).toContain('use-plugins');
    rmSync(file);
    // Settings' Export config does the same.
    await openSettingsTab('All settings');
    await page.getByRole('button', { name: 'Export config', exact: true }).click();
    await expect.poll(() => readFileSync(file, 'utf8')).toContain('use-plugins');
  } finally {
    await app.evaluate(({ dialog }) => {
      const g = globalThis as unknown as { originalSaveDialog?: typeof dialog.showSaveDialog };
      if (g.originalSaveDialog) dialog.showSaveDialog = g.originalSaveDialog;
    });
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the preview and an exported config carry no cloud key or proxy password from a draft that still holds them', async () => {
  // The window's draft keeps a value main moved to the Keychain until the profile is opened again.
  // Fake values only. Neither call saves the draft, so nothing reaches the Keychain.
  const draft = await page.evaluate(async () => {
    const [base] = await window.xenon.profiles.list();
    return {
      ...base,
      settings: {
        ...base.settings,
        cloud: { cloudName: 'lambdatest', url: 'https://hub.lambdatest.example/wd/hub', username: 'qa-user', apiKey: 'k-test-123' },
        proxy: { host: 'squid.lab', port: 3128, auth: { username: 'qa', password: 'p@ss:w/rd' } }
      }
    };
  });
  const spec = await page.evaluate((d) => window.xenon.server.launchPreview(d), draft);
  expect(JSON.stringify(spec)).not.toMatch(/k-test-123|p@ss|p%40ss|qa-user/);
  expect(spec.envKeys).toEqual(expect.arrayContaining(['CLOUD_USERNAME', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY']));

  const dir = mkdtempSync(path.join(os.tmpdir(), 'xenon-config-'));
  const file = path.join(dir, 'secrets.appium.yaml');
  await app.evaluate(({ dialog }, filePath) => {
    const g = globalThis as unknown as { originalSaveDialog?: typeof dialog.showSaveDialog };
    g.originalSaveDialog ??= dialog.showSaveDialog;
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as typeof dialog.showSaveDialog;
  }, file);
  try {
    expect(await page.evaluate((d) => window.xenon.profiles.exportConfigYaml(d), draft)).toBe(true);
    const text = readFileSync(file, 'utf8');
    expect(text).toContain('squid.lab');
    expect(text).not.toMatch(/k-test-123|p@ss|p%40ss|qa-user/);
  } finally {
    await app.evaluate(({ dialog }) => {
      const g = globalThis as unknown as { originalSaveDialog?: typeof dialog.showSaveDialog };
      if (g.originalSaveDialog) dialog.showSaveDialog = g.originalSaveDialog;
    });
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the Settings switch shows technical details, and two quick changes never flicker', async () => {
  // At the bottom of Essentials.
  await openSettingsTab('Essentials');
  const toggle = settingSwitch('Show technical details');
  await expect(toggle).toHaveAccessibleDescription('Option names, folders, commands and diagnostic lines');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[data-setting-key="maxSessions"]').getByText('maxSessions', { exact: true })).toBeVisible();
  await expect
    .poll(async () => (await menuItems(app, 'View')).find((i) => i.label === 'Show Technical Details')?.checked)
    .toBe(true);

  // Main takes 200 ms to answer, so both clicks are made before the first answer comes back. The
  // first answer (off) used to show for a moment over the second click (on).
  type Handler = (...args: unknown[]) => unknown;
  type Slow = { originalPrefsSet?: Handler };
  await app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
    const g = globalThis as unknown as Slow;
    g.originalPrefsSet ??= handlers.get('prefs:set');
    const set = g.originalPrefsSet!;
    handlers.set('prefs:set', async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return set(...args);
    });
  });
  try {
    await toggle.evaluate((el) => {
      const seen: string[] = [];
      (window as unknown as { switchSeen: string[] }).switchSeen = seen;
      new MutationObserver(() => seen.push(el.getAttribute('aria-checked') ?? '')).observe(el, {
        attributes: true,
        attributeFilter: ['aria-checked']
      });
    });
    await toggle.click();
    await toggle.click();
    await page.waitForTimeout(800); // both answers are back
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(await page.evaluate(() => (window as unknown as { switchSeen: string[] }).switchSeen)).toEqual([
      'false',
      'true'
    ]);
    expect(await page.evaluate(() => window.xenon.prefs.get())).toMatchObject({ technicalDetails: true });
  } finally {
    await app.evaluate(({ ipcMain }) => {
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
      const set = (globalThis as unknown as Slow).originalPrefsSet;
      if (set) handlers.set('prefs:set', set);
    });
  }
});

test('the window is painted in the page’s own background colour, in both themes', async () => {
  // The window's backgroundColor shows before the page loads and at its edges while it resizes.
  const toHex = (rgb: string) =>
    `#${(rgb.match(/\d+/g) ?? [])
      .slice(0, 3)
      .map((n) => Number(n).toString(16).padStart(2, '0'))
      .join('')}`;
  const pageBackground = async () => toHex(await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
  const windowBackground = () =>
    app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBackgroundColor().toLowerCase());
  try {
    await page.emulateMedia({ colorScheme: null });
    for (const theme of ['dark', 'light'] as const) {
      await setAppearance(page, theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme, { timeout: 2_000 });
      const expected = await pageBackground();
      await expect.poll(windowBackground).toBe(expected);
    }
  } finally {
    await setAppearance(page, 'system');
    await page.emulateMedia({ colorScheme: 'light' });
  }
});

test('with technical details off, Logs are in plain words', async () => {
  await setTechnical(page, false);
  const keys = await optionKeys(page);
  // A line full of jargon from the server: lines are quoted, not the app's own words.
  await openPlace('Logs');
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.send('evt:log', [
      { ts: Date.now(), stream: 'system', text: 'APPIUM_HOME=/Users/qa/.appium npm i -g appium --maxSessions' }
    ])
  );
  await expect(page.getByText('APPIUM_HOME=/Users/qa/.appium', { exact: false })).toBeVisible();
  expect(findJargon(await ownWords(page), keys)).toEqual([]);
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
});

test('Essentials shows the everyday options in plain words', async () => {
  // Every Essentials row there is: both kinds of phone, and AI repair on with Gemini (the defaults).
  await openSettingsTab('Essentials');
  const phones = page.getByRole('radiogroup', { name: 'Which phones', exact: true });
  const platform = (await phones.getByRole('radio', { checked: true }).textContent())?.trim();
  await phones.getByRole('radio', { name: 'Both', exact: true }).click();
  try {
    const groups = page.getByRole('tabpanel', { name: 'Essentials', exact: true }).getByRole('region');
    await expect(groups).toHaveCount(5);
    for (const [i, name] of ['Phones', 'Tests', 'Recording & history', 'Sharing & sign-in', 'AI help'].entries()) {
      await expect(groups.nth(i)).toHaveAccessibleName(name);
    }
    await expect(page.getByRole('radiogroup', { name: 'Android', exact: true })).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'iPhone', exact: true }).getByRole('radio', { name: 'Simulators', exact: true })).toBeVisible();
    await expect(settingSwitch('Only emulators that are already running')).toBeVisible();
    await expect(settingSwitch('Only simulators that are already running')).toBeVisible();
    await expect(page.getByRole('spinbutton', { name: 'Tests at the same time', exact: true })).toBeVisible();
    await expect(portField()).toBeVisible();
    await expect(page.getByRole('spinbutton', { name: 'Wait for a free phone up to', exact: true })).toHaveAccessibleDescription('min');
    await expect(settingSwitch('Keep a full record of each test')).toHaveAccessibleDescription('— steps, screenshots and logs, in the dashboard');
    await expect(page.getByRole('spinbutton', { name: 'Keep history for', exact: true })).toHaveAccessibleDescription('days');
    await expect(settingSwitch('Ask people to sign in')).toBeVisible();
    await expect(settingSwitch('Share this Mac’s phones with a lab hub')).toHaveAttribute('aria-checked', 'false');
    await expect(settingSwitch('Repair broken element lookups automatically')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('radiogroup', { name: 'AI service', exact: true }).getByRole('radio', { name: 'Gemini', exact: true })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByLabel('Gemini key', { exact: true })).toBeVisible();
    // Where Xenon says a value saved in the dashboard wins, the row says so.
    await expect(page.locator('[data-setting-key="buildCleanupDays"]')).toContainText('The dashboard can override this.');
    await expect(page.locator('[data-setting-key="maxSessions"]')).not.toContainText('The dashboard can override this.');
    // No raw name without technical details.
    await expect(page.getByText('maxSessions', { exact: true })).toHaveCount(0);
    // At the bottom: the Show technical details switch.
    await expect(settingSwitch('Show technical details')).toBeVisible();

    const keys = await optionKeys(page);
    expect(findJargon(await ownWords(page), keys)).toEqual([]);
    // The port, invalid, with its problem in the list at the top and under the field.
    const before = await portField().inputValue();
    await portField().fill('');
    await expect(page.getByText('Port: Port is required.')).toBeVisible();
    expect(findJargon(await ownWords(page), keys)).toEqual([]);
    await portField().fill(before);
    await page.screenshot({ path: path.join(shotsDir, '02a-essentials.png'), fullPage: true });
    await expectAccessibleInBothThemes(page, 'essentials');
  } finally {
    if (platform) await phones.getByRole('radio', { name: platform, exact: true }).click();
  }
});

test('All settings is in plain words, and passes the accessibility check in both themes', async () => {
  await openSettingsTab('All settings');
  await expect(page.getByRole('spinbutton', { name: 'Tests at the same time', exact: true })).toBeVisible();
  // Nothing left out but what is quoted: the parts of nested options and the table columns too.
  expect(findJargon(await ownWords(page), await optionKeys(page))).toEqual([]);
  await expectAccessibleInBothThemes(page, 'all settings');
});

test('Keys & accounts is in plain words, and passes the accessibility check in both themes', async () => {
  await openSettingsTab('Keys & accounts');
  await expect(page.getByRole('region', { name: 'Gemini key', exact: true })).toBeVisible();
  expect(findJargon(await ownWords(page), await optionKeys(page))).toEqual([]);
  await expectAccessibleInBothThemes(page, 'keys & accounts');
});

test('technical details show raw names in Essentials', async () => {
  await openSettingsTab('Essentials');
  const maxSessions = page.locator('[data-setting-key="maxSessions"]');
  await expect(maxSessions.getByText('maxSessions', { exact: true })).toHaveCount(0);
  await setTechnical(page, true);
  await expect(maxSessions.getByText('maxSessions', { exact: true })).toBeVisible();
  // With Xenon's own description, and the sign-in switch's raw option, the one it inverts, with the value
  // it is stored as.
  const description = await page.evaluate(async () => (await window.xenon.getSchema()).schema.properties.maxSessions?.description ?? '');
  if (description) await expect(maxSessions).toContainText(description.slice(0, 40));
  await expect(page.locator('[data-setting-key="authDisabled"]').getByText('authDisabled: false', { exact: true })).toBeVisible();
  await expect(page.locator('[data-setting-key="server.port"]').getByText('server.port', { exact: true })).toBeVisible();
});

test('choosing Android hides the iPhone rows', async () => {
  await openSettingsTab('Essentials');
  const phones = page.getByRole('radiogroup', { name: 'Which phones', exact: true });
  const platform = (await phones.getByRole('radio', { checked: true }).textContent())?.trim();
  const iphone = page.getByRole('radiogroup', { name: 'iPhone', exact: true });
  const android = page.getByRole('radiogroup', { name: 'Android', exact: true });
  const simulators = settingSwitch('Only simulators that are already running');
  const emulators = settingSwitch('Only emulators that are already running');
  try {
    await phones.getByRole('radio', { name: 'Both', exact: true }).click();
    await expect(iphone).toBeVisible();
    await expect(simulators).toBeVisible();
    await expect(android).toBeVisible();

    await phones.getByRole('radio', { name: 'Android', exact: true }).click();
    await expect(iphone).toHaveCount(0);
    await expect(simulators).toHaveCount(0);
    await expect(android).toBeVisible();
    await expect(emulators).toBeVisible();
    await expect.poll(async () => (await storedProfile()).settings.platform).toBe('android');

    // Real Android phones only: no emulator row either.
    const before = (await android.getByRole('radio', { checked: true }).textContent())?.trim();
    await android.getByRole('radio', { name: 'Real phones', exact: true }).click();
    await expect(emulators).toHaveCount(0);
    if (before) await android.getByRole('radio', { name: before, exact: true }).click();
    await expect(emulators).toBeVisible();

    await phones.getByRole('radio', { name: 'iPhone', exact: true }).click();
    await expect(android).toHaveCount(0);
    await expect(iphone).toBeVisible();
  } finally {
    if (platform) await phones.getByRole('radio', { name: platform, exact: true }).click();
  }
});

test('wait for a free phone is in minutes and saves milliseconds', async () => {
  await openSettingsTab('Essentials');
  const wait = page.getByRole('spinbutton', { name: 'Wait for a free phone up to', exact: true });
  const stored = async () => (await storedProfile()).settings.deviceAvailabilityTimeoutMs;
  const before = await stored();
  try {
    await wait.fill('2.5');
    await wait.blur();
    await expect.poll(stored).toBe(150000);
    // Shown again in minutes, and looking at it rewrites nothing.
    await openPlace('Home');
    await openPlace('Settings');
    await expect(wait).toHaveValue('2.5');
    await wait.focus();
    await wait.blur();
    expect(await stored()).toBe(150000);
    // Under half a minute is not a wait (R: at least 0.5): it says so and saves nothing. It says so when
    // the box is left, not while it is typed (Task 17 minor), and the error goes as soon as the text is valid.
    await wait.fill('0.2');
    await page.waitForTimeout(300);
    await expect(page.getByText('Enter 0.5 or more.', { exact: true })).toHaveCount(0);
    await expect(wait).not.toHaveAttribute('aria-invalid', 'true');
    await wait.blur();
    const error = page.getByText('Enter 0.5 or more.', { exact: true });
    await expect(error).toBeVisible();
    await expect(error).toHaveAttribute('role', 'alert');
    expect(await stored()).toBe(150000);
    // Valid text clears it at once, before the box is left, and is saved as typed (R50).
    await wait.fill('2');
    await expect(error).toHaveCount(0);
    await expect.poll(stored).toBe(120000);
    // Enter shows an error as leaving the box does.
    await wait.fill('0.1');
    await wait.press('Enter');
    await expect(error).toBeVisible();
    await wait.fill('2.5');
    await wait.blur();
    await expect(error).toHaveCount(0);
    await expect.poll(stored).toBe(150000);
    // Text the browser won't call a number, then emptied, leaves no stale error (kit gap, item 18), and
    // an empty box goes back to Xenon's default.
    await wait.fill('');
    await wait.pressSequentially('1e');
    await wait.press('Meta+A');
    await wait.press('Backspace');
    await wait.blur();
    await expect(page.getByText('Enter a number.', { exact: true })).toHaveCount(0);
    await expect.poll(async () => 'deviceAvailabilityTimeoutMs' in (await storedProfile()).settings).toBe(false);
  } finally {
    await wait.fill(before === undefined ? '' : String(Number(before) / 60000));
    await wait.blur();
  }
});

test('All settings bounds retention and waits as Essentials does, and Essentials says what 0 tests at once means (I2)', async () => {
  await openSettingsTab('All settings');
  const setting = (key: string) => page.locator(`#setting-${key}`);
  const stored = async (key: string) => (await storedProfile()).settings[key];
  const keepFor = setting('buildCleanupDays');
  const wait = setting('deviceAvailabilityTimeoutMs');
  const atOnce = setting('maxSessions');
  const before = { keepFor: await stored('buildCleanupDays'), wait: await stored('deviceAvailabilityTimeoutMs'), atOnce: await stored('maxSessions') };
  try {
    // 0 days would delete all history at the next cleanup: it says so and saves nothing.
    await keepFor.fill('0');
    await keepFor.blur();
    await expect(page.locator('[data-setting-key="buildCleanupDays"]').getByText('Enter 1 or more.', { exact: true })).toBeVisible();
    expect(await stored('buildCleanupDays')).toBe(before.keepFor);
    // A wait of 0 ms would fail every waiting request; at least half a minute, in milliseconds here.
    await wait.fill('0');
    await wait.blur();
    await expect(page.locator('[data-setting-key="deviceAvailabilityTimeoutMs"]').getByText('Enter 30000 or more.', { exact: true })).toBeVisible();
    expect(await stored('deviceAvailabilityTimeoutMs')).toBe(before.wait);
    // Tests at the same time stays open: below 1 is no limit.
    await atOnce.fill('0');
    await atOnce.blur();
    await expect.poll(() => stored('maxSessions')).toBe(0);
    await openSettingsTab('Essentials');
    const essentialsAtOnce = page.getByRole('spinbutton', { name: 'Tests at the same time', exact: true });
    await expect(essentialsAtOnce).toHaveValue('0');
    await expect(essentialsAtOnce).toHaveAccessibleDescription('0 means no limit');
  } finally {
    await openSettingsTab('All settings');
    for (const [key, value] of [
      ['buildCleanupDays', before.keepFor],
      ['deviceAvailabilityTimeoutMs', before.wait],
      ['maxSessions', before.atOnce]
    ] as const) {
      await setting(key).fill(value === undefined ? '' : String(value));
      await setting(key).blur();
    }
    await expect.poll(() => stored('maxSessions')).toBe(before.atOnce);
  }
});

test('a number typed and started at once launches with it (R50)', async () => {
  // The box commits as it is typed in, so ⌘⏎ with the cursor still in it starts the value on screen.
  const port = await openPort();
  await port.fill(String(freePort));
  const testsAtOnce = page.getByRole('spinbutton', { name: 'Tests at the same time', exact: true });
  const before = await testsAtOnce.inputValue();
  const typed = before === '5' ? '6' : '5';
  await standIn(NOTHING_STARTS);
  // The start is recorded with the profile it was asked to launch, and launches nothing.
  await app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
    const g = globalThis as unknown as { started?: unknown };
    g.started = undefined;
    handlers.set('server:start', async (_event: unknown, profile: unknown) => {
      g.started = profile;
      return undefined;
    });
  });
  try {
    await testsAtOnce.fill(typed);
    await expect(testsAtOnce).toBeFocused();
    await pressStartShortcut();
    const started = () =>
      app.evaluate(() => (globalThis as unknown as { started?: { settings: { maxSessions?: number } } }).started?.settings.maxSessions);
    await expect.poll(started).toBe(Number(typed));
  } finally {
    await restoreHandlers();
    await testsAtOnce.fill(before);
    await testsAtOnce.blur();
    await expect.poll(async () => String((await storedProfile()).settings.maxSessions)).toBe(before);
  }
});

/** Records the profile a start is asked to launch, and launches nothing. */
async function recordStarts() {
  await standIn(NOTHING_STARTS);
  await app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
    const g = globalThis as unknown as { started?: unknown };
    g.started = undefined;
    handlers.set('server:start', async (_event: unknown, profile: unknown) => {
      g.started = profile;
      return undefined;
    });
  });
}

/** The settings of the profile the last recorded start was asked to launch. */
const startedSettings = () =>
  app.evaluate(() => (globalThis as unknown as { started?: { settings: Record<string, unknown> } }).started?.settings ?? null);

test('⌘⏎ with the cursor still in a table cell launches what the cell holds', async () => {
  // A cell commits when it loses focus, and the shortcut moves no focus: the start ends the edit first.
  const port = await openPort();
  await port.fill(String(freePort));
  await openSettingsTab('All settings');
  const table = page.locator('[data-setting-key="simulators"]');
  await recordStarts();
  try {
    await table.getByRole('button', { name: 'Add row', exact: true }).click();
    const name = table.getByLabel('Name row 1', { exact: true });
    await name.fill('iPhone-cmd-enter');
    await expect(name).toBeFocused();
    await pressStartShortcut();
    await expect.poll(async () => (await startedSettings())?.simulators).toEqual([{ name: 'iPhone-cmd-enter', sdk: '' }]);
    // The cursor is still in the cell.
    await expect(name).toBeFocused();
  } finally {
    await restoreHandlers();
    await table.getByRole('button', { name: 'Remove row', exact: true }).first().click();
    await expect.poll(async () => (await storedProfile()).settings.simulators).toBeUndefined();
  }
});

test('⌘⏎ with the cursor still in a JSON box launches what the box holds', async () => {
  const port = await openPort();
  await port.fill(String(freePort));
  await setTechnical(page, true);
  await openSettingsTab('All settings');
  const box = page.locator('[data-setting-key="proxy"] textarea');
  await recordStarts();
  try {
    await box.fill('{ "host": "cmd-enter.lab", "port": 3128 }');
    await expect(box).toBeFocused();
    await pressStartShortcut();
    await expect.poll(async () => (await startedSettings())?.proxy).toEqual({ host: 'cmd-enter.lab', port: 3128 });
    await expect(box).toBeFocused();
  } finally {
    await restoreHandlers();
    await box.fill('');
    await box.blur();
    await expect.poll(async () => (await storedProfile()).settings.proxy).toBeUndefined();
  }
});

test('a number typed and then reloaded is kept (R50)', async () => {
  await openSettingsTab('Essentials');
  const testsAtOnce = page.getByRole('spinbutton', { name: 'Tests at the same time', exact: true });
  const before = await testsAtOnce.inputValue();
  const typed = before === '5' ? '6' : '5';
  // No blur, no Enter: the window goes with the cursor still in the box.
  await testsAtOnce.fill(typed);
  await page.reload();
  await expect(profileSwitcher(page)).toBeVisible({ timeout: 20_000 });
  expect((await storedProfile()).settings.maxSessions).toBe(Number(typed));
  await openSettingsTab('Essentials');
  await expect(testsAtOnce).toHaveValue(typed);
  await testsAtOnce.fill(before);
  await testsAtOnce.blur();
  await expect.poll(async () => String((await storedProfile()).settings.maxSessions)).toBe(before);
});

test('Ask people to sign in writes authDisabled', async () => {
  await openSettingsTab('Essentials');
  const signIn = settingSwitch('Ask people to sign in');
  const stored = async () => (await storedProfile()).settings.authDisabled;
  await expect(signIn).toHaveAttribute('aria-checked', 'true');
  try {
    // Off means sign-in is off: authDisabled is stored as true.
    await signIn.click();
    await expect(signIn).toHaveAttribute('aria-checked', 'false');
    await expect.poll(stored).toBe(true);
    // All settings shows the same switch the same way round (R46).
    await openSettingsTab('All settings');
    await expect(settingSwitch('Ask people to sign in')).toHaveAttribute('aria-checked', 'false');
    await settingSwitch('Ask people to sign in').click();
    await expect.poll(stored).toBeUndefined();
    await openSettingsTab('Essentials');
    await expect(signIn).toHaveAttribute('aria-checked', 'true');
  } finally {
    if ((await stored()) !== undefined) await page.evaluate(async () => {
      const [p] = await window.xenon.profiles.list();
      const settings = { ...p.settings };
      delete settings.authDisabled;
      await window.xenon.profiles.save({ ...p, settings });
    });
  }
});

test('with technical details on, the sign-in switch shows the value it is stored as', async () => {
  // The switch says the opposite of its option, so the raw value is the one to check.
  await setTechnical(page, true);
  const stored = async () => (await storedProfile()).settings.authDisabled;
  const raw = (place: string) => page.locator(`[data-setting-key="${place}"]`).locator('[data-raw] code');
  try {
    await openSettingsTab('Essentials');
    await expect(raw('authDisabled')).toHaveText('authDisabled: false');
    await settingSwitch('Ask people to sign in').click();
    await expect.poll(stored).toBe(true);
    await expect(raw('authDisabled')).toHaveText('authDisabled: true');
    await openSettingsTab('All settings');
    await expect(raw('authDisabled')).toHaveText('authDisabled: true');
    await settingSwitch('Ask people to sign in').click();
    await expect.poll(stored).toBeUndefined();
    await expect(raw('authDisabled')).toHaveText('authDisabled: false');
  } finally {
    if ((await stored()) !== undefined) await page.evaluate(async () => {
      const [p] = await window.xenon.profiles.list();
      const settings = { ...p.settings };
      delete settings.authDisabled;
      await window.xenon.profiles.save({ ...p, settings });
    });
  }
});

test('All settings lists the phone choices in Essentials’ order, and clicking the chosen one keeps it', async () => {
  await openSettingsTab('All settings');
  const which = page.getByRole('radiogroup', { name: 'Which phones', exact: true });
  await expect(which.getByRole('radio')).toHaveText(['Android', 'iPhone', 'Both']);
  const stored = async () => (await storedProfile()).settings.platform;
  const before = await stored();
  try {
    await which.getByRole('radio', { name: 'Android', exact: true }).click();
    await expect.poll(stored).toBe('android');
    // Clicked again, it stays chosen: Which phones has a default, so it never goes back to showing Both.
    await which.getByRole('radio', { name: 'Android', exact: true }).click();
    await page.waitForTimeout(500); // past the save's 300 ms
    expect(await stored()).toBe('android');
    await expect(which.getByRole('radio', { name: 'Android', exact: true })).toHaveAttribute('aria-checked', 'true');
  } finally {
    await page.evaluate(async (platform) => {
      const p = (await window.xenon.profiles.list()).find((x) => x.name === 'Local server')!;
      await window.xenon.profiles.save({ ...p, settings: { ...p.settings, platform } });
    }, before);
    await page.reload();
    await expect(page.getByTestId('profile-switcher')).toBeVisible({ timeout: 20_000 });
  }
});

test('Settings with technical details on passes the accessibility check in both themes', async () => {
  await setTechnical(page, true);
  await openSettingsTab('Essentials');
  await expect(page.getByText('maxSessions', { exact: true })).toBeVisible();
  await expectAccessibleInBothThemes(page, 'essentials, technical details on');
  await openSettingsTab('All settings');
  await expect(page.getByRole('region', { name: 'Technical', exact: true })).toBeVisible();
  await expectAccessibleInBothThemes(page, 'all settings, technical details on');
});

test('Keys & accounts and Logs with technical details on pass the accessibility check in both themes', async () => {
  await setTechnical(page, true);
  await openSettingsTab('Keys & accounts');
  await expect(page.getByRole('region', { name: 'Database file', exact: true })).toBeVisible();
  await expectAccessibleInBothThemes(page, 'keys & accounts, technical details on');
  await openPlace('Logs');
  await expect(page.getByRole('button', { name: 'Open log folder', exact: true })).toBeVisible();
  await expectAccessibleInBothThemes(page, 'logs, technical details on');
});

type Handler = (...args: unknown[]) => unknown;

/**
 * Puts stand-ins in main for these IPC handlers: each records that it was called and gives
 * `answer`. restoreHandlers puts the real ones back.
 */
async function standIn(answers: Record<string, unknown>) {
  await app.evaluate(({ ipcMain }, answers) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
    const g = globalThis as unknown as { realHandlers?: Map<string, Handler>; calls: string[] };
    g.realHandlers ??= new Map();
    g.calls = [];
    for (const [channel, answer] of Object.entries(answers)) {
      if (!g.realHandlers.has(channel)) g.realHandlers.set(channel, handlers.get(channel)!);
      handlers.set(channel, async () => {
        g.calls.push(channel);
        return answer;
      });
    }
  }, answers);
}

const calledHandlers = () => app.evaluate(() => (globalThis as unknown as { calls: string[] }).calls);

async function restoreHandlers() {
  await app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
    const g = globalThis as unknown as { realHandlers?: Map<string, Handler> };
    for (const [channel, real] of g.realHandlers ?? []) handlers.set(channel, real);
    g.realHandlers = new Map();
  });
}

/** Every check passes and a start is recorded, not made: if validation let a start through, it shows as a call. */
const NOTHING_STARTS = {
  'server:start': undefined,
  'toolchain:preflight': { ok: true, checks: [], blockers: [] }
};

const savedBasePath = () =>
  page.evaluate(async () => (await window.xenon.profiles.list()).find((p) => p.name === 'Local server')?.server.basePath);

/** Sets the base path through the Technical group, waits until it is saved, and leaves technical details off. */
async function setBasePath(value: string) {
  await setTechnical(page, true);
  await openSettingsTab('All settings');
  await page.getByRole('textbox', { name: 'Base path', exact: true }).fill(value);
  await expect.poll(savedBasePath).toBe(value);
  await setTechnical(page, false);
}

const basePathField = () => page.getByRole('textbox', { name: 'Base path', exact: true });

test('with technical details off, a wrong base path can be fixed by typing, and the field stays until focus leaves it', async () => {
  const original = await savedBasePath();
  await setBasePath('wd/hub');
  try {
    // Shown for its problem, though technical details are off: only the setting that has it (R52), with
    // no folder, command or path, and not the environment variables, the preview or the export.
    const technical = page.getByRole('region', { name: 'Technical', exact: true });
    await expect(technical).toBeVisible();
    await expect(page.getByText("Base path must start with '/'.").first()).toBeVisible();
    await expect(basePathField()).toBeVisible();
    await expect(page.getByTestId('appium-home')).toHaveCount(0);
    await expect(technical.getByRole('button', { name: 'Open Appium folder', exact: true })).toHaveCount(0);
    await expect(technical.getByRole('spinbutton', { name: 'Keep-alive timeout', exact: true })).toHaveCount(0);
    await expect(technical.getByRole('heading', { name: 'Environment variables' })).toHaveCount(0);
    await expect(page.getByTestId('preview-button')).toHaveCount(0);
    // Carry 14 holds here too: every word on screen is plain.
    expect(findJargon(await ownWords(page), await optionKeys(page))).toEqual([]);
    // The "/" fixes it, and the group must not go then: the rest of the typing lands in the field.
    await basePathField().click();
    await page.keyboard.press('Meta+A');
    await page.keyboard.type('/wd/hub', { delay: 30 });
    await expect(basePathField()).toBeFocused();
    await expect(technical).toBeVisible();
    await expect(basePathField()).toHaveValue('/wd/hub');
    await expect.poll(savedBasePath).toBe('/wd/hub');
    // A click that takes focus out of the group lands where it was aimed, though the group goes: it
    // waits for the pointer to come up. Scrolled to the end, the page would otherwise move down under
    // the pointer by the group's height, between press and release.
    const scroller = page.getByTestId('place-scroll');
    await scroller.evaluate((el) => (el.scrollTop = el.scrollHeight));
    const logs = settingSwitch('Machine-readable logs');
    const before = await logs.getAttribute('aria-checked');
    await logs.click();
    await expect(technical).toHaveCount(0);
    await expect(logs).toHaveAttribute('aria-checked', before === 'true' ? 'false' : 'true');
    await logs.click();
    await expect(logs).toHaveAttribute('aria-checked', before ?? 'false');
    // Focus leaving it, fixed, puts technical details back to what they are: off.
    await setBasePath('wd/hub');
    await expect(technical).toBeVisible();
    await basePathField().fill('/wd/hub');
    await expect.poll(savedBasePath).toBe('/wd/hub');
    await page.getByTestId('settings-search').click();
    await expect(technical).toHaveCount(0);
  } finally {
    if (original && original !== (await savedBasePath())) await setBasePath(original);
  }
});

test('with technical details off, ⌘⏎ with a wrong base path opens Settings at it and starts nothing', async () => {
  const original = await savedBasePath();
  const port = await openPort();
  await port.fill(String(freePort));
  await setBasePath('wd/hub');
  await standIn(NOTHING_STARTS);
  try {
    await openPlace('Home');
    await pressStartShortcut();
    await expect(page.getByRole('tab', { name: 'Settings', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(basePathField()).toBeFocused();
    await page.waitForTimeout(800);
    expect(await calledHandlers()).not.toContain('server:start');
  } finally {
    await restoreHandlers();
    if (original) await setBasePath(original);
  }
});

test('Start from the menu-bar icon into a closed window, with a setting wrong, opens Settings at it and starts nothing', async () => {
  // The window reopens and gets the Start before it has read the open profile's option list, so
  // the Start must wait until the settings have been checked. Playwright can't open the menu-bar
  // icon's menu, so its two steps are done as it does them: showWindow (through second-instance),
  // then the action. Both Starts: the app menu's Start Server (sent by main as for any menu item,
  // once the window has loaded) and the menu-bar icon's own 'start-server'.
  const original = await savedBasePath();
  const port = await openPort();
  await port.fill(String(freePort));
  await setBasePath('wd/hub');
  await standIn(NOTHING_STARTS);
  try {
    for (const how of ['Start Server in the Server menu', 'start-server from the menu-bar icon'] as const) {
      await openPlace('Home');
      const closed = page.waitForEvent('close');
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
      await closed;
      const reopened = app.waitForEvent('window');
      await app.evaluate(
        ({ app: electronApp, BrowserWindow, Menu }, viaMenu) => {
          electronApp.emit('second-instance');
          if (viaMenu) {
            const server = Menu.getApplicationMenu()?.items.find((i) => i.label === 'Server');
            server?.submenu?.items.find((i) => i.label === 'Start Server')?.click();
            return;
          }
          const win = BrowserWindow.getAllWindows()[0];
          win.webContents.once('did-finish-load', () => win.webContents.send('evt:menuAction', 'start-server'));
        },
        how.startsWith('Start Server')
      );
      page = await reopened;
      adoptWindow(page);
      await expect(page.getByRole('tab', { name: 'Settings', exact: true }), how).toHaveAttribute('aria-selected', 'true', {
        timeout: 20_000
      });
      await expect(basePathField(), how).toBeFocused();
      await page.waitForTimeout(1_000);
      expect(await calledHandlers(), how).not.toContain('server:start');
    }
  } finally {
    await restoreHandlers();
    if (original) await setBasePath(original);
  }
});

test('Start from the menu-bar icon never stops a running server', async () => {
  // A Start the window acts on a moment late must not turn into a Stop (ruling R20): the menu-bar
  // icon's 'start-server' does nothing while the server is active.
  await standIn({ ...NOTHING_STARTS, 'server:stop': undefined });
  try {
    await openPlace('Home');
    await sendServerStates({ status: 'running', port: freePort, startedAt: Date.now() });
    await expect(announcedStatus(page)).toHaveText('Running');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('evt:menuAction', 'start-server'));
    await page.waitForTimeout(800);
    expect(await calledHandlers()).toEqual([]);
    await expect(announcedStatus(page)).toHaveText('Running');
  } finally {
    await restoreHandlers();
    await sendServerStates({});
    await expect(announcedStatus(page)).toHaveText('Stopped');
  }
});

/** Notes the real handlers for these channels, so restoreHandlers puts them back after a test replaces them its own way. */
async function keepRealHandlers(channels: string[]) {
  await app.evaluate(({ ipcMain }, channels) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
    const g = globalThis as unknown as { realHandlers?: Map<string, Handler> };
    g.realHandlers ??= new Map();
    for (const channel of channels) if (!g.realHandlers.has(channel)) g.realHandlers.set(channel, handlers.get(channel)!);
  }, channels);
}

test('Start and Stop keep keyboard focus while the server starts, runs and stops', async () => {
  // A button that becomes disabled drops focus, to nowhere, so a keyboard or VoiceOver user pressing
  // Start would lose their place. Start and Stop are busy for a moment and say so, but keep focus,
  // through the swap from Start to Stop and back. The check, the start and the stop are stood in for
  // in main, each sending the statuses the supervisor would, a moment apart: nothing is launched.
  const port = await openPort();
  await port.fill(String(freePort));
  await keepRealHandlers(['toolchain:preflight', 'server:start', 'server:stop']);
  await app.evaluate(
    ({ ipcMain, BrowserWindow }, { port, idle }) => {
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
      const g = globalThis as unknown as { stops: number };
      g.stops = 0;
      const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      const send = (s: Record<string, unknown>) =>
        BrowserWindow.getAllWindows()[0].webContents.send('evt:serverState', { ...idle, ...s });
      handlers.set('toolchain:preflight', async () => {
        await wait(600);
        return { ok: true, checks: [], blockers: [] };
      });
      // Each status lasts long enough for the assertions' retries to see it.
      handlers.set('server:start', async () => {
        send({ status: 'starting', port });
        await wait(1_500);
        send({ status: 'running', port, startedAt: Date.now() });
      });
      handlers.set('server:stop', async () => {
        g.stops++;
        send({ status: 'stopping', port });
        await wait(1_500);
        send({});
      });
    },
    { port: freePort, idle: IDLE_STATE }
  );
  try {
    await openPlace('Home');
    const start = page.getByTestId('start-button');
    const stop = page.getByTestId('stop-button');
    await expect(start).toBeEnabled({ timeout: 25_000 });
    await start.focus();
    await page.keyboard.press('Enter');
    // Busy while the check runs: it says so, and keeps focus.
    await expect(start).toHaveAttribute('aria-disabled', 'true');
    await expect(start).toBeFocused();
    // Start becomes Stop in the same place, and focus is on it.
    await expect(announcedStatus(page)).toHaveText('Starting…');
    await expect(stop).toBeFocused();
    await expect(announcedStatus(page)).toHaveText('Running');
    await expect(stop).toBeFocused();
    await expect(stop).not.toHaveAttribute('aria-disabled', 'true');

    await page.keyboard.press('Enter');
    await expect(announcedStatus(page)).toHaveText('Stopping…');
    await expect(stop).toHaveAttribute('aria-disabled', 'true');
    await expect(stop).toBeFocused();
    // Pressing it again while it stops does nothing: one stop, not two.
    await page.keyboard.press('Enter');
    await expect(announcedStatus(page)).toHaveText('Stopped');
    await expect(start).toBeFocused();
    expect(await app.evaluate(() => (globalThis as unknown as { stops: number }).stops)).toBe(1);
  } finally {
    await restoreHandlers();
    await sendServerStates({});
    await expect(announcedStatus(page)).toHaveText('Stopped');
  }
});

test('Start keeps keyboard focus when its own check finds a problem, and the reason is announced', async () => {
  // The check in the background passed, but the one Start runs first fails (the port was taken in
  // between). Home, which is open, says why and offers its fix (from any other place Setup opens to
  // show why), and Start is now blocked: it keeps focus, says it can't be pressed (aria-disabled,
  // never disabled, which would drop focus to nowhere), is described by the reason, and the reason
  // comes into a live region that was there, empty, before it.
  const port = await openPort();
  await port.fill(String(freePort));
  const reason = `Port ${freePort} is in use by another app. Choose another port or close that app.`;
  await keepRealHandlers(['toolchain:preflight', 'server:start']);
  await app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
    const g = globalThis as unknown as { preflight: unknown; starts: number };
    g.preflight = { ok: true, checks: [], blockers: [] };
    g.starts = 0;
    handlers.set('toolchain:preflight', async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return g.preflight;
    });
    handlers.set('server:start', async () => {
      g.starts++;
    });
  });
  const status = page.getByTestId('sidebar-status');
  const reasonLive = status.locator('[aria-live="polite"]:not([role])');
  try {
    await openPlace('Home');
    const start = page.getByTestId('start-button');
    await expect(start).toBeEnabled({ timeout: 25_000 });
    const liveBefore = await reasonLive.evaluateAll((regions) => regions.map((r) => r.textContent));
    // The port is taken now: Start's own check will say so.
    await app.evaluate((_electron, blocker) => {
      (globalThis as unknown as { preflight: unknown }).preflight = { ok: false, checks: [], blockers: [blocker] };
    }, reason);
    await start.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('start-blocked-reason')).toHaveText(reason);
    await expect(page.getByTestId('home-title')).toHaveText('Can’t start yet');
    await expect(page.getByRole('tab', { name: 'Home', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(start).toBeFocused();
    await expect(start).toHaveAttribute('aria-disabled', 'true');
    await expect(start).not.toHaveAttribute('disabled');
    await expect(start).toHaveAccessibleDescription(reason);
    expect(liveBefore).toEqual(['']);
    await expect(reasonLive).toHaveText(reason);
    // Pressing it now does nothing.
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    expect(await app.evaluate(() => (globalThis as unknown as { starts: number }).starts)).toBe(0);
    await expect(start).toBeFocused();
  } finally {
    await restoreHandlers();
    // Looking again (as regaining focus does) finds the port free, and Start comes back.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByTestId('start-button')).toBeEnabled({ timeout: 25_000 });
    await openPlace('Home');
  }
});

test('Stop keeps keyboard focus when the window was opened while the server ran', async () => {
  // A window opened while the server runs has not checked its profile yet (our server holds the
  // port). After Stop, Start says "Checking…" until that first check is back, and keeps focus.
  // The server's state, the stop and a slow check are stood in for in main: nothing runs.
  const profileId = await page.evaluate(
    async () => (await window.xenon.profiles.list()).find((p) => p.name === 'Local server')!.id
  );
  await openPlace('Home');
  await keepRealHandlers(['server:state', 'server:stop', 'toolchain:preflight']);
  await app.evaluate(
    ({ ipcMain, BrowserWindow }, { port, idle, profileId }) => {
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
      const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      const running = { ...idle, status: 'running', port, profileId, startedAt: Date.now() };
      const g = globalThis as unknown as { serverNow: unknown };
      g.serverNow = running;
      handlers.set('server:state', async () => g.serverNow);
      // Long enough that no check is back before the stop.
      handlers.set('toolchain:preflight', async () => {
        await wait(4_000);
        return { ok: true, checks: [], blockers: [] };
      });
      handlers.set('server:stop', async () => {
        const send = (s: unknown) => BrowserWindow.getAllWindows()[0].webContents.send('evt:serverState', s);
        send({ ...running, status: 'stopping' });
        await wait(500);
        g.serverNow = idle;
        send(idle);
      });
    },
    { port: freePort, idle: IDLE_STATE, profileId }
  );
  try {
    const closed = page.waitForEvent('close');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await closed;
    const reopened = app.waitForEvent('window');
    await app.evaluate(({ app: electronApp }) => electronApp.emit('second-instance'));
    page = await reopened;
    adoptWindow(page);
    await expect(profileSwitcher(page)).toBeVisible({ timeout: 20_000 });
    await expect(announcedStatus(page)).toHaveText('Running');
    const stop = page.getByTestId('stop-button');
    const start = page.getByTestId('start-button');
    await stop.focus();
    await page.keyboard.press('Enter');
    await expect(announcedStatus(page)).toHaveText('Stopped');
    await expect(page.getByTestId('start-blocked-reason')).toHaveText('Checking…');
    await expect(start).toBeFocused();
    await expect(start).toHaveAttribute('aria-disabled', 'true');
    // The check comes back: Start can be pressed, and still has focus.
    await expect(start).toBeEnabled({ timeout: 10_000 });
    await expect(start).toBeFocused();
  } finally {
    await restoreHandlers();
    await sendServerStates({});
    await expect(announcedStatus(page)).toHaveText('Stopped');
  }
});

test('the switcher and the Profiles sheet mark the profile whose server is running', async () => {
  // Local server is running while another profile is open. Both lists say which is running, in a
  // word: the switcher and the sheet show it, and the switcher's radio has it in its description.
  const runningId = await page.evaluate(
    async () => (await window.xenon.profiles.list()).find((p) => p.name === 'Local server')!.id
  );
  await createProfileFromMenu();
  let sheet = await openProfilesSheet();
  await renameProfile(sheet, 'New profile', 'Open probe');
  await closeProfilesSheet();
  try {
    await sendServerStates({ status: 'running', profileId: runningId, port: freePort, startedAt: Date.now() });
    await expect(announcedStatus(page)).toHaveText('Running');

    const panel = await openSwitcher();
    const seed = panel.getByRole('radio', { name: 'Local server', exact: true });
    const open = panel.getByRole('radio', { name: 'Open probe', exact: true });
    await expect(open).toHaveAttribute('aria-checked', 'true');
    await expect(seed.getByText('Running', { exact: true })).toBeVisible();
    await expect(seed).toHaveAccessibleDescription(/^(Android|iPhone|Android and iPhone) · port \d+ Running$/);
    await expect(open.getByText('Running', { exact: true })).toHaveCount(0);
    await expect(open).toHaveAccessibleDescription(/^(Android|iPhone|Android and iPhone) · port \d+$/);
    await expectAccessibleInBothThemes(page, 'the profile switcher, with a profile running');
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);

    sheet = await openProfilesSheet();
    await expect(profileRow(sheet, 'Local server').getByText('Running', { exact: true })).toBeVisible();
    await expect(profileRow(sheet, 'Open probe').getByText('Running', { exact: true })).toHaveCount(0);
    await expectAccessibleInBothThemes(page, 'the Profiles sheet, with a profile running');
    await closeProfilesSheet();
  } finally {
    await sendServerStates({});
    await expect(announcedStatus(page)).toHaveText('Stopped');
    sheet = await openProfilesSheet();
    await deleteProfile(sheet, 'Open probe');
    await closeProfilesSheet();
    await expect(profileSwitcher(page)).toHaveText('Local server');
  }
});

test('a place opened from the View menu takes focus when the place it left had it', async () => {
  // Focus in the Port box goes with Settings when View > Home replaces it: it lands on Home's tab,
  // where the person "went", not on nothing.
  const port = await openPort();
  await port.focus();
  await clickMenuItem(app, 'View', { label: 'Home' });
  const home = page.getByRole('tab', { name: 'Home', exact: true });
  await expect(home).toHaveAttribute('aria-selected', 'true');
  await expect(home).toBeFocused();
  // Focus outside the place it left stays where it is.
  await profileSwitcher(page).focus();
  await clickMenuItem(app, 'View', { label: 'Logs' });
  await expect(page.getByRole('tab', { name: 'Logs', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(profileSwitcher(page)).toBeFocused();
  await openPlace('Home');
});

test('a profile imported with an Appium folder that is not text still opens, and the menus still act', async () => {
  // An imported file can hold anything. A number where the Appium folder goes must not stop the
  // option list from loading, which every Start from the menus waits for, nor anything else.
  const dir = mkdtempSync(path.join(os.tmpdir(), 'xenon-import-'));
  const file = path.join(dir, 'odd.xenon-profile.json');
  writeFileSync(
    file,
    JSON.stringify({
      name: 'Odd folder',
      settings: { platform: 'android' },
      server: { port: freePort, basePath: '/wd/hub', appiumHome: 42, keepAliveTimeout: 800 }
    })
  );
  await app.evaluate(({ dialog }, filePath) => {
    const g = globalThis as unknown as { originalOpenDialog?: typeof dialog.showOpenDialog };
    g.originalOpenDialog ??= dialog.showOpenDialog;
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [filePath] })) as typeof dialog.showOpenDialog;
  }, file);
  const errors: string[] = [];
  const onError = (e: Error) => errors.push(e.message);
  page.on('pageerror', onError);
  try {
    await openPlace('Home');
    await clickMenuItem(app, 'File', { label: 'Import Profiles…' });
    await expect(profileSwitcher(page)).toHaveText('Odd folder');
    // Places, the sheet, and a Start (stood in for: nothing starts) are all acted on.
    await clickMenuItem(app, 'View', { label: 'Logs' });
    await expect(page.getByRole('tab', { name: 'Logs', exact: true })).toHaveAttribute('aria-selected', 'true');
    await clickMenuItem(app, 'File', { label: 'Manage Profiles…' });
    await expect(profilesSheet()).toBeVisible();
    await closeProfilesSheet();
    await standIn(NOTHING_STARTS);
    await pressStartShortcut();
    await expect.poll(calledHandlers).toContain('server:start');
    expect(errors).toEqual([]);
  } finally {
    page.off('pageerror', onError);
    await restoreHandlers();
    await app.evaluate(({ dialog }) => {
      const g = globalThis as unknown as { originalOpenDialog?: typeof dialog.showOpenDialog };
      if (g.originalOpenDialog) dialog.showOpenDialog = g.originalOpenDialog;
    });
    rmSync(dir, { recursive: true, force: true });
    const sheet = await openProfilesSheet();
    await deleteProfile(sheet, 'Odd folder');
    await closeProfilesSheet();
    await expect(profileSwitcher(page)).toHaveText('Local server');
  }
});

test('an option list that can’t be read for a profile gives way to the bundled one, and a Start from the menus still acts', async () => {
  // Under main's own guard, the window's: the read for the open profile fails outright. The settings
  // are then checked against the bundled list, so the Start that waits for that check still happens.
  await keepRealHandlers(['schema:get']);
  await app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
    const real = (globalThis as unknown as { realHandlers: Map<string, Handler> }).realHandlers.get('schema:get')!;
    handlers.set('schema:get', (event, profile, opts) => {
      if (!profile || (opts as { bundled?: boolean } | undefined)?.bundled) return real(event, profile, opts);
      throw new Error('the option list could not be read');
    });
  });
  const errors: string[] = [];
  const onError = (e: Error) => errors.push(e.message);
  page.on('pageerror', onError);
  try {
    await createProfileFromMenu();
    const port = await openPort();
    await port.fill(String(freePort));
    await openPlace('Home');
    await standIn(NOTHING_STARTS);
    await pressStartShortcut();
    await expect.poll(calledHandlers).toContain('server:start');
    expect(errors).toEqual([]);
  } finally {
    page.off('pageerror', onError);
    await restoreHandlers();
    const sheet = await openProfilesSheet();
    await deleteProfile(sheet, 'New profile');
    await closeProfilesSheet();
    await expect(profileSwitcher(page)).toHaveText('Local server');
  }
});

test('an export that fails says so', async () => {
  // A save that throws (a full disk, a folder that went away) is told, not dropped.
  await keepRealHandlers(['profiles:export', 'profiles:exportConfigYaml']);
  await app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
    const fail = async () => {
      throw new Error('ENOSPC: no space left on device');
    };
    handlers.set('profiles:export', fail);
    handlers.set('profiles:exportConfigYaml', fail);
  });
  const dismissAll = async () => {
    const dismiss = page.getByRole('alert').getByRole('button', { name: 'Dismiss', exact: true });
    while ((await dismiss.count()) > 0) await dismiss.first().click();
  };
  try {
    await openPlace('Home');
    await clickMenuItem(app, 'File', { label: 'Export Profile…' });
    await expect(page.getByRole('alert').filter({ hasText: 'Couldn’t export the profile.' })).toBeVisible();
    await dismissAll();
    await setTechnical(page, true);
    await clickMenuItem(app, 'Server', { label: 'Export Config…' });
    await expect(page.getByRole('alert').filter({ hasText: 'Couldn’t export the config.' })).toBeVisible();
    await expect(page.getByText('Config saved', { exact: true })).toHaveCount(0);
  } finally {
    await restoreHandlers();
    await dismissAll();
  }
});

test('Set up clicked while Start’s own check runs stops the start', async () => {
  // Start looks at this Mac again before it launches. Set up clicked while that look is out
  // rewrites the Appium folder the start would launch from, so when the look comes back (even
  // passing) nothing starts, and the person stays on Setup, where Set up is running. The look is
  // held in main until released; Set up hangs until finished; a start is counted, not made.
  await keepRealHandlers(['toolchain:preflight', 'setup:install', 'server:start']);
  await app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
    const g = globalThis as unknown as {
      hold: boolean;
      looks: number;
      starts: number;
      releaseLook?: () => void;
      finishSetup?: () => void;
    };
    const ok = { ok: true, checks: [], blockers: [] };
    g.hold = false;
    g.looks = 0;
    g.starts = 0;
    handlers.set('toolchain:preflight', () => {
      g.looks++;
      if (!g.hold) return Promise.resolve(ok);
      return new Promise((resolve) => {
        g.releaseLook = () => resolve(ok);
      });
    });
    handlers.set(
      'setup:install',
      () =>
        new Promise((resolve) => {
          g.finishSetup = () => resolve({ ok: true, failedStep: null });
        })
    );
    handlers.set('server:start', async () => {
      g.starts++;
    });
  });
  const looks = () => app.evaluate(() => (globalThis as unknown as { looks: number }).looks);
  const starts = () => app.evaluate(() => (globalThis as unknown as { starts: number }).starts);
  const hold = (on: boolean) =>
    app.evaluate((_electron, on) => {
      (globalThis as unknown as { hold: boolean }).hold = on;
    }, on);
  const release = () => app.evaluate(() => (globalThis as unknown as { releaseLook: () => void }).releaseLook());
  const start = page.getByTestId('start-button');
  try {
    const port = await openPort();
    await port.fill(String(freePort));
    await openPlace('Home');
    await page.evaluate(() => window.dispatchEvent(new FocusEvent('focus')));
    await expect(start).toBeEnabled({ timeout: 25_000 });

    // The look Start runs first is held.
    await hold(true);
    const before = await looks();
    await start.click();
    await expect.poll(looks).toBeGreaterThan(before);

    // Set up, while it is out; then the look comes back, passing.
    await openPlace('Setup');
    await setUpButton().click();
    await release();
    await page.waitForTimeout(800);
    expect(await starts()).toBe(0);
    await expect(page.getByRole('tab', { name: 'Setup', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(announcedStatus(page)).toHaveText('Stopped');

    // The control: with no Set up, the same held look lets the start through.
    await hold(false);
    await app.evaluate(() => (globalThis as unknown as { finishSetup: () => void }).finishSetup());
    await expect(start).toBeEnabled({ timeout: 25_000 });
    await hold(true);
    const again = await looks();
    await start.click();
    await expect.poll(looks).toBeGreaterThan(again);
    await release();
    await expect.poll(starts).toBe(1);
  } finally {
    await app.evaluate(() => {
      const g = globalThis as unknown as { hold: boolean; releaseLook?: () => void; finishSetup?: () => void };
      g.hold = false;
      g.releaseLook?.();
      g.finishSetup?.();
    });
    await restoreHandlers();
    await openPlace('Home');
  }
});

test('Set up this Mac shows its steps and how it ended, inline beneath it', async () => {
  // Set up is stood in for in main: it reports two steps as main does (each when it starts and
  // again when it ends), holds the second until released, then fails it. Nothing is installed.
  await keepRealHandlers(['setup:install']);
  await app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
    const g = globalThis as unknown as { finishSetup?: () => void };
    handlers.set('setup:install', async (event: unknown) => {
      const sender = (event as { sender: { send: (channel: string, p: unknown) => void } }).sender;
      const send = (p: unknown) => sender.send('evt:setupProgress', p);
      send({ step: 'locate-appium', done: false, ok: false, detail: 'which appium' });
      send({ step: 'locate-appium', done: true, ok: true, detail: '/opt/homebrew/bin/appium' });
      send({ step: 'install-plugin', done: false, ok: false, detail: 'appium plugin install xenon' });
      await new Promise<void>((resolve) => {
        g.finishSetup = resolve;
      });
      send({ step: 'install-plugin', done: true, ok: false, detail: 'npm ERR! 404 Not Found - GET https://registry.npmjs.org/xenon' });
      return { ok: false, failedStep: 'install-plugin' };
    });
  });
  try {
    await openPlace('Setup');
    // A test before this one stood in for the check; coming back to the window looks again for real.
    await page.evaluate(() => window.dispatchEvent(new FocusEvent('focus')));
    await expect(setupRow('node')).toBeVisible({ timeout: 20_000 });
    await setUpButton().click();
    const steps = page.getByRole('list', { name: 'Setup steps', exact: true });
    await expect(steps.getByRole('listitem')).toHaveCount(2);
    await expect(steps.getByRole('listitem').nth(0)).toContainText('Finding Appium');
    await expect(steps.getByRole('listitem').nth(0).getByRole('img', { name: 'Done', exact: true })).toBeVisible();
    await expect(steps.getByRole('listitem').nth(1)).toContainText('Installing Xenon');
    await expect(steps.getByRole('listitem').nth(1).getByRole('img', { name: 'In progress', exact: true })).toBeVisible();
    // The steps are under the button, not a scroll area of their own.
    expect(await steps.evaluate((el) => getComputedStyle(el).overflowY)).toBe('visible');
    // While it runs, nothing else looks at this Mac: Check again says it can't, and keeps its place.
    await expect(page.getByTestId('setup-check-again')).toHaveAttribute('aria-disabled', 'true');
    expect(findJargon(await ownWords(page), await optionKeys(page))).toEqual([]);
    await expectAccessibleInBothThemes(page, 'setup, setting up');

    await app.evaluate(() => (globalThis as unknown as { finishSetup: () => void }).finishSetup());
    const summary = page.getByTestId('setup-summary');
    // A3's summary (its toast's words), as they are.
    await expect(summary).toHaveText("Setup didn't finish: Installing Xenon failed. See the steps on Setup.");
    await expect(steps.getByRole('listitem').nth(1).getByRole('img', { name: 'Failed', exact: true })).toBeVisible();
    // The failed step's own error is quoted as it is, in the mono face.
    await expect(steps.locator('[data-raw]')).toHaveText(/npm ERR! 404/);
    await expect(setUpButton()).toHaveText('Set up this Mac');
    await expect(setUpButton()).not.toHaveAttribute('aria-disabled');
    // The toast says the same, at once (assertively, as an error); it floats over the page, so it is
    // dismissed before the page is checked, as a person would.
    const toastAlert = page.getByRole('alert').filter({ hasText: "Setup didn't finish" });
    await expect(toastAlert).toBeVisible();
    await toastAlert.getByRole('button', { name: 'Dismiss', exact: true }).first().click();
    await expect(toastAlert).toHaveCount(0);
    await expect(summary).toBeVisible();
    expect(findJargon(await ownWords(page), await optionKeys(page))).toEqual([]);
    await expectAccessibleInBothThemes(page, 'setup, after a failed run');
  } finally {
    await app.evaluate(() => (globalThis as unknown as { finishSetup?: () => void }).finishSetup?.());
    await restoreHandlers();
  }
});

test('a row’s own action that fixes the row leaves keyboard focus on the row’s sentence, not nowhere', async () => {
  // The check and Set up are stood in for in main: the driver list can't be read, then lacks the
  // Android driver, then (after Set up, which is held until released) has both. Nothing is installed.
  await keepRealHandlers(['toolchain:preflight', 'setup:install']);
  await app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
    const g = globalThis as unknown as { drivers: string; finishSetup?: () => void };
    g.drivers = 'could not list drivers';
    const ok = (id: string, label: string, detail: string) => ({ id, label, status: 'ok', code: 'ok', detail, blocking: false });
    handlers.set('toolchain:preflight', async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      const listed = g.drivers.startsWith('installed');
      return {
        ok: true,
        checks: [
          ok('node', 'Node.js', 'v22.12.0'),
          ok('appium', 'Appium', '3.1.1'),
          { id: 'drivers', label: 'Appium drivers', status: listed ? 'ok' : 'warn', code: listed ? 'ok' : 'list-failed', detail: g.drivers, blocking: false },
          ok('adb', 'Android SDK (adb)', 'Android Debug Bridge version 1.0.41 — ANDROID_HOME=/sdk'),
          ok('xcode', 'Xcode', 'Xcode 16.0'),
          ok('go-ios', 'iPhone support', 'Ready for iPhones')
        ],
        blockers: []
      };
    });
    handlers.set('setup:install', async (event: unknown) => {
      const sender = (event as { sender: { send: (channel: string, p: unknown) => void } }).sender;
      sender.send('evt:setupProgress', { step: 'locate-appium', done: true, ok: true, detail: '/opt/homebrew/bin/appium' });
      await new Promise<void>((resolve) => {
        g.finishSetup = resolve;
      });
      g.drivers = 'installed: uiautomator2, xcuitest';
      return { ok: true, failedStep: null };
    });
  });
  const setDrivers = (drivers: string) =>
    app.evaluate((_electron, drivers) => {
      (globalThis as unknown as { drivers: string }).drivers = drivers;
    }, drivers);
  const focused = () =>
    page.evaluate(() => {
      const a = document.activeElement;
      if (a === null || a === document.body) return 'BODY';
      const row = a.closest('[data-testid^="setup-row-"]')?.getAttribute('data-testid') ?? '';
      return `${row} ${a.tagName}: ${(a.textContent ?? '').trim()}`;
    });
  const android = setupRow('android-support');
  const sentence = android.locator('[data-row-sentence]');
  try {
    await openPlace('Setup');
    await page.evaluate(() => window.dispatchEvent(new FocusEvent('focus')));

    // 1. The list could not be read. The row's Check again, from the keyboard, reads it: the row is
    // fine now and its button goes, so focus goes to what the row says.
    const checkAgain = android.getByRole('button', { name: 'Check again', exact: true });
    await expect(checkAgain).toBeVisible({ timeout: 15_000 });
    await setDrivers('installed: uiautomator2, xcuitest');
    await checkAgain.focus();
    await page.keyboard.press('Enter');
    await expect(android).toContainText('Android support is installed.', { timeout: 15_000 });
    expect(await focused()).toBe('setup-row-android-support P: Android support is installed.');
    await expect(sentence).toBeFocused();

    // 2. The Android driver is missing. The row's Set up this Mac, from the keyboard: while Set up runs
    // it can't be pressed and says why; once Set up and the look after it are done, the row is fine.
    await setDrivers('installed: xcuitest');
    await page.evaluate(() => window.dispatchEvent(new FocusEvent('focus')));
    const setUp = android.getByRole('button', { name: 'Set up this Mac', exact: true });
    await expect(setUp).toBeVisible({ timeout: 15_000 });
    await setUp.focus();
    await page.keyboard.press('Enter');
    await expect(setUpButton()).toHaveText('Setting up…');
    await expect(setUp).toHaveAttribute('aria-disabled', 'true');
    await expect(setUp).toHaveAccessibleDescription('Android support isn’t installed yet. Wait for Set up to finish.');
    await expect(setUp).toBeFocused();
    const header = page.getByTestId('setup-check-again');
    await expect(header).toHaveAttribute('aria-disabled', 'true');
    await expect(header).toHaveAccessibleDescription('Wait for Set up to finish.');
    await app.evaluate(() => (globalThis as unknown as { finishSetup: () => void }).finishSetup());
    await expect(android).toContainText('Android support is installed.', { timeout: 15_000 });
    expect(await focused()).toBe('setup-row-android-support P: Android support is installed.');
    await expect(sentence).toBeFocused();
  } finally {
    await app.evaluate(() => (globalThis as unknown as { finishSetup?: () => void }).finishSetup?.());
    await restoreHandlers();
    await page.evaluate(() => window.dispatchEvent(new FocusEvent('focus')));
    await expect(setupRow('node')).toBeVisible({ timeout: 20_000 });
  }
});

test('a Set up run’s steps and how it ended show on the profile it ran for, not on another', async () => {
  // Set up is stood in for in main: one step, then it finishes. Nothing is installed.
  await keepRealHandlers(['setup:install']);
  await app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
    handlers.set('setup:install', async (event: unknown) => {
      const sender = (event as { sender: { send: (channel: string, p: unknown) => void } }).sender;
      sender.send('evt:setupProgress', { step: 'locate-appium', done: false, ok: false, detail: 'which appium' });
      sender.send('evt:setupProgress', { step: 'locate-appium', done: true, ok: true, detail: '/opt/homebrew/bin/appium' });
      return { ok: true, failedStep: null };
    });
  });
  const steps = page.getByRole('list', { name: 'Setup steps', exact: true });
  const summary = page.getByTestId('setup-summary');
  try {
    await openPlace('Setup');
    await setUpButton().click();
    await expect(summary).toHaveText('Setup finished', { timeout: 15_000 });
    await expect(steps.getByRole('listitem')).toHaveCount(1);

    // Another profile's Setup says nothing about a run that wasn't for it.
    await createProfile();
    await openPlace('Setup');
    await expect(setupRow('node')).toBeVisible({ timeout: 20_000 });
    await expect(summary).toHaveCount(0);
    await expect(steps).toHaveCount(0);

    // Back on the profile it ran for, they are there again.
    await switchProfile('Local server');
    await expect(summary).toHaveText('Setup finished');
    await expect(steps.getByRole('listitem')).toHaveCount(1);
  } finally {
    await restoreHandlers();
    if ((await profileSwitcher().textContent()) !== 'Local server') await switchProfile('Local server');
    const sheet = await openProfilesSheet();
    if ((await sheet.getByTestId('profile-row').count()) > 1) await deleteProfile(sheet, 'New profile');
    await closeProfilesSheet();
  }
});

test('Start waits while Set up runs, and comes back when it ends', async () => {
  // A real setup installs for minutes and changes this Mac. Stand in for it, in
  // the main process where the handler lives, with one that hangs until released.
  // The real one is put back afterwards, for the tests after this one.
  await keepRealHandlers(['setup:install']);
  await app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
    handlers.set(
      'setup:install',
      () =>
        new Promise((resolve) => {
          (globalThis as unknown as { finishSetup: () => void }).finishSetup = () =>
            resolve({ ok: true, failedStep: null });
        })
    );
  });
  try {
    // Start must be on to begin with: a port nobody holds, as the other Start tests use.
    const port = await openPort();
    await port.fill(String(freePort));
    const start = page.getByTestId('start-button');
    await expect(start).toBeEnabled({ timeout: 25_000 });

    await openPlace('Setup');
    await setUpButton().click();
    // It says it is running and can't be pressed again, and keeps focus (it is never natively disabled).
    await expect(setUpButton()).toHaveText('Setting up…');
    await expect(page.getByRole('button', { name: 'Setting up…' })).toBeDisabled();
    await expect(setUpButton()).toBeFocused();

    // A start now could launch against a half-installed Appium folder, so Start says to wait.
    const reason = 'Wait for Set up to finish.';
    await expect(start).toBeDisabled();
    await expect(start).toHaveAttribute('title', reason);
    await expect(page.getByTestId('start-blocked-reason')).toHaveText(reason);

    // The shortcut does nothing either: no check, no start, no jump to another place.
    await openPlace('Settings');
    await pressStartShortcut();
    await expect(page.getByRole('tab', { name: 'Settings', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(announcedStatus(page)).toHaveText('Stopped');
    await expect(page.getByTestId('stop-button')).toHaveCount(0);
    await expect(start).toBeDisabled();

    // Set up ends: Start is checked again at once and comes back by itself.
    await app.evaluate(() => (globalThis as unknown as { finishSetup: () => void }).finishSetup());
    await expect(start).toBeEnabled({ timeout: 25_000 });
    await expect(page.getByTestId('start-blocked-reason')).toHaveCount(0);
  } finally {
    await app.evaluate(() => (globalThis as unknown as { finishSetup?: () => void }).finishSetup?.());
    await restoreHandlers();
  }
});

test('a closed window reopened by a menu-bar action still gets that action', async () => {
  // The menu-bar icon's Start Server, with the window closed, reopens it (showWindow) and sends the
  // Start in the same click. Playwright can't open the menu-bar icon's menu, so this does the same
  // two steps with what it can reach: 'second-instance' runs showWindow, and View > Logs stands in
  // for the action (a real Start would start a server).
  const closed = page.waitForEvent('close');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await closed;
  const reopened = app.waitForEvent('window');
  await app.evaluate(({ app: electronApp, Menu }) => {
    electronApp.emit('second-instance');
    const view = Menu.getApplicationMenu()?.items.find((i) => i.label === 'View');
    view?.submenu?.items.find((i) => i.label === 'Logs')?.click();
  });
  page = await reopened;
  adoptWindow(page);
  await expect(profileSwitcher(page)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('tab', { name: 'Logs', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('an app menu item with the window closed opens it again, and is acted on', async () => {
  // View ⌘1–⌘4, File's items and Server's work from the menu bar with no window open: the window
  // comes back and does what was chosen.
  const closed = page.waitForEvent('close');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await closed;
  const reopened = app.waitForEvent('window');
  await clickMenuItem(app, 'View', { accelerator: 'Cmd+3' });
  page = await reopened;
  adoptWindow(page);
  await expect(profileSwitcher(page)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('tab', { name: 'Settings', exact: true })).toHaveAttribute('aria-selected', 'true');
  await openPlace('Home');
});

test('Start from the menu-bar icon into a closed window starts the profile that was open, and shows it', async () => {
  // Closing the window ends the page that knew which profile was open. The menu-bar icon's Start
  // reopens it, and must start that profile, not the first one; the window must show it too.
  await createProfileFromMenu();
  const sheet = await openProfilesSheet();
  await renameProfile(sheet, 'New profile', 'Profile B');
  await closeProfilesSheet();
  const port = await openPort();
  await port.fill(String(freePort));
  await expect
    .poll(() => page.evaluate(async () => (await window.xenon.profiles.list()).find((p) => p.name === 'Profile B')?.server.port))
    .toBe(freePort);
  await openPlace('Home');
  // Record which profile a start is for; the check passes. Nothing is launched.
  await keepRealHandlers(['toolchain:preflight', 'server:start']);
  await app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
    const g = globalThis as unknown as { started: string[] };
    g.started = [];
    handlers.set('toolchain:preflight', async () => ({ ok: true, checks: [], blockers: [] }));
    handlers.set('server:start', async (_e, profile) => {
      g.started.push((profile as { name: string }).name);
    });
  });
  const started = () => app.evaluate(() => (globalThis as unknown as { started: string[] }).started);
  try {
    const closed = page.waitForEvent('close');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await closed;
    // What the menu-bar icon's Start does: show the window, then send it 'start-server'.
    const reopened = app.waitForEvent('window');
    await app.evaluate(({ app: electronApp, BrowserWindow }) => {
      electronApp.emit('second-instance');
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.once('did-finish-load', () => win.webContents.send('evt:menuAction', 'start-server'));
    });
    page = await reopened;
    adoptWindow(page);
    await expect(profileSwitcher(page)).toHaveText('Profile B', { timeout: 20_000 });
    await expect.poll(started).toEqual(['Profile B']);
  } finally {
    await restoreHandlers();
    const sheet = await openProfilesSheet();
    await deleteProfile(sheet, 'Profile B');
    await closeProfilesSheet();
    await expect(profileSwitcher(page)).toHaveText('Local server');
  }
});

test('the next launch opens the profile that was open when the app quit', async () => {
  // A second app, on its own folder, alongside the suite's: open a second profile, quit, and launch
  // again on the same folder.
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'xenon-e2e-relaunch-'));
  try {
    let other = await launchApp({ userDataDir, asCurrent: false });
    await expect(profileSwitcher(other.page)).toHaveText('Local server');
    await createProfileFromMenu(other.page, other.app);
    const openId = await other.page.evaluate(
      async () => (await window.xenon.profiles.list()).find((p) => p.name === 'New profile')!.id
    );
    await expect.poll(() => other.page.evaluate(() => window.xenon.profiles.lastOpen())).toBe(openId);
    await other.app.close();

    other = await launchApp({ userDataDir, asCurrent: false });
    await expect(profileSwitcher(other.page)).toHaveText('New profile');
    await other.app.close();
  } finally {
    rmSync(userDataDir, { recursive: true, force: true });
  }
});
