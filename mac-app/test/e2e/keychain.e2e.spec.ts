import { test, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeDefaultProfile } from '../../src/shared/profileDefaults';
import type { Profile } from '../../src/shared/types';
import {
  clickMenuItem,
  launchApp,
  openPlace,
  pickFreePort,
  profileSwitcher,
  seedProfiles,
  setTechnical,
  switchProfile
} from './helpers';

// The cloud key and the proxy password in the window (Task 14, fix round 1): the
// draft lets go of a value main moved to the Keychain (R40), the cloud key is
// never typed into a box (R39), and the preview shows the launch that will run
// (I4). Each profile keeps its own of both (R54). The app runs on its own
// throwaway folder, and its Keychain is a stand-in (safeStorage replaced in the
// main process before any secret is stored), so nothing here reaches the Mac's
// real Keychain. The values are fake. No real server is started: the one start
// here runs a stand-in for Appium.

let app: ElectronApplication;
let page: Page;
let userDataDir: string;
/** The probe profile's id: its own secrets are in slots named by it. */
let probeId: string;

const STAND_IN = 'stand-in:';

/** A stand-in for the Keychain in the app's main process: reversible, and never the Mac's own. */
async function installStandIn(target: ElectronApplication): Promise<void> {
  await target.evaluate(({ safeStorage }, prefix) => {
    safeStorage.isEncryptionAvailable = () => true;
    safeStorage.encryptString = (text: string) => Buffer.from(prefix + text, 'utf8');
    safeStorage.decryptString = (cipher: Buffer) => cipher.toString('utf8').slice(prefix.length);
  }, STAND_IN);
}

/** What the stand-in Keychain holds, by slot, read from the secrets file of a run's folder. */
function keychainIn(dir: string): Record<string, string> {
  const file = path.join(dir, 'secrets.json');
  if (!existsSync(file)) return {};
  const stored = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
  return Object.fromEntries(
    Object.entries(stored).map(([key, cipher]) => [key, Buffer.from(cipher, 'base64').toString('utf8').slice(STAND_IN.length)])
  );
}

/** What the stand-in Keychain of this run holds. */
const keychain = (): Record<string, string> => keychainIn(userDataDir);

/** A profile's own slot (R54): the probe profile's, unless another id is given. */
const ownSlot = (key: 'CLOUD_KEY' | 'PROXY_PASSWORD', id = probeId): string => `${key}@${id}`;

/** The profiles file as written. */
const profilesFile = () => readFileSync(path.join(userDataDir, 'profiles.json'), 'utf8');

/** The open profile as stored. */
const stored = () => page.evaluate(async () => (await window.xenon.profiles.list())[0]);

async function openSettingsTab(name: 'Essentials' | 'All settings' | 'Keys & accounts') {
  await openPlace('Settings', page);
  const tab = page.getByRole('tab', { name, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

/** The proxy setting's JSON box, which All settings offers with technical details on. */
const proxyBox = (): Locator => page.locator('[data-setting-key="proxy"] textarea');

/** Types the proxy settings into its JSON box (technical details on) and leaves the box, which commits them. */
async function setProxy(value: unknown) {
  await setTechnical(page, true);
  await openSettingsTab('All settings');
  await proxyBox().fill(JSON.stringify(value));
  await proxyBox().blur();
}

/**
 * An edit to another setting, as a person makes one later: the save sends the
 * whole draft, proxy and all. Waits until it is stored.
 */
async function editMaxSessions(n: number) {
  await openSettingsTab('All settings');
  const box = page.locator('#setting-maxSessions');
  await box.fill(String(n));
  // A number box saves as it is typed (R50); Enter ends the edit.
  await box.press('Enter');
  await expect.poll(async () => (await stored()).settings.maxSessions).toBe(n);
}

/** A secret's group in Keys & accounts, by its plain label. */
const keyRow = (label: string): Locator => page.getByRole('region', { name: label, exact: true });

/** The proxy password's row in Keys & accounts: the profile's own (R54). */
const proxyPasswordRow = (): Locator => keyRow('Proxy password — for this profile');

/** The cloud key's row in Keys & accounts: the profile's own (R54). */
const cloudKeyRow = (): Locator => keyRow('Cloud access key — for this profile');

/** A switch, by its exact name. */
const switchNamed = (name: string): Locator => page.getByRole('switch', { name, exact: true });

/** The confirmation that Clear asks for. */
const clearDialog = (label: string): Locator => page.getByRole('dialog', { name: `Clear the ${label}?`, exact: true });

test.beforeAll(async () => {
  const port = await pickFreePort();
  userDataDir = mkdtempSync(path.join(os.tmpdir(), 'xenon-e2e-keychain-'));
  const base = makeDefaultProfile({ id: randomUUID(), now: Date.now(), name: 'Keychain probe' });
  const profile: Profile = {
    ...base,
    settings: { ...base.settings, platform: 'android', androidDeviceType: 'simulated' },
    server: { ...base.server, port }
  };
  seedProfiles(userDataDir, [profile]);
  probeId = profile.id;
  ({ app, page } = await launchApp({ userDataDir }));
  await installStandIn(app);
});

test.afterAll(async () => {
  await app?.close();
  if (userDataDir) rmSync(userDataDir, { recursive: true, force: true });
});

test('a proxy password typed in the proxy settings moves to this profile’s own slot, and the window lets go of it (R40, R54)', async () => {
  await setProxy({ host: 'squid.lab', port: 3128, auth: { username: 'qa', password: 'p-test-old' } });
  await expect.poll(() => keychain()[ownSlot('PROXY_PASSWORD')]).toBe('p-test-old');
  // The profile's own, not an app-wide one, and nothing to turn on.
  expect(keychain().PROXY_PASSWORD).toBeUndefined();
  expect((await stored()).secretRefs).not.toContain('PROXY_PASSWORD');
  expect(profilesFile()).not.toContain('p-test-old');
  // The window took the profile as stored: the box shows the proxy without the password.
  await expect(proxyBox()).not.toHaveValue(/p-test-old/);
  await expect(proxyBox()).toHaveValue(/squid\.lab/);
  // The proxy's parts show it too, and its password is a pointer to this profile's row (I1, R54).
  await expect(page.getByRole('textbox', { name: 'Proxy address', exact: true })).toHaveValue('squid.lab');
  await expect(page.getByRole('spinbutton', { name: 'Proxy port', exact: true })).toHaveValue('3128');
  await expect(page.getByRole('textbox', { name: 'Proxy user name', exact: true })).toHaveValue('qa');
  const pointer = page.locator('[data-setting-key="proxy.auth.password"]');
  await expect(pointer).toContainText('Proxy password is a secret — set it in Keys & accounts');
  await expect(pointer.locator('input, textarea')).toHaveCount(0);
  // Opened again, the window never shows it: the profile doesn't hold it.
  await page.reload();
  await expect(profileSwitcher(page)).toHaveText('Keychain probe');
  await openSettingsTab('All settings');
  await expect(proxyBox()).toHaveValue(/squid\.lab/);
  await expect(proxyBox()).not.toHaveValue(/p-test-old/);
  await expect(page.locator('body')).not.toContainText('p-test-old');
  await setTechnical(page, false);
  await expect(proxyBox()).toHaveCount(0);
  // Keys & accounts shows the password as saved for this profile, with no switch to use it.
  await openSettingsTab('Keys & accounts');
  await expect(proxyPasswordRow().getByText('Saved for this profile', { exact: true })).toBeVisible();
  await expect(switchNamed('Used by this profile: Proxy password')).toHaveCount(0);
  await expect(switchNamed('Used by this profile: Cloud access key')).toHaveCount(0);
});

test('a cleared proxy password stays cleared after the next edit', async () => {
  await openSettingsTab('Keys & accounts');
  // Clear asks first, and Cancel keeps it.
  await proxyPasswordRow().getByRole('button', { name: 'Clear Proxy password', exact: true }).click();
  await expect(clearDialog('Proxy password')).toBeVisible();
  // It is this profile's alone.
  await expect(clearDialog('Proxy password')).toHaveAccessibleDescription('This profile starts without it until a new one is saved.');
  await clearDialog('Proxy password').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(clearDialog('Proxy password')).toHaveCount(0);
  expect(keychain()[ownSlot('PROXY_PASSWORD')]).toBe('p-test-old');
  await proxyPasswordRow().getByRole('button', { name: 'Clear Proxy password', exact: true }).click();
  await clearDialog('Proxy password').getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(proxyPasswordRow().getByText('Not set', { exact: true })).toBeVisible();
  expect(keychain()[ownSlot('PROXY_PASSWORD')]).toBeUndefined();
  // The cursor is back in the box, since Clear itself has gone.
  await expect(proxyPasswordRow().getByLabel('Proxy password', { exact: true })).toBeFocused();
  // Another edit, which a draft still holding the old password would store again.
  await editMaxSessions(3);
  expect(keychain()[ownSlot('PROXY_PASSWORD')]).toBeUndefined();
  expect(profilesFile()).not.toContain('p-test-old');
});

test('a password replaced in Keys & accounts is not put back by the next edit', async () => {
  await openSettingsTab('Keys & accounts');
  await proxyPasswordRow().locator('input[type="password"]').fill('p-test-new');
  await proxyPasswordRow().getByRole('button', { name: 'Save Proxy password', exact: true }).click();
  await expect(proxyPasswordRow().getByText('Saved for this profile', { exact: true })).toBeVisible();
  // The box lets go of what was typed, and Save keeps the cursor (R20).
  await expect(proxyPasswordRow().locator('input[type="password"]')).toHaveValue('');
  await expect(proxyPasswordRow().getByRole('button', { name: 'Save Proxy password', exact: true })).toBeFocused();
  // Another edit, which a draft still holding the old password would store over the new one.
  await editMaxSessions(4);
  expect(keychain()[ownSlot('PROXY_PASSWORD')]).toBe('p-test-new');
  expect(profilesFile()).not.toMatch(/p-test-old|p-test-new/);
  await openSettingsTab('Keys & accounts');
  await expect(proxyPasswordRow().getByText('Saved for this profile', { exact: true })).toBeVisible();
});

test('the preview shows the launch that will run: the proxy in the environment, by name only (I4)', async () => {
  const spec = await page.evaluate(async () => window.xenon.server.launchPreview((await window.xenon.profiles.list())[0]));
  expect(spec.envKeys).toEqual(expect.arrayContaining(['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY']));
  expect(spec.configYaml).not.toContain('squid.lab');
  expect(JSON.stringify(spec)).not.toMatch(/p-test-new|p-test-old/);
});

test('the cloud key has no box in the settings: it points to Keys & accounts (R39)', async () => {
  await openSettingsTab('All settings');
  const apiKey = page.locator('[data-setting-key="cloud.apiKey"]');
  await expect(apiKey).toContainText('Cloud access key is a secret — set it in Keys & accounts');
  await expect(apiKey.locator('input, textarea')).toHaveCount(0);
  // The rest of the cloud settings stay editable.
  await expect(page.locator('[data-setting-key="cloud.cloudName"] input')).toHaveCount(1);
});

test('typing on into the next table cell while a save is answered keeps every letter (R40 with R17)', async () => {
  // Tab commits a row and its save goes out 300 ms later; the answer comes back while the next cell is
  // being typed in. Taking the answer used to put the table's rows back and drop what the cell held.
  await openSettingsTab('All settings');
  const table = page.locator('[data-setting-key="simulators"]');
  await table.getByRole('button', { name: 'Add row', exact: true }).click();
  const name = table.getByLabel('Name row 1', { exact: true });
  const sdk = table.getByLabel('iOS version row 1', { exact: true });
  await name.fill('iPhone 15');
  await name.press('Tab');
  await expect(sdk).toBeFocused();
  await page.keyboard.type('17.0.');
  // The row's save has been answered (a list read after it is answered after it).
  await expect.poll(async () => (await stored()).settings.simulators).toEqual([{ name: 'iPhone 15', sdk: '' }]);
  await page.waitForTimeout(100); // the answer has been rendered
  await page.keyboard.type('1-beta');
  await expect(sdk).toHaveValue('17.0.1-beta');
  await sdk.press('Tab');
  await expect.poll(async () => (await stored()).settings.simulators).toEqual([{ name: 'iPhone 15', sdk: '17.0.1-beta' }]);
});

/** File > New Profile, which (unlike the switcher) leaves focus where it is, and waits until the new profile is open. */
async function newProfileFromMenu() {
  await clickMenuItem(app, 'File', { label: 'New Profile' });
  await expect(profileSwitcher(page)).toHaveText('New profile');
}

/** Focus leaves whatever holds it, as when the person moves on, and any save has gone out. */
async function leaveFocus() {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(500); // past the save's 300 ms
}

/** The profiles as stored, the new one and the one it was made from. */
async function profilesAfter(fromId: string) {
  const all = await page.evaluate(() => window.xenon.profiles.list());
  return { created: all.find((p) => p.name === 'New profile')!, from: all.find((p) => p.id === fromId)! };
}

/** Back to the probe profile, and the new one deleted, so each test starts from the same place. */
async function dropNewProfile() {
  await page.evaluate(async () => {
    for (const p of await window.xenon.profiles.list()) if (p.name === 'New profile') await window.xenon.profiles.delete(p.id);
  });
  await page.reload();
  await expect(profileSwitcher(page)).toHaveText('Keychain probe');
}

test('File > New Profile with a table cell still focused writes nothing of it into either profile', async () => {
  await openSettingsTab('All settings');
  const table = page.locator('[data-setting-key="simulators"]');
  // The probe profile has a simulator row (the test before this one leaves one; alone, it adds one).
  if ((await table.getByLabel('Name row 1', { exact: true }).count()) === 0) {
    await table.getByRole('button', { name: 'Add row', exact: true }).click();
    await table.getByLabel('Name row 1', { exact: true }).fill('A-sim');
    await table.getByLabel('iOS version row 1', { exact: true }).fill('1');
    await table.getByLabel('iOS version row 1', { exact: true }).blur();
    await expect.poll(async () => (await stored()).settings.simulators).toEqual([{ name: 'A-sim', sdk: '1' }]);
  }
  const before = await stored();
  await table.getByLabel('Name row 1', { exact: true }).click();
  await page.keyboard.type('X');
  await newProfileFromMenu();
  await leaveFocus();
  const { created, from } = await profilesAfter(before.id);
  expect(created.settings.simulators, 'the new profile took the old one’s rows').toEqual(
    makeDefaultProfile({ id: 'x', now: 0 }).settings.simulators
  );
  expect(from.settings.simulators).toEqual(before.settings.simulators);
  // The table on screen is the new profile's, which has no simulators.
  await expect(table.getByLabel('Name row 1', { exact: true })).toHaveCount(0);
  await dropNewProfile();
});

test('File > New Profile with a number being typed keeps each profile’s own value', async () => {
  await setTechnical(page, true);
  await openSettingsTab('All settings');
  const before = await stored();
  const keepAlive = page.getByRole('spinbutton', { name: 'Keep-alive timeout' });
  await keepAlive.click();
  await keepAlive.fill('4242');
  await newProfileFromMenu();
  await leaveFocus();
  const { created, from } = await profilesAfter(before.id);
  expect(created.server.keepAliveTimeout).toBe(makeDefaultProfile({ id: 'x', now: 0 }).server.keepAliveTimeout);
  // The number went to the profile it was typed in as it was typed (R50); the new one keeps its own.
  expect(from.server.keepAliveTimeout).toBe(4242);
  await setTechnical(page, false);
  await dropNewProfile();
});

test('File > New Profile with All settings searched starts the new profile with an empty search box', async () => {
  // The search box keeps its own text, so another profile must start without it (carry 10).
  await openSettingsTab('All settings');
  const search = page.getByTestId('settings-search');
  await search.fill('Simulators to offer');
  await search.focus();
  await newProfileFromMenu();
  await expect(search).toHaveValue('');
  await dropNewProfile();
});

test('saving a Gemini key turns Used by this profile on', async () => {
  // AI repair is on with Gemini by default, so Essentials offers the Gemini key.
  await openSettingsTab('Essentials');
  expect((await stored()).secretRefs).not.toContain('XENON_GEMINI_API_KEY');
  const box = page.getByLabel('Gemini key', { exact: true });
  await box.fill('g-test-1');
  await page.getByRole('button', { name: 'Save Gemini key', exact: true }).click();
  await expect(box).toHaveValue('');
  await expect(box).toHaveAttribute('placeholder', '•••••••• saved');
  expect(keychain().XENON_GEMINI_API_KEY).toBe('g-test-1');
  await expect.poll(async () => (await stored()).secretRefs).toContain('XENON_GEMINI_API_KEY');
  expect(profilesFile()).not.toContain('g-test-1');
  // Keys & accounts says the same.
  await openSettingsTab('Keys & accounts');
  await expect(keyRow('Gemini key').getByText('Saved', { exact: true })).toBeVisible();
  await expect(switchNamed('Used by this profile: Gemini key')).toHaveAttribute('aria-checked', 'true');

  // Clear from Essentials asks too, and clears the Keychain value only.
  await openSettingsTab('Essentials');
  await page.getByRole('button', { name: 'Clear Gemini key', exact: true }).click();
  await clearDialog('Gemini key').getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Clear Gemini key', exact: true })).toHaveCount(0);
  expect(keychain().XENON_GEMINI_API_KEY).toBeUndefined();
  await expect(box).toBeFocused();
  await page.waitForTimeout(500); // past the save's 300 ms
  expect((await stored()).secretRefs).toContain('XENON_GEMINI_API_KEY');
});

/** The hub section's rows in Essentials. */
const hub = {
  toggle: () => switchNamed('Share this Mac’s phones with a lab hub'),
  address: () => page.getByRole('textbox', { name: 'Hub address', exact: true }),
  accessKey: () => page.getByLabel('Access key', { exact: true }),
  token: () => page.getByLabel('Token', { exact: true })
};

test('switching the hub on with no address saves nothing, and another profile starts with it off', async () => {
  await openSettingsTab('Essentials');
  await expect(hub.toggle()).toHaveAttribute('aria-checked', 'false');
  await expect(hub.address()).toHaveCount(0);
  await hub.toggle().click();
  // On: the address, access key and token, with the cursor in the address.
  await expect(hub.toggle()).toHaveAttribute('aria-checked', 'true');
  await expect(hub.address()).toBeFocused();
  await expect(hub.address()).toHaveValue('');
  await expect(hub.accessKey()).toBeVisible();
  await expect(hub.token()).toBeVisible();
  await page.waitForTimeout(500); // past the save's 300 ms
  expect('hub' in (await stored()).settings).toBe(false);
  expect(profilesFile()).not.toMatch(/"hub"/);
  // The section is this profile's: a new one starts with it off, and so does this one, opened again.
  await newProfileFromMenu();
  await openSettingsTab('Essentials');
  await expect(hub.toggle()).toHaveAttribute('aria-checked', 'false');
  await dropNewProfile();
  await openSettingsTab('Essentials');
  await expect(hub.toggle()).toHaveAttribute('aria-checked', 'false');
});

test('the hub switch reveals address and keys, and off keeps the keys', async () => {
  await openSettingsTab('Essentials');
  await hub.toggle().click();
  await hub.address().fill('http://hub-mac:4723');
  await expect.poll(async () => (await stored()).settings.hub).toBe('http://hub-mac:4723');
  await hub.accessKey().fill('a-test-1');
  await page.getByRole('button', { name: 'Save Hub access key', exact: true }).click();
  await hub.token().fill('t-test-1');
  await page.getByRole('button', { name: 'Save Hub token', exact: true }).click();
  await expect(hub.token()).toHaveAttribute('placeholder', '•••••••• saved');
  expect(keychain()).toMatchObject({ XENON_HUB_ACCESS_KEY: 'a-test-1', XENON_HUB_TOKEN: 't-test-1' });
  await expect.poll(async () => (await stored()).secretRefs).toEqual(expect.arrayContaining(['XENON_HUB_ACCESS_KEY', 'XENON_HUB_TOKEN']));

  // Emptying a saved address deletes it, and the rows stay while it is typed again.
  await hub.address().fill('');
  await expect.poll(async () => 'hub' in (await stored()).settings).toBe(false);
  await expect(hub.toggle()).toHaveAttribute('aria-checked', 'true');
  await expect(hub.address()).toBeVisible();
  await expect(hub.accessKey()).toBeVisible();
  await expect(hub.token()).toBeVisible();
  await hub.address().fill('http://hub-mac:4723');
  await expect.poll(async () => (await stored()).settings.hub).toBe('http://hub-mac:4723');

  // Off clears the address and keeps the keys, saved and used by this profile.
  await hub.toggle().click();
  await expect(hub.address()).toHaveCount(0);
  await expect(hub.accessKey()).toHaveCount(0);
  await expect.poll(async () => 'hub' in (await stored()).settings).toBe(false);
  expect(keychain()).toMatchObject({ XENON_HUB_ACCESS_KEY: 'a-test-1', XENON_HUB_TOKEN: 't-test-1' });
  expect((await stored()).secretRefs).toEqual(expect.arrayContaining(['XENON_HUB_ACCESS_KEY', 'XENON_HUB_TOKEN']));
  await openSettingsTab('Keys & accounts');
  await expect(switchNamed('Used by this profile: Hub access key')).toHaveAttribute('aria-checked', 'true');
  await expect(switchNamed('Used by this profile: Hub token')).toHaveAttribute('aria-checked', 'true');

  // On again: the address is empty, and the keys are still saved.
  await openSettingsTab('Essentials');
  await hub.toggle().click();
  await expect(hub.address()).toHaveValue('');
  await expect(hub.accessKey()).toHaveAttribute('placeholder', '•••••••• saved');
  await hub.toggle().click();
});

test('a wrong hub address opens Essentials at its box', async () => {
  // A problem with a setting Essentials shows is fixed there: Start puts the cursor in the hub's address,
  // not on the switch that shares its option (carry 3).
  await openSettingsTab('Essentials');
  await hub.toggle().click();
  await hub.address().fill('http://hub-mac:4723/wd/hub');
  await openSettingsTab('All settings');
  await page.getByRole('tab', { name: 'Home', exact: true }).click();
  await clickMenuItem(app, 'Server', { accelerator: 'Cmd+Return' });
  await expect(page.getByRole('tab', { name: 'Essentials', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(hub.address()).toBeFocused();
  await hub.address().fill('');
  await hub.toggle().click();
  await expect.poll(async () => 'hub' in (await stored()).settings).toBe(false);
});

test('a key saved while another profile opens is used by the profile it was saved on (R51)', async () => {
  // The Keychain takes 1.5 s to answer, and File > New Profile opens another profile meanwhile.
  await openSettingsTab('Keys & accounts');
  const used = switchNamed('Used by this profile: Gemini key');
  if ((await used.getAttribute('aria-checked')) === 'true') await used.click();
  await expect.poll(async () => (await stored()).secretRefs).not.toContain('XENON_GEMINI_API_KEY');
  const original = (await stored()).id;
  type Handler = (...args: unknown[]) => unknown;
  await app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
    const g = globalThis as unknown as { realSecretSet?: Handler };
    g.realSecretSet ??= handlers.get('secrets:set');
    const real = g.realSecretSet!;
    handlers.set('secrets:set', async (...args: unknown[]) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return real(...args);
    });
  });
  try {
    await openSettingsTab('Essentials');
    await page.getByLabel('Gemini key', { exact: true }).fill('g-test-2');
    await page.getByRole('button', { name: 'Save Gemini key', exact: true }).click();
    await newProfileFromMenu();
    await expect.poll(() => keychain().XENON_GEMINI_API_KEY, { timeout: 5_000 }).toBe('g-test-2');
    await page.waitForTimeout(800); // the profile's save has been answered
    const all = await page.evaluate(() => window.xenon.profiles.list());
    const uses = Object.fromEntries(all.map((p) => [p.id === original ? 'original' : p.name, p.secretRefs.includes('XENON_GEMINI_API_KEY')]));
    expect(uses).toEqual({ original: true, 'New profile': false });
    // The new profile on screen doesn't use it either.
    await openSettingsTab('Keys & accounts');
    await expect(switchNamed('Used by this profile: Gemini key')).toHaveAttribute('aria-checked', 'false');
  } finally {
    await app.evaluate(({ ipcMain }) => {
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
      const real = (globalThis as unknown as { realSecretSet?: Handler }).realSecretSet;
      if (real) handlers.set('secrets:set', real);
    });
    await page.evaluate(() => window.xenon.secrets.clear('XENON_GEMINI_API_KEY'));
    await dropNewProfile();
  }
});

test('a cloud key saved in Keys & accounts is this profile’s own: the preview names it, and a new profile has none (R54)', async () => {
  await openSettingsTab('Keys & accounts');
  await cloudKeyRow().locator('input[type="password"]').fill('k-test-1');
  await cloudKeyRow().getByRole('button', { name: 'Save Cloud access key', exact: true }).click();
  await expect(cloudKeyRow().getByText('Saved for this profile', { exact: true })).toBeVisible();
  expect(keychain()[ownSlot('CLOUD_KEY')]).toBe('k-test-1');
  expect(keychain().CLOUD_KEY).toBeUndefined();
  expect((await stored()).secretRefs).not.toContain('CLOUD_KEY');
  expect(profilesFile()).not.toContain('k-test-1');
  // The preview names CLOUD_KEY among what the launch passes, never its value.
  const spec = await page.evaluate(async () => window.xenon.server.launchPreview((await window.xenon.profiles.list())[0]));
  expect(spec.envKeys).toContain('CLOUD_KEY');
  expect(JSON.stringify(spec)).not.toContain('k-test-1');
  // Another profile has no cloud key of its own.
  await newProfileFromMenu();
  await openSettingsTab('Keys & accounts');
  await expect(cloudKeyRow().getByText('Not set', { exact: true })).toBeVisible();
  const created = await page.evaluate(async () => (await window.xenon.profiles.list()).find((p) => p.name === 'New profile')!);
  const createdSpec = await page.evaluate((p) => window.xenon.server.launchPreview(p), created);
  expect(createdSpec.envKeys).not.toContain('CLOUD_KEY');
  await dropNewProfile();
  await openSettingsTab('Keys & accounts');
  await expect(cloudKeyRow().getByText('Saved for this profile', { exact: true })).toBeVisible();
});

test('a cloud key saved while another profile opens goes to the profile it was saved on (R54 with R51)', async () => {
  // The Keychain takes 1.5 s to answer, and File > New Profile opens another profile meanwhile.
  type Handler = (...args: unknown[]) => unknown;
  await app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
    const g = globalThis as unknown as { realSecretSet?: Handler };
    g.realSecretSet ??= handlers.get('secrets:set');
    const real = g.realSecretSet!;
    handlers.set('secrets:set', async (...args: unknown[]) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return real(...args);
    });
  });
  try {
    await openSettingsTab('Keys & accounts');
    await cloudKeyRow().locator('input[type="password"]').fill('k-test-2');
    await cloudKeyRow().getByRole('button', { name: 'Save Cloud access key', exact: true }).click();
    await newProfileFromMenu();
    await expect.poll(() => keychain()[ownSlot('CLOUD_KEY')], { timeout: 5_000 }).toBe('k-test-2');
    const created = await page.evaluate(async () => (await window.xenon.profiles.list()).find((p) => p.name === 'New profile')!.id);
    expect(keychain()[ownSlot('CLOUD_KEY', created)]).toBeUndefined();
    await openSettingsTab('Keys & accounts');
    await expect(cloudKeyRow().getByText('Not set', { exact: true })).toBeVisible();
  } finally {
    await app.evaluate(({ ipcMain }) => {
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
      const real = (globalThis as unknown as { realSecretSet?: Handler }).realSecretSet;
      if (real) handlers.set('secrets:set', real);
    });
    await dropNewProfile();
  }
});

/**
 * Starts a profile through the real start (its save, its Keychain secrets, its
 * launch plan), with a stand-in for Appium that says it is listening and waits,
 * then stops it. Returns the cloud and proxy variables that process was given.
 */
async function launchVariables(target: { app: ElectronApplication; page: Page }, profileId: string, cwd: string) {
  type Launched = Record<string, string | undefined>;
  await target.app.evaluate((_electron, dir) => {
    type Spawn = (cmd: string, args: string[], opts: { env?: Launched; cwd?: string }) => unknown;
    const cp = (process as unknown as { mainModule: { require(id: string): { spawn: Spawn } } }).mainModule.require('node:child_process');
    const g = globalThis as unknown as { realSpawn?: Spawn; launched?: Launched | null };
    g.realSpawn ??= cp.spawn;
    g.launched = null;
    cp.spawn = (cmd, args, opts) => {
      if (!/(^|\/)appium$/.test(String(cmd))) return g.realSpawn!(cmd, args, opts);
      const env = opts.env ?? {};
      g.launched = { CLOUD_KEY: env.CLOUD_KEY, CLOUD_USERNAME: env.CLOUD_USERNAME, HTTP_PROXY: env.HTTP_PROXY, HTTPS_PROXY: env.HTTPS_PROXY };
      return g.realSpawn!('/bin/sh', ['-c', 'echo "Appium REST http interface listener started"; exec sleep 60'], { cwd: dir });
    };
  }, cwd);
  try {
    await target.page.evaluate(async (id) => {
      const profile = (await window.xenon.profiles.list()).find((p) => p.id === id)!;
      await window.xenon.server.start(profile);
    }, profileId);
    await expect.poll(() => target.app.evaluate(() => (globalThis as unknown as { launched?: unknown }).launched ?? null)).not.toBeNull();
    return (await target.app.evaluate(() => (globalThis as unknown as { launched: Launched }).launched)) as Launched;
  } finally {
    await target.page.evaluate(() => window.xenon.server.stop());
    await expect.poll(() => target.page.evaluate(async () => (await window.xenon.server.state()).status)).toBe('stopped');
    await target.app.evaluate(() => {
      const cp = (process as unknown as { mainModule: { require(id: string): { spawn: unknown } } }).mainModule.require('node:child_process');
      const g = globalThis as unknown as { realSpawn?: unknown };
      if (g.realSpawn) cp.spawn = g.realSpawn;
    });
  }
}

test('the C1 probe: deleting one profile leaves the other its own cloud key and proxy password, and it launches with them (R54)', async () => {
  // Its own app on its own folder: two 0.2.0 profiles, A on BrowserStack and B on LambdaTest, each
  // behind its own proxy, holding the key and the password in plain text. They are written once the
  // stand-in Keychain is in place, and the window reads them when it is loaded again.
  const dir = mkdtempSync(path.join(os.tmpdir(), 'xenon-e2e-c1-'));
  const appiumHome = mkdtempSync(path.join(os.tmpdir(), 'xenon-e2e-c1-home-'));
  const port = await pickFreePort();
  const old = (name: string, cloudName: string, key: string, password: string): Profile => {
    const base = makeDefaultProfile({ id: randomUUID(), now: Date.now(), name });
    return {
      ...base,
      settings: {
        ...base.settings,
        platform: 'android',
        androidDeviceType: 'simulated',
        cloud: { cloudName, url: `https://hub.${cloudName}.example/wd/hub`, username: `qa-${name}`, apiKey: key },
        proxy: { host: `proxy-${name}.lab`, port: 3128, auth: { username: 'qa', password } }
      },
      server: { ...base.server, port, appiumHome }
    };
  };
  const a = old('A', 'browserstack', 'k-test-A', 'p-test-A');
  const b = old('B', 'lambdatest', 'k-test-B', 'p-test-B');
  seedProfiles(dir, [{ ...makeDefaultProfile({ id: randomUUID(), now: Date.now(), name: 'Placeholder' }), server: { ...a.server } }]);
  let second: { app: ElectronApplication; page: Page } | undefined;
  try {
    second = await launchApp({ userDataDir: dir, asCurrent: false });
    await installStandIn(second.app);
    seedProfiles(dir, [a, b]);
    await second.page.reload();
    await expect(profileSwitcher(second.page)).toHaveText('A', { timeout: 20_000 });
    expect(keychainIn(dir)).toEqual({
      [`CLOUD_KEY@${a.id}`]: 'k-test-A',
      [`PROXY_PASSWORD@${a.id}`]: 'p-test-A',
      [`CLOUD_KEY@${b.id}`]: 'k-test-B',
      [`PROXY_PASSWORD@${b.id}`]: 'p-test-B'
    });
    expect(readFileSync(path.join(dir, 'profiles.json'), 'utf8')).not.toMatch(/k-test-|p-test-/);

    // Two profiles behind different proxies each launch with their own password.
    expect(await launchVariables(second, a.id, appiumHome)).toEqual({
      CLOUD_KEY: 'k-test-A',
      CLOUD_USERNAME: 'qa-A',
      HTTP_PROXY: 'http://qa:p-test-A@proxy-A.lab:3128',
      HTTPS_PROXY: 'http://qa:p-test-A@proxy-A.lab:3128'
    });

    // A is deleted: B keeps its own, and A's go with it.
    await second.page.evaluate((id) => window.xenon.profiles.delete(id), a.id);
    await second.page.evaluate(() => window.xenon.profiles.list());
    expect(keychainIn(dir)).toEqual({ [`CLOUD_KEY@${b.id}`]: 'k-test-B', [`PROXY_PASSWORD@${b.id}`]: 'p-test-B' });
    expect(await launchVariables(second, b.id, appiumHome)).toEqual({
      CLOUD_KEY: 'k-test-B',
      CLOUD_USERNAME: 'qa-B',
      HTTP_PROXY: 'http://qa:p-test-B@proxy-B.lab:3128',
      HTTPS_PROXY: 'http://qa:p-test-B@proxy-B.lab:3128'
    });
    expect(readFileSync(path.join(dir, 'profiles.json'), 'utf8')).not.toMatch(/k-test-|p-test-/);
  } finally {
    await second?.app.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(appiumHome, { recursive: true, force: true });
  }
});

test('Keys & accounts: saving a shared key turns Used by this profile on, and names the other profiles that use it (I1)', async () => {
  // Another profile uses the Gemini key.
  await newProfileFromMenu();
  await openSettingsTab('Keys & accounts');
  await switchNamed('Used by this profile: Gemini key').click();
  const createdRefs = () =>
    page.evaluate(async () => (await window.xenon.profiles.list()).find((p) => p.name === 'New profile')!.secretRefs);
  await expect.poll(createdRefs).toContain('XENON_GEMINI_API_KEY');
  await switchProfile('Keychain probe');
  try {
    await openSettingsTab('Keys & accounts');
    const gemini = keyRow('Gemini key');
    const box = gemini.getByLabel('Gemini key', { exact: true });
    // Saving here changes it for that profile too, and the box says so.
    await expect(gemini.getByText('Also used by New profile.', { exact: true })).toBeVisible();
    await expect(box).toHaveAccessibleDescription('Also used by New profile.');
    // A profile's own key is never another's: no such line under it.
    await expect(cloudKeyRow().getByText(/^Also used by/)).toHaveCount(0);

    const used = switchNamed('Used by this profile: Gemini key');
    if ((await used.getAttribute('aria-checked')) === 'true') await used.click();
    await expect.poll(async () => (await stored()).secretRefs).not.toContain('XENON_GEMINI_API_KEY');
    await box.fill('g-test-3');
    await gemini.getByRole('button', { name: 'Save Gemini key', exact: true }).click();
    await expect(box).toHaveAttribute('placeholder', '•••••••• saved');
    // Saved from Keys & accounts, it is turned on for the profile Save was pressed on, as from Essentials.
    await expect(used).toHaveAttribute('aria-checked', 'true');
    await expect.poll(async () => (await stored()).secretRefs).toContain('XENON_GEMINI_API_KEY');
    expect(profilesFile()).not.toContain('g-test-3');
  } finally {
    await page.evaluate(() => window.xenon.secrets.clear('XENON_GEMINI_API_KEY', null));
    await dropNewProfile();
  }
});

test('Keys & accounts warns when this profile’s saved proxy password has a colon in it (R53)', async () => {
  await openSettingsTab('Keys & accounts');
  const note = proxyPasswordRow().getByText(/^This password has a colon \(:\)\./);
  const box = proxyPasswordRow().locator('input[type="password"]');
  const save = proxyPasswordRow().getByRole('button', { name: 'Save Proxy password', exact: true });
  await box.fill('p-test:5');
  await save.click();
  await expect(note).toBeVisible();
  // It is announced politely as it appears.
  await expect(proxyPasswordRow().getByRole('status').filter({ hasText: /^This password has a colon/ })).toHaveCount(1);
  expect(keychain()[ownSlot('PROXY_PASSWORD')]).toBe('p-test:5');
  // Another profile's password is its own: a new profile has no note.
  await newProfileFromMenu();
  await openSettingsTab('Keys & accounts');
  await expect(proxyPasswordRow().getByText(/^This password has a colon/)).toHaveCount(0);
  await dropNewProfile();
  // A password without one: no note.
  await openSettingsTab('Keys & accounts');
  await expect(note).toBeVisible();
  await box.fill('p-test-6');
  await save.click();
  await expect(note).toHaveCount(0);
  expect(keychain()[ownSlot('PROXY_PASSWORD')]).toBe('p-test-6');
  // Nothing on screen, in a file or in what the window was told holds the password.
  await expect(page.locator('body')).not.toContainText('p-test-');
  expect(profilesFile()).not.toContain('p-test-');
});

test('a user name and key typed into the provider address are flagged, and never reach a file (R55)', async () => {
  await openSettingsTab('All settings');
  const address = page.getByRole('textbox', { name: 'Provider address', exact: true });
  const message = 'Leave your user name and key out of the address; save the key in Keys & accounts.';
  const hint = page.locator('[data-setting-key="cloud.url"]').getByText(message, { exact: true });
  // Saves are answered after 1.5 s, so the window holds what was typed for a moment.
  type Handler = (...args: unknown[]) => unknown;
  await app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
    const g = globalThis as unknown as { realProfileSave?: Handler };
    g.realProfileSave ??= handlers.get('profiles:save');
    const real = g.realProfileSave!;
    handlers.set('profiles:save', async (...args: unknown[]) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return real(...args);
    });
  });
  try {
    await address.fill('https://qa-user:k-test-9@hub-cloud.browserstack.example/wd/hub');
    await expect(hint).toBeVisible();
    // The list of problems above the tabs names it in plain words too.
    await expect(page.getByText(`Provider address: ${message}`, { exact: true })).toBeVisible();
    // The save cuts them out: the stored address, the file, and then the box.
    await expect
      .poll(async () => ((await stored()).settings.cloud as { url?: string } | undefined)?.url, { timeout: 5_000 })
      .toBe('https://hub-cloud.browserstack.example/wd/hub');
    expect(profilesFile()).not.toMatch(/k-test-9|qa-user/);
    await expect(address).toHaveValue('https://hub-cloud.browserstack.example/wd/hub');
    await expect(hint).toHaveCount(0);
  } finally {
    await app.evaluate(({ ipcMain }) => {
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
      const real = (globalThis as unknown as { realProfileSave?: Handler }).realProfileSave;
      if (real) handlers.set('profiles:save', real);
    });
    await address.fill('');
    await expect.poll(async () => ((await stored()).settings.cloud as { url?: string } | undefined)?.url).toBeUndefined();
  }
});

test('the proxy is edited as fields, and the cloud user name has a plain box that never reaches the config (R56)', async () => {
  await openSettingsTab('All settings');
  const cloudUser = page.getByRole('textbox', { name: 'Cloud user name', exact: true });
  const port = page.getByRole('spinbutton', { name: 'Proxy port', exact: true });
  const before = (await stored()).settings.proxy as { port?: number } | undefined;
  try {
    await cloudUser.fill('qa-user-1');
    await expect.poll(async () => ((await stored()).settings.cloud as { username?: string } | undefined)?.username).toBe('qa-user-1');
    // Passed as CLOUD_USERNAME, and never written to the config.
    const spec = await page.evaluate(async () => window.xenon.server.launchPreview((await window.xenon.profiles.list())[0]));
    expect(spec.envKeys).toContain('CLOUD_USERNAME');
    expect(spec.configYaml).not.toContain('qa-user-1');

    // The proxy's port is a number box, bounded like a port, and its connection a choice in plain words.
    await port.fill('0');
    await port.blur();
    await expect(page.locator('[data-setting-key="proxy.port"]').getByText('Enter 1 or more.', { exact: true })).toBeVisible();
    await port.fill('8080');
    await port.blur();
    await expect.poll(async () => ((await stored()).settings.proxy as { port?: number }).port).toBe(8080);
    await expect(page.getByRole('radiogroup', { name: 'Connection to the proxy', exact: true }).getByRole('radio')).toHaveText(['HTTP', 'HTTPS']);
    // Its password is set where this profile's is kept.
    await page.locator('[data-setting-key="proxy.auth.password"]').getByRole('button', { name: 'Open Keys & accounts', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Keys & accounts', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(proxyPasswordRow()).toBeVisible();
  } finally {
    await openSettingsTab('All settings');
    await cloudUser.fill('');
    await port.fill(before?.port === undefined ? '' : String(before.port));
    await port.blur();
    await expect.poll(async () => ((await stored()).settings.cloud as { username?: string } | undefined)?.username).toBeUndefined();
  }
});

test('a save the Keychain can’t take says so in plain words, and keeps what was typed', async () => {
  await installStandIn(app);
  await app.evaluate(({ safeStorage }) => {
    safeStorage.isEncryptionAvailable = () => false;
  });
  try {
    await openSettingsTab('Keys & accounts');
    const box = proxyPasswordRow().locator('input[type="password"]');
    await box.fill('p-test-7');
    await proxyPasswordRow().getByRole('button', { name: 'Save Proxy password', exact: true }).click();
    await expect(
      page.getByText('Couldn’t save the Proxy password: this Mac’s Keychain isn’t available, so it wasn’t saved anywhere. Try again later.', {
        exact: true
      })
    ).toBeVisible();
    // The box keeps the text for another try, and nothing was stored or written.
    await expect(box).toHaveValue('p-test-7');
    expect(keychain()[ownSlot('PROXY_PASSWORD')]).not.toBe('p-test-7');
    expect(profilesFile()).not.toContain('p-test-7');
  } finally {
    await installStandIn(app);
    await proxyPasswordRow().locator('input[type="password"]').fill('');
  }
});

