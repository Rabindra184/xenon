import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { makeDefaultProfile } from '../../src/shared/profileDefaults';
import type { Profile } from '../../src/shared/types';
import { expectAccessibleInBothThemes } from './a11y';
import { findJargon } from './jargon';
import {
  announcedStatus,
  clickMenuItem,
  closeProfilesSheet,
  createProfile,
  deleteProfile,
  launchApp,
  openPlace,
  openProfilesSheet,
  optionKeys,
  ownWords,
  pickFreePort,
  pressStartShortcut,
  profileSwitcher,
  restoreClipboard,
  saveClipboard,
  seedProfiles,
  setTechnical,
  switchProfile
} from './helpers';

// Home against this Mac's real toolchain (Node.js, Appium and the Xenon in the
// Appium folder the app finds), with real servers. They start on ports picked
// free for the run, never 4723, for Android emulators only, with Xenon's
// database in the run's own folder, so nothing here reaches the developer's own
// server, phones or devices list. Every server a test starts is stopped by it.

let app: ElectronApplication;
let page: Page;
let userDataDir: string;
let freePort = 0;
/** The Mac's clipboard text before the run: the copy tests overwrite it, and it is put back after. */
let savedClipboard: string | null = null;

/** A profile for real starts: Android emulators only, on `port`. */
function testProfile(port: number, name = 'Local server'): Profile {
  const p = makeDefaultProfile({ id: randomUUID(), now: Date.now(), name });
  return {
    ...p,
    settings: { ...p.settings, platform: 'android', androidDeviceType: 'simulated' },
    server: { ...p.server, port }
  };
}

/** What the app's environment adds, so a server it starts keeps its devices list in `dir`. */
const isolatedEnv = (dir: string) => ({ DATABASE_URL: `file:${path.join(dir, 'xenon-e2e.db')}` });

test.beforeAll(async () => {
  freePort = await pickFreePort();
  userDataDir = mkdtempSync(path.join(os.tmpdir(), 'xenon-e2e-home-'));
  seedProfiles(userDataDir, [testProfile(freePort)]);
  ({ app, page } = await launchApp({ userDataDir, env: isolatedEnv(userDataDir) }));
  savedClipboard = await saveClipboard(app);
});

test.afterAll(async () => {
  // The clipboard first: a stop that throws must not leave the Mac's clipboard holding an address.
  try {
    if (savedClipboard !== null) await restoreClipboard(app, savedClipboard);
  } finally {
    try {
      if (page) await stopServer(page);
    } finally {
      await app?.close();
      if (userDataDir) rmSync(userDataDir, { recursive: true, force: true });
    }
  }
});

test.afterEach(async () => {
  await setTechnical(page, false);
});

const home = (p: Page = page) => p.getByTestId('home');
const homeTitle = (p: Page = page) => p.getByTestId('home-title');
/** One of Home's own buttons, by its exact name (the sidebar has a Start and Stop too). */
const homeButton = (name: string | RegExp, p: Page = page) =>
  home(p).getByRole('button', { name, exact: typeof name === 'string' });

const serverState = (p: Page = page) =>
  p.evaluate(() => window.xenon.server.state()) as Promise<{ status: string; pid: number | null; port: number | null }>;

/** Starts the open profile's server from Home and waits until it runs. */
async function startFromHome(p: Page = page) {
  await expect(homeTitle(p)).toHaveText(/Ready to start|Xenon stopped unexpectedly/, { timeout: 25_000 });
  const start = homeButton(/^(Start|Start again)$/, p);
  await start.click();
  await expect(announcedStatus(p)).toHaveText('Running', { timeout: 60_000 });
}

/** Stops the server if one is active, and waits until it has. */
async function stopServer(p: Page = page) {
  const { status } = await serverState(p);
  if (status === 'stopped' || status === 'crashed') return;
  await p.evaluate(() => window.xenon.server.stop());
  await expect
    .poll(async () => (await serverState(p)).status, { timeout: 45_000 })
    .toMatch(/^(stopped|crashed)$/);
}

const clipboard = () => app.evaluate(({ clipboard }) => clipboard.readText());

/** The newest "Copied" toast (an earlier copy's may still be up). */
const copiedToast = () => page.getByRole('status').getByText('Copied', { exact: true }).last();

/** With technical details off, the window is in plain words, and it passes axe in both themes. */
async function plainAndAccessible(state: string) {
  await setTechnical(page, false);
  expect(findJargon(await ownWords(page), await optionKeys(page)), `home-${state}: words`).toEqual([]);
  await expectAccessibleInBothThemes(page, `home-${state}`);
}

/** One of the tabs inside Settings. */
async function openSettingsTab(name: 'Essentials' | 'All settings' | 'Keys & accounts') {
  await openPlace('Settings');
  const tab = page.getByRole('tab', { name, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

/** The port box in Settings' Essentials. */
async function portField() {
  await openSettingsTab('Essentials');
  return page.getByRole('spinbutton', { name: 'Port tests connect to', exact: true });
}

test('Home is ready on a set-up Mac', async () => {
  await openPlace('Home');
  await expect(homeTitle()).toHaveText('Ready to start', { timeout: 25_000 });
  await expect(home()).toContainText('Android phones · this Mac only');
  const start = homeButton('Start');
  await start.focus();
  await expect(start).toBeFocused();
  // Start and Stop change colour at once, never cross-fading Start onto red or Stop onto green.
  const transition = (testId: string) =>
    page.getByTestId(testId).evaluate((el) => getComputedStyle(el).transitionProperty);
  expect(await transition('home-primary')).toBe('none');
  expect(await transition('start-button')).toBe('none');
  await plainAndAccessible('ready');
});

test('a port in use offers Use port N and it works', async () => {
  const taken = net.createServer();
  await new Promise<void>((resolve) => taken.listen(freePort, resolve));
  try {
    await openPlace('Home');
    // Coming back to the window looks again.
    await page.evaluate(() => window.dispatchEvent(new FocusEvent('focus')));
    await expect(homeTitle()).toHaveText('Can’t start yet', { timeout: 15_000 });
    await expect(home()).toContainText(`Port ${freePort} is already in use by another app.`);
    const fix = homeButton(/^Use port \d+$/);
    await expect(fix).toBeVisible();
    const next = Number((await fix.textContent())!.replace(/\D+/g, ''));
    expect(next).toBeGreaterThan(freePort);
    await expect(homeButton('Try again')).toBeVisible();
    await expect(home()).toContainText('Something else? See Setup for every check.');
    await plainAndAccessible('cant-start');

    // Every title and button Home shows from the click on is noted. The last answer says the old
    // port is in use until the new one is checked; that must never read as "See Setup".
    await page.evaluate(() => {
      const seen: string[] = [];
      const note = () => {
        const title = document.querySelector('[data-testid="home-title"]')?.textContent ?? '';
        const primary = document.querySelector('[data-testid="home-primary"]')?.textContent ?? '';
        seen.push(`${title} | ${primary}`);
      };
      const observer = new MutationObserver(note);
      observer.observe(document.querySelector('[data-testid="home"]')!, {
        subtree: true,
        childList: true,
        characterData: true
      });
      Object.assign(window, { homeSeen: seen, homeObserver: observer });
    });
    await fix.click();
    await expect(homeTitle()).toHaveText('Ready to start', { timeout: 15_000 });
    const seen = await page.evaluate(() => {
      const w = window as unknown as { homeSeen: string[]; homeObserver: MutationObserver };
      w.homeObserver.disconnect();
      return w.homeSeen;
    });
    expect(seen.filter((s) => s.includes('See Setup') || s.startsWith('Can’t start yet'))).toEqual([]);
    await expect(await portField()).toHaveValue(String(next));
    await expect
      .poll(() => page.evaluate(async () => (await window.xenon.profiles.list())[0].server.port))
      .toBe(next);
  } finally {
    await new Promise((resolve) => taken.close(resolve));
    // Back to the run's port, which the rest of this file starts on.
    await (await portField()).fill(String(freePort));
    await openPlace('Home');
    await expect(homeTitle()).toHaveText('Ready to start', { timeout: 15_000 });
  }
});

test('a profile without Xenon shows the first-run checklist', async () => {
  const emptyHome = mkdtempSync(path.join(os.tmpdir(), 'xenon-empty-home-'));
  try {
    await setTechnical(page, true);
    await openSettingsTab('All settings');
    await page.getByTestId('appium-home').fill(emptyHome);
    await openPlace('Home');
    await expect(homeTitle()).toHaveText('Let’s get this Mac ready', { timeout: 25_000 });
    await expect(home()).toContainText('A one-time setup, about 2 minutes.');
    // The list is what this Mac needs: Set up installs Xenon and the drivers, not Node.js or Appium.
    await expect(home().getByRole('list', { name: 'What this Mac needs', exact: true })).toBeVisible();
    const xenon = home().getByRole('listitem').filter({ hasText: 'Xenon' });
    await expect(xenon).toContainText('— not installed yet');
    // Node.js and Appium are on this Mac, so they are done, and say nothing more.
    await expect(home().getByRole('listitem').filter({ hasText: 'Node.js' })).not.toContainText('not installed');
    await expect(homeButton('Set up this Mac')).toBeVisible();
    await plainAndAccessible('first-run');
  } finally {
    await setTechnical(page, true);
    await openSettingsTab('All settings');
    await page.getByTestId('appium-home').fill('');
    await setTechnical(page, false);
    await openPlace('Home');
    await expect(homeTitle()).toHaveText('Ready to start', { timeout: 25_000 });
    rmSync(emptyHome, { recursive: true, force: true });
  }
});

type Handler = (...args: unknown[]) => unknown;

/** Stands in for main's handlers of these channels, each giving its answer and noting the call; restoreHandlers puts them back. */
async function standIn(answers: Record<string, unknown>) {
  await app.evaluate(({ ipcMain }, answers) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
    const g = globalThis as unknown as { realHandlers?: Map<string, Handler>; calls: unknown[][] };
    g.realHandlers ??= new Map();
    g.calls = [];
    for (const [channel, answer] of Object.entries(answers)) {
      if (!g.realHandlers.has(channel)) g.realHandlers.set(channel, handlers.get(channel)!);
      handlers.set(channel, async (_e, ...args) => {
        g.calls.push([channel, ...args]);
        return answer;
      });
    }
  }, answers);
}

const calls = () => app.evaluate(() => (globalThis as unknown as { calls: unknown[][] }).calls);

/** Stands in for main's handlers of these channels with ones that fail; restoreHandlers puts them back. */
async function standInFailing(channels: string[]) {
  await app.evaluate(({ ipcMain }, channels) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
    const g = globalThis as unknown as { realHandlers?: Map<string, Handler> };
    g.realHandlers ??= new Map();
    for (const channel of channels) {
      if (!g.realHandlers.has(channel)) g.realHandlers.set(channel, handlers.get(channel)!);
      handlers.set(channel, async () => {
        throw new Error(`stand-in: ${channel} failed`);
      });
    }
  }, channels);
}

async function restoreHandlers() {
  await app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
    const g = globalThis as unknown as { realHandlers?: Map<string, Handler> };
    for (const [channel, real] of g.realHandlers ?? []) handlers.set(channel, real);
    g.realHandlers = new Map();
  });
}

/** Looks again, as coming back to the window does. */
const lookAgain = () => page.evaluate(() => window.dispatchEvent(new FocusEvent('focus')));

const ok = (id: string, label: string, detail: string) => ({ id, label, status: 'ok', detail, blocking: true });

test('a driver list that could not be read is not called missing', async () => {
  // Xenon is missing, so it is first run; the drivers could not be listed, so Android support is
  // not done, but nothing says it is not installed.
  await standIn({
    'toolchain:preflight': {
      ok: false,
      checks: [
        ok('node', 'Node.js', 'v22.12.0'),
        ok('appium', 'Appium', '3.1.1'),
        { id: 'drivers', label: 'Appium drivers', status: 'warn', detail: 'could not list drivers', blocking: false }
      ],
      blockers: ["Run Set up first. Xenon isn't installed in the Appium folder this profile uses."]
    }
  });
  try {
    await openPlace('Home');
    await lookAgain();
    await expect(homeTitle()).toHaveText('Let’s get this Mac ready', { timeout: 15_000 });
    const items = home().getByRole('listitem');
    await expect(items.filter({ hasText: 'Xenon' })).toContainText('— not installed yet');
    const android = items.filter({ hasText: 'Android support' });
    await expect(android).toContainText('— couldn’t check');
    await expect(android).not.toContainText('not installed');
    // An Android-only profile has no iOS or iPhone item.
    await expect(items.filter({ hasText: 'iOS support' })).toHaveCount(0);
    await expect(items.filter({ hasText: 'iPhone support' })).toHaveCount(0);
  } finally {
    await restoreHandlers();
    await lookAgain();
    await expect(homeTitle()).toHaveText('Ready to start', { timeout: 15_000 });
  }
});

test('Set up pressed twice at once runs once', async () => {
  // Two presses before the window has drawn the first (one task, no frame between) must not start
  // two runs writing the same Appium folder. Set up itself is stood in for: nothing is installed.
  await standIn({
    'toolchain:preflight': {
      ok: false,
      checks: [ok('node', 'Node.js', 'v22.12.0'), ok('appium', 'Appium', '3.1.1')],
      blockers: ["Run Set up first. Xenon isn't installed in the Appium folder this profile uses."]
    },
    'setup:install': { ok: true, failedStep: null }
  });
  try {
    await openPlace('Home');
    await lookAgain();
    const setUp = homeButton('Set up this Mac');
    await expect(setUp).toBeVisible({ timeout: 15_000 });
    await setUp.evaluate((el: HTMLElement) => {
      el.click();
      el.click();
    });
    await expect(page.getByRole('status').getByText('Setup finished', { exact: true }).last()).toBeVisible();
    await page.waitForTimeout(500);
    expect((await calls()).filter(([channel]) => channel === 'setup:install')).toHaveLength(1);
  } finally {
    await restoreHandlers();
    await lookAgain();
    await expect(homeTitle()).toHaveText('Ready to start', { timeout: 15_000 });
  }
});

test('Node.js missing: a plain sentence, the check’s own words only with technical details, and How to install', async () => {
  const remediation = 'Install Node 20+ (e.g. brew install node).';
  await standIn({
    'toolchain:preflight': {
      ok: false,
      checks: [
        { id: 'node', label: 'Node.js', status: 'missing', detail: 'node not found on PATH', blocking: true, remediation },
        ok('appium', 'Appium', '3.1.1')
      ],
      blockers: []
    },
    'app:openLink': true
  });
  try {
    await openPlace('Home');
    await lookAgain();
    await expect(homeTitle()).toHaveText('Can’t start yet', { timeout: 15_000 });
    await expect(home()).toContainText('Node.js isn’t installed on this Mac. Appium needs it.');
    await expect(home()).not.toContainText(remediation);
    await expect(home().locator('[data-raw]')).toHaveCount(0);
    // The sidebar's reason under Start says it in the same plain words (R24), never the check's own
    // fix, so the whole window is in plain words.
    const reason = page.getByTestId('start-blocked-reason');
    await expect(reason).toHaveText('Node.js isn’t installed on this Mac. Appium needs it.');
    await expect(page.getByTestId('start-button')).toHaveAttribute('title', 'Node.js isn’t installed on this Mac. Appium needs it.');
    expect(findJargon(await ownWords(page), await optionKeys(page))).toEqual([]);

    await setTechnical(page, true);
    const raw = home().locator('[data-raw]');
    await expect(raw).toContainText('node not found on PATH');
    await expect(raw).toContainText(remediation);
    // With technical details on, the sidebar may say the check's own words.
    await expect(reason).toHaveText(remediation);
    await setTechnical(page, false);
    await expect(home().locator('[data-raw]')).toHaveCount(0);
    await expect(reason).toHaveText('Node.js isn’t installed on this Mac. Appium needs it.');

    await homeButton('How to install').click();
    await expect.poll(calls).toContainEqual(['app:openLink', 'install']);
  } finally {
    await restoreHandlers();
    await lookAgain();
    await expect(homeTitle()).toHaveText('Ready to start', { timeout: 15_000 });
  }
});

test('Setup says Node.js is missing in plain words, links How to install, and gives the command with technical details', async () => {
  const remediation = 'Install Node 20+ (e.g. brew install node).';
  await standIn({
    'toolchain:preflight': {
      ok: false,
      checks: [
        {
          id: 'node',
          label: 'Node.js',
          status: 'missing',
          code: 'missing',
          detail: 'node not found on PATH',
          blocking: true,
          remediation
        },
        ok('appium', 'Appium', '3.1.1')
      ],
      blockers: []
    },
    'app:openLink': true
  });
  try {
    await openPlace('Setup');
    await lookAgain();
    const node = page.getByTestId('setup-row-node');
    await expect(node).toContainText('Node.js isn’t installed on this Mac. Appium needs it.', { timeout: 15_000 });
    await expect(node).not.toContainText(remediation);
    await expect(node.getByRole('img', { name: 'Needs attention', exact: true })).toBeVisible();
    // Setup carries its "!" for it.
    await expect(page.getByRole('tab', { name: 'Setup', exact: true })).toHaveAccessibleDescription('Needs attention');
    expect(findJargon(await ownWords(page), await optionKeys(page))).toEqual([]);

    // The app can't install Node.js, so the row links to the guide.
    const howTo = node.getByRole('button', { name: 'How to install', exact: true });
    await expect(howTo).toHaveAccessibleDescription('Node.js isn’t installed on this Mac. Appium needs it.');
    await howTo.click();
    await expect.poll(calls).toContainEqual(['app:openLink', 'install']);

    // With technical details on: what the check found, its own fix, and the command, with Copy.
    await setTechnical(page, true);
    const raw = node.locator('[data-raw]');
    await expect(raw).toContainText('node not found on PATH');
    await expect(raw).toContainText(remediation);
    await expect(raw).toContainText('brew install node@22');
    await app.evaluate(({ clipboard }) => clipboard.writeText(''));
    await node.getByRole('button', { name: 'Copy the Node.js command', exact: true }).click();
    await expect.poll(clipboard).toBe('brew install node@22');
    await expect(copiedToast()).toBeVisible();
    await expectAccessibleInBothThemes(page, 'setup-node-missing-technical');
    await setTechnical(page, false);
    await expect(node.locator('[data-raw]')).toHaveCount(0);
    await expectAccessibleInBothThemes(page, 'setup-node-missing');
  } finally {
    await restoreHandlers();
    await lookAgain();
    await openPlace('Home');
    await expect(homeTitle()).toHaveText('Ready to start', { timeout: 15_000 });
  }
});

test('on a profile switch, Setup says nothing until that profile’s own check is back, then says it once', async () => {
  // The checks are stood in for in main, by the profile's phones: this file's profile (Android alone)
  // is all fine; a new profile (both kinds of phone) has no Android tools. Any look can be held.
  await app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
    const g = globalThis as unknown as { realHandlers?: Map<string, Handler>; hold: boolean; heldLooks: Array<() => void> };
    g.realHandlers ??= new Map();
    if (!g.realHandlers.has('toolchain:preflight')) g.realHandlers.set('toolchain:preflight', handlers.get('toolchain:preflight')!);
    g.hold = false;
    g.heldLooks = [];
    const ok = (id: string, label: string, detail: string) => ({ id, label, status: 'ok', code: 'ok', detail, blocking: false });
    const fine = [
      ok('node', 'Node.js', 'v22.12.0'),
      ok('appium', 'Appium', '3.1.1'),
      ok('drivers', 'Appium drivers', 'installed: uiautomator2, xcuitest'),
      ok('adb', 'Android SDK (adb)', 'Android Debug Bridge version 1.0.41'),
      ok('xcode', 'Xcode', 'Xcode 16.0'),
      ok('go-ios', 'iPhone support', 'Ready for iPhones')
    ];
    const noAdb = fine.map((c) =>
      c.id === 'adb' ? { ...c, status: 'warn', code: 'missing', detail: 'adb not found and no Android SDK detected' } : c
    );
    handlers.set('toolchain:preflight', async (_event: unknown, profile: { settings: { platform?: string } }) => {
      if (g.hold) await new Promise<void>((resolve) => g.heldLooks.push(resolve));
      return { ok: true, checks: profile.settings.platform === 'android' ? fine : noAdb, blockers: [] };
    });
  });
  const hold = (on: boolean) =>
    app.evaluate((_electron, on) => {
      (globalThis as unknown as { hold: boolean }).hold = on;
    }, on);
  const held = () => app.evaluate(() => (globalThis as unknown as { heldLooks: Array<() => void> }).heldLooks.length);
  const releaseLooks = () =>
    app.evaluate(() => {
      const g = globalThis as unknown as { hold: boolean; heldLooks?: Array<() => void> };
      g.hold = false;
      for (const release of g.heldLooks?.splice(0) ?? []) release();
    });
  const region = page.locator('[data-testid="setup"] [role="status"][aria-live="polite"]');
  /** Every text Setup's region has taken since this was called, in order. */
  const noteSaid = () =>
    page.evaluate(() => {
      const w = window as unknown as { said: string[]; saidObserver?: MutationObserver };
      w.saidObserver?.disconnect();
      w.said = [];
      const region = () => document.querySelector('[data-testid="setup"] [role="status"][aria-live="polite"]');
      // What it holds now was said before this; only what it says from here on is noted.
      let last = region()?.textContent ?? '';
      w.saidObserver = new MutationObserver(() => {
        const text = region()?.textContent ?? '';
        if (text !== last) {
          last = text;
          w.said.push(text);
        }
      });
      w.saidObserver.observe(document.body, { subtree: true, childList: true, characterData: true });
    });
  const said = async () =>
    (await page.evaluate(() => (window as unknown as { said: string[] }).said)).filter((text) => text !== '');
  try {
    await openPlace('Setup');
    await lookAgain();
    await expect(page.getByTestId('setup-row-android-tools')).toContainText('Android tools are ready.', { timeout: 15_000 });
    // A second profile, opened at once and checked (not held): its answer is said.
    await createProfile();
    await expect(page.getByTestId('setup-row-android-tools')).toContainText('Android tools aren’t installed.', {
      timeout: 15_000
    });
    await expect(region).toHaveText('1 thing needs attention.');

    // Back to the first profile, with its check held: its last answer is on screen, but no check has
    // completed, so nothing is said.
    await noteSaid();
    await hold(true);
    await switchProfile('Local server');
    await expect.poll(held).toBeGreaterThan(0);
    await expect(page.getByTestId('setup-row-android-tools')).toContainText('Android tools are ready.');
    await page.waitForTimeout(1_000);
    expect(await said()).toEqual([]);
    await expect(page.getByTestId('setup-check-again')).toHaveAttribute('aria-disabled', 'true');

    // Its check comes back: the summary is said, once.
    await releaseLooks();
    await expect(region).toHaveText('All checks passed.', { timeout: 15_000 });
    await page.waitForTimeout(1_000);
    expect(await said()).toEqual(['All checks passed.']);
  } finally {
    await page.evaluate(() => (window as unknown as { saidObserver?: MutationObserver }).saidObserver?.disconnect());
    await releaseLooks();
    await restoreHandlers();
    if ((await profileSwitcher().textContent()) !== 'Local server') await switchProfile('Local server');
    const sheet = await openProfilesSheet();
    if ((await sheet.getByTestId('profile-row').count()) > 1) await deleteProfile(sheet, 'New profile');
    await closeProfilesSheet();
    await lookAgain();
    await openPlace('Home');
    await expect(homeTitle()).toHaveText('Ready to start', { timeout: 15_000 });
  }
});

test('changing the profile’s phones looks again: Setup shows the iPhone row without coming back to the window', async () => {
  // Focus is kept from reaching the app, so only the change itself can look again; the real check
  // runs, and each look is counted.
  await page.evaluate(() => {
    const keepFocusOut = (e: Event) => e.stopImmediatePropagation();
    window.addEventListener('focus', keepFocusOut, true);
    Object.assign(window, { keepFocusOut });
  });
  await app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
    const g = globalThis as unknown as { realHandlers?: Map<string, Handler>; looks: number };
    g.realHandlers ??= new Map();
    if (!g.realHandlers.has('toolchain:preflight')) g.realHandlers.set('toolchain:preflight', handlers.get('toolchain:preflight')!);
    const real = g.realHandlers.get('toolchain:preflight')!;
    g.looks = 0;
    handlers.set('toolchain:preflight', async (...args: unknown[]) => {
      g.looks++;
      return real(...args);
    });
  });
  const looks = () => app.evaluate(() => (globalThis as unknown as { looks: number }).looks);
  const platform = (name: 'Android' | 'iPhone') =>
    page.getByRole('radiogroup', { name: 'Which phones', exact: true }).getByRole('radio', { name, exact: true });
  const openAllSettings = () => openSettingsTab('All settings');
  try {
    await openPlace('Setup');
    await expect(page.getByTestId('setup-row-android-support')).toBeVisible({ timeout: 15_000 });
    // Android alone: no iPhone row.
    await expect(page.getByTestId('setup-row-iphone-support')).toHaveCount(0);

    const before = await looks();
    await openAllSettings();
    await platform('iPhone').click();
    await openPlace('Setup');
    await expect(page.getByTestId('setup-row-iphone-support')).toContainText('iPhone support', { timeout: 20_000 });
    await expect(page.getByTestId('setup-row-xcode')).toBeVisible();
    await expect(page.getByTestId('setup-row-android-support')).toHaveCount(0);
    // One look, for the change.
    await page.waitForTimeout(1_000);
    expect((await looks()) - before).toBe(1);
  } finally {
    await openAllSettings();
    await platform('Android').click();
    await page.evaluate(() => {
      const w = window as unknown as { keepFocusOut?: (e: Event) => void };
      if (w.keepFocusOut) window.removeEventListener('focus', w.keepFocusOut, true);
    });
    await restoreHandlers();
    await lookAgain();
    await openPlace('Home');
    await expect(homeTitle()).toHaveText('Ready to start', { timeout: 15_000 });
  }
});

test('Try again says it can’t be pressed while it looks, and keeps focus', async () => {
  // The look Try again runs is held until released, so the moment in between can be seen. Only the
  // looks Try again starts are counted: the window coming back into focus also looks (debounced),
  // so for this test focus is kept from reaching the app, and every held look is released at the end.
  const taken = net.createServer();
  await new Promise<void>((resolve) => taken.listen(freePort, resolve));
  const looks = () => app.evaluate(() => (globalThis as unknown as { looks: number }).looks);
  const releaseLooks = () =>
    app.evaluate(() => {
      const g = globalThis as unknown as { heldLooks?: Array<() => void> };
      for (const release of g.heldLooks?.splice(0) ?? []) release();
    });
  try {
    await openPlace('Home');
    await lookAgain();
    await expect(homeTitle()).toHaveText('Can’t start yet', { timeout: 15_000 });
    await page.evaluate(() => {
      const keepFocusOut = (e: Event) => e.stopImmediatePropagation();
      // At the window, a capturing listener runs before the app's own.
      window.addEventListener('focus', keepFocusOut, true);
      Object.assign(window, { keepFocusOut });
    });
    await app.evaluate(({ ipcMain }) => {
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
      const g = globalThis as unknown as {
        realHandlers?: Map<string, Handler>;
        looks: number;
        heldLooks: Array<() => void>;
      };
      g.realHandlers ??= new Map();
      if (!g.realHandlers.has('toolchain:preflight')) {
        g.realHandlers.set('toolchain:preflight', handlers.get('toolchain:preflight')!);
      }
      const real = g.realHandlers.get('toolchain:preflight')!;
      g.looks = 0;
      g.heldLooks = [];
      handlers.set('toolchain:preflight', async (...args: unknown[]) => {
        g.looks++;
        await new Promise<void>((resolve) => {
          g.heldLooks.push(resolve);
        });
        return real(...args);
      });
    });

    const tryAgain = homeButton('Try again');
    await expect(tryAgain).not.toHaveAttribute('aria-disabled');
    await tryAgain.focus();
    await page.keyboard.press('Enter');
    await expect(tryAgain).toHaveAttribute('aria-disabled', 'true');
    await expect(tryAgain.locator('svg.animate-spin')).toHaveCount(1);
    await expect(tryAgain).toBeFocused();
    expect(await looks()).toBe(1);
    // Pressing it again while it looks does not look twice.
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    expect(await looks()).toBe(1);

    await releaseLooks();
    await expect(tryAgain).not.toHaveAttribute('aria-disabled');
    await expect(tryAgain.locator('svg.animate-spin')).toHaveCount(0);
    await expect(tryAgain).toBeFocused();
    await expect(homeTitle()).toHaveText('Can’t start yet');
  } finally {
    await page.evaluate(() => {
      const w = window as unknown as { keepFocusOut?: (e: Event) => void };
      if (w.keepFocusOut) window.removeEventListener('focus', w.keepFocusOut, true);
    });
    await restoreHandlers();
    await releaseLooks();
    await new Promise((resolve) => taken.close(resolve));
    await lookAgain();
    await expect(homeTitle()).toHaveText('Ready to start', { timeout: 15_000 });
  }
});

test('running shows the test address and copies it', async () => {
  await openPlace('Home');
  try {
    await startFromHome();
    await expect(homeTitle()).toHaveText('Running');
    await expect(home()).toContainText('Test address');
    await expect(home()).toContainText(`http://localhost:${freePort}/wd/hub`);
    await expect(home()).toContainText(new RegExp(`Colleagues on your network: http://\\S+\\.local:${freePort}/wd/hub`));
    await expect(homeButton('Open dashboard')).toBeVisible();

    await app.evaluate(({ clipboard }) => clipboard.writeText(''));
    await home().getByTestId('copy-test-address').click();
    await expect.poll(clipboard).toBe(`http://localhost:${freePort}/wd/hub`);
    await expect(copiedToast()).toBeVisible();
    // The copied address is the server's: it answers.
    const status = await fetch(`${await clipboard()}/status`);
    expect(status.status).toBe(200);
    expect((await status.json()).value.ready).toBe(true);

    await home().getByTestId('copy-colleague-address').click();
    await expect.poll(clipboard).toMatch(new RegExp(`^http://\\S+\\.local:${freePort}/wd/hub$`));
    // It is exactly the address the app works out for colleagues (from the Mac's Bonjour name, R27),
    // asked of the app itself rather than re-derived here, so the test needs no tool of its own.
    const reported = await page.evaluate(
      (port) => window.xenon.share.addresses({ server: { port, basePath: '/wd/hub' } }),
      freePort
    );
    expect(await clipboard()).toBe(reported.colleagues);

    await plainAndAccessible('running');
  } finally {
    await stopServer();
  }
});

test('while running, Set up this Mac can’t be pressed and says why, and Check again still looks', async () => {
  await openPlace('Home');
  try {
    await startFromHome();
    await openPlace('Setup');
    const setUp = page.getByTestId('setup-run');
    // Set up replaces files the running server uses: it says so, keeps focus, and does nothing.
    await expect(setUp).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByText('Stop the server to run Set up.', { exact: true })).toBeVisible();
    await expect(setUp).toHaveAccessibleDescription(/Stop the server to run Set up\./);
    await setUp.focus();
    await page.keyboard.press('Enter');
    await expect(setUp).toBeFocused();
    await expect(setUp).toHaveText('Set up this Mac');
    await expect(page.getByRole('list', { name: 'Setup steps', exact: true })).toHaveCount(0);
    expect((await serverState()).status).toBe('running');

    // Check again looks while the server runs (its own port is not counted against it) and says what it found.
    const checkAgain = page.getByTestId('setup-check-again');
    await checkAgain.click();
    const announced = page.getByRole('tabpanel', { name: 'Setup', exact: true }).locator('[role="status"]');
    await expect(announced).toHaveText('All checks passed.', { timeout: 20_000 });
    await expect(page.getByText('Everything this Mac needs to run tests. Checked just now.')).toBeVisible();
    expect(findJargon(await ownWords(page), await optionKeys(page))).toEqual([]);
    await expectAccessibleInBothThemes(page, 'setup-running');
  } finally {
    await stopServer();
  }
});

test('while running, an edited base path does not change the test address', async () => {
  // The server serves the base path it was started with until the next start. Editing the
  // profile's meanwhile (it is not locked while running) must not change the address tests get.
  const launched = `http://localhost:${freePort}/wd/hub`;
  const basePath = () => page.getByRole('textbox', { name: 'Base path', exact: true });
  await openPlace('Home');
  try {
    await startFromHome();
    await setTechnical(page, true);
    await openSettingsTab('All settings');
    const technical = page.getByRole('region', { name: 'Technical', exact: true });
    await expect(technical.getByText('Restart the server to use this.')).toHaveCount(0);
    await basePath().fill('/edited');
    await expect
      .poll(() => page.evaluate(async () => (await window.xenon.profiles.list())[0].server.basePath))
      .toBe('/edited');
    // The running server keeps the base path it started with, and Settings says the edit waits for a restart.
    await expect(technical.getByText('Restart the server to use this.', { exact: true })).toBeVisible();
    // The same for the port, under its row in Essentials; put back as it was started, it says nothing.
    const port = await portField();
    await port.fill(String(freePort + 1));
    await expect(page.locator('[data-setting-key="server.port"]').getByText('Restart the server to use this.', { exact: true })).toBeVisible();
    await port.fill(String(freePort));
    await expect(page.getByText('Restart the server to use this.')).toHaveCount(0);
    await setTechnical(page, false);

    await openPlace('Home');
    await expect(home()).toContainText(launched);
    await expect(home()).not.toContainText('/edited');
    await app.evaluate(({ clipboard }) => clipboard.writeText(''));
    await home().getByTestId('copy-test-address').click();
    await expect.poll(clipboard).toBe(launched);
    await app.evaluate(({ clipboard }) => clipboard.writeText(''));
    await clickMenuItem(app, 'Server', { label: 'Copy Test Address' });
    await expect.poll(clipboard).toBe(launched);
    await home().getByTestId('copy-colleague-address').click();
    await expect.poll(clipboard).toMatch(new RegExp(`^http://\\S+\\.local:${freePort}/wd/hub$`));
    // …and it is the address the server answers on.
    const status = await fetch(`${launched}/status`);
    expect(status.status).toBe(200);
  } finally {
    await stopServer();
    await setTechnical(page, true);
    await openSettingsTab('All settings');
    await basePath().fill('/wd/hub');
    await expect
      .poll(() => page.evaluate(async () => (await window.xenon.profiles.list())[0].server.basePath))
      .toBe('/wd/hub');
    await setTechnical(page, false);
    await openPlace('Home');
  }
});

test('a killed server shows Stopped unexpectedly', async () => {
  await openPlace('Home');
  try {
    await startFromHome();
    const { pid } = await serverState();
    expect(pid).not.toBeNull();
    process.kill(pid!, 'SIGKILL');
    await expect(homeTitle()).toHaveText('Xenon stopped unexpectedly', { timeout: 15_000 });
    await expect(home()).toContainText('Appium closed on its own.');
    await expect(homeButton('Start again')).toBeVisible();
    await expect(homeButton('See what happened')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Logs', exact: true })).toHaveAccessibleDescription('New problem');
    await plainAndAccessible('crashed');

    // With technical details on, Home quotes what the server reported, marked as quoted.
    await setTechnical(page, true);
    await expect(home().locator('[data-raw]')).toContainText('Appium exited with code SIGKILL');
    await setTechnical(page, false);

    // See what happened goes to Logs (Task 19 adds the jump to the line), which clears the dot.
    await homeButton('See what happened').click();
    await expect(page.getByRole('tab', { name: 'Logs', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: 'Logs', exact: true })).toHaveAccessibleDescription('');
  } finally {
    await stopServer();
    await openPlace('Home');
  }
});

test('a crash whose port is then taken offers Use port N on Home, and it works', async () => {
  // The crash lasts until a start succeeds. Another app takes the port meanwhile: Home keeps the
  // crash's words and offers the fix, never a Start the sidebar says can't be pressed, nor Setup.
  const homeTab = page.getByRole('tab', { name: 'Home', exact: true });
  const start = page.getByTestId('start-button');
  const taken = net.createServer();
  let next = 0;
  await openPlace('Home');
  try {
    await startFromHome();
    const { pid } = await serverState();
    expect(pid).not.toBeNull();
    process.kill(pid!, 'SIGKILL');
    await expect(homeTitle()).toHaveText('Xenon stopped unexpectedly', { timeout: 15_000 });
    await new Promise<void>((resolve) => taken.listen(freePort, resolve));
    await lookAgain();

    await expect(page.getByTestId('start-blocked-reason')).toHaveText(
      `Port ${freePort} is already in use by another app. Choose another port or close that app.`,
      { timeout: 15_000 }
    );
    await expect(start).toHaveAttribute('aria-disabled', 'true');
    await expect(homeTitle()).toHaveText('Xenon stopped unexpectedly');
    const fix = homeButton(/^Use port \d+$/);
    await expect(fix).toBeVisible();
    next = Number((await fix.textContent())!.replace(/\D+/g, ''));
    expect(next).toBeGreaterThan(freePort);
    await expect(homeButton('Start again')).toHaveCount(0);
    await expect(homeButton('See what happened')).toBeVisible();
    await plainAndAccessible('crashed-blocked');

    // ⌘⏎ looks again, finds the port still taken, and stays on Home, which says why.
    await pressStartShortcut();
    await expect(start).toHaveAttribute('aria-disabled', 'true');
    await page.waitForTimeout(1_000);
    await expect(homeTab).toHaveAttribute('aria-selected', 'true');
    await expect(fix).toBeVisible();
    expect((await serverState()).status).toBe('crashed');

    // Use port N: the new port is free, so Start can be pressed again, from Home and the sidebar.
    await fix.click();
    await expect(homeButton('Start again')).toBeVisible({ timeout: 15_000 });
    await expect(start).not.toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('start-blocked-reason')).toHaveCount(0);
    await expect(homeTab).toHaveAttribute('aria-selected', 'true');
    await homeButton('Start again').click();
    await expect(announcedStatus()).toHaveText('Running', { timeout: 60_000 });
    expect((await serverState()).port).toBe(next);
    await expect(homeTitle()).toHaveText('Running');
  } finally {
    await stopServer();
    if (taken.listening) await new Promise((resolve) => taken.close(resolve));
    // Back to the run's port, which the rest of this file starts on.
    await (await portField()).fill(String(freePort));
    await openPlace('Home');
    await expect(homeTitle()).toHaveText(/Ready to start|Xenon stopped unexpectedly/, { timeout: 25_000 });
  }
});

test('another profile running: Home says so and offers to switch', async () => {
  await openPlace('Home');
  try {
    await startFromHome();
    await createProfile();
    await expect(profileSwitcher()).toHaveText('New profile');
    await openPlace('Home');
    await expect(homeTitle()).toHaveText('“Local server” is running');
    await expect(home()).toContainText('Only one profile runs at a time. Stop it to start this one.');
    // Not this profile's address: the running one's is not shown as this one's.
    await expect(home().getByTestId('copy-test-address')).toHaveCount(0);
    // The sidebar describes the server.
    await expect(announcedStatus()).toHaveText('Running');

    // ⇧⌘C, from this profile, copies the running profile's address.
    await app.evaluate(({ clipboard }) => clipboard.writeText(''));
    await clickMenuItem(app, 'Server', { accelerator: 'Shift+Cmd+C' });
    await expect.poll(clipboard).toBe(`http://localhost:${freePort}/wd/hub`);

    await homeButton('Switch to it').click();
    await expect(profileSwitcher()).toHaveText('Local server');
    await expect(homeTitle()).toHaveText('Running');
  } finally {
    await stopServer();
    const sheet = await openProfilesSheet();
    if ((await sheet.getByTestId('profile-row').filter({ hasText: 'New profile' }).count()) > 0) {
      await deleteProfile(sheet, 'New profile');
    }
    await closeProfilesSheet();
    await expect(profileSwitcher()).toHaveText('Local server');
    await openPlace('Home');
  }
});

test('a removed profile still running: Home shows its address, which copies (R23)', async () => {
  // A launch of its own, since its running profile is deleted. Nobody can switch to that profile,
  // so Home is the one place its address is; the server still says its port and base path.
  const port = await pickFreePort();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'xenon-e2e-removed-'));
  seedProfiles(dir, [testProfile(port, 'Local server'), testProfile(await pickFreePort(), 'Other')]);
  const own = await launchApp({ userDataDir: dir, env: isolatedEnv(dir), asCurrent: false });
  const p = own.page;
  const address = `http://localhost:${port}/wd/hub`;
  try {
    await expect(profileSwitcher(p)).toHaveText('Local server');
    await startFromHome(p);
    await switchProfile('Other', p);
    const sheet = await openProfilesSheet(p);
    await deleteProfile(sheet, 'Local server');
    await closeProfilesSheet(p);
    await openPlace('Home', p);

    await expect(homeTitle(p)).toHaveText('A removed profile is still running');
    await expect(home(p).getByTestId('address-card')).toContainText(address);
    await own.app.evaluate(({ clipboard }) => clipboard.writeText(''));
    await home(p).getByTestId('copy-test-address').click();
    await expect.poll(() => own.app.evaluate(({ clipboard }) => clipboard.readText())).toBe(address);
    // …and it is the address the server answers on.
    expect((await fetch(`${address}/status`)).status).toBe(200);
  } finally {
    await stopServer(p);
    await own.app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Copy Test Address copies the open profile’s address while nothing runs', async () => {
  await openPlace('Home');
  await expect(homeTitle()).toHaveText('Ready to start', { timeout: 25_000 });
  await app.evaluate(({ clipboard }) => clipboard.writeText(''));
  await clickMenuItem(app, 'Server', { label: 'Copy Test Address' });
  await expect.poll(clipboard).toBe(`http://localhost:${freePort}/wd/hub`);
  await expect(copiedToast()).toBeVisible();
});

test('a copy that fails says why: the clipboard, or no address', async () => {
  const errorToast = (text: string) => page.getByRole('alert').getByText(text, { exact: true }).last();
  await openPlace('Home');
  await expect(homeTitle()).toHaveText('Ready to start', { timeout: 25_000 });
  try {
    // The clipboard refused it: copying again may work.
    await standInFailing(['share:copy']);
    await clickMenuItem(app, 'Server', { label: 'Copy Test Address' });
    await expect(errorToast('Couldn’t copy the address. Try again.')).toBeVisible();
    await restoreHandlers();

    // Main gave no address for the port: nothing was there to copy.
    await standInFailing(['share:addresses']);
    await clickMenuItem(app, 'Server', { label: 'Copy Test Address' });
    await expect(errorToast('There’s no test address yet. Check the port in Settings.')).toBeVisible();
  } finally {
    await restoreHandlers();
  }
});

test('Home fits the smallest window', async () => {
  const setSize = (w: number, h: number) =>
    app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setSize(w, h), [w, h]);
  /** Nothing on Home is below the window's edge: neither main nor the place's own scroll area scrolls. */
  const fits = () =>
    page.evaluate(() =>
      ['main#content', '[data-testid="place-scroll"]'].map((selector) => {
        const el = document.querySelector(selector)!;
        return { selector, fits: el.scrollHeight <= el.clientHeight };
      })
    );
  const allFit = [
    { selector: 'main#content', fits: true },
    { selector: '[data-testid="place-scroll"]', fits: true }
  ];
  await openPlace('Home');
  try {
    await setSize(900, 600);
    await expect.poll(() => page.evaluate(() => window.innerHeight)).toBeLessThanOrEqual(600);
    await expect(homeTitle()).toHaveText('Ready to start', { timeout: 25_000 });
    expect(await fits()).toEqual(allFit);

    await startFromHome();
    await expect(home().getByTestId('copy-test-address')).toBeVisible();
    expect(await fits()).toEqual(allFit);
  } finally {
    await stopServer();
    await setSize(1120, 760);
  }
});

test('keyboard only: launch to Start', async () => {
  // A launch of its own, so focus starts where a person's does. Its profile is on a free port.
  const port = await pickFreePort();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'xenon-e2e-keys-'));
  seedProfiles(dir, [testProfile(port)]);
  const own = await launchApp({ userDataDir: dir, env: isolatedEnv(dir), asCurrent: false });
  try {
    const p = own.page;
    await expect(homeTitle(p)).toHaveText('Ready to start', { timeout: 25_000 });
    const start = homeButton('Start', p);
    let reached = false;
    for (let presses = 0; presses < 30 && !reached; presses++) {
      await p.keyboard.press('Tab');
      reached = await start.evaluate((el) => el === document.activeElement);
    }
    expect(reached, 'Tab reaches Home’s Start').toBe(true);
    await p.keyboard.press('Enter');
    await expect(announcedStatus(p)).toHaveText('Running', { timeout: 60_000 });
    await stopServer(p);
  } finally {
    await own.app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
