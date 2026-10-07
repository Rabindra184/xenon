import { test, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { accessibilityProblems, expectAccessible, expectAccessibleInBothThemes } from './a11y';
import { findJargon } from './jargon';
import {
  clickMenuItem,
  closeProfilesSheet,
  createProfile,
  createProfileFromMenu,
  deleteProfile,
  launchApp,
  openPlace,
  openProfilesSheet,
  openSwitcher,
  pinRow,
  pressStartShortcut,
  profileRow,
  profileSwitcher,
  profilesSheet,
  renameProfile,
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

async function pickFreePort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as net.AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

test.beforeAll(async () => {
  freePort = await pickFreePort();
  ({ app, page } = await launchApp());
});

test.afterAll(async () => {
  await app?.close();
});

/** One of the tabs inside Settings. */
async function openSettingsTab(name: 'All settings' | 'Keys & accounts') {
  await openPlace('Settings');
  const tab = page.getByRole('tab', { name, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

/** The port box in Settings' Server group. */
const portField = () => page.getByRole('spinbutton', { name: 'Port' });

/** Opens Settings at the Server group and returns its port box. */
async function openPort() {
  await openSettingsTab('All settings');
  return portField();
}

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
  await expect(page.getByTestId('sidebar-status')).toContainText('Stopped');
  // The status is announced politely when it changes.
  await expect(page.getByTestId('sidebar-status').locator('[aria-live="polite"]')).toHaveText('Stopped');
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
  await page.keyboard.press('Enter');
  await expect(page.locator('main#content')).toBeFocused();
});

test('renders the schema-driven settings form with grouped sections', async () => {
  await openSettingsTab('All settings');
  // The server's own settings come first.
  await expect(page.getByRole('region', { name: 'Server' })).toBeVisible();
  // Section titles appear twice (nav + heading); assert on the headings.
  await expect(page.getByRole('heading', { name: 'Platform & Discovery' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Session Control' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'AI & Self-Healing' })).toBeVisible();
  // The line saying which Xenon these options come from (installed or bundled depends on the machine).
  await expect(page.getByTestId('schema-source')).toContainText(/Xenon \d+\.\d+\.\d+/);
  // A representative field auto-generated from the option list.
  await expect(page.getByText('Max Sessions')).toBeVisible();
  // Secret-bearing settings are deferred to Keys & accounts, not shown as inputs
  // (the three AI keys and the Database URL render this notice).
  await expect(page.getByText(/is a secret — set it in Keys & accounts/).first()).toBeVisible();
  await expect(page.getByText(/is a secret — set it in Keys & accounts/)).toHaveCount(4);
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
    const tab = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Re-check'))?.closest('.overflow-auto');
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
  await openSettingsTab('All settings');
  const android = page.getByRole('radio', { name: 'android', exact: true }).first();
  await android.click();
  await expect(android).toHaveAttribute('aria-checked', 'true');
  // Re-read via a fresh selection round-trip: leave Settings and come back.
  await openPlace('Setup');
  await openPlace('Settings');
  await expect(page.getByRole('radio', { name: 'android', exact: true }).first()).toHaveAttribute(
    'aria-checked',
    'true'
  );
});

test('a setting changed just before creating a profile is kept', async () => {
  // The save waits 300 ms for typing to stop and holds one edit. Creating a
  // profile didn't save it first, so the new profile's first edit replaced it
  // and the setting was lost.
  await openSettingsTab('All settings');
  await page.getByTestId('settings-search').fill('');
  const original = ((await profileSwitcher(page).textContent()) ?? '').trim();
  const platform = page.getByRole('radiogroup', { name: 'Platform', exact: true });
  const basePath = page.getByRole('textbox', { name: 'Base path', exact: true });
  const previous = (await platform.getByRole('radio', { checked: true }).textContent())?.trim();
  const changed = previous === 'ios' ? 'both' : 'ios';

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
  await openSettingsTab('All settings');
  await page.getByTestId('settings-search').fill('bootedSimulators');
  await expect(page.getByRole('switch').first()).toHaveAttribute('aria-checked', 'true');

  // Clean up: remove the probe profile.
  sheet = await openProfilesSheet();
  await deleteProfile(sheet, 'Booted default probe');
  await closeProfilesSheet();
  await openSettingsTab('All settings');
  await page.getByTestId('settings-search').fill('');
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
  await openSettingsTab('Keys & accounts');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
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
    await sheet.getByRole('button', { name: 'Export…', exact: true }).click();
    // The notice counts the values left out and names none; the file has the name but not the value.
    const notice = sheet.getByRole('status').filter({ hasText: 'secret value' });
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

    // File > Export Profile… with the sheet closed opens it, to say so.
    await clickMenuItem(app, 'File', { label: 'Export Profile…' });
    await expect(profilesSheet()).toBeVisible();
    await expect(profilesSheet().getByText('1 secret value was left out', { exact: false })).toBeVisible();

    // A cancelled dialog saves nothing and says nothing.
    await app.evaluate(({ dialog }) => {
      dialog.showSaveDialog = (async () => ({ canceled: true, filePath: '' })) as typeof dialog.showSaveDialog;
    });
    await sheet.getByRole('button', { name: 'Export…', exact: true }).click();
    await expect(sheet.getByText('secret value')).toHaveCount(0);
  } finally {
    await app.evaluate(({ dialog }) => {
      const g = globalThis as unknown as { originalSaveDialog?: typeof dialog.showSaveDialog };
      if (g.originalSaveDialog) dialog.showSaveDialog = g.originalSaveDialog;
    });
    await setTechnical(page, false);
    rmSync(dir, { recursive: true, force: true });
  }

  // Clean up: remove the probe.
  await deleteProfile(profilesSheet(), 'Export probe');
  await closeProfilesSheet();
  await expect(profileSwitcher(page)).toHaveText('Local server');
});

test('logs tab is reachable and distinct from the Log Folder button', async () => {
  // The place has role=tab; the folder opener is a button named "Open log folder".
  await setTechnical(page, true);
  await openPlace('Logs');
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
  await page.getByTestId('settings-search').fill('adbRemote');
  const chipInput = page.getByPlaceholder('add + Enter').first();
  await chipInput.fill('192.168.1.50:5555');
  await chipInput.press('Enter');
  await expect(page.getByText('192.168.1.50:5555')).toBeVisible();

  // Round-trip through the store: leave Settings and come back.
  await openPlace('Setup');
  await openPlace('Settings');
  await page.getByTestId('settings-search').fill('adbRemote');
  await expect(page.getByText('192.168.1.50:5555')).toBeVisible();

  await page.getByRole('button', { name: 'Remove 192.168.1.50:5555' }).click();
  await expect(page.getByText('192.168.1.50:5555')).not.toBeVisible();
  await page.getByTestId('settings-search').fill('');
});

test('table editor round-trips an object-array setting', async () => {
  await openSettingsTab('All settings');
  await page.getByTestId('settings-search').fill('simulators');
  await page.getByRole('button', { name: 'Add row' }).first().click();
  const cell = page.getByRole('textbox', { name: 'name row 1' });
  await cell.fill('iPhone 15');
  await cell.blur();

  await openPlace('Setup');
  await openPlace('Settings');
  await page.getByTestId('settings-search').fill('simulators');
  await expect(page.getByRole('textbox', { name: 'name row 1' })).toHaveValue('iPhone 15');

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
  await expect(page.getByTestId('sidebar-status')).toContainText('Stopped');
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
  await expect(page.getByTestId('sidebar-status')).toContainText('Stopped');

  await portField().fill(String(freePort));
});

test('profile edits survive a rapid-typing debounce window', async () => {
  // The base path is a text box whose edits are saved 300 ms after typing stops.
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
  await openSettingsTab('All settings');
  const basePath = page.getByRole('textbox', { name: 'Base path', exact: true });
  const original = await basePath.inputValue();
  const port = portField();
  const originalPort = await port.inputValue();
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
    await port.fill('');
    await basePath.fill('/abcd');
    await page.waitForTimeout(900);
    await expect(port).toHaveValue('');
    await expect.poll(stored, { timeout: 5_000 }).toBe('/abcd');
  } finally {
    await app.evaluate(({ ipcMain }) => {
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
      const save = (globalThis as unknown as Slow).originalSave;
      if (save) handlers.set('profiles:save', save);
    });
    await port.fill(originalPort);
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

test('settings search filters fields by key name', async () => {
  await openSettingsTab('All settings');
  const search = page.getByTestId('settings-search');
  await search.fill('adbRemote');
  await expect(page.getByText('ADB Remote')).toBeVisible();
  await expect(page.getByText('Max Sessions')).not.toBeVisible();
  await search.fill('zzz-no-match');
  await expect(page.getByText(/No settings match/)).toBeVisible();
  await search.fill('');
  await expect(page.getByText('Max Sessions')).toBeVisible();
});

test('the sidebar status says Stopped, and Setup names the installed Xenon', async () => {
  await expect(page.getByTestId('sidebar-status')).toContainText('Stopped');
  // A definite answer, not a pending placeholder: either a version read from
  // this machine's Appium folder or an explicit "isn't installed".
  await openPlace('Setup');
  await expect(page.getByTestId('plugin-version')).toHaveText(/^Xenon (\d+\.\d+\.\d+ is installed|isn’t installed yet)$/);
});

test('secrets panel lists env-injected secrets and toggles injection', async () => {
  await openSettingsTab('Keys & accounts');
  await expect(page.getByText('Gemini API key')).toBeVisible();
  await expect(page.getByText('XENON_HUB_TOKEN')).toBeVisible();
  // Toggle "inject in this profile" for the first secret.
  const firstInject = page.getByRole('checkbox').first();
  await firstInject.check();
  await expect(firstInject).toBeChecked();
  await page.screenshot({ path: path.join(shotsDir, '04-secrets.png'), fullPage: true });
});

test('env-vars editor adds an arbitrary variable to the profile', async () => {
  await openSettingsTab('Keys & accounts');
  await expect(page.getByRole('heading', { name: 'Environment variables' })).toBeVisible();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const keyInput = page.getByPlaceholder('KEY').first();
  await keyInput.fill('OTEL_EXPORTER_OTLP_ENDPOINT');
  await expect(keyInput).toHaveValue('OTEL_EXPORTER_OTLP_ENDPOINT');
  await expect(page.getByText(/saved in the profile as plain text/)).toHaveCount(0);
  // A variable named like a secret is pointed at its Keychain-backed field.
  await keyInput.fill('DATABASE_URL');
  await expect(page.getByText(/DATABASE_URL belongs above, under Database URL/)).toBeVisible();
  await keyInput.fill('OTEL_EXPORTER_OTLP_ENDPOINT');
  await expect(page.getByText(/saved in the profile as plain text/)).toHaveCount(0);
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

test('Setup runs toolchain checks', async () => {
  await openPlace('Setup');
  await expect(page.getByText('Node.js')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Appium', { exact: true })).toBeVisible();
  await expect(page.getByText(/First-run setup/)).toBeVisible();
  // The ports row for simulators and WebDriverAgent is retired: the plugin chooses those itself.
  await expect(page.getByText('Simulator / WDA ports')).toHaveCount(0);
  // The button says "Set up" (the checks' remedies tell people to run it); the server is stopped here.
  await expect(page.getByRole('button', { name: 'Set up', exact: true })).toBeEnabled();
  await page.screenshot({ path: path.join(shotsDir, '05-health.png'), fullPage: true });
  // No serious or critical WCAG 2.1 A/AA problem in either theme, contrast
  // included down the whole place, and nothing left out.
  await expectAccessibleInBothThemes(page, 'setup');
});

test('Setup surfaces the resolved ANDROID_HOME', async () => {
  await openPlace('Setup');
  // adb check reports the SDK root the launcher injects, not just a version.
  await expect(page.getByText(/ANDROID_HOME=|no Android SDK detected|SDK root could be resolved/)).toBeVisible({
    timeout: 20_000
  });
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
  await expect(page.getByTestId('sidebar-status')).toContainText('Stopped');
  await page.screenshot({ path: path.join(shotsDir, '06-preflight-block.png'), fullPage: true });
  // The blocker box reads in both themes (its words were danger-on-tint, 4.48:1 in light).
  await expectAccessibleInBothThemes(page, 'setup with blockers');
  // Home lists the same reasons.
  await openPlace('Home');
  await expect(page.getByTestId('readiness-blockers').getByText(reason).first()).toBeVisible();

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
  const version = page.getByTestId('plugin-version');
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
  const announced = status.locator('[aria-live="polite"]');
  const logs = page.getByRole('tab', { name: 'Logs', exact: true });
  try {
    await openPlace('Home');
    await send({ status: 'running', port: freePort, startedAt: Date.now(), dashboardUrl: `http://127.0.0.1:${freePort}/xenon/` });
    await expect(announced).toHaveText('Running');
    await expect(page.getByTestId('stop-button')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open dashboard' })).toBeVisible();
    await expect(logs).toHaveAccessibleDescription('');

    await send({ status: 'crashed', exitCode: 1, lastError: 'Appium exited with code 1' });
    await expect(announced).toHaveText('Stopped unexpectedly');
    await expect(page.getByTestId('start-button')).toBeVisible();
    // The dot is the tab's description; its name is still just the place.
    await expect(logs).toHaveAccessibleName('Logs');
    await expect(logs).toHaveAccessibleDescription('New problem');
    // Home quotes what the server last said, marked as quoted rather than the app's own words.
    await expect(page.locator('[data-raw]')).toHaveText('Appium exited with code 1');

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

test('Start waits while Set up runs, and comes back when it ends', async () => {
  // A real setup installs for minutes and changes this Mac. Stand in for it, in
  // the main process where the handler lives, with one that hangs until released.
  // This is the last test, so the stand-in does not outlive the ones that need the real thing.
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('setup:install');
    ipcMain.handle(
      'setup:install',
      () =>
        new Promise((resolve) => {
          (globalThis as unknown as { finishSetup: () => void }).finishSetup = () =>
            resolve({ ok: true, failedStep: null });
        })
    );
  });

  // Start must be on to begin with: a port nobody holds, as the other Start tests use.
  const port = await openPort();
  await port.fill(String(freePort));
  const start = page.getByTestId('start-button');
  await expect(start).toBeEnabled({ timeout: 25_000 });

  await openPlace('Setup');
  await page.getByRole('button', { name: 'Set up', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Setting up…' })).toBeDisabled();

  // A start now could launch against a half-installed Appium folder, so Start says to wait.
  const reason = 'Wait for Set up to finish.';
  await expect(start).toBeDisabled();
  await expect(start).toHaveAttribute('title', reason);
  await expect(page.getByTestId('start-blocked-reason')).toHaveText(reason);

  // The shortcut does nothing either: no check, no start, no jump to another place.
  await openPlace('Settings');
  await pressStartShortcut();
  await expect(page.getByRole('tab', { name: 'Settings', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('sidebar-status')).toContainText('Stopped');
  await expect(page.getByTestId('stop-button')).toHaveCount(0);
  await expect(start).toBeDisabled();

  // Set up ends: Start is checked again at once and comes back by itself.
  await app.evaluate(() => (globalThis as unknown as { finishSetup: () => void }).finishSetup());
  await expect(start).toBeEnabled({ timeout: 25_000 });
  await expect(page.getByTestId('start-blocked-reason')).toHaveCount(0);
});
