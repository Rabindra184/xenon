import { test, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeDefaultProfile } from '../../src/shared/profileDefaults';
import type { Profile } from '../../src/shared/types';
import { clickMenuItem, launchApp, openPlace, pickFreePort, profileSwitcher, seedProfiles, setTechnical } from './helpers';

// The cloud key and the proxy password in the window (Task 14, fix round 1): the
// draft lets go of a value main moved to the Keychain (R40), the cloud key is
// never typed into a box (R39), and the preview shows the launch that will run
// (I4). The app runs on its own throwaway folder, and its Keychain is a stand-in
// (safeStorage replaced in the main process before any secret is stored), so
// nothing here reaches the Mac's real Keychain. The values are fake. No server
// is started.

let app: ElectronApplication;
let page: Page;
let userDataDir: string;

const STAND_IN = 'stand-in:';

/** What the stand-in Keychain holds, read from the secrets file. */
function keychain(): Record<string, string> {
  const file = path.join(userDataDir, 'secrets.json');
  if (!existsSync(file)) return {};
  const stored = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
  return Object.fromEntries(
    Object.entries(stored).map(([key, cipher]) => [key, Buffer.from(cipher, 'base64').toString('utf8').slice(STAND_IN.length)])
  );
}

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

/** The proxy setting's JSON box. */
const proxyBox = (): Locator => page.locator('[data-setting-key="proxy"] textarea');

/** Types the proxy settings and leaves the box, which commits them. */
async function setProxy(value: unknown) {
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
  // A number box commits when it is left or Enter is pressed.
  await box.press('Enter');
  await expect.poll(async () => (await stored()).settings.maxSessions).toBe(n);
}

/** A secret's group in Keys & accounts, by its plain label. */
const keyRow = (label: string): Locator => page.getByRole('region', { name: label, exact: true });

/** The proxy password's row in Keys & accounts. */
const proxyPasswordRow = (): Locator => keyRow('Proxy password');

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
  ({ app, page } = await launchApp({ userDataDir }));
  // A stand-in for the Keychain: reversible, and never the Mac's own.
  await app.evaluate(({ safeStorage }, prefix) => {
    safeStorage.isEncryptionAvailable = () => true;
    safeStorage.encryptString = (text: string) => Buffer.from(prefix + text, 'utf8');
    safeStorage.decryptString = (cipher: Buffer) => cipher.toString('utf8').slice(prefix.length);
  }, STAND_IN);
});

test.afterAll(async () => {
  await app?.close();
  if (userDataDir) rmSync(userDataDir, { recursive: true, force: true });
});

test('a proxy password typed in the proxy settings moves to the Keychain, and the window lets go of it (R40)', async () => {
  await setProxy({ host: 'squid.lab', port: 3128, auth: { username: 'qa', password: 'p-test-old' } });
  await expect.poll(async () => (await stored()).secretRefs).toContain('PROXY_PASSWORD');
  expect(keychain().PROXY_PASSWORD).toBe('p-test-old');
  expect(profilesFile()).not.toContain('p-test-old');
  // The window took the profile as stored: the box shows the proxy without the password.
  await expect(proxyBox()).not.toHaveValue(/p-test-old/);
  await expect(proxyBox()).toHaveValue(/squid\.lab/);
  // Keys & accounts shows the password as saved and used by this profile.
  await openSettingsTab('Keys & accounts');
  await expect(proxyPasswordRow().getByText('Saved', { exact: true })).toBeVisible();
  await expect(switchNamed('Used by this profile: Proxy password')).toHaveAttribute('aria-checked', 'true');
});

test('a cleared proxy password stays cleared after the next edit', async () => {
  await openSettingsTab('Keys & accounts');
  // Clear asks first, and Cancel keeps it.
  await proxyPasswordRow().getByRole('button', { name: 'Clear Proxy password', exact: true }).click();
  await expect(clearDialog('Proxy password')).toBeVisible();
  await clearDialog('Proxy password').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(clearDialog('Proxy password')).toHaveCount(0);
  expect(keychain().PROXY_PASSWORD).toBe('p-test-old');
  await proxyPasswordRow().getByRole('button', { name: 'Clear Proxy password', exact: true }).click();
  await clearDialog('Proxy password').getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(proxyPasswordRow().getByText('Not set', { exact: true })).toBeVisible();
  expect(keychain().PROXY_PASSWORD).toBeUndefined();
  // Clear wipes the Keychain value only: whether the profile uses it is its own switch (carry 4), and
  // the cursor is back in the box, since Clear itself has gone.
  await expect(switchNamed('Used by this profile: Proxy password')).toHaveAttribute('aria-checked', 'true');
  expect((await stored()).secretRefs).toContain('PROXY_PASSWORD');
  await expect(proxyPasswordRow().getByLabel('Proxy password', { exact: true })).toBeFocused();
  // Another edit, which a draft still holding the old password would store again.
  await editMaxSessions(3);
  expect(keychain().PROXY_PASSWORD).toBeUndefined();
  expect(profilesFile()).not.toContain('p-test-old');
});

test('a password replaced in Keys & accounts is not put back by the next edit', async () => {
  await openSettingsTab('Keys & accounts');
  await proxyPasswordRow().locator('input[type="password"]').fill('p-test-new');
  await proxyPasswordRow().getByRole('button', { name: 'Save Proxy password', exact: true }).click();
  await expect(proxyPasswordRow().getByText('Saved', { exact: true })).toBeVisible();
  // The box lets go of what was typed, and Save keeps the cursor (R20).
  await expect(proxyPasswordRow().locator('input[type="password"]')).toHaveValue('');
  await expect(proxyPasswordRow().getByRole('button', { name: 'Save Proxy password', exact: true })).toBeFocused();
  // Another edit, which a draft still holding the old password would store over the new one.
  await editMaxSessions(4);
  expect(keychain().PROXY_PASSWORD).toBe('p-test-new');
  expect(profilesFile()).not.toMatch(/p-test-old|p-test-new/);
  await openSettingsTab('Keys & accounts');
  await expect(switchNamed('Used by this profile: Proxy password')).toHaveAttribute('aria-checked', 'true');
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
  expect(from.server.keepAliveTimeout).toBe(before.server.keepAliveTimeout);
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
